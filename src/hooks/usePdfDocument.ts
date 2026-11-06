"use client";

import { useState, useRef, useEffect, useCallback, useEffectEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  getHistoryRecord,
  getPdfData,
  HistoryRecord,
  updateHistoryFilename,
  updateHistoryProgress,
  updateHistoryRecord,
  calculatePdfFingerprint,
} from '@/lib/db';

export interface UsePdfDocumentOptions {
  fileId: string | null;
  /** 文件名或阅读进度写入本地后回调（用于安排云端同步） */
  onMetaChanged?: () => void;
}

export function usePdfDocument(options: UsePdfDocumentOptions) {
  const { fileId, onMetaChanged } = options;
  const router = useRouter();

  const [dbRecord, setDbRecord] = useState<HistoryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [resumePrompt, setResumePrompt] = useState<{ page: number; totalPages?: number } | null>(null);

  // 标题修改状态
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [editTitleValue, setEditTitleValue] = useState<string>('');

  // 视口与布局状态
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(50);
  const [isImmersive, setIsImmersive] = useState<boolean>(false);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [pdfRenderWidth, setPdfRenderWidth] = useState<number>(600);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  // DOM 容器引用
  const containerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);

  /** 打开文档后用户是否翻过页；未翻页前不写入进度，避免把已保存的进度覆盖为第 1 页 */
  const hasNavigatedRef = useRef(false);

  const notifyMetaChanged = useEffectEvent(() => onMetaChanged?.());

  // 1. 从 IndexedDB 加载文档记录与 PDF 文件，并检测断点续读
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    hasNavigatedRef.current = false;

    (async () => {
      const [record, pdfData] = await Promise.all([getHistoryRecord(fileId), getPdfData(fileId)]);
      if (cancelled) return;
      if (!record || !pdfData) {
        router.replace('/');
        return;
      }
      let loaded = record;
      if (!loaded.fingerprint) {
        try {
          const fingerprint = await calculatePdfFingerprint(pdfData);
          loaded = (await updateHistoryRecord(fileId, r => ({ ...r, fingerprint }))) ?? loaded;
        } catch (e) {
          console.error('Calculate fingerprint error', e);
        }
      }
      // 记录打开时间（不改变阅读进度）
      loaded = (await updateHistoryProgress(fileId, { lastReadTime: Date.now() })) ?? loaded;
      if (cancelled) return;

      setDbRecord(loaded);
      setFile(new File([pdfData], loaded.filename, { type: 'application/pdf' }));
      setEditTitleValue(loaded.filename);
      setPageNumber(1);
      if (loaded.lastReadPage && loaded.lastReadPage > 1) {
        setResumePrompt({ page: loaded.lastReadPage, totalPages: loaded.totalPages });
      }
    })().catch(err => console.error('加载文档失败', err));

    return () => {
      cancelled = true;
    };
  }, [fileId, router]);

  // 2. 用户翻页后持久化阅读进度
  useEffect(() => {
    if (!fileId || pageNumber < 1) return;
    if (!hasNavigatedRef.current) {
      if (pageNumber === 1) return;
      hasNavigatedRef.current = true;
    }
    const timer = setTimeout(() => {
      const now = Date.now();
      updateHistoryProgress(fileId, { lastReadPage: pageNumber, lastReadTime: now })
        .then(updated => {
          if (!updated) return;
          setDbRecord(prev =>
            prev && prev.id === updated.id
              ? { ...prev, lastReadPage: updated.lastReadPage, lastReadTime: updated.lastReadTime, metaUpdatedAt: updated.metaUpdatedAt }
              : prev
          );
          notifyMetaChanged();
        })
        .catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [fileId, pageNumber]);

  // 3. 监听左侧容器宽度
  useEffect(() => {
    const targetEl = leftPaneRef.current || containerRef.current;
    if (!targetEl) return;

    const updateWidth = () => {
      const calculatedWidth = Math.max(280, targetEl.clientWidth - 48);
      setPdfRenderWidth(prev => (Math.abs(prev - calculatedWidth) > 10 ? calculatedWidth : prev));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(targetEl);
    return () => observer.disconnect();
  }, [leftPaneWidth, isImmersive]);

  // 4. 文档加载完成：记录总页数
  const onDocumentLoadSuccess = (pdf: PDFDocumentProxy) => {
    setPdfDocument(pdf);
    const pages = pdf.numPages || 0;
    setNumPages(pages);
    setDbRecord(prev => (prev ? { ...prev, totalPages: pages } : prev));
    if (fileId) {
      updateHistoryProgress(fileId, { totalPages: pages }).catch(console.error);
    }
  };

  // 5. 分页导航与边界约束
  const changePage = useCallback(
    (offset: number) => {
      hasNavigatedRef.current = true;
      setPageNumber(prev => Math.min(Math.max(1, prev + offset), numPages || 1));
    },
    [numPages]
  );

  const goToPage = useCallback(
    (page: number) => {
      hasNavigatedRef.current = true;
      setPageNumber(Math.min(Math.max(1, page), numPages || page));
    },
    [numPages]
  );

  // 6. 键盘翻页快捷键
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

  // 7. 分栏拖拽改变宽度
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

  // 8. 保存修改后的文件名
  const handleSaveTitle = async () => {
    if (!editTitleValue.trim() || !fileId || !dbRecord) {
      setIsEditingTitle(false);
      return;
    }
    let newName = editTitleValue.trim();
    if (!newName.toLowerCase().endsWith('.pdf')) {
      newName += '.pdf';
    }
    const updated = await updateHistoryFilename(fileId, newName);
    if (updated) {
      setDbRecord(prev => (prev ? { ...prev, filename: updated.filename, metaUpdatedAt: updated.metaUpdatedAt } : prev));
      if (file) setFile(new File([file], newName, { type: 'application/pdf' }));
      onMetaChanged?.();
    }
    setIsEditingTitle(false);
  };

  // 9. 缩放控制
  const zoomIn = () => setZoomScale(s => Math.min(2.0, s + 0.15));
  const zoomOut = () => setZoomScale(s => Math.max(0.6, s - 0.15));
  const resetZoom = () => setZoomScale(1.0);
  const toggleImmersive = () => setIsImmersive(prev => !prev);

  return {
    dbRecord,
    setDbRecord,
    file,
    pdfDocument,
    numPages,
    pageNumber,
    changePage,
    goToPage,
    isEditingTitle,
    setIsEditingTitle,
    editTitleValue,
    setEditTitleValue,
    handleSaveTitle,
    leftPaneWidth,
    setLeftPaneWidth,
    isImmersive,
    toggleImmersive,
    isResizing,
    setIsResizing,
    pdfRenderWidth,
    zoomScale,
    zoomIn,
    zoomOut,
    resetZoom,
    containerRef,
    leftPaneRef,
    pdfWrapperRef,
    onDocumentLoadSuccess,
    resumePrompt,
    setResumePrompt,
  };
}
