"use client";

import { useState, useRef, useEffect, useCallback, useMemo, useEffectEvent } from 'react';
import { pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AppSettings } from '@/context/AppContext';
import { HistoryRecord, setPageTranslation } from '@/lib/db';
import { executeTranslateStream } from '@/lib/llmClient';
import { consumeTextStream, readErrorResponse } from '@/lib/llm/protocol';
import { extractPdfTextWithHierarchy, parseTranslationOutput } from '@/services/alignmentEngine';
import { analyzePageLayout } from '@/services/layoutAnalysisEngine';
import { schedulePush } from '@/services/cloudSyncService';
import { getLookaheadPagesToPreload } from '@/lib/pageRanges';

export interface UseTranslatorOptions {
  file: File | null;
  pdfDocument?: PDFDocumentProxy | null;
  pageNumber: number;
  numPages: number;
  settings: AppSettings;
  preloadCount?: number;
  dbRecord: HistoryRecord | null;
  setDbRecord: React.Dispatch<React.SetStateAction<HistoryRecord | null>>;
}

interface StreamState {
  page: number;
  text: string;
  thinking: boolean;
}

interface PageMessage {
  page: number;
  text: string;
}

/** 上一页结尾作为跨页上下文的最大字符数 */
const PREVIOUS_TAIL_CHARS = 400;

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item;
}

/** 提取单页原文：优先使用版面分析得到的段落块，失败时退回按字号分级的纯文本 */
export async function extractPageText(doc: PDFDocumentProxy, page: number): Promise<string> {
  const pdfPage = await doc.getPage(page);
  const textContent = await pdfPage.getTextContent();
  const items = textContent.items.filter(isTextItem);
  const blocks = analyzePageLayout(items, pdfPage.view, page);
  return blocks.length > 0 ? blocks.map(b => b.text).join('\n\n') : extractPdfTextWithHierarchy(items);
}

/** 上一页末尾的一段文字，从单词边界开始截取 */
async function getPreviousPageTail(doc: PDFDocumentProxy, page: number): Promise<string> {
  if (page <= 1) return '';
  const text = (await extractPageText(doc, page - 1)).trim();
  if (text.length <= PREVIOUS_TAIL_CHARS) return text;
  const tail = text.slice(-PREVIOUS_TAIL_CHARS);
  const firstSpace = tail.indexOf(' ');
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
}

export function useTranslator(options: UseTranslatorOptions) {
  const { file, pdfDocument, pageNumber, numPages, settings, preloadCount = 2, dbRecord, setDbRecord } = options;

  const [stream, setStream] = useState<StreamState | null>(null);
  const [translatingPage, setTranslatingPage] = useState<number | null>(null);
  const [noTextPage, setNoTextPage] = useState<number | null>(null);
  const [pageError, setPageError] = useState<PageMessage | null>(null);
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  const [preloadingPages, setPreloadingPages] = useState<number[] | null>(null);
  const [preloadProgress, setPreloadProgress] = useState<{ total: number; done: number }>({ total: 0, done: 0 });

  const translationCache = useMemo(() => dbRecord?.translations ?? {}, [dbRecord?.translations]);
  const translationCacheRef = useRef<Record<number, string>>(translationCache);
  const currentPageRef = useRef<number>(pageNumber);
  const abortControllerRef = useRef<AbortController | null>(null);
  const preloadAbortRef = useRef<AbortController | null>(null);
  const preloadTargetPagesRef = useRef<number[]>([]);
  const recordId = dbRecord?.id;

  useEffect(() => {
    translationCacheRef.current = translationCache;
  }, [translationCache]);

  // 翻页时取消进行中的当前页翻译，并检测本页是否有内嵌文本层
  useEffect(() => {
    currentPageRef.current = pageNumber;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (!pdfDocument || pageNumber < 1) return;
    let cancelled = false;
    extractPageText(pdfDocument, pageNumber)
      .then(txt => {
        if (!cancelled) {
          setNoTextPage(txt.trim() ? null : pageNumber);
        }
      })
      .catch(() => {
        // 忽略翻页读取异常
      });
    return () => {
      cancelled = true;
    };
  }, [pageNumber, pdfDocument]);

  // 切换文档或卸载时取消所有请求
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      preloadAbortRef.current?.abort();
    };
  }, [recordId]);

  const getPdfDoc = useCallback(async (): Promise<PDFDocumentProxy | null> => {
    if (pdfDocument) return pdfDocument;
    if (!file) return null;
    return pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  }, [pdfDocument, file]);

  const extractPagePlainText = useCallback(
    async (targetPage: number): Promise<string> => {
      try {
        const doc = await getPdfDoc();
        if (!doc || targetPage < 1 || (doc.numPages && targetPage > doc.numPages)) return '';
        return await extractPageText(doc, targetPage);
      } catch {
        return '';
      }
    },
    [getPdfDoc]
  );

  /** 写入本地数据库、更新内存状态，并安排云端增量同步 */
  const persistTranslation = useCallback(
    async (page: number, text: string) => {
      if (!recordId) return;
      const updated = await setPageTranslation(recordId, page, text);
      if (!updated) return;
      setDbRecord(prev =>
        prev && prev.id === updated.id
          ? { ...prev, translations: updated.translations, translationTimes: updated.translationTimes }
          : prev
      );
      if (settings.syncKey?.trim() && settings.autoCloudSync !== false) {
        schedulePush(recordId, settings.syncKey);
      }
    },
    [recordId, setDbRecord, settings.syncKey, settings.autoCloudSync]
  );

  /** 请求模型翻译一段文本，返回清洗后的 Markdown */
  const requestTranslation = useCallback(
    async (
      text: string,
      previousPageTail: string,
      signal: AbortSignal,
      onStream?: (raw: string) => void
    ): Promise<string> => {
      const response = await executeTranslateStream({
        text,
        previousPageTail,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        customPrompt: settings.customPrompt,
        signal,
      });
      if (!response.ok) {
        throw new Error(await readErrorResponse(response, '翻译请求失败'));
      }
      const raw = await consumeTextStream(response, onStream);
      return parseTranslationOutput(raw).cleanMarkdown;
    },
    [settings.apiKey, settings.baseUrl, settings.model, settings.provider, settings.customPrompt]
  );

  /** 翻译指定文本并作为某页译文保存（也用于 OCR 结果翻译） */
  const executeTranslateText = useCallback(
    async (sourceText: string, targetPage: number, previousPageTail = '') => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setTranslatingPage(targetPage);
      setPageError(null);
      setStream({ page: targetPage, text: '', thinking: false });

      try {
        const clean = await requestTranslation(sourceText, previousPageTail, controller.signal, raw => {
          if (currentPageRef.current !== targetPage) return;
          setStream({
            page: targetPage,
            text: parseTranslationOutput(raw).cleanMarkdown,
            thinking: raw.includes('<think>'),
          });
        });
        if (clean) await persistTranslation(targetPage, clean);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error(err);
        setPageError({ page: targetPage, text: err instanceof Error ? err.message : '翻译过程中出现异常。' });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setStream(prev => (prev?.page === targetPage ? null : prev));
        setTranslatingPage(prev => (prev === targetPage ? null : prev));
      }
    },
    [requestTranslation, persistTranslation]
  );

  /** 翻译当前页；force 为 true 时忽略已有缓存重新翻译 */
  const translateCurrentPage = useCallback(
    async (force = false) => {
      if (!file && !pdfDocument) return;
      const targetPage = pageNumber;
      if (!force && translationCacheRef.current[targetPage]) return;

      setTranslatingPage(targetPage);
      setPageError(null);
      try {
        const doc = await getPdfDoc();
        if (!doc) return;
        const text = await extractPageText(doc, targetPage);
        if (!text.trim()) {
          setNoTextPage(targetPage);
          return;
        }
        setNoTextPage(prev => (prev === targetPage ? null : prev));
        const previousTail = await getPreviousPageTail(doc, targetPage);
        await executeTranslateText(text, targetPage, previousTail);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error(err);
        setPageError({ page: targetPage, text: err instanceof Error ? err.message : '翻译过程中出现异常。' });
      } finally {
        setTranslatingPage(prev => (prev === targetPage && !abortControllerRef.current ? null : prev));
      }
    },
    [file, pdfDocument, pageNumber, getPdfDoc, executeTranslateText]
  );

  /** 后台预翻译后续窗口页面（仅检查未来 maxCount 页，跳过已有译文与无文本页面），可被取消 */
  const preTranslatePipeline = useCallback(
    async (startPage: number, maxCount = preloadCount) => {
      if (
        maxCount <= 0 ||
        (!file && !pdfDocument) ||
        (preloadAbortRef.current && !preloadAbortRef.current.signal.aborted)
      ) {
        return;
      }

      const pagesToPreload = getLookaheadPagesToPreload(
        startPage,
        numPages,
        maxCount,
        translationCacheRef.current
      );
      if (pagesToPreload.length === 0) return;

      const controller = new AbortController();
      preloadAbortRef.current = controller;
      preloadTargetPagesRef.current = pagesToPreload;
      setPreloadingPages(pagesToPreload);
      setPreloadProgress({ total: pagesToPreload.length, done: 0 });

      try {
        const doc = await getPdfDoc();
        if (!doc) return;
        let doneCount = 0;
        for (const targetPage of pagesToPreload) {
          if (controller.signal.aborted) break;
          try {
            if (!translationCacheRef.current[targetPage]) {
              const text = await extractPageText(doc, targetPage);
              if (text.trim()) {
                const previousTail = await getPreviousPageTail(doc, targetPage);
                const clean = await requestTranslation(text, previousTail, controller.signal);
                if (clean) await persistTranslation(targetPage, clean);
              }
            }
          } catch (err) {
            if (isAbortError(err)) break;
            console.warn(`预翻译第 ${targetPage} 页失败:`, err);
          }
          doneCount++;
          setPreloadProgress({ total: pagesToPreload.length, done: doneCount });
        }
      } catch (err) {
        if (!isAbortError(err)) console.error('Pipeline pre-translation error:', err);
      } finally {
        if (preloadAbortRef.current === controller) {
          preloadAbortRef.current = null;
          preloadTargetPagesRef.current = [];
          setPreloadingPages(null);
        }
      }
    },
    [preloadCount, file, pdfDocument, numPages, getPdfDoc, requestTranslation, persistTranslation]
  );

  // 自动翻译：当前页无缓存时延迟翻译，并根据用户设定的 preloadCount 预翻译后续页面
  const onAutoTranslatePage = useEffectEvent((page: number, count: number) => {
    const isCurrentCached = Boolean(translationCacheRef.current[page]);
    if (isCurrentCached && count <= 0) {
      return undefined;
    }
    const delayMs = isCurrentCached ? 120 : 320;
    const timer = setTimeout(() => {
      if (!isCurrentCached) {
        translateCurrentPage();
      }
      if (count > 0) {
        preTranslatePipeline(page, count);
      }
    }, delayMs);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (!file || !autoTranslate || preloadCount <= 0) {
      preloadAbortRef.current?.abort();
    } else if (preloadAbortRef.current && !preloadAbortRef.current.signal.aborted) {
      const windowStart = pageNumber + 1;
      const windowEnd = Math.min(numPages, pageNumber + preloadCount);
      const hasOverlap = preloadTargetPagesRef.current.some(
        p => p >= windowStart && p <= windowEnd
      );
      if (!hasOverlap) {
        preloadAbortRef.current.abort();
      }
    }
    if (!file || !autoTranslate) return;
    return onAutoTranslatePage(pageNumber, preloadCount);
  }, [file, pageNumber, numPages, autoTranslate, preloadCount]);

  const isPreTranslating = useMemo(() => {
    if (!file || !autoTranslate || preloadCount <= 0 || !preloadingPages) return false;
    const windowStart = pageNumber + 1;
    const windowEnd = Math.min(numPages, pageNumber + preloadCount);
    return preloadingPages.some(p => p >= windowStart && p <= windowEnd);
  }, [file, autoTranslate, preloadCount, preloadingPages, pageNumber, numPages]);

  const cachedText = translationCache[pageNumber];
  const displayedText = useMemo(() => {
    if (stream?.page === pageNumber) return stream.text;
    if (cachedText) return parseTranslationOutput(cachedText).cleanMarkdown;
    return '';
  }, [stream, cachedText, pageNumber]);

  const isNoTextPage = noTextPage === pageNumber && !cachedText && !(stream?.page === pageNumber);

  const setError = useCallback(
    (message: string) => setPageError(message ? { page: currentPageRef.current, text: message } : null),
    []
  );

  return {
    displayedText,
    isNoTextPage,
    isTranslating: translatingPage === pageNumber,
    isThinking: stream?.page === pageNumber && stream.thinking,
    error: pageError?.page === pageNumber ? pageError.text : '',
    setError,
    autoTranslate,
    setAutoTranslate,
    isPreTranslating,
    preloadProgress,
    translationCache,
    extractPagePlainText,
    executeTranslateText,
    translateCurrentPage,
    preTranslatePipeline,
  };
}
