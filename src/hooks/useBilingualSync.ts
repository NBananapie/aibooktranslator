import { useState, useEffect, useCallback, useMemo } from 'react';
import { pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { findContiguousItemsForSentence, HighlightRect, textItemToRect } from '@/services/alignmentEngine';
import { analyzePageLayout, SourceBlock } from '@/services/layoutAnalysisEngine';

export type ExactHighlightSpan = HighlightRect;

export interface UseBilingualSyncOptions {
  file: File | null;
  pdfDocument?: PDFDocumentProxy | null;
  pageNumber: number;
  pdfRenderWidth: number;
  zoomScale: number;
  pdfWrapperRef: React.RefObject<HTMLDivElement | null>;
}

interface PageLayout {
  page: number;
  textItems: TextItem[];
  view: number[];
  blocks: SourceBlock[];
}

interface PageScoped<T> {
  page: number;
  value: T;
}

const DEFAULT_VIEW = [0, 0, 600, 800];
const NO_ITEMS: TextItem[] = [];
const NO_BLOCKS: SourceBlock[] = [];

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item;
}

/**
 * 当前页的原文版面数据（文本块、段落块、页面尺寸）、段落悬停与原文高亮。
 * 悬停与高亮状态绑定页码，翻页后自动失效。
 */
export function useBilingualSync(options: UseBilingualSyncOptions) {
  const { file, pdfDocument, pageNumber, pdfRenderWidth, zoomScale, pdfWrapperRef } = options;

  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [hovered, setHovered] = useState<PageScoped<string | null> | null>(null);
  const [highlight, setHighlight] = useState<PageScoped<string> | null>(null);

  // 读取当前页文本内容并做版面分析
  useEffect(() => {
    if ((!pdfDocument && !file) || pageNumber < 1) return;
    let isCancelled = false;

    (async () => {
      try {
        const doc = pdfDocument ?? (file ? await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise : null);
        if (!doc) return;
        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        if (isCancelled) return;
        const textItems = textContent.items.filter(isTextItem);
        const view = page.view || DEFAULT_VIEW;
        setLayout({ page: pageNumber, textItems, view, blocks: analyzePageLayout(textItems, view, pageNumber) });
      } catch (e) {
        console.error('读取页面文本失败', e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [pdfDocument, file, pageNumber]);

  const current = layout?.page === pageNumber ? layout : null;
  const pdfTextItems = current?.textItems ?? NO_ITEMS;
  const pdfOriginalView = current?.view ?? DEFAULT_VIEW;
  const sourceBlocks = current?.blocks ?? NO_BLOCKS;

  const setHoveredBlockId = useCallback(
    (id: string | null) => setHovered({ page: pageNumber, value: id }),
    [pageNumber]
  );

  const clearHighlights = useCallback(() => {
    setHighlight(null);
    setHovered(null);
  }, []);

  /**
   * 在原文中高亮与给定英文文本连续匹配的位置。page 可指定目标页（如从剪藏跳转），
   * 该页文本加载完成后再计算位置。
   */
  const highlightTextInPdf = useCallback(
    (text: string, page: number = pageNumber) => {
      const query = text.trim();
      setHighlight(query ? { page, value: query } : null);
    },
    [pageNumber]
  );

  const scale = (pdfRenderWidth * zoomScale) / (pdfOriginalView[2] || 600);
  const pageHeight = pdfOriginalView[3] || 800;
  const highlightQuery = highlight?.page === pageNumber ? highlight.value : '';

  const exactHighlightSpans = useMemo<HighlightRect[]>(() => {
    if (!highlightQuery || pdfTextItems.length === 0) return [];
    const validItems = pdfTextItems.filter(item => item.str && item.str.trim() && item.transform);
    return findContiguousItemsForSentence(highlightQuery, validItems).map(item => textItemToRect(item, pageHeight, scale));
  }, [highlightQuery, pdfTextItems, pageHeight, scale]);

  // 高亮出现时滚动到第一处
  const firstHighlightTop = exactHighlightSpans[0]?.top;
  useEffect(() => {
    if (firstHighlightTop === undefined) return;
    pdfWrapperRef.current?.scrollTo({ top: Math.max(0, firstHighlightTop - 100), behavior: 'smooth' });
  }, [firstHighlightTop, pdfWrapperRef]);

  return {
    pdfTextItems,
    pdfOriginalView,
    sourceBlocks,
    hoveredBlockId: hovered?.page === pageNumber ? hovered.value : null,
    setHoveredBlockId,
    exactHighlightSpans,
    clearHighlights,
    highlightTextInPdf,
  };
}
