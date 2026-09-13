"use client";

import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import styles from '@/app/page.module.css';
import { PdfHeader, PdfHeaderProps } from './PdfHeader';

import { SourceBlock } from '@/services/layoutAnalysisEngine';

// Initialize PDF.js worker
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

export interface PdfPaneProps extends PdfHeaderProps {
  file: File | null;
  leftPaneRef: React.RefObject<HTMLDivElement | null>;
  pdfWrapperRef: React.RefObject<HTMLDivElement | null>;
  leftPaneWidth: number;
  isImmersive: boolean;
  pdfRenderWidth: number;
  exactHighlightSpans: Array<{ left: number; top: number; width: number; height: number }>;
  onDocumentLoadSuccess: (pdf: any) => void;
  onPdfSelection: () => void;
  sourceBlocks?: SourceBlock[];
  hoveredBlockId?: string | null;
  activeSentenceBlockId?: string | null;
  onHoverBlock?: (id: string | null) => void;
  onClickBlock?: (id: string) => void;
  pdfOriginalView?: number[];
}

export function PdfPane({
  file,
  leftPaneRef,
  pdfWrapperRef,
  leftPaneWidth,
  isImmersive,
  pdfRenderWidth,
  zoomScale,
  pageNumber,
  exactHighlightSpans,
  onDocumentLoadSuccess,
  onPdfSelection,
  sourceBlocks = [],
  hoveredBlockId = null,
  activeSentenceBlockId = null,
  onHoverBlock,
  onClickBlock,
  pdfOriginalView = [0, 0, 600, 800],
  ...headerProps
}: PdfPaneProps) {
  const origWidth = pdfOriginalView[2] || 600;
  const currentRenderW = pdfRenderWidth * zoomScale;
  const scale = origWidth > 0 ? currentRenderW / origWidth : 1;

  const handlePdfMouseMove = (e: React.MouseEvent) => {
    if (e.buttons > 0) return; // 正在按住鼠标拖拽选词时，禁止触发 Hover 切换与重绘
    // 当存在活跃划词高亮或正在聚焦句子时，锁定聚焦段落，禁止鼠标游走触发全局重绘和边框抖动闪烁
    if (activeSentenceBlockId || exactHighlightSpans.length > 0) return;
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
    } else {
      if (hoveredBlockId) {
        onHoverBlock?.(null);
      }
    }
  };

  return (
    <div
      ref={leftPaneRef}
      className={`${styles.leftPane} ${isImmersive ? styles.hiddenPane : ''}`}
      style={{ flexBasis: `calc(${leftPaneWidth}% - 6px)`, flexGrow: 0, flexShrink: 0 }}
    >
      <PdfHeader
        zoomScale={zoomScale}
        pageNumber={pageNumber}
        {...headerProps}
      />

      <div
        className={styles.pdfWrapper}
        ref={pdfWrapperRef}
        onMouseUp={onPdfSelection}
        onMouseMove={handlePdfMouseMove}
        onMouseLeave={() => {
          if (!activeSentenceBlockId && exactHighlightSpans.length === 0) {
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
                const isHovered = activeSentenceBlockId ? activeSentenceBlockId === block.id : hoveredBlockId === block.id;

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
                    onClick={() => onClickBlock?.(block.id)}
                  />
                );
              })}
              {/* 划词精准荧光高亮 */}
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
  );
}
