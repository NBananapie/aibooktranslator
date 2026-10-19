"use client";

import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '@/app/page.module.css';
import { ClipItem } from '@/lib/db';
import { ScanText, Zap } from 'lucide-react';
import { isValidClippedText } from '@/hooks/useTextSelection';
import { SourceBlock } from '@/services/layoutAnalysisEngine';
import { TargetBlock } from '@/services/alignmentEngine';
import { BlockLayoutMetrics } from '@/hooks/useBilingualSync';
import { MarkdownHeader, MarkdownHeaderProps } from './MarkdownHeader';
import { ClipsDrawer, ClipsDrawerProps } from './ClipsDrawer';

const REMARK_PLUGINS = [remarkGfm];

interface BlockContentRendererProps {
  blockId: string;
  text: string;
  currentPageClips: ClipItem[];
  onClippedSpanClick?: (e: React.MouseEvent, clip: ClipItem) => void;
}

function extractPlainText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join('');
  }
  if (React.isValidElement(node) && (node.props as any)?.children) {
    return extractPlainText((node.props as any).children);
  }
  return '';
}

interface MatchRange {
  start: number;
  end: number;
  clip: ClipItem;
}

function wrapNodesWithRanges(
  nodes: React.ReactNode,
  ranges: MatchRange[],
  tracker: { offset: number },
  onClippedSpanClick?: (e: React.MouseEvent, clip: ClipItem) => void,
  keyPrefix = 'clip-node'
): React.ReactNode {
  if (nodes === null || nodes === undefined) return nodes;

  if (typeof nodes === 'string' || typeof nodes === 'number') {
    const textStr = String(nodes);
    const nodeStart = tracker.offset;
    const nodeEnd = nodeStart + textStr.length;
    tracker.offset = nodeEnd;

    // 寻找与当前文本节点在区间上相交的所有剪藏范围
    const overlapping = ranges.filter(r => r.start < nodeEnd && r.end > nodeStart);
    if (overlapping.length === 0) {
      return textStr;
    }

    const segments: React.ReactNode[] = [];
    let localCursor = 0;

    for (const r of overlapping) {
      const sliceStart = Math.max(0, r.start - nodeStart);
      const sliceEnd = Math.min(textStr.length, r.end - nodeStart);

      if (sliceStart > localCursor) {
        segments.push(textStr.slice(localCursor, sliceStart));
      }

      if (sliceEnd > sliceStart) {
        const clippedSlice = textStr.slice(sliceStart, sliceEnd);
        segments.push(
          <span
            key={`${keyPrefix}-${r.clip.id}-${nodeStart + sliceStart}`}
            data-clip-interactive="true"
            className={styles.clippedTextSpan}
            onClick={e => {
              e.stopPropagation();
              onClippedSpanClick?.(e, r.clip);
            }}
            title={`已剪藏（点击唤起微岛）: ${r.clip.text.slice(0, 36)}...`}
          >
            {clippedSlice}
          </span>
        );
        localCursor = sliceEnd;
      }
    }

    if (localCursor < textStr.length) {
      segments.push(textStr.slice(localCursor));
    }

    return segments;
  }

  if (Array.isArray(nodes)) {
    return nodes.map((child, idx) =>
      wrapNodesWithRanges(child, ranges, tracker, onClippedSpanClick, `${keyPrefix}-${idx}`)
    );
  }

  if (React.isValidElement(nodes)) {
    const elementProps = nodes.props as any;
    if (elementProps?.children) {
      const newChildren = wrapNodesWithRanges(
        elementProps.children,
        ranges,
        tracker,
        onClippedSpanClick,
        `${keyPrefix}-elem`
      );
      return React.cloneElement(nodes, { ...elementProps }, newChildren);
    }
    return nodes;
  }

  return nodes;
}

const BlockContentRenderer = React.memo(
  function BlockContentRenderer({
    blockId,
    text,
    currentPageClips,
    onClippedSpanClick,
  }: BlockContentRendererProps) {
    const highlightBlockChildren = useCallback(
      (children: React.ReactNode) => {
        if (!currentPageClips || currentPageClips.length === 0) return children;

        const fullText = extractPlainText(children);
        if (!fullText || !fullText.trim()) return children;

        const ranges: MatchRange[] = [];
        const fullTrimmed = fullText.trim();

        for (const clip of currentPageClips) {
          if (!clip.text) continue;
          const clipRaw = clip.text;
          const clipTrimmed = clipRaw.trim();
          if (!clipTrimmed) continue;

          // 1. 直接匹配子串
          let idx = fullText.indexOf(clipRaw);
          let matchLen = clipRaw.length;
          if (idx === -1) {
            idx = fullText.indexOf(clipTrimmed);
            matchLen = clipTrimmed.length;
          }

          // 2. 整段剪藏或大段选区覆盖（解决整段剪藏或含加粗跨节点匹配失灵）
          if (idx === -1 && fullTrimmed) {
            if (clipTrimmed === fullTrimmed || clipTrimmed.includes(fullTrimmed)) {
              const startInFull = fullText.indexOf(fullTrimmed);
              if (startInFull !== -1) {
                idx = startInFull;
                matchLen = fullTrimmed.length;
              }
            }
          }

          // 3. 空白与换行折叠容错匹配
          if (idx === -1 && fullTrimmed) {
            const normFull = fullText.replace(/\s+/g, ' ');
            const normClip = clipTrimmed.replace(/\s+/g, ' ');
            const normIdx = normFull.indexOf(normClip);
            if (normIdx !== -1) {
              let oStart = 0;
              let nCount = 0;
              while (oStart < fullText.length && nCount < normIdx) {
                if (/\s/.test(fullText[oStart])) {
                  while (oStart + 1 < fullText.length && /\s/.test(fullText[oStart + 1])) oStart++;
                }
                nCount++;
                oStart++;
              }
              let oEnd = oStart;
              let nLen = 0;
              while (oEnd < fullText.length && nLen < normClip.length) {
                if (/\s/.test(fullText[oEnd])) {
                  while (oEnd + 1 < fullText.length && /\s/.test(fullText[oEnd + 1])) oEnd++;
                }
                nLen++;
                oEnd++;
              }
              ranges.push({ start: oStart, end: oEnd, clip });
              continue;
            }
          }

          if (idx !== -1) {
            ranges.push({
              start: idx,
              end: idx + matchLen,
              clip,
            });
          }
        }

        if (ranges.length === 0) return children;

        // 按起始位置升序排序
        ranges.sort((a, b) => a.start - b.start);

        const tracker = { offset: 0 };
        return wrapNodesWithRanges(children, ranges, tracker, onClippedSpanClick);
      },
      [currentPageClips, onClippedSpanClick]
    );

    const customComponents = useMemo(
      () => ({
        p: ({ node, children, ...props }: any) => (
          <p {...props}>{highlightBlockChildren(children)}</p>
        ),
        h1: ({ node, children, ...props }: any) => (
          <h1 {...props}>{highlightBlockChildren(children)}</h1>
        ),
        h2: ({ node, children, ...props }: any) => (
          <h2 {...props}>{highlightBlockChildren(children)}</h2>
        ),
        h3: ({ node, children, ...props }: any) => (
          <h3 {...props}>{highlightBlockChildren(children)}</h3>
        ),
        h4: ({ node, children, ...props }: any) => (
          <h4 {...props}>{highlightBlockChildren(children)}</h4>
        ),
        li: ({ node, children, ...props }: any) => (
          <li {...props}>{highlightBlockChildren(children)}</li>
        ),
        blockquote: ({ node, children, ...props }: any) => (
          <blockquote {...props}>{highlightBlockChildren(children)}</blockquote>
        ),
      }),
      [highlightBlockChildren]
    );

    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={customComponents}>
        {text || '翻译中...'}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.text !== nextProps.text) return false;
    if (prevProps.currentPageClips.length !== nextProps.currentPageClips.length) return false;
    return prevProps.currentPageClips.every((c, i) => c.id === nextProps.currentPageClips[i]?.id);
  }
);

export interface MarkdownPaneProps extends MarkdownHeaderProps, ClipsDrawerProps {
  leftPaneWidth: number;
  displayedText: string;
  fullTextThinking: boolean;
  error: string;
  ocrText?: string;
  pageNumber: number;
  activeSentenceZh: string;
  activeSentenceBlockId?: string | null;
  onExecuteTranslateText: (text: string, page: number) => void;
  onMarkdownSelection: () => void;
  onClippedSpanClick: (e: React.MouseEvent, clip: ClipItem) => void;
  sourceBlocks?: SourceBlock[];
  targetBlocks?: TargetBlock[];
  hoveredBlockId?: string | null;
  onHoverBlock?: (id: string | null) => void;
  onClickBlock?: (id: string) => void;
  blockLayoutMetrics?: Record<string, BlockLayoutMetrics>;
  markdownContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function MarkdownPane({
  leftPaneWidth,
  isImmersive,
  viewMode,
  isTranslating,
  isOcrLoading,
  displayedText,
  fullTextThinking,
  error,
  ocrText,
  pageNumber,
  activeSentenceZh,
  activeSentenceBlockId,
  fullWidthReading,
  clips,
  onExecuteTranslateText,
  onMarkdownSelection,
  onClippedSpanClick,
  isOpen,
  toggleBtnRef,
  onToggle,
  onClose,
  onCopyAll,
  onExportMarkdown,
  onJumpToPage,
  onCopyClip,
  onDeleteClip,
  sourceBlocks = [],
  targetBlocks = [],
  hoveredBlockId = null,
  onHoverBlock,
  onClickBlock,
  blockLayoutMetrics = {},
  markdownContainerRef,
  fontSize = 16,
  setFontSize,
  ...headerProps
}: MarkdownPaneProps) {
  const internalMarkdownContainerRef = useRef<HTMLDivElement>(null);
  const containerRefToUse = markdownContainerRef || internalMarkdownContainerRef;
  const currentPageClips = useMemo(
    () => clips.filter(c => c.pageNumber === pageNumber && isValidClippedText(c.text)),
    [clips, pageNumber]
  );

  return (
    <div
      className={styles.rightPane}
      style={{
        flexBasis: isImmersive ? '100%' : `calc(${100 - leftPaneWidth}% - 6px)`,
        flexGrow: isImmersive ? 1 : 0,
        flexShrink: 0,
      }}
    >
      <MarkdownHeader
        fontSize={fontSize}
        setFontSize={setFontSize}
        isImmersive={isImmersive}
        viewMode={viewMode}
        isTranslating={isTranslating}
        isOcrLoading={isOcrLoading}
        fullWidthReading={fullWidthReading}
        {...headerProps}
      />

      <div className={styles.rightPaneBody}>
        <div
          className={`${styles.markdownWrapper} ${styles.pageFadeIn}`}
          ref={containerRefToUse}
          onMouseUp={onMarkdownSelection}
          onKeyUp={onMarkdownSelection}
          style={{ '--reader-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          {isTranslating && !displayedText && targetBlocks.length === 0 ? (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
              <p>{fullTextThinking ? 'AI 正在深度思考中...' : '正在连接 AI 引擎流式输出...'}</p>
            </div>
          ) : isOcrLoading ? (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
              <p>百度飞桨 PaddleOCR 正在解析页面版面、表格与文字...</p>
            </div>
          ) : error ? (
            <div
              style={{
                color: 'var(--accent-rose)',
                padding: '16px',
                background: 'rgba(244, 63, 94, 0.1)',
                borderRadius: '8px',
                border: '1px solid var(--accent-rose)',
                fontSize: '14px',
              }}
            >
              {error}
            </div>
          ) : viewMode === 'ocr_source' && ocrText ? (
            <div
              className={styles.ocrContent}
              style={{
                maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none',
                margin: isImmersive ? '0 auto' : '0',
                fontSize: `${fontSize}px`,
                lineHeight: isImmersive ? '2.0' : '1.85',
                transition: 'font-size 0.2s ease, max-width 0.25s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  marginBottom: '14px',
                  borderBottom: '1px solid var(--glass-border)',
                  paddingBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: '13.5px',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <ScanText size={15} /> 百度飞桨 PaddleOCR-VL 结构化识别
                  </span>
                  <button
                    className={styles.btn}
                    style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                    onClick={() => onExecuteTranslateText(ocrText, pageNumber)}
                  >
                    <Zap size={13} /> 将此 OCR 内容翻译为中文
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: 'var(--muted)' }}>
                  <span className={styles.badge}>多模态版面解析</span>
                  <span className={styles.badgeSubtle}>复杂表格/公式/分栏识别</span>
                  <span className={styles.badgeSubtle}>高保真 Markdown 排版还原</span>
                </div>
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{ocrText}</ReactMarkdown>
            </div>
          ) : (
            <div
              style={{
                maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none',
                margin: isImmersive ? '0 auto' : '0',
                fontSize: `${fontSize}px`,
                lineHeight: isImmersive ? '2.0' : '1.85',
                transition: 'font-size 0.2s ease, max-width 0.25s ease',
              }}
            >
              <BlockContentRenderer
                blockId="full-page"
                text={displayedText ? displayedText : '待翻译或翻页中...'}
                currentPageClips={currentPageClips}
                onClippedSpanClick={onClippedSpanClick}
              />
              {isTranslating && <span className={styles.cursorPulse}> ▍</span>}
            </div>
          )}
        </div>

        <ClipsDrawer
          clips={clips}
          isOpen={isOpen}
          toggleBtnRef={toggleBtnRef}
          onToggle={onToggle}
          onClose={onClose}
          onCopyAll={onCopyAll}
          onExportMarkdown={onExportMarkdown}
          onJumpToPage={onJumpToPage}
          onCopyClip={onCopyClip}
          onDeleteClip={onDeleteClip}
        />
      </div>
    </div>
  );
}
