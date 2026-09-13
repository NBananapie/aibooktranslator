"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getHistoryRecord,
  saveHistoryRecord,
  HistoryRecord,
  updateHistoryFilename,
  updateHistoryProgress,
} from '@/lib/db';

export interface UsePdfDocumentOptions {
  activeFileId: string | null;
  onRecordLoaded?: (record: HistoryRecord) => void;
}

export function usePdfDocument(options: UsePdfDocumentOptions) {
  const { activeFileId, onRecordLoaded } = options;
  const router = useRouter();

  const [dbRecord, setDbRecord] = useState<HistoryRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

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

  // 1. 初始化从 IndexedDB 加载文档记录
  useEffect(() => {
    if (!activeFileId) return;
    getHistoryRecord(activeFileId).then(record => {
      if (record) {
        setDbRecord(record);
        setFile(new File([record.pdfData], record.filename, { type: 'application/pdf' }));
        setEditTitleValue(record.filename);

        const initialPage = record.lastReadPage && record.lastReadPage >= 1 ? record.lastReadPage : 1;
        setPageNumber(initialPage);

        updateHistoryProgress(activeFileId, {
          lastReadPage: initialPage,
          lastReadTime: Date.now(),
        }).catch(console.error);

        if (onRecordLoaded) {
          onRecordLoaded(record);
        }
      } else {
        router.push('/');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, router]);

  // 2. 自适应动态监听左侧容器宽度，杜绝滚动条震荡造成的死循环
  useEffect(() => {
    const targetEl = leftPaneRef.current || containerRef.current;
    if (!targetEl) return;

    const updateWidth = () => {
      if (targetEl) {
        const containerW = targetEl.clientWidth;
        const calculatedWidth = Math.max(280, containerW - 48);
        setPdfRenderWidth(prev => (Math.abs(prev - calculatedWidth) > 10 ? calculatedWidth : prev));
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(targetEl);
    return () => observer.disconnect();
  }, [leftPaneWidth, isImmersive]);

  // 3. 文档成功加载回调
  const onDocumentLoadSuccess = (pdf: any) => {
    setPdfDocument(pdf);
    const pages = pdf?.numPages || 0;
    setNumPages(pages);
    if (activeFileId) {
      updateHistoryProgress(activeFileId, {
        totalPages: pages,
        lastReadPage: pageNumber,
        lastReadTime: Date.now(),
      }).catch(console.error);
    }
  };

  // 4. 分页导航与边界约束
  const changePage = useCallback(
    (offset: number) => {
      setPageNumber(prev => Math.min(Math.max(1, prev + offset), numPages || 1));
    },
    [numPages]
  );

  // 5. 键盘翻页快捷键
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

  // 6. 分栏拖拽改变宽度
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

  // 7. 保存修改后的文件名
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

  // 8. 缩放控制辅助函数
  const zoomIn = () => setZoomScale(s => Math.min(2.0, s + 0.15));
  const zoomOut = () => setZoomScale(s => Math.max(0.6, s - 0.15));
  const resetZoom = () => setZoomScale(1.0);
  const toggleImmersive = () => setIsImmersive(prev => !prev);

  return {
    dbRecord,
    setDbRecord,
    file,
    setFile,
    pdfDocument,
    numPages,
    setNumPages,
    pageNumber,
    setPageNumber,
    changePage,
    isEditingTitle,
    setIsEditingTitle,
    editTitleValue,
    setEditTitleValue,
    handleSaveTitle,
    leftPaneWidth,
    setLeftPaneWidth,
    isImmersive,
    setIsImmersive,
    toggleImmersive,
    isResizing,
    setIsResizing,
    pdfRenderWidth,
    zoomScale,
    setZoomScale,
    zoomIn,
    zoomOut,
    resetZoom,
    containerRef,
    leftPaneRef,
    pdfWrapperRef,
    onDocumentLoadSuccess,
  };
}
