"use client";

import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import styles from '@/app/page.module.css';
import { PdfHeader, PdfHeaderProps } from './PdfHeader';

import { SourceBlock } from '@/services/layoutAnalysisEngine';
import { findContiguousItemsForSentence } from '@/services/alignmentEngine';
import { ClipItem } from '@/lib/db';

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
  clips?: ClipItem[];
  onClippedSpanClick?: (e: React.MouseEvent, clip: ClipItem) => void;
  pdfTextItems?: any[];
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
  clips = [],
  onClippedSpanClick,
  pdfTextItems = [],
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

  // 计算原文页面中的已剪藏虚线下划线高亮矩形
  const clippedSpans = React.useMemo(() => {
    if (!clips || clips.length === 0 || !pdfTextItems || pdfTextItems.length === 0) return [];
    const validItems = pdfTextItems.filter(item => item.str && item.str.trim() && item.transform);
    if (validItems.length === 0) return [];

    // 原文左侧 PDF 只对英文/原文剪藏卡片绘制下划线，含有中文字符的译文剪藏绝不跨屏误绘
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
          const x = item.transform[4];
          const y = item.transform[5];
          const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
          const w = item.width || item.str.length * fontHeight * 0.55;

          const left = x * scale;
          const top = (origHeight - y - fontHeight * 0.95) * scale;
          const width = w * scale;
          const height = fontHeight * 1.15 * scale;

          result.push({
            clip,
            rect: { left, top, width, height },
            key: `pdf-clip-${clip.id}-${idx}`,
          });
        });
      }
    }
    return result;
  }, [clips, pdfTextItems, pageNumber, pdfOriginalView, scale]);

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
              {/* 原文已剪藏虚线下划线标记 */}
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
                  title={`已剪藏: ${clip.text}（点击唤起微岛）`}
                />
              ))}
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
