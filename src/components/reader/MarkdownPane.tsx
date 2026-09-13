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

const BlockContentRenderer = React.memo(
  function BlockContentRenderer({
    blockId,
    text,
    currentPageClips,
    onClippedSpanClick,
  }: BlockContentRendererProps) {
    const relevantClips = useMemo(() => {
      if (!currentPageClips || currentPageClips.length === 0) return [];
      return currentPageClips.filter(c => c.text && text.includes(c.text));
    }, [currentPageClips, text]);

    const formatBlockSegments = useCallback(
      (rawText: string) => {
        let segs: React.ReactNode[] = [rawText];

        // 剪藏下划线与交互（点击已剪藏文字唤起微岛）
        if (relevantClips.length > 0) {
          for (const clip of relevantClips) {
            if (!clip.text) continue;
            const clipText = clip.text;
            const next: React.ReactNode[] = [];
            for (const s of segs) {
              if (typeof s === 'string' && s.includes(clipText)) {
                const parts = s.split(clipText);
                for (let i = 0; i < parts.length; i++) {
                  if (i > 0) {
                    next.push(
                      <span
                        key={`clip-${clip.id}-${i}`}
                        className={styles.clippedTextSpan}
                        onClick={e => {
                          e.stopPropagation();
                          onClippedSpanClick?.(e, clip);
                        }}
                        title="已剪藏（点击唤起微岛）"
                      >
                        {clipText}
                      </span>
                    );
                  }
                  if (parts[i]) next.push(parts[i]);
                }
              } else {
                next.push(s);
              }
            }
            segs = next;
          }
        }

        return segs;
      },
      [blockId, relevantClips, onClippedSpanClick]
    );

    const customComponents = useMemo(
      () => ({
        p: ({ node, children, ...props }: any) => (
          <p {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </p>
        ),
        h1: ({ node, children, ...props }: any) => (
          <h1 {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </h1>
        ),
        h2: ({ node, children, ...props }: any) => (
          <h2 {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </h2>
        ),
        h3: ({ node, children, ...props }: any) => (
          <h3 {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </h3>
        ),
        li: ({ node, children, ...props }: any) => (
          <li {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </li>
        ),
        strong: ({ node, children, ...props }: any) => (
          <strong {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </strong>
        ),
        em: ({ node, children, ...props }: any) => (
          <em {...props}>
            {React.Children.map(children, child =>
              typeof child === 'string' ? formatBlockSegments(child) : child
            )}
          </em>
        ),
      }),
      [formatBlockSegments]
    );

    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={customComponents}>
        {text || '翻译中...'}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.text === nextProps.text && prevProps.currentPageClips === nextProps.currentPageClips;
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
            <div className={styles.ocrContent}>
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
          ) : targetBlocks.length > 0 ? (
            <div
              style={{
                maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none',
                margin: isImmersive ? '0 auto' : '0',
                fontSize: isImmersive ? '17px' : '15.5px',
                lineHeight: isImmersive ? '2.0' : '1.85',
                transition: 'all 0.25s ease',
              }}
            >
              {/* 沉浸式段落卡片流（1:1 语义锚定与行高镜像） */}
              {targetBlocks.map(tb => {
                const metric = blockLayoutMetrics[tb.id];
                const isSelected = activeSentenceBlockId === tb.id;
                const isHovered = isSelected || (!activeSentenceBlockId && hoveredBlockId === tb.id);
                const sourceBlock = sourceBlocks.find(sb => sb.id === tb.id);

                return (
                  <div
                    key={tb.id}
                    id={`target-${tb.id}`}
                    className={`${styles.bilingualBlockCard} ${isHovered ? styles.bilingualBlockActive : ''}`}
                    style={{
                      minHeight: metric ? `${metric.heightPx}px` : undefined,
                      marginTop: metric ? `${metric.marginTopPx}px` : '14px',
                    }}
                    onMouseEnter={() => {
                      if (!activeSentenceBlockId) {
                        onHoverBlock?.(tb.id);
                      }
                    }}
                    onMouseLeave={() => {
                      if (!activeSentenceBlockId) {
                        onHoverBlock?.(null);
                      }
                    }}
                  >
                    <div className={styles.bilingualBlockHeader}>
                      <span className={styles.bilingualBlockBadge}>
                        ¶ P{pageNumber} · 段落 {tb.blockIndex + 1}
                      </span>
                      {sourceBlock && (
                        <button
                          type="button"
                          className={styles.bilingualBlockActionBtn}
                          onClick={() => onClickBlock?.(tb.id)}
                          title="定位左侧对应英文段落"
                        >
                          定位原文
                        </button>
                      )}
                    </div>
                    <div className={styles.bilingualBlockContent}>
                      <BlockContentRenderer
                        key={tb.id}
                        blockId={tb.id}
                        text={tb.text || '翻译中...'}
                        currentPageClips={currentPageClips}
                        onClippedSpanClick={onClippedSpanClick}
                      />
                    </div>
                  </div>
                );
              })}
              {isTranslating && <span className={styles.cursorPulse}> ▍</span>}
            </div>
          ) : (
            <div
              style={{
                maxWidth: isImmersive ? (fullWidthReading ? '100%' : '900px') : 'none',
                margin: isImmersive ? '0 auto' : '0',
                fontSize: isImmersive ? '17px' : '15.5px',
                lineHeight: isImmersive ? '2.0' : '1.85',
                transition: 'all 0.25s ease',
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
