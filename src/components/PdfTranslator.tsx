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

export default function PdfTranslator() {
  const { settings, activeFileId, theme, toggleTheme } = useAppContext();
  const router = useRouter();

  const [dbRecord, setDbRecord] = useState<HistoryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  
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

  // OCR state
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(false);
  const [ocrCache, setOcrCache] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<'translation' | 'ocr_source'>('translation');

  // Clips state (剪藏系统)
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [isClipsDrawerOpen, setIsClipsDrawerOpen] = useState<boolean>(false);
  const clipsBtnRef = useRef<HTMLButtonElement>(null);
  const [ghostFlyStyle, setGhostFlyStyle] = useState<React.CSSProperties | null>(null);
  const [ghostFlyText, setGhostFlyText] = useState<string>('');

  // Floating Toolbar state (划词悬浮胶囊栏)
  const [floatingToolbar, setFloatingToolbar] = useState<{
    visible: boolean;
    top: number;
    left: number;
    text: string;
  } | null>(null);

  // Left PDF Highlight Overlay (原文联动高亮)
  const [pdfHighlightBox, setPdfHighlightBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

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
        // Strip out reasoning blocks <think>...</think> from the stream
        const target = fullTextRef.current.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
        
        if (prev.length < target.length) {
          const diff = target.length - prev.length;
          const charsToAdd = Math.max(1, Math.ceil(diff / 4));
          return prev + target.slice(prev.length, prev.length + charsToAdd);
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

        if (record.translations && record.translations[initialPage]) {
          fullTextRef.current = record.translations[initialPage];
          setTranslatedText(record.translations[initialPage]);
          setDisplayedText(record.translations[initialPage]);
        }

        // 更新上次阅读时间与页码
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

  // Handle page changes to instantly load cached text and update progress in DB
  useEffect(() => {
    currentPageRef.current = pageNumber;
    setViewMode('translation');
    setFloatingToolbar(null);
    setPdfHighlightBox(null);
    
    // 中断上一次未完成的翻译流，杜绝竞态与 Token 浪费
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
      fullTextRef.current = translationCache[pageNumber];
      setTranslatedText(translationCache[pageNumber]);
      setDisplayedText(translationCache[pageNumber]);
    } else {
      fullTextRef.current = '';
      setTranslatedText('');
      setDisplayedText('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber, activeFileId]);

  // Persist translationCache to DB whenever it changes
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

  // 保存修改后的文件名
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

  // 截取当前 PDF 页面为高分辨率 Base64 图像
  const captureCurrentPageImage = async (): Promise<string> => {
    if (!file) throw new Error('PDF 文件未加载');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x 提高清晰度确保 OCR 精度
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 上下文初始化失败');
    await (page.render as any)({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL('image/jpeg', 0.95);
  };

  // 执行通用流式翻译
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
      let currentText = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          currentText += chunk;
          if (currentPageRef.current === targetPage) {
            fullTextRef.current = currentText; 
          }
        }
      }

      const finalCleanText = currentText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      if (currentPageRef.current === targetPage) {
        setTranslatedText(finalCleanText);
      }
      setTranslationCache(prev => ({ ...prev, [targetPage]: finalCleanText }));
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || '翻译过程中出现异常。');
    } finally {
      setIsTranslating(false);
    }
  };

  // 单独触发 OCR 识别
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

    if (!force && translationCache[pageNumber]) {
      return;
    }

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
        // 若原生提取无文字（扫描件），检查是否有 OCR Token 自动启用 OCR 识别
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
        // 下一页为扫描件时通过 OCR 预提取
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

      const finalCleanText = fullNextText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      setTranslationCache(prev => ({ ...prev, [nextPage]: finalCleanText }));
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

  // === 需求4: 右侧选中译文时在左侧 PDF 原文联动显示高亮遮罩 ===
  const triggerPdfHighlightForSelection = (selectedText: string) => {
    if (!selectedText.trim() || !pdfWrapperRef.current) return;

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    const currentDocText = displayedText || translationCache[pageNumber] || '';
    if (!currentDocText) return;

    const index = currentDocText.indexOf(selectedText);
    const totalLen = Math.max(1, currentDocText.length);
    const ratio = index >= 0 ? index / totalLen : 0.2;
    const lenRatio = Math.max(0.08, selectedText.length / totalLen);

    // 计算 PDF 容器内部大概相对位置
    const pdfPageElem = pdfWrapperRef.current.querySelector('.react-pdf__Page') as HTMLElement;
    if (pdfPageElem) {
      const pageHeight = pdfPageElem.clientHeight || 800;
      const pageWidth = pdfPageElem.clientWidth || (pdfRenderWidth * zoomScale);
      
      const topPos = Math.max(10, Math.min(pageHeight - 60, ratio * pageHeight + 20));
      const boxHeight = Math.max(36, Math.min(180, lenRatio * pageHeight * 1.5));
      const boxWidth = Math.max(200, pageWidth - 48);

      setPdfHighlightBox({
        top: topPos,
        left: 24,
        width: boxWidth,
        height: boxHeight,
      });

      // 平滑滚动左侧 PDF 视口至对应区域
      pdfWrapperRef.current.scrollTo({
        top: Math.max(0, topPos - 120),
        behavior: 'smooth',
      });

      // 4 秒后自动淡出高亮
      highlightTimerRef.current = setTimeout(() => {
        setPdfHighlightBox(null);
      }, 4000);
    }
  };

  // === 需求5 & 6: 划词选区监听与悬浮胶囊栏 ===
  const handleMarkdownSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setFloatingToolbar(null);
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 1) {
      setFloatingToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setFloatingToolbar({
      visible: true,
      top: rect.top,
      left: rect.left + rect.width / 2,
      text,
    });

    // 触发左侧原文联动高亮
    triggerPdfHighlightForSelection(text);
  };

  // 点击外部关闭悬浮胶囊栏
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.floatingToolbar}`) || target.closest(`.${styles.explainCardModal}`)) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setFloatingToolbar(null);
      }
    };

    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, []);

  // === 需求5: 剪藏文字与飞入动效 ===
  const handleAddClip = async () => {
    if (!floatingToolbar || !floatingToolbar.text || !activeFileId) return;
    const textToClip = floatingToolbar.text;

    // 触发飞入吸入动效
    const selection = window.getSelection();
    let startRect = { top: floatingToolbar.top, left: floatingToolbar.left, width: 120, height: 30 };
    if (selection && !selection.isCollapsed) {
      startRect = selection.getRangeAt(0).getBoundingClientRect();
    }

    const targetRect = clipsBtnRef.current?.getBoundingClientRect() || { top: 20, left: window.innerWidth - 60, width: 30, height: 30 };

    setGhostFlyText(textToClip.slice(0, 30) + (textToClip.length > 30 ? '...' : ''));
    setGhostFlyStyle({
      top: startRect.top,
      left: startRect.left,
      width: Math.min(260, Math.max(100, startRect.width)),
      transform: 'scale(1) translateY(0)',
      opacity: 1,
      filter: 'blur(0px)',
    });

    // 触发吸入抽屉动画
    requestAnimationFrame(() => {
      setTimeout(() => {
        setGhostFlyStyle({
          top: targetRect.top,
          left: targetRect.left,
          width: 60,
          transform: 'scale(0.2) translateY(-20px)',
          opacity: 0,
          filter: 'blur(8px)',
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
    setFloatingToolbar(null);
  };

  // 删除剪藏
  const handleDeleteClip = async (clipId: string) => {
    if (!activeFileId) return;
    await deleteHistoryClip(activeFileId, clipId);
    setClips(prev => prev.filter(c => c.id !== clipId));
  };

  // 复制剪藏
  const handleCopyClip = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制剪藏内容到剪贴板！');
  };

  // 一键复制所有剪藏
  const handleCopyAllClips = () => {
    if (clips.length === 0) return;
    const content = clips
      .map((c, i) => `【摘录 ${i + 1}】(第 ${c.pageNumber} 页):\n${c.text}\n`)
      .join('\n---\n\n');
    navigator.clipboard.writeText(content);
    alert(`已复制全部 ${clips.length} 条剪藏内容！`);
  };

  // 导出剪藏为 Markdown
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

  // === 需求6: AI 深度解释与多轮追问 ===
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
          contextText: displayedText || translationCache[pageNumber] || '',
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

  // 提交深入追问
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
          contextText: displayedText || translationCache[pageNumber] || '',
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
      mdContent += `### 第 ${page} 页\n\n`;
      mdContent += `${translationCache[page]}\n\n---\n\n`;
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
          📌 {ghostFlyText}
        </div>
      )}

      {/* 划词悬浮胶囊工具栏 */}
      {floatingToolbar && floatingToolbar.visible && (
        <div 
          className={styles.floatingToolbar} 
          style={{ top: `${floatingToolbar.top}px`, left: `${floatingToolbar.left}px` }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button className={`${styles.capsuleBtn} ${styles.capsuleBtnPrimary}`} onClick={handleAddClip} title="将选中文字剪藏至本书摘录">
            📌 剪藏
          </button>
          <button className={styles.capsuleBtn} onClick={handleOpenExplain} title="结合上下文让 AI 深度解析该词句">
            💡 解释
          </button>
          <button className={styles.capsuleBtn} onClick={() => { navigator.clipboard.writeText(floatingToolbar.text); setFloatingToolbar(null); }} title="复制选中文字">
            📋 复制
          </button>
        </div>
      )}

      {/* Left Pane - PDF Viewer */}
      {!isImmersive && (
        <div className={styles.leftPane} style={{ flexBasis: `calc(${leftPaneWidth}% - 6px)`, flexGrow: 0, flexShrink: 0 }}>
          <div className={styles.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, marginRight: '10px' }}>
              <button className={styles.btnSecondary} onClick={() => router.push('/')} title="返回首页">
                ← 首页
              </button>
              
              {isEditingTitle ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                    autoFocus
                    style={{
                      padding: '4px 8px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid var(--primary)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      flex: 1,
                      minWidth: '120px'
                    }}
                  />
                  <button className={styles.btn} style={{ padding: '4px 8px', fontSize: '12px' }} onClick={handleSaveTitle}>
                    确定
                  </button>
                  <button className={styles.btnSecondary} style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => setIsEditingTitle(false)}>
                    取消
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
                  <h2 
                    style={{ 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      whiteSpace: 'nowrap',
                      maxWidth: '280px',
                      cursor: 'pointer'
                    }} 
                    onClick={() => {
                      setEditTitleValue(file?.name || '');
                      setIsEditingTitle(true);
                    }}
                    title="点击修改文件名"
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
                    title="重命名此文件"
                  >
                    ✏️
                  </button>
                </div>
              )}
            </div>

            <div className={styles.controls}>
              {/* Zoom controls */}
              <button 
                type="button" 
                className={styles.btnSecondary} 
                onClick={() => setZoomScale(s => Math.max(0.6, s - 0.15))}
                title="缩小"
              >
                －
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '38px', textAlign: 'center' }}>
                {Math.round(zoomScale * 100)}%
              </span>
              <button 
                type="button" 
                className={styles.btnSecondary} 
                onClick={() => setZoomScale(s => Math.min(2.0, s + 0.15))}
                title="放大"
              >
                ＋
              </button>

              {/* Page Controls */}
              <button className={styles.btn} disabled={pageNumber <= 1} onClick={() => changePage(-1)}>
                上一页
              </button>
              <input 
                type="range" 
                min={1} 
                max={numPages || 1} 
                value={pageNumber} 
                onChange={(e) => setPageNumber(Number(e.target.value))} 
                style={{ width: '70px', cursor: 'pointer' }}
                title="快速拖拽翻页"
              />
              <span className={styles.badge}>
                {pageNumber} / {numPages || '-'}
              </span>
              <button className={styles.btn} disabled={pageNumber >= numPages} onClick={() => changePage(1)}>
                下一页
              </button>
            </div>
          </div>

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
                  />
                  {/* 原文联动琥珀高光遮罩 */}
                  {pdfHighlightBox && (
                    <div 
                      className={styles.pdfHighlightOverlay}
                      style={{
                        top: `${pdfHighlightBox.top}px`,
                        left: `${pdfHighlightBox.left}px`,
                        width: `${pdfHighlightBox.width}px`,
                        height: `${pdfHighlightBox.height}px`,
                      }}
                    />
                  )}
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
          title="按住拖拽调整宽度，双击快速复位 50:50"
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
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isImmersive && (
              <button className={styles.btnSecondary} onClick={() => router.push('/')} style={{ marginRight: '6px' }}>
                ← 首页
              </button>
            )}
            <h2>
              {viewMode === 'translation' ? 'AI 译文 (中文)' : 'PaddleOCR 原文结构'}
              {isTranslating ? (
                <span className={styles.badge} style={{ marginLeft: '6px' }}>⚡ 流式生成中</span>
              ) : isOcrLoading ? (
                <span className={styles.badge} style={{ marginLeft: '6px' }}>🔍 OCR 识别中</span>
              ) : translationCache[pageNumber] ? (
                <span className={styles.badge} style={{ marginLeft: '6px' }}>已缓存</span>
              ) : null}
            </h2>

            {/* OCR 结果与翻译切换 */}
            {ocrCache[pageNumber] && (
              <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                <button
                  type="button"
                  className={`${styles.presetBtn} ${viewMode === 'translation' ? styles.presetBtnActive : ''}`}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => setViewMode('translation')}
                >
                  中文译文
                </button>
                <button
                  type="button"
                  className={`${styles.presetBtn} ${viewMode === 'ocr_source' ? styles.presetBtnActive : ''}`}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => setViewMode('ocr_source')}
                >
                  OCR 原文结构
                </button>
              </div>
            )}
          </div>

          <div className={styles.controls}>
            <button 
              type="button" 
              className={styles.themeToggleBtn} 
              onClick={toggleTheme}
              title="切换主题"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>

            {/* 剪藏库入口 */}
            <button
              ref={clipsBtnRef}
              type="button"
              className={styles.btnSecondary}
              onClick={() => setIsClipsDrawerOpen(true)}
              title="查看本书全部剪藏摘录"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              📑 剪藏 ({clips.length})
            </button>

            {isImmersive && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setFullWidthReading(w => !w)}
                title="切换阅读栏宽度"
              >
                {fullWidthReading ? '🗖 居中阅读' : '🗗 铺满全宽'}
              </button>
            )}

            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => runOcrOnCurrentPage(false)}
              disabled={!file || isOcrLoading}
              title="使用百度飞桨 PaddleOCR-VL 识别本页（包含多模态表格与排版结构）"
            >
              {isOcrLoading ? '识别中...' : '🔍 OCR 识别'}
            </button>

            <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: 'var(--primary-surface)', border: '1px solid var(--primary-border)', color: 'var(--primary)', padding: '6px 12px', borderRadius: '10px', fontWeight: 600 }}>
              <input 
                type="checkbox" 
                checked={isImmersive} 
                onChange={(e) => setIsImmersive(e.target.checked)} 
                style={{ margin: 0 }}
              />
              沉浸模式
            </label>
            
            <button 
              className={styles.btnSecondary} 
              onClick={downloadMarkdown} 
              disabled={Object.keys(translationCache).length === 0}
              title="导出已翻译的所有页码为 Markdown"
            >
              ⬇ 导出 MD
            </button>
            
            <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input 
                type="checkbox" 
                checked={autoTranslate} 
                onChange={(e) => setAutoTranslate(e.target.checked)} 
              />
              翻页自动翻译
            </label>

            <button
              className={styles.btnSecondary}
              onClick={preTranslateNextPage}
              disabled={!file || pageNumber >= numPages || isPreTranslating || !!translationCache[pageNumber + 1]}
            >
              {isPreTranslating ? '预加载中...' : translationCache[pageNumber + 1] ? '下页已就绪' : '预译下一页'}
            </button>
            
            <button 
              className={styles.btn} 
              onClick={() => translateCurrentPage(true)} 
              disabled={!file || isTranslating || isOcrLoading}
            >
              {isTranslating ? '生成中...' : isOcrLoading ? 'OCR 提取中...' : translatedText ? '重新翻译' : '翻译此页'}
            </button>
          </div>
        </div>

        <div 
          className={styles.markdownWrapper}
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
                <span style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 600 }}>🔍 百度飞桨 OCR 识别结果</span>
                <button 
                  className={styles.btn} 
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => executeTranslateText(ocrCache[pageNumber], pageNumber)}
                >
                  🚀 将此 OCR 内容翻译为中文
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayedText ? displayedText : '待翻译或翻页中...'}
              </ReactMarkdown>
              {isTranslating && <span className={styles.cursorPulse}> ▍</span>}
            </div>
          )}
        </div>
      </div>

      {/* 剪藏侧边栏抽屉 (Clips Drawer) */}
      {isClipsDrawerOpen && (
        <div className={styles.clipsDrawerOverlay} onClick={() => setIsClipsDrawerOpen(false)}>
          <div className={styles.clipsDrawer} onClick={e => e.stopPropagation()}>
            <div className={styles.clipsHeader}>
              <h3>📑 本书剪藏摘录 ({clips.length})</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className={styles.btnSecondary} 
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={handleCopyAllClips}
                  disabled={clips.length === 0}
                  title="一键复制全部剪藏"
                >
                  📋 复制全部
                </button>
                <button 
                  className={styles.btnSecondary} 
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={handleExportClipsMarkdown}
                  disabled={clips.length === 0}
                  title="导出为 Markdown 书摘"
                >
                  ⬇ 导出 MD
                </button>
                <button 
                  className={styles.iconBtn} 
                  onClick={() => setIsClipsDrawerOpen(false)}
                  title="关闭抽屉"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className={styles.clipsList}>
              {clips.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                  <p>暂无剪藏内容</p>
                  <p style={{ fontSize: '12px', marginTop: '6px' }}>在右侧译文中鼠标划词选中任意段落，点击【📌 剪藏】即可收录至此</p>
                </div>
              ) : (
                clips.map(clip => (
                  <div key={clip.id} className={styles.clipCard}>
                    <div className={styles.clipMeta}>
                      <span 
                        style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 600 }}
                        onClick={() => { setPageNumber(clip.pageNumber); setIsClipsDrawerOpen(false); }}
                        title="点击跳转至此页"
                      >
                        第 {clip.pageNumber} 页 ↗
                      </span>
                      <span>{new Date(clip.createdAt).toLocaleDateString()} {new Date(clip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className={styles.clipContent}>{clip.text}</p>
                    <div className={styles.clipActions}>
                      <button 
                        className={styles.btnSecondary} 
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        onClick={() => handleCopyClip(clip.text)}
                        title="复制此段"
                      >
                        复制
                      </button>
                      <button 
                        className={styles.btnSecondary} 
                        style={{ padding: '2px 8px', fontSize: '11px', color: 'var(--accent-rose)' }}
                        onClick={() => handleDeleteClip(clip.id)}
                        title="删除此条剪藏"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI 深度解释与追问卡片小窗 (Explain Modal) */}
      {isExplainModalOpen && (
        <div className={styles.explainCardOverlay} onClick={() => setIsExplainModalOpen(false)}>
          <div className={styles.explainCardModal} onClick={e => e.stopPropagation()}>
            <div className={styles.explainHeader}>
              <h3>💡 AI 深度伴读解析</h3>
              <button className={styles.iconBtn} onClick={() => setIsExplainModalOpen(false)}>✕</button>
            </div>

            <div className={styles.explainBody}>
              {/* 选中的词句引用 */}
              <div className={styles.explainSelectionQuote}>
                “{explainTargetText}”
              </div>

              {/* 首轮解释解析 */}
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

              {/* 多轮追问历史 */}
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
                  💬 深入追问与探讨...
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



