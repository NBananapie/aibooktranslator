"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { pdfjs } from 'react-pdf';
import { AppSettings } from '@/context/AppContext';
import { HistoryRecord, saveHistoryRecord } from '@/lib/db';
import { executeTranslateStream } from '@/lib/llmClient';
import {
  extractPdfTextWithHierarchy,
  parseTranslationOutput,
  formatSourceBlocksForPrompt,
  parseBlockTranslation,
  TargetBlock,
  BilingualMapEntry,
} from '@/services/alignmentEngine';
import { analyzePageLayout, SourceBlock } from '@/services/layoutAnalysisEngine';

export interface UseTranslatorOptions {
  file: File | null;
  pdfDocument?: any;
  pageNumber: number;
  numPages: number;
  settings: AppSettings;
  activeFileId: string | null;
  dbRecord: HistoryRecord | null;
  setDbRecord: React.Dispatch<React.SetStateAction<HistoryRecord | null>>;
  onBilingualMapExtracted?: (page: number, map: BilingualMapEntry[]) => void;
  sourceBlocks?: SourceBlock[];
}

export function useTranslator(options: UseTranslatorOptions) {
  const {
    file,
    pdfDocument,
    pageNumber,
    numPages,
    settings,
    dbRecord,
    setDbRecord,
    onBilingualMapExtracted,
    sourceBlocks = [],
  } = options;

  const [translatedText, setTranslatedText] = useState<string>('');
  const [displayedText, setDisplayedText] = useState<string>('');
  const [targetBlocks, setTargetBlocks] = useState<TargetBlock[]>([]);
  const fullTextRef = useRef<string>('');
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  const [isPreTranslating, setIsPreTranslating] = useState<boolean>(false);
  const [preloadProgress, setPreloadProgress] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [translationCache, setTranslationCache] = useState<Record<number, string>>({});

  const translationCacheRef = useRef<Record<number, string>>({});
  const isPreTranslatingRef = useRef<boolean>(false);
  const currentPageRef = useRef<number>(pageNumber);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastParsedRawRef = useRef<string>('');

  // 1. 平滑打字机动画调度器
  useEffect(() => {
    let rafId: number | null = null;
    let isCancelled = false;

    const tick = () => {
      if (isCancelled) return;
      const { cleanMarkdown } = parseTranslationOutput(fullTextRef.current);
      let needsNextFrame = isTranslating;

      setDisplayedText(prev => {
        if (prev.length < cleanMarkdown.length) {
          needsNextFrame = true;
          const diff = cleanMarkdown.length - prev.length;
          const charsToAdd = Math.max(1, Math.ceil(diff / 4));
          return prev + cleanMarkdown.slice(prev.length, prev.length + charsToAdd);
        }
        return prev;
      });

      if (needsNextFrame || isTranslating) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      isCancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isTranslating]);

  // 1. 初始化从 dbRecord 同步已有翻译缓存
  useEffect(() => {
    if (dbRecord?.translations && Object.keys(dbRecord.translations).length > 0) {
      setTranslationCache(prev => ({
        ...dbRecord.translations,
        ...prev,
      }));
    }
  }, [dbRecord?.id]);

  // 2. 页面切换时，同步当前页引用、重置或回显翻译内容
  useEffect(() => {
    currentPageRef.current = pageNumber;
    lastParsedRawRef.current = '';

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const cached = translationCache[pageNumber] || dbRecord?.translations?.[pageNumber];
    if (cached) {
      const raw = cached;
      fullTextRef.current = raw;
      lastParsedRawRef.current = raw;
      const { cleanMarkdown } = parseTranslationOutput(raw);
      setTargetBlocks([]);
      setTranslatedText(cleanMarkdown);
      setDisplayedText(cleanMarkdown);
    } else {
      fullTextRef.current = '';
      setTranslatedText('');
      setDisplayedText('');
      setTargetBlocks([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, translationCache]);

  // 3. 持久化 translationCache 到 IndexedDB
  useEffect(() => {
    translationCacheRef.current = translationCache;
    if (dbRecord && Object.keys(translationCache).length > 0) {
      const updatedRecord = {
        ...dbRecord,
        translations: translationCache,
        totalPages: dbRecord.totalPages || numPages || 0,
      };
      setDbRecord(updatedRecord);
      saveHistoryRecord(updatedRecord).catch(e => console.error('Save history error', e));
    }
  }, [translationCache, numPages]);

  // 4. 执行翻译文本流
  const executeTranslateText = async (sourceText: string, targetPage: number) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setError('');
    setTranslatedText('');
    fullTextRef.current = '';
    setDisplayedText('');

    try {
      const response = await executeTranslateStream({
        text: sourceText,
        targetLanguage: '中文',
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        customPrompt: settings.customPrompt,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorMessage = '翻译请求失败';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText.slice(0, 150)}`;
        }
        throw new Error(errorMessage);
      }
      if (!response.body) throw new Error('当前浏览器不支持 ReadableStream。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let currentRawText = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          currentRawText += chunk;
          if (currentPageRef.current === targetPage) {
            fullTextRef.current = currentRawText;
            // 实时过滤思考标签并进行流式渲染，呈现打字机逐字输出效果
            const streamDisplay = currentRawText
              .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
              .replace(/<!--\s*BILINGUAL_MAP[\s\S]*$/i, '')
              .trim();
            if (streamDisplay) {
              setDisplayedText(streamDisplay);
            }
          }
        }
      }

      // 流式接收完毕后，清洗最终文本并写入缓存
      const finalClean = currentRawText
        .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
        .replace(/<!--\s*BILINGUAL_MAP[\s\S]*$/i, '')
        .trim();

      if (currentPageRef.current === targetPage) {
        setTargetBlocks([]);
        setTranslatedText(finalClean);
        setDisplayedText(finalClean);
      }
      setTranslationCache(prev => ({ ...prev, [targetPage]: finalClean }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || '翻译过程中出现异常。');
    } finally {
      setIsTranslating(false);
    }
  };

  // 共享文档实例获取辅助函数 (优先复用共享单例，杜绝重复解析)
  const getPdfDoc = async () => {
    if (pdfDocument) return pdfDocument;
    if (!file) return null;
    const arrayBuffer = await file.arrayBuffer();
    return await pdfjs.getDocument({ data: arrayBuffer }).promise;
  };

  // 5. 触发当前页翻译
  const translateCurrentPage = useCallback(
    async (force = false) => {
      if (!file) return;
      if (!force && translationCacheRef.current[pageNumber]) return;

      setIsTranslating(true);
      setError('');
      setTranslatedText('');
      fullTextRef.current = '';
      setDisplayedText('');
      setTargetBlocks([]);

      try {
        let promptText = '';
        if (sourceBlocks && sourceBlocks.length > 0) {
          promptText = sourceBlocks.map(b => b.text).join('\n\n');
        } else {
          const doc = await getPdfDoc();
          if (!doc) {
            setIsTranslating(false);
            return;
          }
          const page = await doc.getPage(pageNumber);
          const textContent = await page.getTextContent();
          promptText = extractPdfTextWithHierarchy(textContent.items as any[]);
        }

        // 若当前页无原生提取文本 (如封面、插图或空白页)：优雅占位提示，严禁擅自后台调用 OCR
        if (!promptText.trim()) {
          setIsTranslating(false);
          const msg =
            '*(当前页面未检测到原生文本内容。若本页为扫描件或图表，可点击上方顶栏中的「百度飞桨 OCR」按钮进行高精度结构化识别)*';
          setTranslatedText(msg);
          fullTextRef.current = msg;
          setDisplayedText(msg);
          setTargetBlocks([]);
          return;
        }

        await executeTranslateText(promptText, pageNumber);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error(err);
        setError(err.message || '翻译过程中出现异常。');
        setIsTranslating(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, pdfDocument, pageNumber, sourceBlocks, executeTranslateText]
  );

  // 6. 静默流水线预加载：后台平滑预翻译后续多页 (当前页+1, 当前页+2)
  const preTranslatePipeline = useCallback(
    async (startPage: number, maxCount = 2) => {
      if (!file || isPreTranslatingRef.current) return;

      const pagesToPreload: number[] = [];
      for (let p = startPage + 1; p <= numPages && pagesToPreload.length < maxCount; p++) {
        if (!translationCacheRef.current[p]) {
          pagesToPreload.push(p);
        }
      }

      if (pagesToPreload.length === 0) return;

      isPreTranslatingRef.current = true;
      setIsPreTranslating(true);
      setPreloadProgress({ total: pagesToPreload.length, done: 0 });

      try {
        const doc = await getPdfDoc();
        if (!doc) return;

        let doneCount = 0;
        for (const targetPage of pagesToPreload) {
          if (translationCacheRef.current[targetPage]) {
            doneCount++;
            setPreloadProgress({ total: pagesToPreload.length, done: doneCount });
            continue;
          }

          try {
            const page = await doc.getPage(targetPage);
            const textContent = await page.getTextContent();
            const pageBlocks = analyzePageLayout(
              textContent.items as any[],
              page.view || [0, 0, 600, 800],
              targetPage
            );
            const promptText =
              pageBlocks.length > 0
                ? pageBlocks.map(b => b.text).join('\n\n')
                : extractPdfTextWithHierarchy(textContent.items as any[]);

            // 若后续页无原生文本（空白/纯图片），直接跳过预读，严禁在后台静默跑 OCR
            if (!promptText.trim()) {
              doneCount++;
              setPreloadProgress({ total: pagesToPreload.length, done: doneCount });
              continue;
            }

            const response = await executeTranslateStream({
              text: promptText,
              targetLanguage: '中文',
              apiKey: settings.apiKey,
              baseUrl: settings.baseUrl,
              model: settings.model,
              provider: settings.provider,
              customPrompt: settings.customPrompt,
            });

            if (response.ok && response.body) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder('utf-8');
              let done = false;
              let fullNextText = '';

              while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) fullNextText += decoder.decode(value, { stream: true });
              }

              if (fullNextText.trim()) {
                setTranslationCache(prev => {
                  const nextCache = { ...prev, [targetPage]: fullNextText };
                  translationCacheRef.current = nextCache;
                  return nextCache;
                });
              }
            }
          } catch (err) {
            console.warn(`流水线静默预读第 ${targetPage} 页异常:`, err);
          } finally {
            doneCount++;
            setPreloadProgress({ total: pagesToPreload.length, done: doneCount });
          }
        }
      } catch (err) {
        console.error('Pipeline pre-translation error:', err);
      } finally {
        isPreTranslatingRef.current = false;
        setIsPreTranslating(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, pdfDocument, numPages, settings]
  );

  // 7. 自动翻译触发与预翻译连接 (通过 Ref 稳定引用，彻底终结依赖死循环卡顿)
  const translateCurrentPageRef = useRef(translateCurrentPage);
  translateCurrentPageRef.current = translateCurrentPage;
  const preTranslatePipelineRef = useRef(preTranslatePipeline);
  preTranslatePipelineRef.current = preTranslatePipeline;

  useEffect(() => {
    if (!file || !autoTranslate) return;

    if (translationCacheRef.current[pageNumber]) {
      preTranslatePipelineRef.current(pageNumber);
      return;
    }

    const timer = setTimeout(() => {
      translateCurrentPageRef.current();
      preTranslatePipelineRef.current(pageNumber);
    }, 350);

    return () => clearTimeout(timer);
  }, [file, pageNumber, autoTranslate]);

  return {
    translatedText,
    setTranslatedText,
    displayedText,
    setDisplayedText,
    targetBlocks,
    setTargetBlocks,
    fullTextRef,
    isTranslating,
    setIsTranslating,
    error,
    setError,
    autoTranslate,
    setAutoTranslate,
    isPreTranslating,
    preloadProgress,
    translationCache,
    setTranslationCache,
    translationCacheRef,
    executeTranslateText,
    translateCurrentPage,
    preTranslatePipeline,
  };
}
