"use client";

import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import styles from '@/app/page.module.css';
import { Minus, Plus } from 'lucide-react';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { SourceBlock } from '@/services/layoutAnalysisEngine';
import { findContiguousItemsForSentence, textItemToRect } from '@/services/alignmentEngine';
import { ClipItem } from '@/lib/db';

// Initialize PDF.js worker
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

export interface PdfPaneProps {
  file: File | null;
  leftPaneRef: React.RefObject<HTMLDivElement | null>;
  pdfWrapperRef: React.RefObject<HTMLDivElement | null>;
  leftPaneWidth: number;
  isImmersive: boolean;
  pdfRenderWidth: number;
  zoomScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  dimPdfInDark?: boolean;
  pageNumber: number;
  exactHighlightSpans: Array<{ left: number; top: number; width: number; height: number }>;
  onDocumentLoadSuccess: (pdf: PDFDocumentProxy) => void;
  onPdfSelection: () => void;
  sourceBlocks?: SourceBlock[];
  hoveredBlockId?: string | null;
  onHoverBlock?: (id: string | null) => void;
  pdfOriginalView?: number[];
  clips?: ClipItem[];
  onClippedSpanClick?: (e: React.MouseEvent, clip: ClipItem) => void;
  pdfTextItems?: TextItem[];
}

export function PdfPane({
  file,
  leftPaneRef,
  pdfWrapperRef,
  leftPaneWidth,
  isImmersive,
  pdfRenderWidth,
  zoomScale,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  dimPdfInDark = true,
  pageNumber,
  exactHighlightSpans,
  onDocumentLoadSuccess,
  onPdfSelection,
  sourceBlocks = [],
  hoveredBlockId = null,
  onHoverBlock,
  pdfOriginalView = [0, 0, 600, 800],
  clips = [],
  onClippedSpanClick,
  pdfTextItems = [],
}: PdfPaneProps) {
  const origWidth = pdfOriginalView[2] || 600;
  const currentRenderW = pdfRenderWidth * zoomScale;
  const scale = origWidth > 0 ? currentRenderW / origWidth : 1;

  const handlePdfMouseMove = (e: React.MouseEvent) => {
    if (e.buttons > 0) return;
    if (exactHighlightSpans.length > 0) return;
    if (!sourceBlocks || sourceBlocks.length === 0 || !pdfWrapperRef.current) return;
    const wrapper = pdfWrapperRef.current;
    const rect = wrapper.getBoundingClientRect();
    const relX = (e.clientX - rect.left + wrapper.scrollLeft) / scale;
    const relY = (e.clientY - rect.top + wrapper.scrollTop) / scale;

    const found = sourceBlocks.find(
      b =>
        relX >= b.box.x &&
        relX <= b.box.x + b.box.width &&
        relY >= b.box.y &&
        relY <= b.box.y + b.box.height
    );
    if (found) {
      if (hoveredBlockId !== found.id) {
        onHoverBlock?.(found.id);
      }
    } else if (hoveredBlockId) {
      onHoverBlock?.(null);
    }
  };

  // 计算原文页面中的已书摘虚线下划线高亮矩形
  const clippedSpans = React.useMemo(() => {
    if (!clips || clips.length === 0 || !pdfTextItems || pdfTextItems.length === 0) return [];
    const validItems = pdfTextItems.filter(item => item.str && item.str.trim() && item.transform);
    if (validItems.length === 0) return [];

    // 原文左侧 PDF 只对英文/原文书摘卡片绘制下划线，含有中文字符的译文书摘绝不跨屏误绘
    const pageClips = clips.filter(
      c => c.pageNumber === pageNumber && c.text && c.text.trim() && !/[\u4e00-\u9fa5]/.test(c.text)
    );
    if (pageClips.length === 0) return [];

    const origHeight = pdfOriginalView[3] || 800;
    const result: Array<{
      clip: ClipItem;
      rect: { left: number; top: number; width: number; height: number };
      key: string;
    }> = [];

    for (const clip of pageClips) {
      const matchedItems = findContiguousItemsForSentence(clip.text.trim(), validItems);
      if (matchedItems && matchedItems.length > 0) {
        matchedItems.forEach((item, idx) => {
          result.push({
            clip,
            rect: textItemToRect(item, origHeight, scale),
            key: `pdf-clip-${clip.id}-${idx}`,
          });
        });
      }
    }
    return result;
  }, [clips, pdfTextItems, pageNumber, pdfOriginalView, scale]);

  const zoomPercent = Math.round(zoomScale * 100);

  return (
    <div
      ref={leftPaneRef}
      className={`${styles.leftPane} ${isImmersive ? styles.hiddenPane : ''} ${
        dimPdfInDark ? 'pdf-night-dim' : ''
      }`}
      style={{ flexBasis: `calc(${leftPaneWidth}% - 3px)`, flexGrow: 0, flexShrink: 0 }}
    >
      <div
        className={styles.pdfWrapper}
        ref={pdfWrapperRef}
        onMouseUp={onPdfSelection}
        onMouseMove={handlePdfMouseMove}
        onMouseLeave={() => {
          if (exactHighlightSpans.length === 0) {
            onHoverBlock?.(null);
          }
        }}
      >
        {file && (
          <Document
            file={file}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className={styles.loadingOverlay}>
                <div className={styles.spinner} />
              </div>
            }
          >
            <div style={{ position: 'relative' }}>
              <Page
                pageNumber={pageNumber}
                width={pdfRenderWidth * zoomScale}
                renderTextLayer={true}
                renderAnnotationLayer={false}
                loading={null}
                noData={null}
              />
              {/* 段落级几何包围框与 Hover 聚焦 */}
              {sourceBlocks.map(block => {
                const left = block.box.x * scale;
                const top = block.box.y * scale;
                const width = block.box.width * scale;
                const height = block.box.height * scale;
                const isHovered = hoveredBlockId === block.id;

                return (
                  <div
                    key={block.id}
                    className={`${styles.pdfBlockOverlay} ${isHovered ? styles.pdfBlockHovered : ''}`}
                    style={{
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${width}px`,
                      height: `${height}px`,
                    }}
                  />
                );
              })}
              {/* 书摘跳转精准定位高亮 */}
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
              {/* 原文已书摘虚线下划线标记 */}
              {clippedSpans.map(({ clip, rect, key }) => (
                <span
                  key={key}
                  data-clip-interactive="true"
                  className={styles.pdfClippedDashedSpan}
                  style={{
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    onClippedSpanClick?.(e, clip);
                  }}
                  title={`已存书摘: ${clip.text}`}
                />
              ))}
            </div>
          </Document>
        )}
      </div>

      {/* 左下角克制悬浮缩放胶囊 */}
      <div className={styles.pdfZoomBar} data-interactive-protected="true">
        <button
          type="button"
          className={styles.pdfZoomBtn}
          onClick={onZoomOut}
          disabled={zoomScale <= 0.61}
          aria-label="缩小原文"
          title="缩小原文"
        >
          <Minus size={12} />
        </button>
        <button
          type="button"
          className={styles.pdfZoomReset}
          onClick={onResetZoom}
          title="点击复位 100% 适配页宽"
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          className={styles.pdfZoomBtn}
          onClick={onZoomIn}
          disabled={zoomScale >= 1.99}
          aria-label="放大原文"
          title="放大原文"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
