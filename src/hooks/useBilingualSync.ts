import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { pdfjs } from 'react-pdf';
import {
  findContiguousItemsForSentence,
  extractSpecificEnForQuery,
  findMatchingZhSentenceForEnQuery,
  findMatchingEnSentenceForZhQuery,
  BilingualMapEntry,
  TargetBlock,
} from '@/services/alignmentEngine';
import { analyzePageLayout, SourceBlock } from '@/services/layoutAnalysisEngine';

export interface ExactHighlightSpan {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BlockLayoutMetrics {
  id: string;
  topPx: number;
  heightPx: number;
  marginTopPx: number;
}

export interface UseBilingualSyncOptions {
  file: File | null;
  pdfDocument?: any;
  pageNumber: number;
  displayedText?: string;
  pdfRenderWidth: number;
  zoomScale: number;
  pdfWrapperRef: React.RefObject<HTMLDivElement | null>;
  markdownContainerRef?: React.RefObject<HTMLDivElement | null>;
  targetBlocks?: TargetBlock[];
}

export function useBilingualSync(options: UseBilingualSyncOptions) {
  const {
    file,
    pdfDocument,
    pageNumber,
    displayedText = '',
    pdfRenderWidth,
    zoomScale,
    pdfWrapperRef,
    markdownContainerRef,
    targetBlocks = [],
  } = options;

  // PDF Text Items 缓存与原始页面尺寸
  const [pdfTextItems, setPdfTextItems] = useState<any[]>([]);
  const [pdfOriginalView, setPdfOriginalView] = useState<number[]>([0, 0, 600, 800]);

  // 段落版面分析结果
  const [sourceBlocks, setSourceBlocks] = useState<SourceBlock[]>([]);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // 双语对齐映射缓存 (BILINGUAL_MAP)
  const [bilingualMapCache, setBilingualMapCache] = useState<
    Record<number, BilingualMapEntry[]>
  >({});

  // 精准行内划词高亮条状态
  const [exactHighlightSpans, setExactHighlightSpans] = useState<ExactHighlightSpan[]>([]);
  const [activeHighlightZh, setActiveHighlightZh] = useState<string>('');
  const [activeSentenceZh, setActiveSentenceZh] = useState<string>('');
  const [activeSentenceBlockId, setActiveSentenceBlockId] = useState<string | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. 提取当前页的 PDF TextItems 与原始尺寸并生成结构化段落块
  useEffect(() => {
    if ((!pdfDocument && !file) || pageNumber < 1) return;
    let isCancelled = false;

    (async () => {
      try {
        let doc = pdfDocument;
        if (!doc && file) {
          const arrayBuffer = await file.arrayBuffer();
          doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        }
        if (!doc) return;

        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        if (!isCancelled) {
          const items = textContent.items || [];
          const view = page.view || [0, 0, 600, 800];
          setPdfTextItems(items);
          setPdfOriginalView(view);
          const blocks = analyzePageLayout(items, view, pageNumber);
          setSourceBlocks(blocks);
        }
      } catch (e) {
        console.error('Error fetching page text content for exact highlights', e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [pdfDocument, file, pageNumber]);

  // 2. 计算各段落块的绝对像素度量，用于右侧样式镜像与对齐
  const blockLayoutMetrics = useMemo(() => {
    const metrics: Record<string, BlockLayoutMetrics> = {};
    if (sourceBlocks.length === 0) return metrics;

    const origWidth = pdfOriginalView[2] || 600;
    const currentRenderW = pdfRenderWidth * zoomScale;
    const scale = origWidth > 0 ? currentRenderW / origWidth : 1;

    let prevBottomPx = 0;
    for (let i = 0; i < sourceBlocks.length; i++) {
      const b = sourceBlocks[i];
      const topPx = Math.round(b.box.y * scale);
      const heightPx = Math.max(28, Math.round(b.box.height * scale));
      const rawMarginTop = i === 0 ? topPx : topPx - prevBottomPx;
      const marginTopPx = Math.max(6, rawMarginTop);

      metrics[b.id] = {
        id: b.id,
        topPx,
        heightPx,
        marginTopPx,
      };
      prevBottomPx = topPx + heightPx;
    }
    return metrics;
  }, [sourceBlocks, pdfOriginalView, pdfRenderWidth, zoomScale]);

  // 3. 页面切换时，重置当页高亮与悬浮状态
  useEffect(() => {
    setExactHighlightSpans([]);
    setActiveHighlightZh('');
    setActiveSentenceZh('');
    setActiveSentenceBlockId(null);
    setHoveredBlockId(null);
  }, [pageNumber]);

  // 4. 清空高亮
  const clearHighlights = useCallback(() => {
    setExactHighlightSpans([]);
    setActiveHighlightZh('');
    setActiveSentenceZh('');
    setActiveSentenceBlockId(null);
    setHoveredBlockId(null);
  }, []);

  // 5. 双向滚动同步（防互锁抖动）
  const isSyncScrollingRef = useRef<boolean>(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const syncScrollToBlock = useCallback(
    (blockId: string, source: 'pdf' | 'markdown') => {
      if (isSyncScrollingRef.current) return;
      isSyncScrollingRef.current = true;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        isSyncScrollingRef.current = false;
      }, 400);

      const targetEl =
        source === 'pdf'
          ? document.getElementById(`target-${blockId}`)
          : document.querySelector(`[class*="pdfBlockOverlay"][data-block-id="${blockId}"]`);

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    []
  );

  // 6. 从译文划词 -> 触发左侧 PDF 精准荧光高亮 (句级对齐，不破坏右侧原生选区)
  const triggerHighlightFromZh = useCallback(
    (
      queryZh: string,
      contextParagraph?: string,
      blockId?: string,
      overrideTargetBlocks?: TargetBlock[]
    ) => {
      const cleanZh = queryZh.trim();
      if (!cleanZh) return;

      const activeBlocks = overrideTargetBlocks || targetBlocks;
      const currentMap = bilingualMapCache[pageNumber] || [];
      const { matchedEnSentence, matchedZhSentence, matchedBlockId } =
        findMatchingEnSentenceForZhQuery({
          zhQuery: cleanZh,
          sourceBlocks,
          targetBlocks: activeBlocks,
          bilingualMap: currentMap,
          hintBlockId: blockId,
          contextParagraph,
        });

      if (matchedBlockId || blockId) {
        setHoveredBlockId(matchedBlockId || blockId || null);
        setActiveSentenceBlockId(matchedBlockId || blockId || null);
      }

      if (!pdfWrapperRef.current || pdfTextItems.length === 0) return;

      const origWidth = pdfOriginalView[2] || 600;
      const origHeight = pdfOriginalView[3] || 800;
      const currentRenderW = pdfRenderWidth * zoomScale;
      const scale = currentRenderW / origWidth;

      const validItems = pdfTextItems.filter(
        item => item.str && item.str.trim() && item.transform
      );
      if (validItems.length === 0) return;

      let matchedItems: any[] = [];
      if (matchedEnSentence) {
        matchedItems = findContiguousItemsForSentence(matchedEnSentence, validItems);
      }
      if (matchedItems.length === 0 && /[a-zA-Z0-9]{2,}/.test(cleanZh)) {
        matchedItems = findContiguousItemsForSentence(cleanZh, validItems);
      }

      if (matchedItems.length > 0) {
        const spans = matchedItems.map(item => {
          const x = item.transform[4];
          const y = item.transform[5];
          const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
          const w = item.width || item.str.length * fontHeight * 0.55;

          const left = x * scale;
          const top = (origHeight - y - fontHeight * 0.95) * scale;
          const width = w * scale;
          const height = fontHeight * 1.15 * scale;

          return { left, top, width, height };
        });

        setExactHighlightSpans(spans);

        if (spans.length > 0 && pdfWrapperRef.current) {
          pdfWrapperRef.current.scrollTo({
            top: Math.max(0, spans[0].top - 100),
            behavior: 'smooth',
          });
        }
      }
    },
    [bilingualMapCache, pageNumber, sourceBlocks, targetBlocks, pdfTextItems, pdfOriginalView, pdfRenderWidth, zoomScale, pdfWrapperRef]
  );

  // 7. 从原文 PDF 划词 -> 触发右侧译文对应中文句高亮 & 左侧整句高亮包裹
  const triggerHighlightFromEn = useCallback(
    (queryEn: string, hintBlockId?: string, overrideTargetBlocks?: TargetBlock[]) => {
      const cleanEn = queryEn.trim();
      if (!cleanEn) return;

      const activeBlocks = overrideTargetBlocks || targetBlocks;
      const currentMap = bilingualMapCache[pageNumber] || [];
      const { matchedZhSentence, matchedEnSentence, matchedBlockId } =
        findMatchingZhSentenceForEnQuery({
          enQuery: cleanEn,
          sourceBlocks,
          targetBlocks: activeBlocks,
          bilingualMap: currentMap,
          hintBlockId,
        });

      if (matchedZhSentence) {
        setActiveSentenceZh(matchedZhSentence);
        setActiveSentenceBlockId(matchedBlockId || hintBlockId || null);
        setHoveredBlockId(matchedBlockId || hintBlockId || null);
      }

      // 如果有对应的 blockId，通知平滑滚动右侧对应卡片
      if (matchedBlockId) {
        const targetEl = document.getElementById(`target-${matchedBlockId}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // 左侧 PDF 同步荧光高亮对应的整句
      if (pdfWrapperRef.current && pdfTextItems.length > 0) {
        const origWidth = pdfOriginalView[2] || 600;
        const origHeight = pdfOriginalView[3] || 800;
        const currentRenderW = pdfRenderWidth * zoomScale;
        const scale = currentRenderW / origWidth;

        const validItems = pdfTextItems.filter(
          item => item.str && item.str.trim() && item.transform
        );
        const sentenceToHighlight = matchedEnSentence || cleanEn;
        const matchedItems = findContiguousItemsForSentence(sentenceToHighlight, validItems);

        if (matchedItems.length > 0) {
          const spans = matchedItems.map(item => {
            const x = item.transform[4];
            const y = item.transform[5];
            const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
            const w = item.width || item.str.length * fontHeight * 0.55;

            return {
              left: x * scale,
              top: (origHeight - y - fontHeight * 0.95) * scale,
              width: w * scale,
              height: fontHeight * 1.15 * scale,
            };
          });
          setExactHighlightSpans(spans);
        }
      }
    },
    [bilingualMapCache, pageNumber, sourceBlocks, targetBlocks, pdfTextItems, pdfOriginalView, pdfRenderWidth, zoomScale, pdfWrapperRef]
  );

  return {
    pdfTextItems,
    pdfOriginalView,
    sourceBlocks,
    hoveredBlockId,
    setHoveredBlockId,
    blockLayoutMetrics,
    syncScrollToBlock,
    bilingualMapCache,
    setBilingualMapCache,
    exactHighlightSpans,
    setExactHighlightSpans,
    activeHighlightZh,
    activeSentenceZh,
    setActiveSentenceZh,
    activeSentenceBlockId,
    setActiveSentenceBlockId,
    clearHighlights,
    triggerHighlightFromZh,
    triggerHighlightFromEn,
    triggerExactHighlightForSelection: triggerHighlightFromZh,
  };
}
