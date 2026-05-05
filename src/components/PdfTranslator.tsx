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
  const { settings, activeFileId } = useAppContext();
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

  const currentPageRef = useRef<number>(pageNumber);

  // Smooth typewriter animation effect
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setDisplayedText((prev) => {
        const target = fullTextRef.current;
        if (prev.length < target.length) {
          const diff = target.length - prev.length;
          const charsToAdd = Math.max(1, Math.ceil(diff / 5));
          return prev + target.slice(prev.length, prev.length + charsToAdd);
        }
        return prev;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Load from DB on mount
  useEffect(() => {
    if (!activeFileId) return;
    getHistoryRecord(activeFileId).then(record => {
      if (record) {
        setDbRecord(record);
        setFile(new File([record.pdfData], record.filename, { type: 'application/pdf' }));
        setTranslationCache(record.translations || {});
        
        // Instantly display if current page is in the loaded cache
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

  // Handle page changes to instantly load cached text
  useEffect(() => {
    currentPageRef.current = pageNumber;
    
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
      // Avoid unnecessary writes if nothing actually changed
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
        const msg = '*(当前页面无文本)*';
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
          customPrompt: settings.customPrompt
        }),
      });

      if (!response.ok) throw new Error('Translation request failed');
      if (!response.body) throw new Error('ReadableStream not supported by the browser.');

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

      if (currentPageRef.current === pageNumber) {
        setTranslatedText(currentText);
      }
      setTranslationCache(prev => ({ ...prev, [pageNumber]: currentText }));

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during translation.');
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
          customPrompt: settings.customPrompt
        }),
      });

      if (!response.ok || !response.body) throw new Error('Pre-translation request failed');

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
      }, 600); 
      return () => clearTimeout(timer);
    }
  }, [file, pageNumber, autoTranslate, translateCurrentPage]);

  const changePage = (offset: number) => {
    setPageNumber(prev => Math.min(Math.max(1, prev + offset), numPages));
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
    
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className={styles.container}>
      {!file && (
        <div className={styles.uploadOverlay}>
           <div className={styles.spinner} />
           <p style={{marginTop: '16px', color: 'var(--primary)'}}>加载文档中...</p>
        </div>
      )}

      {/* Left Pane - PDF Viewer */}
      <div className={styles.leftPane}>
        <div className={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             <button className={styles.btnSecondary} onClick={() => router.push('/')}>← 返回主页</button>
             <h2>原始 PDF {file && `(${file.name})`}</h2>
          </div>
          <div className={styles.controls}>
            <button className={styles.btn} disabled={pageNumber <= 1} onClick={() => changePage(-1)}>
              上一页
            </button>
            <input 
              type="range" 
              min={1} 
              max={numPages || 1} 
              value={pageNumber} 
              onChange={(e) => setPageNumber(Number(e.target.value))} 
              style={{ width: '100px', cursor: 'pointer' }}
              title="快速拖动跳转页面"
            />
            <span style={{ fontSize: '14px', minWidth: '40px', textAlign: 'center' }}>
              {pageNumber} / {numPages || '-'}
            </span>
            <button className={styles.btn} disabled={pageNumber >= numPages} onClick={() => changePage(1)}>
              下一页
            </button>
          </div>
        </div>
        <div className={styles.pdfWrapper}>
          {file && (
            <Document
              file={file}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={<div className={styles.loadingOverlay}><div className={styles.spinner} /></div>}
            >
              <Page 
                pageNumber={pageNumber} 
                width={800} 
                renderTextLayer={true}
                renderAnnotationLayer={false}
              />
            </Document>
          )}
        </div>
      </div>

      {/* Right Pane - Translation */}
      <div className={styles.rightPane}>
        <div className={styles.header}>
          <h2>翻译结果 (中文)</h2>
          <div className={styles.controls}>
            <button 
              className={styles.btnSecondary} 
              onClick={downloadMarkdown} 
              disabled={Object.keys(translationCache).length === 0}
            >
              ⬇ 导出 Markdown
            </button>
            <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={autoTranslate} 
                onChange={(e) => setAutoTranslate(e.target.checked)} 
              />
              跟随翻页自动翻译
            </label>
            <button
              className={styles.btn}
              onClick={preTranslateNextPage}
              disabled={!file || pageNumber >= numPages || isPreTranslating || !!translationCache[pageNumber + 1]}
            >
              {isPreTranslating ? '预翻译中...' : translationCache[pageNumber + 1] ? '下一页已就绪' : '预翻译下一页'}
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
              <p>正在连接 AI 引擎...</p>
            </div>
          ) : error ? (
            <div style={{ color: 'red' }}>翻译失败: {error}</div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayedText ? displayedText + (isTranslating ? ' ▍' : '') : '待翻译或缓存中...'}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
