"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import {
  ArrowLeft,
  Pencil,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';

export interface PdfHeaderProps {
  fileName?: string;
  isEditingTitle: boolean;
  editTitleValue: string;
  onStartEditTitle: () => void;
  onTitleChange: (val: string) => void;
  onSaveTitle: () => void;
  onCancelEditTitle: () => void;
  zoomScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pageNumber: number;
  numPages: number;
  onChangePage: (delta: number) => void;
  onSeekPage: (page: number) => void;
  onBackHome: () => void;
}

export function PdfHeader({
  fileName,
  isEditingTitle,
  editTitleValue,
  onStartEditTitle,
  onTitleChange,
  onSaveTitle,
  onCancelEditTitle,
  zoomScale,
  onZoomIn,
  onZoomOut,
  pageNumber,
  numPages,
  onChangePage,
  onSeekPage,
  onBackHome,
}: PdfHeaderProps) {
  return (
    <div className={styles.header}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1, marginRight: '8px' }}>
        <button className={styles.topNavIconBtn} onClick={onBackHome} data-tooltip="返回首页">
          <ArrowLeft size={16} />
        </button>

        {isEditingTitle ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
            <input
              type="text"
              value={editTitleValue}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSaveTitle()}
              autoFocus
              style={{
                padding: '3px 8px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: '1px solid var(--primary)',
                background: 'var(--background)',
                color: 'var(--foreground)',
                flex: 1,
                minWidth: '100px',
              }}
            />
            <button className={styles.btn} style={{ padding: '4px 6px', fontSize: '11px' }} onClick={onSaveTitle}>
              <Check size={12} />
            </button>
            <button className={styles.btnSecondary} style={{ padding: '4px 6px', fontSize: '11px' }} onClick={onCancelEditTitle}>
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
                fontSize: '13px',
              }}
              onClick={onStartEditTitle}
              data-tooltip="点击重命名此书籍"
            >
              {fileName || '原始 PDF'}
            </h2>
            <button
              type="button"
              onClick={onStartEditTitle}
              className={styles.iconBtn}
              data-tooltip="重命名文件名"
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.topNavIconBtn}
          onClick={onZoomOut}
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
          onClick={onZoomIn}
          data-tooltip="放大页面"
        >
          <ZoomIn size={15} />
        </button>

        <button
          className={styles.topNavIconBtn}
          disabled={pageNumber <= 1}
          onClick={() => onChangePage(-1)}
          data-tooltip="上一页 (←)"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          type="range"
          min={1}
          max={numPages || 1}
          value={pageNumber}
          onChange={(e) => onSeekPage(Number(e.target.value))}
          style={{ width: '60px', cursor: 'pointer' }}
          data-tooltip="快速拖拽翻页"
        />
        <span className={styles.badge} style={{ padding: '2px 6px', fontSize: '10.5px' }}>
          {pageNumber}/{numPages || '-'}
        </span>
        <button
          className={styles.topNavIconBtn}
          disabled={pageNumber >= numPages}
          onClick={() => onChangePage(1)}
          data-tooltip="下一页 (→)"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
