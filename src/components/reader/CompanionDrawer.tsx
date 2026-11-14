"use client";

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '@/app/page.module.css';
import { ClipItem } from '@/lib/db';
import { ExplainHistoryItem, PageTurnBannerState } from '@/hooks/useTextSelection';
import { formatPageRanges, parsePageRangeInput } from '@/lib/pageRanges';
import { useToast } from '@/components/Toast';
import {
  X,
  ChevronDown,
  ChevronUp,
  Send,
  Copy,
  Download,
  Trash2,
  ArrowUpRight,
  Sparkles,
  Bookmark,
} from 'lucide-react';

const REMARK_PLUGINS = [remarkGfm];

export interface CompanionDrawerProps {
  isOpen: boolean;
  activeTab: 'explain' | 'clips';
  onChangeTab: (tab: 'explain' | 'clips') => void;
  onClose: () => void;

  // Multi-page Context Props
  pageNumber: number;
  numPages: number;
  contextPages: number[];
  onSetContextPages: (pages: number[]) => void;
  onToggleContextPage: (page: number) => void;
  onRemoveContextPage: (page: number) => void;
  onResetContextToCurrentPage: () => void;
  onIncludeCurrentPageInContext: () => void;
  pageTurnBanner: PageTurnBannerState | null;
  onDismissPageTurnBanner: () => void;
  autoAppendCompanionPage: boolean;
  onChangeAutoAppendCompanionPage: (enabled: boolean) => void;
  translationCache: Record<number, string>;

  // Explain & Chat Props
  explainTargetText: string;
  explainTargetPage: number;
  onClearExplainSelection: () => void;
  explainResultText: string;
  isExplainLoading: boolean;
  explainHistory: ExplainHistoryItem[];
  explainFollowUpInput: string;
  onFollowUpInputChange: (val: string) => void;
  onSendQuestion: (overrideQuestion?: string) => void;

  // Clips Props
  clips: ClipItem[];
  onJumpToPage: (page: number, text: string) => void;
  onCopyClip: (text: string) => void;
  onDeleteClip: (id: string) => void;
  onCopyAllClips: () => void;
  onExportClipsMarkdown: () => void;
}

export function CompanionDrawer({
  isOpen,
  activeTab,
  onChangeTab,
  onClose,
  pageNumber,
  numPages,
  contextPages,
  onSetContextPages,
  onToggleContextPage,
  onRemoveContextPage,
  onResetContextToCurrentPage,
  onIncludeCurrentPageInContext,
  pageTurnBanner,
  onDismissPageTurnBanner,
  autoAppendCompanionPage,
  onChangeAutoAppendCompanionPage,
  translationCache,
  explainTargetText,
  explainTargetPage,
  onClearExplainSelection,
  explainResultText,
  isExplainLoading,
  explainHistory,
  explainFollowUpInput,
  onFollowUpInputChange,
  onSendQuestion,
  clips,
  onJumpToPage,
  onCopyClip,
  onDeleteClip,
  onCopyAllClips,
  onExportClipsMarkdown,
}: CompanionDrawerProps) {
  const { showToast } = useToast();
  const [isCtxExpanded, setIsCtxExpanded] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [rangeInput, setRangeInput] = useState('');
  const [isQuoteExpanded, setIsQuoteExpanded] = useState(false);
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);

  const pickerAnchorRef = useRef<HTMLDivElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  // 当选中文本变化时自动收起长引用展开态
  const [prevQuote, setPrevQuote] = useState(explainTargetText);
  if (explainTargetText !== prevQuote) {
    setPrevQuote(explainTargetText);
    setIsQuoteExpanded(false);
  }

  // 当页数降回 3 页及以下时，自动复位多页抽屉展开状态
  if (contextPages.length <= 3 && isCtxExpanded) {
    setIsCtxExpanded(false);
  }

  useEffect(() => {
    if (!isPickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (pickerAnchorRef.current && !pickerAnchorRef.current.contains(e.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPickerOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen]);

  // 流式输出时平滑滚动至最新内容底部
  useEffect(() => {
    if (activeTab !== 'explain') return;
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeTab, explainResultText, explainHistory.length, isExplainLoading]);

  if (!isOpen) return null;

  const maxBookPage = numPages > 0 ? numPages : Math.max(pageNumber + 10, ...contextPages);
  const rangeSummary = formatPageRanges(contextPages, pageNumber);
  const isManyPages = contextPages.length > 3;

  // 计算选页器中的邻近 10 页网格
  const gridStart = Math.max(1, Math.min(pageNumber - 4, Math.max(1, maxBookPage - 9)));
  const gridEnd = Math.min(maxBookPage, gridStart + 9);
  const nearbyPages: number[] = [];
  for (let p = gridStart; p <= gridEnd; p++) {
    nearbyPages.push(p);
  }

  const applyRangeInput = () => {
    const parsed = parsePageRangeInput(rangeInput, maxBookPage);
    if (parsed.length === 0) {
      showToast('请输入有效页码，例如 12-16, 19', 'warning');
      return;
    }
    onSetContextPages(parsed);
    onDismissPageTurnBanner();
    setRangeInput('');
    setIsPickerOpen(false);
  };

  const applyAdjacentThree = () => {
    const candidates = [pageNumber - 1, pageNumber, pageNumber + 1].filter(
      p => p >= 1 && p <= maxBookPage
    );
    onSetContextPages(candidates);
    onDismissPageTurnBanner();
  };

  const hasConversation =
    Boolean(explainResultText) || explainHistory.length > 0 || isExplainLoading;
  const isLongQuote = explainTargetText.trim().length > 26;

  return (
    <aside className={styles.companionDrawer} data-interactive-protected="true">
      {/* 顶部标签栏 */}
      <div className={styles.drawerHeader}>
        <div className={styles.drawerTabGroup} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'explain'}
            className={`${styles.drawerTab} ${activeTab === 'explain' ? styles.drawerTabActive : ''}`}
            onClick={() => onChangeTab('explain')}
          >
            <Sparkles size={13} />
            <span>伴读解析</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'clips'}
            className={`${styles.drawerTab} ${activeTab === 'clips' ? styles.drawerTabActive : ''}`}
            onClick={() => onChangeTab('clips')}
          >
            <Bookmark size={13} />
            <span>书摘</span>
            {clips.length > 0 && <span className={styles.drawerTabCount}>{clips.length}</span>}
          </button>
        </div>

        <button
          type="button"
          className={styles.headerIconBtn}
          onClick={onClose}
          aria-label="关闭侧栏"
          title="关闭侧栏"
        >
          <X size={14} />
        </button>
      </div>

      {activeTab === 'explain' ? (
        <div className={styles.companionTabBody}>
          {/* 1. 单行紧凑可折叠多页上下文栏 */}
          <div className={styles.ctxSection} ref={pickerAnchorRef}>
            <div className={styles.ctxTopRow}>
              <div className={styles.ctxLeftInline}>
                <span className={styles.ctxLabel}>上下文</span>
                {!isManyPages ? (
                  <div className={styles.ctxInlineChips}>
                    {contextPages.map(p => (
                      <span
                        key={p}
                        className={`${styles.ctxMicroChip} ${
                          p === pageNumber ? styles.ctxMicroChipCurrent : ''
                        }`}
                      >
                        <span>P.{p}</span>
                        {contextPages.length > 1 && (
                          <button
                            type="button"
                            className={styles.ctxMicroChipRemove}
                            onClick={() => onRemoveContextPage(p)}
                            aria-label={`移除第 ${p} 页`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.ctxSummaryPill}
                    onClick={() => setIsCtxExpanded(prev => !prev)}
                    title="点击展开或收起全部已选页码"
                  >
                    <span className={styles.ctxSummaryRange}>{rangeSummary}</span>
                    <span className={styles.ctxSummaryCount}>· 共{contextPages.length}页</span>
                    <span className={styles.ctxSummaryChevron}>
                      {isCtxExpanded ? '收起' : '展开'}
                      {isCtxExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </span>
                  </button>
                )}
              </div>

              <div className={styles.ctxRightActions}>
                {contextPages.length > 1 && !pageTurnBanner && (
                  <button
                    type="button"
                    className={styles.ctxResetBtn}
                    onClick={onResetContextToCurrentPage}
                    title={`清空其他页，仅保留当前第 ${pageNumber} 页作为伴读上下文`}
                  >
                    重置单页
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.ctxPickerTrigger} ${
                    isPickerOpen ? styles.ctxPickerTriggerOpen : ''
                  }`}
                  onClick={() => setIsPickerOpen(prev => !prev)}
                >
                  <span>选页</span>
                  <ChevronDown size={11} />
                </button>
              </div>
            </div>

            {/* 多页（>3页）点击“展开”后的限高滚动微标签托盘 */}
            {isManyPages && isCtxExpanded && (
              <div className={styles.ctxExpandedTray}>
                {contextPages.map(p => (
                  <span
                    key={p}
                    className={`${styles.ctxMicroChip} ${
                      p === pageNumber ? styles.ctxMicroChipCurrent : ''
                    }`}
                  >
                    <span>P.{p}</span>
                    {contextPages.length > 1 && (
                      <button
                        type="button"
                        className={styles.ctxMicroChipRemove}
                        onClick={() => onRemoveContextPage(p)}
                        aria-label={`移除第 ${p} 页`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* 翻页轻提示条（28px 超薄内联提示，清晰区分“仅保留新页”与“撤回并入”） */}
            {pageTurnBanner && (
              <div className={styles.pageTurnStrip}>
                {pageTurnBanner.mode === 'auto_added' ? (
                  <>
                    <span className={styles.pageTurnText}>
                      翻页已加入 <strong>P.{pageTurnBanner.page}</strong>
                    </span>
                    <div className={styles.pageTurnActions}>
                      <button
                        type="button"
                        className={styles.pageTurnActionBtn}
                        onClick={onResetContextToCurrentPage}
                        title={`清空此前页面，仅将 P.${pageTurnBanner.page} 作为提问上下文`}
                      >
                        仅保留 P.{pageTurnBanner.page}
                      </button>
                      <button
                        type="button"
                        className={styles.pageTurnActionBtn}
                        onClick={() => onRemoveContextPage(pageTurnBanner.page)}
                        title={`撤回刚自动加入的 P.${pageTurnBanner.page}`}
                      >
                        撤回
                      </button>
                      <button
                        type="button"
                        className={styles.pageTurnClose}
                        onClick={onDismissPageTurnBanner}
                        aria-label="关闭提示"
                      >
                        ×
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.pageTurnText}>
                      已翻至 <strong>P.{pageTurnBanner.page}</strong>（未加入）
                    </span>
                    <div className={styles.pageTurnActions}>
                      <button
                        type="button"
                        className={styles.pageTurnActionBtn}
                        onClick={onIncludeCurrentPageInContext}
                        title={`将 P.${pageTurnBanner.page} 追加进当前上下文`}
                      >
                        加入 P.{pageTurnBanner.page}
                      </button>
                      <button
                        type="button"
                        className={styles.pageTurnActionBtn}
                        onClick={onResetContextToCurrentPage}
                        title={`清空此前页面，仅将 P.${pageTurnBanner.page} 作为提问上下文`}
                      >
                        仅保留 P.{pageTurnBanner.page}
                      </button>
                      <button
                        type="button"
                        className={styles.pageTurnClose}
                        onClick={onDismissPageTurnBanner}
                        aria-label="关闭提示"
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 选页弹出浮层 PageContextPicker */}
            {isPickerOpen && (
              <div className={styles.ctxPickerPopover}>
                <div className={styles.ctxPresetRow}>
                  <button
                    type="button"
                    className={styles.ctxPresetBtn}
                    onClick={() => {
                      onResetContextToCurrentPage();
                    }}
                  >
                    仅当前页 (P.{pageNumber})
                  </button>
                  <button
                    type="button"
                    className={styles.ctxPresetBtn}
                    onClick={applyAdjacentThree}
                  >
                    相邻 3 页
                  </button>
                </div>

                <div className={styles.popoverHint} style={{ marginBottom: '5px' }}>
                  点击增减邻近页（绿点表示已有译文缓存）
                </div>
                <div className={styles.ctxPageGrid}>
                  {nearbyPages.map(p => {
                    const selected = contextPages.includes(p);
                    const cached = Boolean(translationCache[p]);
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`${styles.ctxPageCell} ${
                          selected ? styles.ctxPageCellActive : ''
                        }`}
                        onClick={() => {
                          onToggleContextPage(p);
                          onDismissPageTurnBanner();
                        }}
                      >
                        <span>{p}</span>
                        {cached && <span className={styles.ctxPageCachedDot} />}
                      </button>
                    );
                  })}
                </div>

                <div className={styles.ctxRangeRow}>
                  <input
                    type="text"
                    value={rangeInput}
                    onChange={e => setRangeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') applyRangeInput();
                    }}
                    placeholder="输入范围，如 10-18, 22"
                    className={styles.ctxRangeInput}
                  />
                  <button
                    type="button"
                    className={styles.ctxPresetBtn}
                    onClick={applyRangeInput}
                  >
                    应用
                  </button>
                </div>

                <label className={styles.ctxAutoAppendLabel}>
                  <input
                    type="checkbox"
                    checked={autoAppendCompanionPage}
                    onChange={e => onChangeAutoAppendCompanionPage(e.target.checked)}
                  />
                  <span>伴读开启时，翻页自动将新页并入上下文</span>
                </label>
              </div>
            )}
          </div>

          {/* 2. 超薄单行划词引用条（22px 单行截断，长句可展开/清除） */}
          {explainTargetText && (
            <div className={styles.quoteStrip}>
              <div className={styles.quoteStripRow}>
                <span
                  className={
                    isQuoteExpanded ? styles.quoteStripTextExpanded : styles.quoteStripText
                  }
                >
                  “{explainTargetText}”
                </span>
                <div className={styles.quoteStripMeta}>
                  <span className={styles.quotePageTag}>P.{explainTargetPage}</span>
                  {isLongQuote && (
                    <button
                      type="button"
                      className={styles.quoteToggleBtn}
                      onClick={() => setIsQuoteExpanded(prev => !prev)}
                    >
                      {isQuoteExpanded ? '收起' : '展开'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.quoteClearBtn}
                    onClick={onClearExplainSelection}
                    title="清除划词引用，改为针对整页提问"
                    aria-label="清除划词引用"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. 对话与流式解析正文 */}
          <div className={styles.explainStream}>
            {!hasConversation ? (
              <div className={styles.explainEmptyState}>
                <div className={styles.explainEmptyTitle}>跨页伴读与深度精讲</div>
                <div className={styles.explainEmptyDesc}>
                  在正文划选任意词句点击「解释」，或直接基于当前所选页（{rangeSummary}）提问。翻页时会自动延续上下文。
                </div>
                <div className={styles.starterChips}>
                  <button
                    type="button"
                    className={styles.starterChip}
                    onClick={() => onSendQuestion('请提炼当前上下文各页的核心论点与逻辑脉络')}
                  >
                    提炼所选页核心观点
                  </button>
                  <button
                    type="button"
                    className={styles.starterChip}
                    onClick={() => onSendQuestion('请解释当前上下文中的关键专业术语与隐含背景')}
                  >
                    解析关键术语与背景
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* 初次划词解释（当尚未合并进多轮 history 时独立展示，合并后在 history[0] 展示） */}
                {explainResultText && explainHistory.length === 0 && (
                  <div className={styles.assistantBubble}>
                    <div className={styles.assistantProse}>
                      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                        {explainResultText}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {explainHistory.map((msg, idx) =>
                  msg.role === 'user' ? (
                    <div key={idx} className={styles.userBubble}>
                      {msg.content}
                    </div>
                  ) : (
                    <div key={idx} className={styles.assistantBubble}>
                      <div className={styles.assistantProse}>
                        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )
                )}

                {isExplainLoading &&
                  !explainResultText &&
                  explainHistory[explainHistory.length - 1]?.role !== 'assistant' && (
                    <div className={styles.thinkingDots}>正在结合 {rangeSummary} 研读思考...</div>
                  )}
                <div ref={streamEndRef} />
              </>
            )}
          </div>

          {/* 4. 底部提问输入框 */}
          <div className={styles.explainFooter}>
            <div className={styles.explainInputRow}>
              <input
                type="text"
                value={explainFollowUpInput}
                onChange={e => onFollowUpInputChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSendQuestion();
                  }
                }}
                placeholder={`基于 ${rangeSummary} 提问...`}
                className={styles.explainInput}
                disabled={isExplainLoading}
              />
              <button
                type="button"
                className={styles.explainSendBtn}
                onClick={() => onSendQuestion()}
                disabled={isExplainLoading || !explainFollowUpInput.trim()}
                aria-label="发送提问"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Tab 2: 书摘列表 */
        <div className={styles.companionTabBody}>
          {clips.length > 0 && (
            <div className={styles.clipsToolbar}>
              <span className={styles.clipsToolbarHint}>点击页码定位原文</span>
              <div className={styles.clipsToolbarActions}>
                <button
                  type="button"
                  className={styles.ctxTextActionBtn}
                  onClick={() => {
                    onCopyAllClips();
                    showToast(`已复制全部 ${clips.length} 条书摘`, 'success');
                  }}
                >
                  <Copy size={11} />
                  <span>复制全部</span>
                </button>
                <button
                  type="button"
                  className={styles.ctxTextActionBtn}
                  onClick={() => {
                    onExportClipsMarkdown();
                    showToast('已导出书摘 Markdown 文件', 'success');
                  }}
                >
                  <Download size={11} />
                  <span>导出 .md</span>
                </button>
              </div>
            </div>
          )}

          <div className={styles.clipsList}>
            {clips.length === 0 ? (
              <div className={styles.explainEmptyState}>
                <div className={styles.explainEmptyTitle}>尚无书摘记录</div>
                <div className={styles.explainEmptyDesc}>
                  在左侧英文 PDF 或右侧中文译文中划选精彩句子，点击浮窗中的「书摘」即可收入此处并跨设备同步。
                </div>
              </div>
            ) : (
              clips.map(clip => (
                <div key={clip.id} className={styles.clipCard}>
                  <div className={styles.clipCardHeader}>
                    <button
                      type="button"
                      className={styles.clipPageJumpBtn}
                      onClick={() => onJumpToPage(clip.pageNumber, clip.text)}
                      title="跳转到该页并高亮定位"
                    >
                      <span>P.{clip.pageNumber}</span>
                      <ArrowUpRight size={11} />
                    </button>

                    {confirmDeleteClipId === clip.id ? (
                      <div className={styles.clipConfirmRow}>
                        <button
                          type="button"
                          className={styles.clipConfirmDangerBtn}
                          onClick={() => {
                            onDeleteClip(clip.id);
                            setConfirmDeleteClipId(null);
                            showToast('已移除该条书摘');
                          }}
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          className={styles.clipConfirmCancelBtn}
                          onClick={() => setConfirmDeleteClipId(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className={styles.clipCardActions}>
                        <button
                          type="button"
                          className={styles.clipActionIconBtn}
                          onClick={() => {
                            onCopyClip(clip.text);
                            showToast('书摘已复制', 'success');
                          }}
                          title="复制此条书摘"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          type="button"
                          className={styles.clipActionIconBtn}
                          onClick={() => setConfirmDeleteClipId(clip.id)}
                          title="删除此条书摘"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  <blockquote className={styles.clipCardQuote}>{clip.text}</blockquote>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
