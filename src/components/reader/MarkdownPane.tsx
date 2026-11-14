"use client";

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '@/app/page.module.css';
import { ClipItem } from '@/lib/db';
import { ReaderFontFamily } from '@/context/AppContext';
import { ScanText, Sparkles, RefreshCw, Settings, AlertCircle } from 'lucide-react';
import { isValidClippedText } from '@/hooks/useTextSelection';

const REMARK_PLUGINS = [remarkGfm];

type MdProps<T extends keyof React.JSX.IntrinsicElements> = React.ComponentPropsWithoutRef<T> & { node?: unknown };
type HighlightTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'li' | 'blockquote';

interface BlockContentRendererProps {
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
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.props.children) {
    return extractPlainText(node.props.children);
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
            title={`已存书摘（点击操作）: ${r.clip.text.slice(0, 36)}`}
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

  if (React.isValidElement<{ children?: React.ReactNode }>(nodes)) {
    const elementProps = nodes.props;
    if (elementProps.children) {
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

          let idx = fullText.indexOf(clipRaw);
          let matchLen = clipRaw.length;
          if (idx === -1) {
            idx = fullText.indexOf(clipTrimmed);
            matchLen = clipTrimmed.length;
          }

          if (idx === -1 && fullTrimmed) {
            if (clipTrimmed === fullTrimmed || clipTrimmed.includes(fullTrimmed)) {
              const startInFull = fullText.indexOf(fullTrimmed);
              if (startInFull !== -1) {
                idx = startInFull;
                matchLen = fullTrimmed.length;
              }
            }
          }

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
        ranges.sort((a, b) => a.start - b.start);

        const tracker = { offset: 0 };
        return wrapNodesWithRanges(children, ranges, tracker, onClippedSpanClick);
      },
      [currentPageClips, onClippedSpanClick]
    );

    const customComponents = useMemo(() => {
      const withClipHighlight = <T extends HighlightTag>(Tag: T) => {
        function Highlighted(props: MdProps<T>) {
          const rest: Record<string, unknown> = { ...props };
          delete rest.node;
          delete rest.children;
          return React.createElement(Tag, rest, highlightBlockChildren(props.children));
        }
        return Highlighted;
      };
      return {
        p: withClipHighlight('p'),
        h1: withClipHighlight('h1'),
        h2: withClipHighlight('h2'),
        h3: withClipHighlight('h3'),
        h4: withClipHighlight('h4'),
        li: withClipHighlight('li'),
        blockquote: withClipHighlight('blockquote'),
      };
    }, [highlightBlockChildren]);

    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={customComponents}>
        {text}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.text !== nextProps.text) return false;
    if (prevProps.currentPageClips.length !== nextProps.currentPageClips.length) return false;
    return prevProps.currentPageClips.every((c, i) => c.id === nextProps.currentPageClips[i]?.id);
  }
);

export interface MarkdownPaneProps {
  leftPaneWidth: number;
  isImmersive: boolean;
  viewMode: 'translation' | 'ocr_source';
  isTranslating: boolean;
  isOcrLoading: boolean;
  isNoTextPage: boolean;
  displayedText: string;
  fullTextThinking: boolean;
  error: string;
  ocrText?: string;
  pageNumber: number;
  fontSize: number;
  readerFont: ReaderFontFamily;
  fullWidthReading: boolean;
  autoTranslate: boolean;
  clips: ClipItem[];
  onTranslateCurrentPage: () => void;
  onEnableAutoTranslateAndRun: () => void;
  onRunOcrAndTranslate: () => void;
  onRunOcrOnly: () => void;
  onExecuteTranslateText: (text: string, page: number) => void;
  onOpenSettings: (tab?: 'llm' | 'ocr' | 'sync') => void;
  onMarkdownSelection: () => void;
  onClippedSpanClick: (e: React.MouseEvent, clip: ClipItem) => void;
}

export function MarkdownPane({
  leftPaneWidth,
  isImmersive,
  viewMode,
  isTranslating,
  isOcrLoading,
  isNoTextPage,
  displayedText,
  fullTextThinking,
  error,
  ocrText,
  pageNumber,
  fontSize,
  readerFont,
  fullWidthReading,
  autoTranslate,
  clips,
  onTranslateCurrentPage,
  onEnableAutoTranslateAndRun,
  onRunOcrAndTranslate,
  onRunOcrOnly,
  onExecuteTranslateText,
  onOpenSettings,
  onMarkdownSelection,
  onClippedSpanClick,
}: MarkdownPaneProps) {
  const currentPageClips = useMemo(
    () => clips.filter(c => c.pageNumber === pageNumber && isValidClippedText(c.text)),
    [clips, pageNumber]
  );

  const articleClasses = [
    styles.markdownArticle,
    readerFont === 'serif' ? styles.markdownSerif : styles.markdownSans,
    isImmersive ? styles.markdownImmersive : '',
    fullWidthReading ? styles.markdownFullWidth : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={styles.rightPane}
      style={{
        flexBasis: isImmersive ? '100%' : `calc(${100 - leftPaneWidth}% - 2px)`,
        flexGrow: 1,
        flexShrink: 1,
      }}
    >
      <div
        className={`${styles.markdownScroll} ${styles.pageFadeIn}`}
        onMouseUp={onMarkdownSelection}
        onKeyUp={onMarkdownSelection}
        style={{ '--reader-font-size': `${fontSize}px` } as React.CSSProperties}
      >
        {isTranslating && !displayedText ? (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>{fullTextThinking ? '正在研读原文语境并推敲译文...' : '正在流式生成出版级中文译文...'}</p>
          </div>
        ) : isOcrLoading ? (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>正在通过 PaddleOCR 解析扫描版面、公式与表格...</p>
          </div>
        ) : error ? (
          <div className={styles.errorCard}>
            <div className={styles.errorCardHeader}>
              <AlertCircle size={16} />
              <span>第 {pageNumber} 页处理遇到问题</span>
            </div>
            <p className={styles.errorCardMsg}>{error}</p>
            <div className={styles.stateCardActions}>
              <button type="button" className={styles.btn} onClick={onTranslateCurrentPage}>
                <RefreshCw size={13} />
                <span>重试本页</span>
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => onOpenSettings('llm')}
              >
                <Settings size={13} />
                <span>检查引擎与 API Key</span>
              </button>
            </div>
          </div>
        ) : viewMode === 'ocr_source' && ocrText ? (
          <article className={articleClasses} style={{ fontSize: `${fontSize}px` }}>
            <div className={styles.ocrBannerBar}>
              <div className={styles.ocrBannerTitle}>
                <ScanText size={15} />
                <span>PaddleOCR 结构化原文 · 第 {pageNumber} 页</span>
              </div>
              <button
                type="button"
                className={styles.btn}
                onClick={() => onExecuteTranslateText(ocrText, pageNumber)}
              >
                <Sparkles size={13} />
                <span>将此 OCR 原文翻译为中文</span>
              </button>
            </div>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{ocrText}</ReactMarkdown>
          </article>
        ) : isNoTextPage && !displayedText ? (
          /* 扫描页 / 图片页内联操作卡 */
          <div className={styles.stateCard}>
            <div className={styles.stateCardIcon}>
              <ScanText size={20} />
            </div>
            <h3 className={styles.stateCardTitle}>第 {pageNumber} 页未检测到内嵌文字层</h3>
            <p className={styles.stateCardDesc}>
              此页可能为扫描书页、插图或纯排版扉页。您可使用多模态 OCR 提取结构化版面并直接翻译为中文。
            </p>
            <div className={styles.stateCardActions}>
              <button type="button" className={styles.btn} onClick={onRunOcrAndTranslate}>
                <ScanText size={14} />
                <span>OCR 识别并翻译为中文</span>
              </button>
              <button type="button" className={styles.btnSecondary} onClick={onRunOcrOnly}>
                <span>仅提取原文 Markdown</span>
              </button>
            </div>
            <button
              type="button"
              className={styles.stateCardSubtleLink}
              onClick={() => onOpenSettings('ocr')}
            >
              配置百度飞桨 OCR Token →
            </button>
          </div>
        ) : !displayedText ? (
          /* 手动模式或尚未翻译页内联操作卡 */
          <div className={styles.stateCard}>
            <div className={styles.stateCardIcon}>
              <Sparkles size={20} />
            </div>
            <h3 className={styles.stateCardTitle}>第 {pageNumber} 页尚未生成译文</h3>
            <p className={styles.stateCardDesc}>
              {autoTranslate
                ? '点击下方按钮立即请求本页精译。'
                : '当前处于手动翻译模式，您可按需翻译本页，或开启翻页自动连译。'}
            </p>
            <div className={styles.stateCardActions}>
              <button type="button" className={styles.btn} onClick={onTranslateCurrentPage}>
                <Sparkles size={14} />
                <span>立即翻译本页</span>
              </button>
              {!autoTranslate && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={onEnableAutoTranslateAndRun}
                >
                  <span>开启翻页自动连译</span>
                </button>
              )}
            </div>
            <button
              type="button"
              className={styles.stateCardSubtleLink}
              onClick={onRunOcrAndTranslate}
            >
              若原文乱码或为扫描版，改用 OCR 识别并翻译 →
            </button>
          </div>
        ) : (
          <article className={articleClasses} style={{ fontSize: `${fontSize}px` }}>
            <BlockContentRenderer
              text={displayedText}
              currentPageClips={currentPageClips}
              onClippedSpanClick={onClippedSpanClick}
            />
            {isTranslating && <span className={styles.cursorPulse}> ▍</span>}
          </article>
        )}
      </div>
    </div>
  );
}
