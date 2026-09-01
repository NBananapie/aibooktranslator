"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '../app/page.module.css';
import { useAppContext } from '@/context/AppContext';
import { getHistoryRecord, saveHistoryRecord, HistoryRecord } from '@/lib/db';
import { useRouter } from 'next/navigation';

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function PdfTranslator() {
  const { settings, activeFileId, theme, toggleTheme } = useAppContext();
  const router = useRouter();

  const [dbRecord, setDbRecord] = useState<HistoryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  
  const [translatedText, setTranslatedText] = useState<string>('');
  const [displayedText, setDisplayedText] = useState<string>('');
  const fullTextRef = useRef<string>('');
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  const [isPreTranslating, setIsPreTranslating] = useState<boolean>(false);
  const [translationCache, setTranslationCache] = useState<Record<number, string>>({});

  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(50);
  const [isImmersive, setIsImmersive] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
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

  // 自适应动态监听左侧容器宽度，消除硬编码 800px 溢出
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
        setTranslationCache(record.translations || {});
        
        if (record.translations && record.translations[pageNumber]) {
          fullTextRef.current = record.translations[pageNumber];
          setTranslatedText(record.translations[pageNumber]);
          setDisplayedText(record.translations[pageNumber]);
        }
      } else {
        router.push('/');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, router]);

  // Handle page changes to instantly load cached text and abort ongoing requests
  useEffect(() => {
    currentPageRef.current = pageNumber;
    
    // 中断上一次未完成的翻译流，杜绝竞态与 Token 浪费
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
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
  }, [pageNumber]);

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
  };

  const translateCurrentPage = useCallback(async (force = false) => {
    if (!file) return;

    if (!force && translationCache[pageNumber]) {
      return;
    }

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
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      
      let extractedText = '';
      let lastY: number | undefined;
      
      for (const item of textContent.items as any[]) {
        if (!item.str && !item.hasEOL) continue;
        if (lastY !== undefined) {
          const yDiff = Math.abs(lastY - item.transform[5]);
          if (yDiff > 12) extractedText += '\n\n';
          else if (yDiff > 4) extractedText += '\n';
        }
        extractedText += item.str;
        if (item.hasEOL) extractedText += '\n';
        if (item.str.trim() !== '') lastY = item.transform[5];
      }

      extractedText = extractedText.replace(/\n{3,}/g, '\n\n');

      if (!extractedText.trim()) {
        setIsTranslating(false);
        const msg = '*(当前页面无提取到文本内容，若为扫描件请先进行 OCR 处理)*';
        setTranslatedText(msg);
        fullTextRef.current = msg;
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
          if (currentPageRef.current === pageNumber) {
            fullTextRef.current = currentText; 
          }
        }
      }

      const finalCleanText = currentText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      if (currentPageRef.current === pageNumber) {
        setTranslatedText(finalCleanText);
      }
      setTranslationCache(prev => ({ ...prev, [pageNumber]: finalCleanText }));

    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 请求被主动中断，无需展示错误
        return;
      }
      console.error(err);
      setError(err.message || '翻译过程中出现异常。');
    } finally {
      setIsTranslating(false);
    }
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
      
      let extractedText = '';
      let lastY: number | undefined;
      for (const item of textContent.items as any[]) {
        if (!item.str && !item.hasEOL) continue;
        if (lastY !== undefined) {
          const yDiff = Math.abs(lastY - item.transform[5]);
          if (yDiff > 12) extractedText += '\n\n';
          else if (yDiff > 4) extractedText += '\n';
        }
        extractedText += item.str;
        if (item.hasEOL) extractedText += '\n';
        if (item.str.trim() !== '') lastY = item.transform[5];
      }
      extractedText = extractedText.replace(/\n{3,}/g, '\n\n');

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

  return (
    <div className={styles.container} ref={containerRef}>
      {!file && (
        <div className={styles.uploadOverlay}>
           <div className={styles.spinner} />
           <p style={{marginTop: '16px', color: 'var(--primary)', fontWeight: 500}}>正在解构 PDF 文档...</p>
        </div>
      )}

      {/* Left Pane - PDF Viewer */}
      {!isImmersive && (
        <div className={styles.leftPane} style={{ flexBasis: `calc(${leftPaneWidth}% - 6px)`, flexGrow: 0, flexShrink: 0 }}>
          <div className={styles.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button className={styles.btnSecondary} onClick={() => router.push('/')} title="返回首页">
                ← 首页
              </button>
              <h2>{file ? file.name : '原始 PDF'}</h2>
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
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '40px', textAlign: 'center' }}>
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
                style={{ width: '80px', cursor: 'pointer' }}
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
                <Page 
                  pageNumber={pageNumber} 
                  width={pdfRenderWidth * zoomScale} 
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                />
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
          <h2>
            {isImmersive && (
              <button className={styles.btnSecondary} onClick={() => router.push('/')} style={{ marginRight: '8px' }}>
                ← 首页
              </button>
            )}
            AI 译文 (中文)
            {translationCache[pageNumber] && <span className={styles.badge} style={{ marginLeft: '6px' }}>已缓存</span>}
          </h2>
          <div className={styles.controls}>
            <button 
              type="button" 
              className={styles.themeToggleBtn} 
              onClick={toggleTheme}
              title="切换主题"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
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
              disabled={!file || isTranslating}
            >
              {translatedText ? '重新翻译' : '翻译此页'}
            </button>
          </div>
        </div>

        <div className={styles.markdownWrapper}>
          {isTranslating && !displayedText ? (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
              <p>{fullTextRef.current.includes('<think>') ? 'AI 正在深度思考中...' : '正在连接 AI 引擎流式输出...'}</p>
            </div>
          ) : error ? (
            <div style={{ color: 'var(--accent-rose)', padding: '16px', background: 'rgba(244, 63, 94, 0.1)', borderRadius: '12px', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
              翻译失败: {error}
            </div>
          ) : (
            <div 
              style={{ 
                maxWidth: isImmersive ? '760px' : 'none', 
                margin: isImmersive ? '0 auto' : '0',
                fontSize: isImmersive ? '17px' : '15px',
                lineHeight: isImmersive ? '2.0' : '1.85',
                transition: 'all 0.3s ease'
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
    </div>
  );
}

