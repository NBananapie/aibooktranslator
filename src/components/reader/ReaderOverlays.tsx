"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import { BookmarkPlus } from 'lucide-react';

export interface ReaderOverlaysProps {
  isLoadingFile: boolean;
  ghostFlyStyle: React.CSSProperties | null;
  ghostFlyText: string;
  isImmersive: boolean;
  pageNumber: number;
  numPages: number;
}

export function ReaderOverlays({
  isLoadingFile,
  ghostFlyStyle,
  ghostFlyText,
  isImmersive,
  pageNumber,
  numPages,
}: ReaderOverlaysProps) {
  return (
    <>
      {isLoadingFile && (
        <div className={styles.uploadOverlay}>
          <div className={styles.spinner} />
          <p style={{ marginTop: '16px', color: 'var(--primary)', fontWeight: 500 }}>
            正在解构 PDF 文档...
          </p>
        </div>
      )}

      {ghostFlyStyle && (
        <div className={styles.ghostFlyingItem} style={ghostFlyStyle}>
          <BookmarkPlus size={14} style={{ display: 'inline', marginRight: '4px' }} />
          {ghostFlyText}
        </div>
      )}

      {isImmersive && (
        <div className={styles.immersiveHint}>
          <span>
            按键盘 <span className={styles.keyBadge}>←</span> <span className={styles.keyBadge}>→</span> 翻页
          </span>
          <span className={styles.badge}>
            {pageNumber} / {numPages || '-'}
          </span>
        </div>
      )}
    </>
  );
}
