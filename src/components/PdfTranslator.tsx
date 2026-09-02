"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '../app/page.module.css';
import { useAppContext } from '@/context/AppContext';
import { 
  getHistoryRecord, 
  saveHistoryRecord, 
  HistoryRecord, 
  ClipItem,
  updateHistoryFilename, 
  updateHistoryProgress, 
  addHistoryClip, 
  deleteHistoryClip 
} from '@/lib/db';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Pencil,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  ScanText,
  BookOpen,
  Download,
  Zap,
  FastForward,
  RotateCw,
  BookmarkPlus,
  BookmarkCheck,
  Sparkles,
  Copy,
  Trash2,
  Maximize2,
  Minimize2,
  Check,
  X,
  ExternalLink,
  MessageSquare
} from 'lucide-react';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function extractPdfTextWithHierarchy(items: any[]): string {
  if (!items || items.length === 0) return '';
  
  // 1. 统计正文基准字号 (Dominant body font size)
  const fontSizes: number[] = [];
  for (const item of items) {
    if (item.str && item.str.trim()) {
      const size = Math.round(Math.abs(item.transform[3]) || item.height || 10);
      if (size > 0) fontSizes.push(size);
    }
  }

  const sizeCounts: Record<number, number> = {};
  let bodyFontSize = 10;
  let maxCount = 0;
  for (const size of fontSizes) {
    sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    if (sizeCounts[size] > maxCount) {
      maxCount = sizeCounts[size];
      bodyFontSize = size;
    }
  }

  // 2. 基于字号与排版坐标进行层级识别
  let extracted = '';
  let lastY: number | undefined;
  let inHeading = false;

  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;
    const str = item.str || '';
    const fontSize = Math.round(Math.abs(item.transform[3]) || item.height || bodyFontSize);
    const currentY = item.transform[5];
    const isHeadingFont = fontSize >= bodyFontSize * 1.2 && fontSize > bodyFontSize + 1.5;

    if (lastY !== undefined) {
      const yDiff = Math.abs(lastY - currentY);
      if (yDiff > 13 || isHeadingFont || inHeading) {
        extracted += '\n\n';
        inHeading = false;
      } else if (yDiff > 4) {
        extracted += '\n';
      }
    }

    // 若当前行为大字号标题行，自动补充 Markdown 二级标题标记
    if (isHeadingFont && str.trim().length > 0 && !inHeading) {
      if (!extracted.endsWith('\n\n') && extracted.length > 0) {
        extracted += '\n\n';
      }
      extracted += '## ';
      inHeading = true;
    }

    extracted += str;
    if (item.hasEOL) {
      extracted += '\n';
      inHeading = false;
    }

    if (str.trim() !== '') {
      lastY = currentY;
    }
  }

  return extracted.replace(/\n{3,}/g, '\n\n').trim();
}

// 智能句子级切分工具函数
function splitSentences(text: string, isZh = false): Array<{ text: string; start: number; end: number }> {
  if (!text) return [];
  const sentences: Array<{ text: string; start: number; end: number }> = [];
  const regex = isZh 
    ? /[^。！？!?；;\n]+[。！？!?；;\n]*/g
    : /[^.!?\n]+[.!?\n]*/g;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      sentences.push({
        text: trimmed,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }
  return sentences;
}

// 提取纯净 Markdown 与隐藏双向对齐映射 (BILINGUAL_MAP)
function parseTranslationOutput(rawText: string): {
  cleanMarkdown: string;
  alignmentMap: Array<{ zh: string; en: string }>;
} {
  if (!rawText) return { cleanMarkdown: '', alignmentMap: [] };

  let cleanMarkdown = rawText;
  let alignmentMap: Array<{ zh: string; en: string }> = [];

  // 1. 尝试提取 <!-- BILINGUAL_MAP: [...] -->
  const mapMatch = rawText.match(/<!--\s*BILINGUAL_MAP:?\s*([\s\S]*?)-->/i);
  if (mapMatch && mapMatch[1]) {
    try {
      const jsonStr = mapMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        alignmentMap = parsed.filter(item => item && (item.zh || item.en));
      }
    } catch (e) {
      // JSON 解析容错
    }
    cleanMarkdown = rawText.replace(/<!--\s*BILINGUAL_MAP:?[\s\S]*?-->/gi, '').trim();
  }

  // 2. 移除大模型 <think> 思维链标签
  cleanMarkdown = cleanMarkdown.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

  return { cleanMarkdown, alignmentMap };
}

export default function PdfTranslator() {
  const { settings, activeFileId, theme, toggleTheme } = useAppContext();
  const router = useRouter();

  const [dbRecord, setDbRecord] = useState<HistoryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageAnimKey, setPageAnimKey] = useState<number>(1);
  
  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [editTitleValue, setEditTitleValue] = useState<string>('');

  const [translatedText, setTranslatedText] = useState<string>('');
  const [displayedText, setDisplayedText] = useState<string>('');
  const fullTextRef = useRef<string>('');
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  const [isPreTranslating, setIsPreTranslating] = useState<boolean>(false);
  const [translationCache, setTranslationCache] = useState<Record<number, string>>({});
  
  // 双语对齐映射缓存 (BILINGUAL_MAP)
  const [bilingualMapCache, setBilingualMapCache] = useState<Record<number, Array<{ zh: string; en: string }>>>({});

  // OCR state
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(false);
  const [ocrCache, setOcrCache] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<'translation' | 'ocr_source'>('translation');

  // PDF Text Items 缓存与原始页面尺寸
  const [pdfTextItems, setPdfTextItems] = useState<any[]>([]);
  const [pdfOriginalView, setPdfOriginalView] = useState<number[]>([0, 0, 600, 800]);

  // 精准行内划词高亮条状态
  const [exactHighlightSpans, setExactHighlightSpans] = useState<Array<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>>([]);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clips state (剪藏系统)
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [isClipsDrawerOpen, setIsClipsDrawerOpen] = useState<boolean>(false);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);
  const [ghostFlyStyle, setGhostFlyStyle] = useState<React.CSSProperties | null>(null);
  const [ghostFlyText, setGhostFlyText] = useState<string>('');

  // Floating Toolbar state (划词悬浮微岛工具栏)
  const [floatingToolbar, setFloatingToolbar] = useState<{
    visible: boolean;
    top: number;
    left: number;
    text: string;
    isClipped?: boolean;
    clipId?: string;
  } | null>(null);

  // AI Explain Modal state (深度解释与追问)
  const [isExplainModalOpen, setIsExplainModalOpen] = useState<boolean>(false);
  const [explainTargetText, setExplainTargetText] = useState<string>('');
  const [explainResultText, setExplainResultText] = useState<string>('');
  const [isExplainLoading, setIsExplainLoading] = useState<boolean>(false);
  const [explainHistory, setExplainHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [explainFollowUpInput, setExplainFollowUpInput] = useState<string>('');
  const [showFollowUpInput, setShowFollowUpInput] = useState<boolean>(false);

  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(50);
  const [isImmersive, setIsImmersive] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const [pdfRenderWidth, setPdfRenderWidth] = useState<number>(600);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  const currentPageRef = useRef<number>(pageNumber);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Smooth typewriter animation effect
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setDisplayedText((prev) => {
        const { cleanMarkdown } = parseTranslationOutput(fullTextRef.current);
        if (prev.length < cleanMarkdown.length) {
          const diff = cleanMarkdown.length - prev.length;
          const charsToAdd = Math.max(1, Math.ceil(diff / 4));
          return prev + cleanMarkdown.slice(prev.length, prev.length + charsToAdd);
        }
        return prev;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // 自适应动态监听左侧容器宽度
  useEffect(() => {
    if (!pdfWrapperRef.current) return;
    const updateWidth = () => {
      if (pdfWrapperRef.current) {
        const containerW = pdfWrapperRef.current.clientWidth;
        const calculatedWidth = Math.max(280, containerW - 48);
        setPdfRenderWidth(calculatedWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(pdfWrapperRef.current);
    return () => observer.disconnect();
  }, [leftPaneWidth, isImmersive]);

  // Load from DB on mount
  useEffect(() => {
    if (!activeFileId) return;
    getHistoryRecord(activeFileId).then(record => {
      if (record) {
        setDbRecord(record);
        setFile(new File([record.pdfData], record.filename, { type: 'application/pdf' }));
        setEditTitleValue(record.filename);
        setTranslationCache(record.translations || {});
        setClips(record.clips || []);
        
        const initialPage = record.lastReadPage && record.lastReadPage >= 1 ? record.lastReadPage : 1;
        setPageNumber(initialPage);
        setPageAnimKey(initialPage);

        if (record.translations && record.translations[initialPage]) {
          const raw = record.translations[initialPage];
          fullTextRef.current = raw;
          const { cleanMarkdown, alignmentMap } = parseTranslationOutput(raw);
          setTranslatedText(cleanMarkdown);
          setDisplayedText(cleanMarkdown);
          if (alignmentMap.length > 0) {
            setBilingualMapCache(prev => ({ ...prev, [initialPage]: alignmentMap }));
          }
        }

        updateHistoryProgress(activeFileId, {
          lastReadPage: initialPage,
          lastReadTime: Date.now()
        }).catch(console.error);
      } else {
        router.push('/');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, router]);

  // 提取当前页的 PDF TextItems 与原始尺寸
  useEffect(() => {
    if (!file || pageNumber < 1) return;
    let isCancelled = false;

    (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        if (!isCancelled) {
          setPdfTextItems(textContent.items || []);
          setPdfOriginalView(page.view || [0, 0, 600, 800]);
        }
      } catch (e) {
        console.error('Error fetching page text content for exact highlights', e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [file, pageNumber]);

  // Handle page changes to load cached text and update progress in DB
  useEffect(() => {
    currentPageRef.current = pageNumber;
    setViewMode('translation');
    setFloatingToolbar(null);
    setExactHighlightSpans([]);
    setPageAnimKey(Date.now());
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (activeFileId) {
      updateHistoryProgress(activeFileId, {
        lastReadPage: pageNumber,
        lastReadTime: Date.now()
      }).catch(console.error);
    }

    if (translationCache[pageNumber]) {
      const raw = translationCache[pageNumber];
      fullTextRef.current = raw;
      const { cleanMarkdown, alignmentMap } = parseTranslationOutput(raw);
      setTranslatedText(cleanMarkdown);
      setDisplayedText(cleanMarkdown);
      if (alignmentMap.length > 0) {
        setBilingualMapCache(prev => ({ ...prev, [pageNumber]: alignmentMap }));
      }
    } else {
      fullTextRef.current = '';
      setTranslatedText('');
      setDisplayedText('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, activeFileId]);

  // Persist translationCache to DB
  useEffect(() => {
    if (dbRecord && Object.keys(translationCache).length > 0) {
      const updatedRecord = { ...dbRecord, translations: translationCache };
      setDbRecord(updatedRecord);
      saveHistoryRecord(updatedRecord).catch(e => console.error("Save history error", e));
    }
  }, [translationCache]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    if (activeFileId) {
      updateHistoryProgress(activeFileId, {
        totalPages: numPages,
        lastReadPage: pageNumber,
        lastReadTime: Date.now()
      }).catch(console.error);
    }
  };

  const handleSaveTitle = async () => {
    if (!editTitleValue.trim() || !activeFileId || !dbRecord) {
      setIsEditingTitle(false);
      return;
    }
    let newName = editTitleValue.trim();
    if (!newName.toLowerCase().endsWith('.pdf')) {
      newName += '.pdf';
    }
    const updatedRecord = { ...dbRecord, filename: newName };
    setDbRecord(updatedRecord);
    setFile(new File([updatedRecord.pdfData], newName, { type: 'application/pdf' }));
    await updateHistoryFilename(activeFileId, newName);
    setIsEditingTitle(false);
  };

  const captureCurrentPageImage = async (): Promise<string> => {
    if (!file) throw new Error('PDF 文件未加载');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 上下文初始化失败');
    await (page.render as any)({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL('image/jpeg', 0.95);
  };

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
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: sourceText, 
          targetLanguage: '中文',
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          provider: settings.provider,
          customPrompt: settings.customPrompt
        }),
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
          }
        }
      }

      const { cleanMarkdown, alignmentMap } = parseTranslationOutput(currentRawText);

      if (currentPageRef.current === targetPage) {
        setTranslatedText(cleanMarkdown);
        setDisplayedText(cleanMarkdown);
        if (alignmentMap.length > 0) {
          setBilingualMapCache(prev => ({ ...prev, [targetPage]: alignmentMap }));
        }
      }
      setTranslationCache(prev => ({ ...prev, [targetPage]: currentRawText }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || '翻译过程中出现异常。');
    } finally {
      setIsTranslating(false);
    }
  };

  const runOcrOnCurrentPage = async (autoTranslateAfter = false) => {
    if (!file || isOcrLoading) return;
    const token = settings.ocr?.apiToken?.trim();
    if (!token) {
      alert('请先在首页「设置」中配置百度飞桨 AI Studio OCR Access Token。\n\n注册链接：https://aistudio.baidu.com/paddleocr');
      return;
    }

    setIsOcrLoading(true);
    setError('');
    try {
      const imageBase64 = await captureCurrentPageImage();
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageBase64,
          apiToken: token,
          model: settings.ocr.model || 'PaddleOCR-VL-1.6',
          apiUrl: settings.ocr.apiUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'OCR 识别请求失败');
      }

      const ocrMarkdown = data.markdown || data.text || '';
      if (!ocrMarkdown.trim()) {
        throw new Error('百度飞桨 OCR 未在此页识别到文本或图表内容。');
      }

      setOcrCache(prev => ({ ...prev, [pageNumber]: ocrMarkdown }));

      if (autoTranslateAfter) {
        setViewMode('translation');
        await executeTranslateText(ocrMarkdown, pageNumber);
      } else {
        setViewMode('ocr_source');
      }
    } catch (err: any) {
      console.error('OCR Error:', err);
      setError(`OCR 识别异常: ${err.message || err}`);
    } finally {
      setIsOcrLoading(false);
    }
  };

  const translateCurrentPage = useCallback(async (force = false) => {
    if (!file) return;
    if (!force && translationCache[pageNumber]) return;

    setViewMode('translation');
    setIsTranslating(true);
    setError('');
    setTranslatedText('');
    fullTextRef.current = '';
    setDisplayedText('');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      
      const extractedText = extractPdfTextWithHierarchy(textContent.items as any[]);

      if (!extractedText.trim()) {
        const token = settings.ocr?.apiToken?.trim();
        if (token) {
          setIsTranslating(false);
          await runOcrOnCurrentPage(true);
          return;
        }

        setIsTranslating(false);
        const msg = '*(当前页面无原生提取文本，若为扫描件/包含图表请点击上方「🔍 OCR 识别」或在首页设置中配置百度飞桨 AIStudio Token)*';
        setTranslatedText(msg);
        fullTextRef.current = msg;
        return;
      }

      await executeTranslateText(extractedText, pageNumber);

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || '翻译过程中出现异常。');
      setIsTranslating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pageNumber, translationCache, settings]);

  const preTranslateNextPage = async () => {
    if (!file || pageNumber >= numPages) return;
    const nextPage = pageNumber + 1;
    if (translationCache[nextPage]) return;

    setIsPreTranslating(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(nextPage);
      const textContent = await page.getTextContent();
      
      let extractedText = extractPdfTextWithHierarchy(textContent.items as any[]);

      if (!extractedText.trim() && settings.ocr?.apiToken?.trim()) {
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await (page.render as any)({ canvasContext: ctx, viewport, canvas }).promise;
          const imageBase64 = canvas.toDataURL('image/jpeg', 0.95);
          const ocrRes = await fetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: imageBase64,
              apiToken: settings.ocr.apiToken,
              model: settings.ocr.model || 'PaddleOCR-VL-1.6',
              apiUrl: settings.ocr.apiUrl,
            }),
          });
          if (ocrRes.ok) {
            const ocrData = await ocrRes.json();
            extractedText = ocrData.markdown || ocrData.text || '';
          }
        }
      }

      if (!extractedText.trim()) {
        setTranslationCache(prev => ({ ...prev, [nextPage]: '*(下一页无文本)*' }));
        return;
      }

      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: extractedText, 
          targetLanguage: '中文',
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          provider: settings.provider,
          customPrompt: settings.customPrompt
        }),
      });

      if (!response.ok || !response.body) throw new Error('预翻译请求失败');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let fullNextText = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) fullNextText += decoder.decode(value, { stream: true });
      }

      setTranslationCache(prev => ({ ...prev, [nextPage]: fullNextText }));
    } catch (err) {
      console.error("Pre-translation error:", err);
    } finally {
      setIsPreTranslating(false);
    }
  };

  useEffect(() => {
    if (file && autoTranslate) {
      const timer = setTimeout(async () => {
        await translateCurrentPage();
        preTranslateNextPage();
      }, 500); 
      return () => clearTimeout(timer);
    }
  }, [file, pageNumber, autoTranslate, translateCurrentPage]);

  const changePage = useCallback((offset: number) => {
    setPageNumber(prev => Math.min(Math.max(1, prev + offset), numPages));
  }, [numPages]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === '[') {
        changePage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ']') {
        changePage(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changePage]);

  // Split pane resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      
      if (newLeftWidth > 20 && newLeftWidth < 80) {
        setLeftPaneWidth(newLeftWidth);
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // === 核心需求1: 基于大模型双向对齐映射的 100% 精确语义高亮 ===
  const triggerExactHighlightForSelection = (selectedText: string) => {
    if (!selectedText.trim() || !pdfWrapperRef.current || pdfTextItems.length === 0) return;

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    const currentDocText = displayedText || '';
    if (!currentDocText) return;

    const origWidth = pdfOriginalView[2] || 600;
    const origHeight = pdfOriginalView[3] || 800;
    const currentRenderW = pdfRenderWidth * zoomScale;
    const scale = currentRenderW / origWidth;

    const validItems = pdfTextItems.filter(item => item.str && item.str.trim() && item.transform);
    if (validItems.length === 0) return;

    let matchedItems: any[] = [];
    const queryZh = selectedText.trim();

    // 1. 优先从大模型输出的 BILINGUAL_MAP 精准映射表中匹配英文原句
    const currentMap = bilingualMapCache[pageNumber] || [];
    let matchedEnSentence = '';

    for (const entry of currentMap) {
      if (entry.zh && entry.en && (entry.zh.includes(queryZh) || queryZh.includes(entry.zh))) {
        matchedEnSentence = entry.en;
        break;
      }
    }

    if (matchedEnSentence) {
      const cleanEnLower = matchedEnSentence.toLowerCase();
      const enWords = cleanEnLower.match(/[a-zA-Z0-9'-]+/g) || [];
      const foundItems = validItems.filter(item => {
        const itemStr = (item.str || '').toLowerCase().trim();
        if (!itemStr) return false;
        return cleanEnLower.includes(itemStr) || enWords.some(w => w.length >= 3 && itemStr.includes(w));
      });

      if (foundItems.length > 0) {
        matchedItems = foundItems;
      }
    }

    // 2. 若无 map 命中，专有名词与英文字符优先精准全词匹配
    if (matchedItems.length === 0) {
      const cleanQuery = queryZh.toLowerCase();
      const hasEnglishLetters = /[a-zA-Z]{2,}/.test(cleanQuery);

      if (hasEnglishLetters) {
        const words = cleanQuery.match(/[a-zA-Z0-9'-]+/g) || [];
        const directMatches = validItems.filter(item => {
          const itemStr = (item.str || '').toLowerCase();
          return words.some(w => w.length >= 2 && (itemStr.includes(w) || w.includes(itemStr)));
        });
        if (directMatches.length > 0) {
          matchedItems = directMatches;
        }
      }
    }

    // 3. 增强的自然句语义切分对齐
    if (matchedItems.length === 0) {
      const zhSentences = splitSentences(currentDocText, true);
      const enRawText = validItems.map(item => item.str).join(' ');
      const enSentences = splitSentences(enRawText, false);

      let targetZhIndex = -1;
      for (let i = 0; i < zhSentences.length; i++) {
        if (zhSentences[i].text.includes(queryZh) || queryZh.includes(zhSentences[i].text)) {
          targetZhIndex = i;
          break;
        }
      }

      if (targetZhIndex >= 0 && enSentences.length > 0) {
        const ratio = targetZhIndex / Math.max(1, zhSentences.length);
        const mappedEnIndex = Math.min(enSentences.length - 1, Math.floor(ratio * enSentences.length));
        const targetEnSentence = enSentences[mappedEnIndex];

        let enCharCount = 0;
        const matchedEnItems: any[] = [];
        for (const item of validItems) {
          const itemLen = (item.str || '').length;
          const itemStart = enCharCount;
          const itemEnd = enCharCount + itemLen;
          if (itemEnd >= targetEnSentence.start && itemStart <= targetEnSentence.end) {
            matchedEnItems.push(item);
          }
          enCharCount += itemLen + 1;
        }

        if (matchedEnItems.length > 0) {
          matchedItems = matchedEnItems;
        }
      }
    }

    // 4. 兜底策略：按字符百分比映射
    if (matchedItems.length === 0) {
      const index = currentDocText.indexOf(queryZh);
      const totalLen = Math.max(1, currentDocText.length);
      const startRatio = index >= 0 ? index / totalLen : 0.1;
      const endRatio = index >= 0 ? (index + queryZh.length) / totalLen : startRatio + 0.1;

      const startIndex = Math.max(0, Math.floor(startRatio * validItems.length));
      const endIndex = Math.min(validItems.length, Math.max(startIndex + 1, Math.ceil(endRatio * validItems.length)));
      matchedItems = validItems.slice(startIndex, endIndex);
    }

    // 将匹配的 items 转换为精准屏幕视口高光矩形
    const spans = matchedItems.map(item => {
      const x = item.transform[4];
      const y = item.transform[5];
      const w = item.width || (item.str.length * 7);
      const h = Math.abs(item.transform[3]) || item.height || 10;

      const left = x * scale;
      const top = (origHeight - y - h) * scale;
      const width = w * scale;
      const height = h * 1.18 * scale;

      return { left, top, width, height };
    });

    setExactHighlightSpans(spans);

    // 平滑滚动至第一个高亮词所在视口
    if (spans.length > 0) {
      const firstSpanTop = spans[0].top;
      pdfWrapperRef.current.scrollTo({
        top: Math.max(0, firstSpanTop - 100),
        behavior: 'smooth',
      });
    }
  };

  // 划词选区监听与悬浮微岛工具栏
  const handleMarkdownSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 1) {
      setFloatingToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 检查该划选文字是否已在剪藏中
    const existingClip = clips.find(c => c.pageNumber === pageNumber && (c.text.includes(text) || text.includes(c.text)));

    setFloatingToolbar({
      visible: true,
      top: rect.top,
      left: rect.left + rect.width / 2,
      text,
      isClipped: !!existingClip,
      clipId: existingClip?.id,
    });

    // 触发语义级精准高亮 (松手常驻高亮，不自动淡出)
    triggerExactHighlightForSelection(text);
  };

  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(`.${styles.floatingToolbar}`) || 
        target.closest(`.${styles.explainCardModal}`) ||
        target.closest(`.${styles.clipsSidebarToggle}`) ||
        target.closest(`.${styles.clippedTextSpan}`)
      ) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setFloatingToolbar(null);
        if (!target.closest(`.${styles.markdownWrapper}`)) {
          setExactHighlightSpans([]);
        }
      }
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, []);

  // 剪藏文字与飞入动效
  const handleAddClip = async () => {
    if (!floatingToolbar || !floatingToolbar.text || !activeFileId) return;
    const textToClip = floatingToolbar.text;

    // 如果已剪藏则执行取消剪藏
    if (floatingToolbar.isClipped && floatingToolbar.clipId) {
      await handleDeleteClip(floatingToolbar.clipId);
      setFloatingToolbar(prev => prev ? { ...prev, isClipped: false, clipId: undefined } : null);
      return;
    }

    const selection = window.getSelection();
    let startRect = { top: floatingToolbar.top, left: floatingToolbar.left, width: 120, height: 30 };
    if (selection && !selection.isCollapsed) {
      startRect = selection.getRangeAt(0).getBoundingClientRect();
    }

    const targetRect = toggleBtnRef.current?.getBoundingClientRect() || { top: window.innerHeight / 2, left: window.innerWidth - 30, width: 25, height: 40 };

    setGhostFlyText(textToClip.slice(0, 24) + (textToClip.length > 24 ? '...' : ''));
    setGhostFlyStyle({
      top: startRect.top,
      left: startRect.left,
      width: Math.min(240, Math.max(100, startRect.width)),
      transform: 'scale(1) translateY(0)',
      opacity: 1,
      filter: 'blur(0px)',
    });

    requestAnimationFrame(() => {
      setTimeout(() => {
        setGhostFlyStyle({
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.left,
          width: 50,
          transform: 'scale(0.2) translateY(0)',
          opacity: 0,
          filter: 'blur(6px)',
        });
      }, 50);
    });

    setTimeout(() => {
      setGhostFlyStyle(null);
      setGhostFlyText('');
    }, 700);

    const newClip: ClipItem = {
      id: crypto.randomUUID(),
      pageNumber,
      text: textToClip,
      sourceText: `第 ${pageNumber} 页书摘`,
      createdAt: Date.now(),
    };

    await addHistoryClip(activeFileId, newClip);
    setClips(prev => [newClip, ...prev.filter(c => c.id !== newClip.id)]);
    setFloatingToolbar(prev => prev ? { ...prev, isClipped: true, clipId: newClip.id } : null);
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!activeFileId) return;
    await deleteHistoryClip(activeFileId, clipId);
    setClips(prev => prev.filter(c => c.id !== clipId));
    if (floatingToolbar && floatingToolbar.clipId === clipId) {
      setFloatingToolbar(prev => prev ? { ...prev, isClipped: false, clipId: undefined } : null);
    }
  };

  const handleCopyClip = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制剪藏内容到剪贴板！');
  };

  const handleCopyAllClips = () => {
    if (clips.length === 0) return;
    const content = clips
      .map((c, i) => `【摘录 ${i + 1}】(第 ${c.pageNumber} 页):\n${c.text}\n`)
      .join('\n---\n\n');
    navigator.clipboard.writeText(content);
    alert(`已复制全部 ${clips.length} 条剪藏内容！`);
  };

  const handleExportClipsMarkdown = () => {
    if (clips.length === 0 || !file) return;
    let md = `# 📖 《${file.name.replace('.pdf', '')}》剪藏书摘\n\n`;
    md += `> 共收集 ${clips.length} 处精华摘录 | 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;
    clips.forEach((c, idx) => {
      md += `### 摘录 ${idx + 1}（第 ${c.pageNumber} 页）\n\n`;
      md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      md += `*记录于: ${new Date(c.createdAt).toLocaleString()}*\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${file.name.replace('.pdf', '')}_剪藏书摘.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // 点击已剪藏的波浪线下划线区域触发悬浮微岛
  const handleClippedSpanClick = (e: React.MouseEvent, clip: ClipItem) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFloatingToolbar({
      visible: true,
      top: rect.top,
      left: rect.left + rect.width / 2,
      text: clip.text,
      isClipped: true,
      clipId: clip.id,
    });
    triggerExactHighlightForSelection(clip.text);
  };

  // AI 深度解释与多轮追问
  const handleOpenExplain = async () => {
    if (!floatingToolbar || !floatingToolbar.text) return;
    const textToExplain = floatingToolbar.text;
    setFloatingToolbar(null);
    setExplainTargetText(textToExplain);
    setExplainResultText('');
    setExplainHistory([]);
    setShowFollowUpInput(false);
    setIsExplainModalOpen(true);
    setIsExplainLoading(true);

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: textToExplain,
          contextText: displayedText || '',
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          provider: settings.provider,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('AI 解释服务请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let currentOutput = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          currentOutput += decoder.decode(value, { stream: true });
          setExplainResultText(currentOutput);
        }
      }
    } catch (err: any) {
      console.error(err);
      setExplainResultText(`解析失败: ${err.message || err}`);
    } finally {
      setIsExplainLoading(false);
    }
  };

  const handleSendFollowUp = async () => {
    if (!explainFollowUpInput.trim() || isExplainLoading) return;
    const question = explainFollowUpInput.trim();
    setExplainFollowUpInput('');
    setIsExplainLoading(true);

    const newHistory = [
      ...explainHistory,
      ...(explainResultText && explainHistory.length === 0
        ? [{ role: 'assistant' as const, content: explainResultText }]
        : []),
      { role: 'user' as const, content: question },
    ];
    setExplainHistory(newHistory);

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: explainTargetText,
          contextText: displayedText || '',
          question,
          history: newHistory,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          provider: settings.provider,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('追问请求响应异常');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let aiResponse = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          aiResponse += decoder.decode(value, { stream: true });
          setExplainHistory([...newHistory, { role: 'assistant', content: aiResponse }]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setExplainHistory([...newHistory, { role: 'assistant', content: `追问回答出错: ${err.message || err}` }]);
    } finally {
      setIsExplainLoading(false);
    }
  };

  const downloadMarkdown = () => {
    if (!file || Object.keys(translationCache).length === 0) return;
    
    let mdContent = `# 翻译结果: ${file.name}\n\n`;
    const sortedPages = Object.keys(translationCache).map(Number).sort((a, b) => a - b);
    
    sortedPages.forEach(page => {
      const { cleanMarkdown } = parseTranslationOutput(translationCache[page]);
      mdContent += `### 第 ${page} 页\n\n`;
      mdContent += `${cleanMarkdown}\n\n---\n\n`;
    });
    
    const minPage = sortedPages[0];
    const maxPage = sortedPages[sortedPages.length - 1];
    const filename = `${file.name.replace('.pdf', '')}_Pages_${minPage}_to_${maxPage}.md`;
    
    const ref = '?utm_source=export&utm_medium=referral&utm_campaign=bilingual_export';
    mdContent += `> 由 [AI PDF Translator](https://aitranslator.justganit.com/${ref}) 生成 —— 完整双语对照阅读，自带 API Key，内容不上传。\n>\n> 更多工具见 [JustGanIt](https://justganit.com/${ref})\n`;

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const [fullWidthReading, setFullWidthReading] = useState<boolean>(false);

  // 获取当前页面的剪藏条目
  const currentPageClips = clips.filter(c => c.pageNumber === pageNumber);

  return (
    <div className={styles.container} ref={containerRef}>
      {!file && (
        <div className={styles.uploadOverlay}>
           <div className={styles.spinner} />
           <p style={{marginTop: '16px', color: 'var(--primary)', fontWeight: 500}}>正在解构 PDF 文档...</p>
        </div>
      )}

      {/* 模糊飞入吸入克隆元素 */}
      {ghostFlyStyle && (
        <div className={styles.ghostFlyingItem} style={ghostFlyStyle}>
          <BookmarkPlus size={14} style={{ display: 'inline', marginRight: '4px' }} />
          {ghostFlyText}
        </div>
      )}

      {/* 划词悬浮微岛工具栏 (Squircle 黄金比例设计，彻底解决图1圆角与剪藏状态联动) */}
      {floatingToolbar && floatingToolbar.visible && (
        <div 
          className={styles.floatingToolbar} 
          style={{ top: `${floatingToolbar.top}px`, left: `${floatingToolbar.left}px` }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button 
            className={`${styles.capsuleBtn} ${styles.capsuleBtnPrimary}`} 
            onClick={handleAddClip}
            data-tooltip={floatingToolbar.isClipped ? '已剪藏（点击取消）' : '剪藏选中文本'}
          >
            {floatingToolbar.isClipped ? <Check size={13} /> : <BookmarkPlus size={13} />}
            <span>{floatingToolbar.isClipped ? '已剪藏' : '剪藏'}</span>
          </button>
          <button className={styles.capsuleBtn} onClick={handleOpenExplain} data-tooltip="AI 结合上下文深度解析">
            <Sparkles size={13} />
            <span>解释</span>
          </button>
          <button className={styles.capsuleBtn} onClick={() => { navigator.clipboard.writeText(floatingToolbar.text); setFloatingToolbar(null); }} data-tooltip="复制到剪贴板">
            <Copy size={13} />
            <span>复制</span>
          </button>
        </div>
      )}

      {/* Left Pane - PDF Viewer */}
      {!isImmersive && (
        <div className={styles.leftPane} style={{ flexBasis: `calc(${leftPaneWidth}% - 6px)`, flexGrow: 0, flexShrink: 0 }}>
          {/* 左侧顶栏：统一 52px 高度与水平对齐，Lucide 矢量图标 */}
          <div className={styles.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1, marginRight: '8px' }}>
              <button className={styles.topNavIconBtn} onClick={() => router.push('/')} data-tooltip="返回首页">
                <ArrowLeft size={16} />
              </button>
              
              {isEditingTitle ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                    autoFocus
                    style={{
                      padding: '3px 8px',
                      fontSize: '12.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--primary)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      flex: 1,
                      minWidth: '100px'
                    }}
                  />
                  <button className={styles.btn} style={{ padding: '4px 6px', fontSize: '11px' }} onClick={handleSaveTitle}>
                    <Check size={12} />
                  </button>
                  <button className={styles.btnSecondary} style={{ padding: '4px 6px', fontSize: '11px' }} onClick={() => setIsEditingTitle(false)}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, overflow: 'hidden' }}>
                  <h2 
                    style={{ 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      whiteSpace: 'nowrap',
                      maxWidth: '220px',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }} 
                    onClick={() => {
                      setEditTitleValue(file?.name || '');
                      setIsEditingTitle(true);
                    }}
                    data-tooltip="点击重命名此书籍"
                  >
                    {file ? file.name : '原始 PDF'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditTitleValue(file?.name || '');
                      setIsEditingTitle(true);
                    }}
                    className={styles.iconBtn}
                    style={{ padding: '3px' }}
                    data-tooltip="重命名文件名"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* 左侧极简图标控制组 */}
            <div className={styles.controls}>
              <button 
                type="button" 
                className={styles.topNavIconBtn} 
                onClick={() => setZoomScale(s => Math.max(0.6, s - 0.15))}
                data-tooltip="缩小页面"
              >
                <ZoomOut size={15} />
              </button>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', minWidth: '34px', textAlign: 'center' }}>
                {Math.round(zoomScale * 100)}%
              </span>
              <button 
                type="button" 
                className={styles.topNavIconBtn} 
                onClick={() => setZoomScale(s => Math.min(2.0, s + 0.15))}
                data-tooltip="放大页面"
              >
                <ZoomIn size={15} />
              </button>

              <button className={styles.topNavIconBtn} disabled={pageNumber <= 1} onClick={() => changePage(-1)} data-tooltip="上一页 (←)">
                <ChevronLeft size={16} />
              </button>
              <input 
                type="range" 
                min={1} 
                max={numPages || 1} 
                value={pageNumber} 
                onChange={(e) => setPageNumber(Number(e.target.value))} 
                style={{ width: '60px', cursor: 'pointer' }}
                data-tooltip="快速拖拽翻页"
              />
              <span className={styles.badge} style={{ padding: '2px 6px', fontSize: '10.5px' }}>
                {pageNumber}/{numPages || '-'}
              </span>
              <button className={styles.topNavIconBtn} disabled={pageNumber >= numPages} onClick={() => changePage(1)} data-tooltip="下一页 (→)">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* 需求3: 移除销毁性 key，保持 Document 单例，彻底消除翻页白屏闪烁 */}
          <div className={styles.pdfWrapper} ref={pdfWrapperRef}>
            {file && (
              <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={<div className={styles.loadingOverlay}><div className={styles.spinner} /></div>}
              >
                <div style={{ position: 'relative' }}>
                  <Page 
                    pageNumber={pageNumber} 
                    width={pdfRenderWidth * zoomScale} 
                    renderTextLayer={true}
                    renderAnnotationLayer={false}
                    loading={null}
                    noData={null}
                    canvasBackground="transparent"
                  />
                  {/* 语义级精准词对词行内划词荧光高亮 */}
                  {exactHighlightSpans.map((rect, idx) => (
                    <span 
                      key={idx}
                      className={styles.pdfExactHighlightSpan}
                      style={{
                        left: `${rect.left}px`,
                        top: `${rect.top}px`,
                        width: `${rect.width}px`,
                        height: `${rect.height}px`,
                      }}
                    />
                  ))}
                </div>
              </Document>
            )}
          </div>
        </div>
      )}

      {/* Resizer handle */}
      {!isImmersive && (
        <div 
          className={styles.resizer}
          onMouseDown={() => setIsResizing(true)}
          onDoubleClick={() => setLeftPaneWidth(50)}
          data-tooltip="按住拖拽宽度，双击复位 50:50"
        />
      )}

      {/* Right Pane - Translation */}
      <div 
        className={styles.rightPane} 
        style={{ 
          flexBasis: isImmersive ? '100%' : `calc(${100 - leftPaneWidth}% - 6px)`,
          flexGrow: isImmersive ? 1 : 0, 
          flexShrink: 0 
        }}
      >
        {/* 右侧顶栏：统一 52px 高度与水平对齐，Lucide 矢量图标 */}
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isImmersive && (
              <button className={styles.topNavIconBtn} onClick={() => router.push('/')} data-tooltip="返回首页">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 style={{ fontSize: '13.5px' }}>
              {viewMode === 'translation' ? 'AI 译文' : 'OCR 原文'}
              {isTranslating ? (
                <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>
                  <Zap size={10} style={{ display: 'inline', marginRight: '2px' }} /> 生成中
                </span>
              ) : isOcrLoading ? (
                <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>
                  <ScanText size={10} style={{ display: 'inline', marginRight: '2px' }} /> 识别中
                </span>
              ) : translationCache[pageNumber] ? (
                <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>已就绪</span>
              ) : null}
            </h2>

            {ocrCache[pageNumber] && (
              <div style={{ display: 'flex', gap: '3px', marginLeft: '4px' }}>
                <button
                  type="button"
                  className={`${styles.presetBtn} ${viewMode === 'translation' ? styles.presetBtnActive : ''}`}
                  style={{ padding: '2px 6px', fontSize: '10px' }}
                  onClick={() => setViewMode('translation')}
                >
                  译文
                </button>
                <button
                  type="button"
                  className={`${styles.presetBtn} ${viewMode === 'ocr_source' ? styles.presetBtnActive : ''}`}
                  style={{ padding: '2px 6px', fontSize: '10px' }}
                  onClick={() => setViewMode('ocr_source')}
                >
                  OCR
                </button>
              </div>
            )}
          </div>

          {/* 右侧极简 Lucide 图标控制组与毛玻璃 Tooltip */}
          <div className={styles.controls}>
            <button 
              type="button" 
              className={styles.topNavIconBtn} 
              onClick={toggleTheme}
              data-tooltip={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {isImmersive && (
              <button
                type="button"
                className={styles.topNavIconBtn}
                onClick={() => setFullWidthReading(w => !w)}
                data-tooltip={fullWidthReading ? '切换居中阅读' : '切换铺满全宽'}
              >
                {fullWidthReading ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            )}

            <button
              type="button"
              className={`${styles.topNavIconBtn} ${isOcrLoading ? styles.topNavIconBtnActive : ''}`}
              onClick={() => runOcrOnCurrentPage(false)}
              disabled={!file || isOcrLoading}
              data-tooltip="百度飞桨 PaddleOCR 结构识别"
            >
              <ScanText size={15} />
            </button>

            <button 
              type="button"
              className={`${styles.topNavIconBtn} ${isImmersive ? styles.topNavIconBtnActive : ''}`}
              onClick={() => setIsImmersive(prev => !prev)}
              data-tooltip={isImmersive ? '退出沉浸模式' : '进入沉浸阅读模式'}
            >
              <BookOpen size={15} />
            </button>
            
            <button 
              type="button"
              className={styles.topNavIconBtn} 
              onClick={downloadMarkdown} 
              disabled={Object.keys(translationCache).length === 0}
              data-tooltip="导出已翻译 Markdown"
            >
              <Download size={15} />
            </button>
            
            <button
              type="button"
              className={`${styles.topNavIconBtn} ${autoTranslate ? styles.topNavIconBtnActive : ''}`}
              onClick={() => setAutoTranslate(prev => !prev)}
              data-tooltip={autoTranslate ? '自动翻译: 已开启' : '自动翻译: 已关闭 (点击开启)'}
            >
              <Zap size={15} />
            </button>

            <button
              type="button"
              className={styles.topNavIconBtn}
              onClick={preTranslateNextPage}
              disabled={!file || pageNumber >= numPages || isPreTranslating || !!translationCache[pageNumber + 1]}
              data-tooltip={translationCache[pageNumber + 1] ? '下一页翻译已就绪' : '预加载翻译下一页'}
            >
              <FastForward size={15} />
            </button>
            
            <button 
              type="button"
              className={`${styles.btn} ${styles.topNavIconBtnActive}`}
              style={{ width: '32px', height: '32px', padding: 0 }}
              onClick={() => translateCurrentPage(true)} 
              disabled={!file || isTranslating || isOcrLoading}
              data-tooltip={isTranslating ? '正在流式生成中...' : translatedText ? '重新翻译当前页' : '翻译此页'}
            >
              <RotateCw size={14} className={isTranslating ? styles.spinAnim : ''} />
            </button>
          </div>
        </div>

        {/* 平级分栏工作区与右侧小三角伸缩手柄 */}
        <div className={styles.rightPaneBody}>
          {/* 小三角伸缩手柄 */}
          <button
            ref={toggleBtnRef}
            type="button"
            className={`${styles.clipsSidebarToggle} ${isClipsDrawerOpen ? styles.clipsSidebarToggleActive : ''}`}
            onClick={() => setIsClipsDrawerOpen(prev => !prev)}
            data-tooltip={isClipsDrawerOpen ? '收起剪藏栏' : '展开剪藏侧栏'}
          >
            {isClipsDrawerOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            <span className={styles.clipsBadgeMini}>{clips.length}</span>
          </button>

          {/* 译文主体视口 */}
          <div 
            key={`md-page-${pageAnimKey}`}
            className={`${styles.markdownWrapper} ${styles.pageFadeIn}`}
            ref={markdownContainerRef}
            onMouseUp={handleMarkdownSelection}
            onKeyUp={handleMarkdownSelection}
          >
            {isTranslating && !displayedText ? (
              <div className={styles.loadingOverlay}>
                <div className={styles.spinner} />
                <p>{fullTextRef.current.includes('<think>') ? 'AI 正在深度思考中...' : '正在连接 AI 引擎流式输出...'}</p>
              </div>
            ) : isOcrLoading ? (
              <div className={styles.loadingOverlay}>
                <div className={styles.spinner} />
                <p>百度飞桨 PaddleOCR 正在解析页面版面、表格与文字...</p>
              </div>
            ) : error ? (
              <div style={{ color: 'var(--accent-rose)', padding: '16px', background: 'rgba(244, 63, 94, 0.1)', borderRadius: '12px', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                {error}
              </div>
            ) : viewMode === 'ocr_source' && ocrCache[pageNumber] ? (
              <div 
                style={{ 
                  maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none', 
                  margin: isImmersive ? '0 auto' : '0',
                  fontSize: isImmersive ? '16px' : '15px',
                  lineHeight: isImmersive ? '1.9' : '1.8',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <ScanText size={14} /> 百度飞桨 OCR 识别结果
                  </span>
                  <button 
                    className={styles.btn} 
                    style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                    onClick={() => executeTranslateText(ocrCache[pageNumber], pageNumber)}
                  >
                    <Zap size={13} /> 将此 OCR 内容翻译为中文
                  </button>
                </div>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {ocrCache[pageNumber]}
                </ReactMarkdown>
              </div>
            ) : (
              <div 
                style={{ 
                  maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none', 
                  margin: isImmersive ? '0 auto' : '0',
                  fontSize: isImmersive ? '17px' : '15.5px',
                  lineHeight: isImmersive ? '2.0' : '1.85',
                  transition: 'all 0.25s ease'
                }}
              >
                {/* 需求2: 自定义 Markdown 渲染，将当前页已剪藏的句子以波浪线和高亮标识 */}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ node, children, ...props }) => {
                      return (
                        <p {...props}>
                          {React.Children.map(children, child => {
                            if (typeof child === 'string' && currentPageClips.length > 0) {
                              // 检查文本是否包含已剪藏片段
                              for (const clip of currentPageClips) {
                                if (clip.text && child.includes(clip.text)) {
                                  const parts = child.split(clip.text);
                                  return parts.reduce((acc: any[], part: string, i: number) => {
                                    if (i > 0) {
                                      acc.push(
                                        <span
                                          key={`clip-${clip.id}-${i}`}
                                          className={styles.clippedTextSpan}
                                          onClick={(e) => handleClippedSpanClick(e, clip)}
                                          data-tooltip="已剪藏（点击唤起微岛）"
                                        >
                                          {clip.text}
                                        </span>
                                      );
                                    }
                                    acc.push(part);
                                    return acc;
                                  }, []);
                                }
                              }
                            }
                            return child;
                          })}
                        </p>
                      );
                    },
                  }}
                >
                  {displayedText ? displayedText : '待翻译或翻页中...'}
                </ReactMarkdown>
                {isTranslating && <span className={styles.cursorPulse}> ▍</span>}
              </div>
            )}
          </div>

          {/* 平级并排剪藏栏 (无黑遮罩，固定 Header 防穿透) */}
          <div className={`${styles.inlineClipsSidebar} ${!isClipsDrawerOpen ? styles.inlineClipsSidebarClosed : ''}`}>
            <div className={styles.clipsHeader}>
              <h3 style={{ fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookmarkCheck size={16} style={{ color: 'var(--primary)' }} /> 本书剪藏 ({clips.length})
              </h3>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                  className={styles.topNavIconBtn} 
                  style={{ width: '26px', height: '26px' }}
                  onClick={handleCopyAllClips}
                  disabled={clips.length === 0}
                  data-tooltip="一键复制全部剪藏"
                >
                  <Copy size={12} />
                </button>
                <button 
                  className={styles.topNavIconBtn} 
                  style={{ width: '26px', height: '26px' }}
                  onClick={handleExportClipsMarkdown}
                  disabled={clips.length === 0}
                  data-tooltip="导出为 Markdown 书摘"
                >
                  <Download size={12} />
                </button>
                <button 
                  className={styles.topNavIconBtn} 
                  style={{ width: '26px', height: '26px' }}
                  onClick={() => setIsClipsDrawerOpen(false)}
                  data-tooltip="收起剪藏栏"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            <div className={styles.clipsList}>
              {clips.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <BookmarkPlus size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                  <p>暂无剪藏内容</p>
                  <p style={{ fontSize: '11.5px', marginTop: '6px' }}>在译文中划词选中文字，点击【剪藏】即可收录</p>
                </div>
              ) : (
                clips.map(clip => (
                  <div key={clip.id} className={styles.clipCard} style={{ padding: '12px' }}>
                    <div className={styles.clipMeta}>
                      {/* 需求5: 精简 Tooltip 文案，去除多余开发括号 */}
                      <span 
                        style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                        onClick={() => {
                          setPageNumber(clip.pageNumber);
                          triggerExactHighlightForSelection(clip.text);
                        }}
                        data-tooltip={`跳转至第 ${clip.pageNumber} 页`}
                      >
                        第 {clip.pageNumber} 页 <ExternalLink size={11} />
                      </span>
                      <span style={{ fontSize: '10.5px' }}>{new Date(clip.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className={styles.clipContent} style={{ fontSize: '12.5px', lineHeight: '1.65' }}>{clip.text}</p>
                    <div className={styles.clipActions}>
                      <button 
                        className={styles.btnSecondary} 
                        style={{ padding: '2px 6px', fontSize: '10.5px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                        onClick={() => handleCopyClip(clip.text)}
                        data-tooltip="复制此段"
                      >
                        <Copy size={11} /> 复制
                      </button>
                      <button 
                        className={styles.btnSecondary} 
                        style={{ padding: '2px 6px', fontSize: '10.5px', color: 'var(--accent-rose)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                        onClick={() => handleDeleteClip(clip.id)}
                        data-tooltip="删除此条剪藏"
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI 深度解释与追问卡片小窗 (Explain Modal) */}
      {isExplainModalOpen && (
        <div className={styles.explainCardOverlay} onClick={() => setIsExplainModalOpen(false)}>
          <div className={styles.explainCardModal} onClick={e => e.stopPropagation()}>
            <div className={styles.explainHeader}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} style={{ color: 'var(--primary)' }} /> AI 深度伴读解析
              </h3>
              <button className={styles.iconBtn} onClick={() => setIsExplainModalOpen(false)} data-tooltip="关闭">
                <X size={15} />
              </button>
            </div>

            <div className={styles.explainBody}>
              <div className={styles.explainSelectionQuote}>
                “{explainTargetText}”
              </div>

              {isExplainLoading && !explainResultText && explainHistory.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--primary)', padding: '20px 0' }}>
                  <div className={styles.spinner} style={{ width: '20px', height: '20px' }} />
                  <span>正在结合上下文进行深度研读与背景解析...</span>
                </div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {explainResultText}
                </ReactMarkdown>
              )}

              {explainHistory.length > 0 && (
                <div className={styles.explainChatHistory}>
                  {explainHistory.map((msg, idx) => (
                    <div 
                      key={idx} 
                      className={msg.role === 'user' ? styles.explainChatMessageUser : styles.explainChatMessageAi}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.explainFooter}>
              {!showFollowUpInput ? (
                <button 
                  className={styles.btnSecondary}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => setShowFollowUpInput(true)}
                >
                  <MessageSquare size={14} /> 深入追问与探讨...
                </button>
              ) : (
                <div className={styles.explainInputRow}>
                  <input
                    type="text"
                    className={styles.explainInput}
                    placeholder="输入您对该词句或概念的疑问..."
                    value={explainFollowUpInput}
                    onChange={e => setExplainFollowUpInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendFollowUp()}
                    autoFocus
                  />
                  <button 
                    className={styles.btn} 
                    style={{ padding: '8px 14px', fontSize: '13px' }}
                    onClick={handleSendFollowUp}
                    disabled={isExplainLoading || !explainFollowUpInput.trim()}
                  >
                    {isExplainLoading ? '生成中...' : '发送'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Immersive Mode Keyboard Navigation Hint */}
      {isImmersive && (
        <div className={styles.immersiveHint}>
          <span>按键盘 <span className={styles.keyBadge}>←</span> <span className={styles.keyBadge}>→</span> 翻页</span>
          <span className={styles.badge}>{pageNumber} / {numPages || '-'}</span>
        </div>
      )}
    </div>
  );
}




