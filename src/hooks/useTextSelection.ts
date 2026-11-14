"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { AppSettings } from '@/context/AppContext';
import { ClipItem } from '@/lib/db';
import { executeExplainStream } from '@/lib/llmClient';
import { readErrorResponse } from '@/lib/llm/protocol';
import { MAX_EXPLAIN_CONTEXT_CHARS } from '@/lib/llm/prompts';
import { parseTranslationOutput } from '@/services/alignmentEngine';
import { SourceBlock } from '@/services/layoutAnalysisEngine';

export interface FloatingToolbarState {
  visible: boolean;
  top: number;
  left: number;
  text: string;
  placement?: 'top' | 'bottom';
  isClipped?: boolean;
  clipId?: string;
}

/**
 * 校验划词/剪藏文本的语义有效性（第一性原理）：
 * 1. 非空且去除首尾空白
 * 2. 必须包含实质性的汉字、英文字母或数字（单字、单词、短语、整句与长段落均被支持）
 * 3. 排除纯空白或纯符号
 */
export function isValidClippedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(trimmed)) {
    return false;
  }
  return true;
}

export interface ExplainHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface PageTurnBannerState {
  page: number;
  mode: 'auto_added' | 'prompt_add';
}

export interface UseTextSelectionOptions {
  displayedText: string;
  settings: AppSettings;
  clips: ClipItem[];
  pageNumber: number;
  /** 当前页原文段落，用于给划词解释提供所在段落的上下文 */
  sourceBlocks?: SourceBlock[];
  /** 全书已缓存译文表，用于组装跨页上下文 */
  translationCache?: Record<number, string>;
  /** 本次会话 OCR 缓存表 */
  ocrCache?: Record<number, string>;
  /** 按页读取未翻译 PDF 原文的方法 */
  extractPagePlainText?: (page: number) => Promise<string>;
  /** 右侧伴读/书摘侧栏当前是否展开 */
  isCompanionOpen?: boolean;
  /** 当前侧栏激活标签 */
  activeCompanionTab?: 'explain' | 'clips';
  /** 打开伴读解释标签页的回调 */
  onActivateExplainTab?: () => void;
  /** 翻页时是否默认自动将新页加入伴读上下文 */
  autoAppendCompanionPage?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 计算悬浮微岛的最佳像素坐标与方向
 */
function calculateToolbarPlacement(rect: DOMRect): { top: number; left: number; placement: 'top' | 'bottom' } {
  const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
  const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;

  const toolbarHalfWidth = 110;
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const rawCenter = rect.left + rect.width / 2;
  const left = Math.max(toolbarHalfWidth + 12, Math.min(screenW - toolbarHalfWidth - 12, rawCenter));

  return { top, left, placement };
}

export function useTextSelection(options: UseTextSelectionOptions) {
  const {
    displayedText,
    settings,
    clips,
    pageNumber,
    sourceBlocks = [],
    translationCache = {},
    ocrCache = {},
    extractPagePlainText,
    isCompanionOpen = false,
    activeCompanionTab = 'explain',
    onActivateExplainTab,
    autoAppendCompanionPage = true,
  } = options;

  // 悬浮微岛胶囊状态
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null);

  // 伴读上下文页码与翻页提示状态
  const [contextPages, setContextPagesState] = useState<number[]>(() => [pageNumber]);
  const [pageTurnBanner, setPageTurnBanner] = useState<PageTurnBannerState | null>(null);

  // AI 深度伴读解释与对话状态
  const [explainTargetText, setExplainTargetText] = useState<string>('');
  const [explainTargetPage, setExplainTargetPage] = useState<number>(pageNumber);
  const [explainResultText, setExplainResultText] = useState<string>('');
  const [isExplainLoading, setIsExplainLoading] = useState<boolean>(false);
  const [explainHistory, setExplainHistory] = useState<ExplainHistoryItem[]>([]);
  const [explainFollowUpInput, setExplainFollowUpInput] = useState<string>('');

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      explainAbortRef.current?.abort();
    };
  }, []);

  // 当伴读解析面板从关闭变为打开时：默认载入当前所在页作为上下文起点
  const isExplainPanelVisible = isCompanionOpen && activeCompanionTab === 'explain';
  const [wasExplainVisible, setWasExplainVisible] = useState<boolean>(isExplainPanelVisible);
  if (isExplainPanelVisible !== wasExplainVisible) {
    setWasExplainVisible(isExplainPanelVisible);
    if (isExplainPanelVisible) {
      setContextPagesState([pageNumber]);
      setPageTurnBanner(null);
    }
  }

  // 当用户在伴读解析窗口开启状态下翻页：自动并入新页码并弹出温和提示（或提示是否并入）
  const [prevPage, setPrevPage] = useState<number>(pageNumber);
  if (pageNumber !== prevPage) {
    setPrevPage(pageNumber);
    if (isExplainPanelVisible) {
      if (!contextPages.includes(pageNumber)) {
        if (autoAppendCompanionPage) {
          setContextPagesState(prev => Array.from(new Set([...prev, pageNumber])).sort((a, b) => a - b));
          setPageTurnBanner({ page: pageNumber, mode: 'auto_added' });
        } else {
          setPageTurnBanner({ page: pageNumber, mode: 'prompt_add' });
        }
      } else {
        setPageTurnBanner(null);
      }
    }
  }

  const setContextPages = useCallback((pages: number[]) => {
    const normalized = Array.from(new Set(pages.filter(p => Number.isInteger(p) && p >= 1))).sort((a, b) => a - b);
    if (normalized.length > 0) {
      setContextPagesState(normalized);
    }
  }, []);

  const toggleContextPage = useCallback((targetPage: number) => {
    setContextPagesState(prev => {
      if (prev.includes(targetPage)) {
        if (prev.length <= 1) return prev;
        return prev.filter(p => p !== targetPage);
      }
      return [...prev, targetPage].sort((a, b) => a - b);
    });
  }, []);

  const removeContextPage = useCallback((targetPage: number) => {
    setContextPagesState(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter(p => p !== targetPage);
    });
    setPageTurnBanner(prev => (prev?.page === targetPage ? null : prev));
  }, []);

  const resetContextToCurrentPage = useCallback(() => {
    setContextPagesState([pageNumber]);
    setPageTurnBanner(null);
  }, [pageNumber]);

  const includeCurrentPageInContext = useCallback(() => {
    setContextPagesState(prev => Array.from(new Set([...prev, pageNumber])).sort((a, b) => a - b));
    setPageTurnBanner(null);
  }, [pageNumber]);

  const dismissPageTurnBanner = useCallback(() => {
    setPageTurnBanner(null);
  }, []);

  const clearExplainSelection = useCallback(() => {
    setExplainTargetText('');
  }, []);

  /**
   * 组装多页上下文文本：
   * - 优先使用已缓存译文或 OCR 结构化文本；若未翻译则提取 PDF 原文；
   * - 为每一页均匀分配字符预算上限，避免页数较多时末尾新页被截断。
   */
  const assembleMultiPageContext = useCallback(
    async (pages: number[], selectedPhrase?: string): Promise<string> => {
      const sortedPages = pages.length > 0 ? Array.from(new Set(pages)).sort((a, b) => a - b) : [pageNumber];
      const perPageBudget = Math.max(700, Math.floor((MAX_EXPLAIN_CONTEXT_CHARS - 800) / sortedPages.length));

      const sections: string[] = [];

      if (selectedPhrase) {
        const matchedBlock = sourceBlocks.find(sb =>
          sb.text.toLowerCase().includes(selectedPhrase.toLowerCase())
        );
        if (matchedBlock) {
          sections.push(`【划词所在原文段落 (P.${pageNumber})】\n${matchedBlock.text.slice(0, 800)}`);
        }
      }

      for (const p of sortedPages) {
        let content = '';
        if (p === pageNumber && displayedText.trim()) {
          content = displayedText.trim();
        } else if (translationCache[p]) {
          content = parseTranslationOutput(translationCache[p]).cleanMarkdown.trim();
        } else if (ocrCache[p]) {
          content = ocrCache[p].trim();
        } else if (extractPagePlainText) {
          content = (await extractPagePlainText(p)).trim();
        }

        if (content) {
          const clipped = content.length > perPageBudget ? `${content.slice(0, perPageBudget)}...` : content;
          sections.push(`=== 第 ${p} 页 ===\n${clipped}`);
        } else {
          sections.push(`=== 第 ${p} 页 ===\n（本页暂无可提取文本）`);
        }
      }

      return sections.join('\n\n').slice(0, MAX_EXPLAIN_CONTEXT_CHARS);
    },
    [pageNumber, sourceBlocks, displayedText, translationCache, ocrCache, extractPagePlainText]
  );

  // 1. 译文区域（右侧 Markdown）单向划词监听
  const handleMarkdownSelection = useCallback(() => {
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        return;
      }

      const raw = selection.toString();
      const text = raw.trim();
      if (!isValidClippedText(text)) {
        return;
      }

      const range = selection.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        const rects = range.getClientRects();
        if (rects.length > 0) rect = rects[0];
      }
      if (rect.width === 0 && rect.height === 0) return;

      const { top, left, placement } = calculateToolbarPlacement(rect);
      const existingClip = clips.find(c => c.pageNumber === pageNumber && c.text.trim() === text);

      setFloatingToolbar({
        visible: true,
        top,
        left,
        text,
        placement,
        isClipped: !!existingClip,
        clipId: existingClip?.id,
      });
    });
  }, [clips, pageNumber]);

  // 2. 原文区域（左侧 PDF）单向划词监听
  const handlePdfSelection = useCallback(() => {
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        return;
      }

      const raw = selection.toString();
      const enText = raw.trim();
      if (!isValidClippedText(enText)) {
        return;
      }

      const range = selection.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        const rects = range.getClientRects();
        if (rects.length > 0) rect = rects[0];
      }
      if (rect.width === 0 && rect.height === 0) return;

      const { top, left, placement } = calculateToolbarPlacement(rect);
      const existingClip = clips.find(c => c.pageNumber === pageNumber && c.text.trim() === enText);

      setFloatingToolbar({
        visible: true,
        top,
        left,
        text: enText,
        placement,
        isClipped: !!existingClip,
        clipId: existingClip?.id,
      });
    });
  }, [clips, pageNumber]);

  // 3. 全局点击与选区折叠监听
  useEffect(() => {
    const PROTECTED_SELECTOR =
      '[data-interactive-protected="true"], [data-clip-interactive="true"], button, input, textarea';

    const handleGlobalMouseUp = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null;
      if (target?.closest(PROTECTED_SELECTOR)) return;

      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        const selection = window.getSelection();
        setFloatingToolbar(prev => {
          if (prev?.isClipped) return prev;
          if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return null;
          }
          return prev;
        });
      }, 80);
    };

    const handleScroll = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-interactive-protected="true"]')) return;
      setFloatingToolbar(null);
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  // 4. 划词触发右侧伴读解析流式输出（非遮挡侧栏）
  const handleOpenExplain = async () => {
    if (!floatingToolbar || !floatingToolbar.text) return;
    const textToExplain = floatingToolbar.text;
    setFloatingToolbar(null);
    window.getSelection()?.removeAllRanges();

    const nextPages = isExplainPanelVisible
      ? Array.from(new Set([...contextPages, pageNumber])).sort((a, b) => a - b)
      : [pageNumber];

    setContextPagesState(nextPages);
    setExplainTargetText(textToExplain);
    setExplainTargetPage(pageNumber);
    setExplainResultText('');
    setExplainHistory([]);
    onActivateExplainTab?.();

    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    setIsExplainLoading(true);

    try {
      const contextPrompt = await assembleMultiPageContext(nextPages, textToExplain);
      const response = await executeExplainStream({
        selectedText: textToExplain,
        contextText: contextPrompt,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readErrorResponse(response, 'AI 伴读服务请求失败'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let currentOutput = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          currentOutput += decoder.decode(value, { stream: true });
          setExplainResultText(currentOutput);
        }
      }
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') return;
      console.error(err);
      setExplainResultText(`解析请求失败：${errorMessage(err)}`);
    } finally {
      if (explainAbortRef.current === controller) {
        explainAbortRef.current = null;
        setIsExplainLoading(false);
      }
    }
  };

  // 5. 多轮追问或无划词直接跨页提问
  const handleSendFollowUp = async (overrideQuestion?: string) => {
    const rawQuestion = overrideQuestion !== undefined ? overrideQuestion : explainFollowUpInput;
    const question = rawQuestion.trim();
    if (!question || isExplainLoading) return;
    if (overrideQuestion === undefined) {
      setExplainFollowUpInput('');
    }

    explainAbortRef.current?.abort();
    const controller = new AbortController();
    explainAbortRef.current = controller;
    setIsExplainLoading(true);

    const priorHistory: ExplainHistoryItem[] = [
      ...explainHistory,
      ...(explainResultText && explainHistory.length === 0
        ? [{ role: 'assistant' as const, content: explainResultText }]
        : []),
    ];
    const newHistory: ExplainHistoryItem[] = [...priorHistory, { role: 'user', content: question }];
    setExplainHistory(newHistory);

    try {
      const contextPrompt = await assembleMultiPageContext(contextPages, explainTargetText || undefined);
      const response = await executeExplainStream({
        selectedText: explainTargetText,
        contextText: contextPrompt,
        question,
        history: priorHistory,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readErrorResponse(response, '伴读回答请求异常'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let aiResponse = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          aiResponse += decoder.decode(value, { stream: true });
          setExplainHistory([...newHistory, { role: 'assistant', content: aiResponse }]);
        }
      }
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') return;
      console.error(err);
      setExplainHistory([...newHistory, { role: 'assistant', content: `回答出错：${errorMessage(err)}` }]);
    } finally {
      if (explainAbortRef.current === controller) {
        explainAbortRef.current = null;
        setIsExplainLoading(false);
      }
    }
  };

  return {
    floatingToolbar,
    setFloatingToolbar,
    handleMarkdownSelection,
    handlePdfSelection,
    contextPages,
    setContextPages,
    toggleContextPage,
    removeContextPage,
    resetContextToCurrentPage,
    includeCurrentPageInContext,
    pageTurnBanner,
    dismissPageTurnBanner,
    explainTargetText,
    explainTargetPage,
    clearExplainSelection,
    explainResultText,
    isExplainLoading,
    explainHistory,
    explainFollowUpInput,
    setExplainFollowUpInput,
    handleOpenExplain,
    handleSendFollowUp,
  };
}
