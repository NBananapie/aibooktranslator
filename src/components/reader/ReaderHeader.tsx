"use client";

import React, { useState, useRef, useEffect } from 'react';
import styles from '@/app/page.module.css';
import { PreloadCountOption, ReaderFontFamily } from '@/context/AppContext';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
  Check,
  X,
  RefreshCw,
  Type,
  MoreHorizontal,
  PanelRight,
  ScanText,
  Download,
  Sun,
  Moon,
  Settings,
  Eye,
} from 'lucide-react';

export interface ReaderHeaderProps {
  fileName?: string;
  isEditingTitle: boolean;
  editTitleValue: string;
  onStartEditTitle: () => void;
  onTitleChange: (val: string) => void;
  onSaveTitle: () => void;
  onCancelEditTitle: () => void;
  onBackHome: () => void;

  pageNumber: number;
  numPages: number;
  onChangePage: (offset: number) => void;
  onSeekPage: (page: number) => void;

  isImmersive: boolean;
  onToggleImmersive: () => void;

  viewMode: 'translation' | 'ocr_source';
  hasOcrCache: boolean;
  onSetViewMode: (mode: 'translation' | 'ocr_source') => void;

  // Translation & Preload Strategy
  isTranslating: boolean;
  hasCachedTranslation: boolean;
  cachedPagesCount: number;
  autoTranslate: boolean;
  onToggleAutoTranslate: () => void;
  preloadCount: PreloadCountOption;
  onChangePreloadCount: (count: PreloadCountOption) => void;
  isPreTranslating: boolean;
  preloadProgress: { done: number; total: number } | null;
  isLookaheadCached: boolean;
  onTranslateCurrentPage: () => void;

  // Typography
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  readerFont: ReaderFontFamily;
  onChangeReaderFont: (font: ReaderFontFamily) => void;
  fullWidthReading: boolean;
  onToggleFullWidthReading: () => void;

  // Overflow tools
  isOcrLoading: boolean;
  onRunOcrAndTranslate: () => void;
  onRunOcrOnly: () => void;
  onDownloadMarkdown: () => void;
  hasAnyTranslationCache: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  dimPdfInDark: boolean;
  onToggleDimPdfInDark: () => void;
  onOpenSettings: (tab?: 'llm' | 'ocr' | 'sync') => void;

  // Companion & Clips Drawer Edge Toggle
  isCompanionOpen: boolean;
  onToggleCompanion: () => void;
  clipsCount: number;
  toggleBtnRef: React.RefObject<HTMLButtonElement | null>;
}

type ActivePopover = 'strategy' | 'typography' | 'more' | null;

const PRELOAD_OPTIONS: { value: PreloadCountOption; label: string }[] = [
  { value: 0, label: '关闭' },
  { value: 1, label: '+1 页' },
  { value: 2, label: '+2 页' },
  { value: 4, label: '+4 页' },
];

export function ReaderHeader({
  fileName,
  isEditingTitle,
  editTitleValue,
  onStartEditTitle,
  onTitleChange,
  onSaveTitle,
  onCancelEditTitle,
  onBackHome,
  pageNumber,
  numPages,
  onChangePage,
  onSeekPage,
  isImmersive,
  onToggleImmersive,
  viewMode,
  hasOcrCache,
  onSetViewMode,
  isTranslating,
  hasCachedTranslation,
  cachedPagesCount,
  autoTranslate,
  onToggleAutoTranslate,
  preloadCount,
  onChangePreloadCount,
  isPreTranslating,
  preloadProgress,
  isLookaheadCached,
  onTranslateCurrentPage,
  fontSize,
  onChangeFontSize,
  readerFont,
  onChangeReaderFont,
  fullWidthReading,
  onToggleFullWidthReading,
  isOcrLoading,
  onRunOcrAndTranslate,
  onRunOcrOnly,
  onDownloadMarkdown,
  hasAnyTranslationCache,
  theme,
  onToggleTheme,
  dimPdfInDark,
  onToggleDimPdfInDark,
  onOpenSettings,
  isCompanionOpen,
  onToggleCompanion,
  clipsCount,
  toggleBtnRef,
}: ReaderHeaderProps) {
  const [openPopover, setOpenPopover] = useState<ActivePopover>(null);
  const [isJumpingPage, setIsJumpingPage] = useState(false);
  const [jumpInputVal, setJumpInputVal] = useState('');
  const headerRightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (headerRightRef.current && !headerRightRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPopover]);

  const commitPageJump = () => {
    const parsed = parseInt(jumpInputVal.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      onSeekPage(Math.min(parsed, numPages || parsed));
    }
    setIsJumpingPage(false);
  };

  const displayTitle = fileName ? fileName.replace(/\.pdf$/i, '') : '正在载入书籍...';
  const progressPercent = numPages > 0 ? Math.min(100, Math.max(0, (pageNumber / numPages) * 100)) : 0;

  const strategySummary = isPreTranslating && preloadProgress
    ? `预读中 ${preloadProgress.done}/${preloadProgress.total}`
    : autoTranslate
      ? preloadCount > 0
        ? isLookaheadCached
          ? '自动连译 · 已翻译'
          : `自动连译 +${preloadCount}页`
        : '自动连译'
      : '手动翻译';

  return (
    <header className={styles.readerHeader} data-interactive-protected="true">
      {/* 阅读进度细线 */}
      <div className={styles.readerProgressHairline} style={{ width: `${progressPercent}%` }} />

      {/* 左侧：返回书架 + 书名重命名 */}
      <div className={styles.headerLeft}>
        <button
          type="button"
          className={styles.backShelfBtn}
          onClick={onBackHome}
          data-tooltip="返回书架"
          data-tooltip-align="start"
        >
          <ArrowLeft size={14} />
          <span>书架</span>
        </button>

        <span className={styles.headerDivider} />

        {isEditingTitle ? (
          <div className={styles.titleEditRow}>
            <input
              type="text"
              value={editTitleValue}
              onChange={e => onTitleChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSaveTitle();
                if (e.key === 'Escape') onCancelEditTitle();
              }}
              className={styles.titleEditInput}
              autoFocus
            />
            <button type="button" className={styles.headerIconBtn} onClick={onSaveTitle} title="保存书名">
              <Check size={13} />
            </button>
            <button type="button" className={styles.headerIconBtn} onClick={onCancelEditTitle} title="取消">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.bookTitleBtn}
            onClick={onStartEditTitle}
            title={`${fileName || ''}（点击重命名）`}
          >
            <span className={styles.bookTitleText}>{displayTitle}</span>
            <Pencil size={11} className={styles.bookTitleEditIcon} />
          </button>
        )}
      </div>

      {/* 中央：页码步进跳转 + 阅读视图切换 */}
      <div className={styles.headerCenter}>
        <div className={styles.pageStepper}>
          <button
            type="button"
            className={styles.stepperNavBtn}
            onClick={() => onChangePage(-1)}
            disabled={pageNumber <= 1}
            aria-label="上一页"
          >
            <ChevronLeft size={14} />
          </button>

          {isJumpingPage ? (
            <input
              type="text"
              inputMode="numeric"
              value={jumpInputVal}
              onChange={e => setJumpInputVal(e.target.value)}
              onBlur={commitPageJump}
              onKeyDown={e => {
                if (e.key === 'Enter') commitPageJump();
                if (e.key === 'Escape') setIsJumpingPage(false);
              }}
              className={styles.pageJumpInput}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={styles.pageJumpDisplay}
              onClick={() => {
                setJumpInputVal(String(pageNumber));
                setIsJumpingPage(true);
              }}
              data-tooltip="点击输入页码跳转"
            >
              <strong>{pageNumber}</strong>
              <span className={styles.pageJumpSlash}>/</span>
              <span>{numPages || '–'}</span>
            </button>
          )}

          <button
            type="button"
            className={styles.stepperNavBtn}
            onClick={() => onChangePage(1)}
            disabled={numPages > 0 && pageNumber >= numPages}
            aria-label="下一页"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className={styles.segmentedControl} role="tablist" aria-label="阅读布局">
          <button
            type="button"
            role="tab"
            aria-selected={!isImmersive}
            className={`${styles.segmentedItem} ${!isImmersive ? styles.segmentedItemActive : ''}`}
            onClick={() => {
              if (isImmersive) onToggleImmersive();
            }}
          >
            双栏对照
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isImmersive}
            className={`${styles.segmentedItem} ${isImmersive ? styles.segmentedItemActive : ''}`}
            onClick={() => {
              if (!isImmersive) onToggleImmersive();
            }}
          >
            沉浸译文
          </button>
        </div>

        {hasOcrCache && (
          <div className={styles.segmentedControl} role="tablist" aria-label="右侧内容源">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'translation'}
              className={`${styles.segmentedItem} ${viewMode === 'translation' ? styles.segmentedItemActive : ''}`}
              onClick={() => onSetViewMode('translation')}
            >
              译文
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'ocr_source'}
              className={`${styles.segmentedItem} ${viewMode === 'ocr_source' ? styles.segmentedItemActive : ''}`}
              onClick={() => onSetViewMode('ocr_source')}
            >
              OCR 原文
            </button>
          </div>
        )}
      </div>

      {/* 右侧：翻译与预读策略 + Aa 排版 + 更多菜单 + 右边缘侧栏开关 */}
      <div className={styles.headerRight} ref={headerRightRef}>
        {/* 1. 翻译与预读策略弹出框 */}
        <div className={styles.popoverAnchor}>
          <button
            type="button"
            className={`${styles.strategyPill} ${openPopover === 'strategy' ? styles.strategyPillOpen : ''}`}
            onClick={() => setOpenPopover(prev => (prev === 'strategy' ? null : 'strategy'))}
          >
            <span
              className={`${styles.strategyDot} ${
                autoTranslate ? styles.strategyDotActive : ''
              } ${isTranslating || isPreTranslating ? styles.strategyDotPulse : ''}`}
            />
            <span>{strategySummary}</span>
            <ChevronDown size={12} className={styles.strategyChevron} />
          </button>

          {openPopover === 'strategy' && (
            <div className={`${styles.popoverPanel} ${styles.popoverRight}`} style={{ width: '268px' }}>
              <div className={styles.popoverSection}>
                <button
                  type="button"
                  className={styles.popoverActionBtn}
                  onClick={() => {
                    onTranslateCurrentPage();
                    setOpenPopover(null);
                  }}
                  disabled={isTranslating}
                >
                  <RefreshCw size={13} className={isTranslating ? styles.spinAnim : ''} />
                  <span>
                    {isTranslating
                      ? '正在流式翻译本页...'
                      : hasCachedTranslation
                        ? `重新翻译当前页 (P.${pageNumber})`
                        : `立即翻译当前页 (P.${pageNumber})`}
                  </span>
                </button>
              </div>

              <div className={styles.popoverSection}>
                <div className={styles.popoverRow}>
                  <div>
                    <div className={styles.popoverLabel}>翻页自动翻译</div>
                    <div className={styles.popoverHint}>翻至未译页面时自动请求译文</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoTranslate}
                    className={`${styles.switchBtn} ${autoTranslate ? styles.switchBtnOn : ''}`}
                    onClick={onToggleAutoTranslate}
                  >
                    <span className={styles.switchThumb} />
                  </button>
                </div>
              </div>

              <div className={styles.popoverSection}>
                <div className={styles.popoverLabel} style={{ marginBottom: '6px' }}>
                  后台提前预读页数
                </div>
                <div className={styles.preloadGrid}>
                  {PRELOAD_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.preloadOption} ${preloadCount === opt.value ? styles.preloadOptionActive : ''}`}
                      onClick={() => onChangePreloadCount(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className={styles.popoverHint} style={{ marginTop: '6px' }}>
                  当前页译完后静默缓存后续页，翻页零等待
                </div>
              </div>

              <div className={styles.popoverFooterStat}>
                <span>已缓存译文</span>
                <strong>
                  {cachedPagesCount} {numPages > 0 ? `/ ${numPages}` : ''} 页
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* 2. Aa 阅读排版弹出框 */}
        <div className={styles.popoverAnchor}>
          <button
            type="button"
            className={`${styles.headerIconBtn} ${openPopover === 'typography' ? styles.headerIconBtnActive : ''}`}
            onClick={() => setOpenPopover(prev => (prev === 'typography' ? null : 'typography'))}
            aria-label="阅读排版设置"
            title="字体与字号"
          >
            <Type size={15} />
          </button>

          {openPopover === 'typography' && (
            <div className={`${styles.popoverPanel} ${styles.popoverRight}`} style={{ width: '240px' }}>
              <div className={styles.popoverSection}>
                <div className={styles.popoverLabel} style={{ marginBottom: '6px' }}>
                  译文字体
                </div>
                <div className={styles.fontFamilyGrid}>
                  <button
                    type="button"
                    className={`${styles.fontFamilyOption} ${readerFont === 'serif' ? styles.fontFamilyOptionActive : ''}`}
                    style={{ fontFamily: 'var(--font-serif)' }}
                    onClick={() => onChangeReaderFont('serif')}
                  >
                    衬线书宋
                  </button>
                  <button
                    type="button"
                    className={`${styles.fontFamilyOption} ${readerFont === 'sans' ? styles.fontFamilyOptionActive : ''}`}
                    style={{ fontFamily: 'var(--font-sans)' }}
                    onClick={() => onChangeReaderFont('sans')}
                  >
                    现代黑体
                  </button>
                </div>
              </div>

              <div className={styles.popoverSection}>
                <div className={styles.popoverLabel} style={{ marginBottom: '6px' }}>
                  正文大小
                </div>
                <div className={styles.fontStepperRow}>
                  <button
                    type="button"
                    className={styles.fontStepperBtn}
                    onClick={() => onChangeFontSize(Math.max(13, fontSize - 1))}
                    disabled={fontSize <= 13}
                  >
                    A−
                  </button>
                  <button
                    type="button"
                    className={styles.fontSizeValue}
                    onClick={() => onChangeFontSize(16)}
                    title="点击恢复默认 16px"
                  >
                    {fontSize} px
                  </button>
                  <button
                    type="button"
                    className={styles.fontStepperBtn}
                    onClick={() => onChangeFontSize(Math.min(26, fontSize + 1))}
                    disabled={fontSize >= 26}
                  >
                    A+
                  </button>
                </div>
              </div>

              {isImmersive && (
                <div className={styles.popoverSection}>
                  <div className={styles.popoverRow}>
                    <div>
                      <div className={styles.popoverLabel}>沉浸版心宽度</div>
                      <div className={styles.popoverHint}>{fullWidthReading ? '宽幅全屏展开' : '经典 68 字舒适行宽'}</div>
                    </div>
                    <button
                      type="button"
                      className={styles.preloadOption}
                      onClick={onToggleFullWidthReading}
                    >
                      {fullWidthReading ? '标准行宽' : '铺满宽屏'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. ⋯ 更多低频工具菜单 */}
        <div className={styles.popoverAnchor}>
          <button
            type="button"
            className={`${styles.headerIconBtn} ${openPopover === 'more' ? styles.headerIconBtnActive : ''}`}
            onClick={() => setOpenPopover(prev => (prev === 'more' ? null : 'more'))}
            aria-label="更多工具"
            title="更多工具"
          >
            <MoreHorizontal size={16} />
          </button>

          {openPopover === 'more' && (
            <div className={`${styles.popoverPanel} ${styles.popoverRight}`} style={{ width: '232px', padding: '5px' }}>
              <button
                type="button"
                className={styles.menuItem}
                disabled={isOcrLoading}
                onClick={() => {
                  setOpenPopover(null);
                  onRunOcrAndTranslate();
                }}
              >
                <ScanText size={14} className={styles.menuItemIcon} />
                <span>扫描页 OCR 识别并翻译</span>
              </button>

              <button
                type="button"
                className={styles.menuItem}
                disabled={isOcrLoading}
                onClick={() => {
                  setOpenPopover(null);
                  onRunOcrOnly();
                }}
              >
                <ScanText size={14} className={styles.menuItemIcon} />
                <span>仅提取本页 OCR 原文</span>
              </button>

              <button
                type="button"
                className={styles.menuItem}
                disabled={!hasAnyTranslationCache}
                onClick={() => {
                  setOpenPopover(null);
                  onDownloadMarkdown();
                }}
              >
                <Download size={14} className={styles.menuItemIcon} />
                <span>导出已译章节 (.md)</span>
              </button>

              <div className={styles.menuDivider} />

              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  onToggleTheme();
                }}
              >
                {theme === 'dark' ? (
                  <Sun size={14} className={styles.menuItemIcon} />
                ) : (
                  <Moon size={14} className={styles.menuItemIcon} />
                )}
                <span>{theme === 'dark' ? '切换为暖白纸感模式' : '切换为深色夜间模式'}</span>
              </button>

              {theme === 'dark' && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={onToggleDimPdfInDark}
                >
                  <Eye size={14} className={styles.menuItemIcon} />
                  <span>夜间柔化 PDF 页面亮度</span>
                  <span className={styles.menuItemMeta}>{dimPdfInDark ? '已开启' : '关闭'}</span>
                </button>
              )}

              <div className={styles.menuDivider} />

              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setOpenPopover(null);
                  onOpenSettings('llm');
                }}
              >
                <Settings size={14} className={styles.menuItemIcon} />
                <span>引擎、OCR 与云同步设置...</span>
              </button>
            </div>
          )}
        </div>

        <span className={styles.headerDivider} />

        {/* 4. 最右边缘：伴读与书摘侧栏图标开关（承接书摘飞行粒子动画） */}
        <button
          ref={toggleBtnRef}
          type="button"
          className={`${styles.headerIconBtn} ${styles.companionEdgeBtn} ${
            isCompanionOpen ? styles.headerIconBtnActive : ''
          }`}
          onClick={onToggleCompanion}
          aria-label={isCompanionOpen ? '收起伴读与书摘侧栏' : '展开伴读与书摘侧栏'}
          title={isCompanionOpen ? '收起侧栏' : '伴读解析与书摘'}
        >
          <PanelRight size={16} />
          {!isCompanionOpen && clipsCount > 0 && (
            <span className={styles.companionEdgeBadge}>{clipsCount > 99 ? '99+' : clipsCount}</span>
          )}
        </button>
      </div>
    </header>
  );
}
