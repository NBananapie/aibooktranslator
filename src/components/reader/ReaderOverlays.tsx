"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import { ClipFlightCanvas, FlightPayload } from './ClipFlightCanvas';

export interface ReaderOverlaysProps {
  isLoadingFile: boolean;
  flightPayload: FlightPayload | null;
  onFlightComplete: () => void;
  isImmersive: boolean;
  pageNumber: number;
  numPages: number;
}

export function ReaderOverlays({
  isLoadingFile,
  flightPayload,
  onFlightComplete,
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

      <ClipFlightCanvas
        flightPayload={flightPayload}
        onFlightComplete={onFlightComplete}
      />

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
