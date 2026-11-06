"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { AppSettings } from '@/context/AppContext';
import { ClipItem } from '@/lib/db';
import { executeExplainStream } from '@/lib/llmClient';
import { readErrorResponse } from '@/lib/llm/protocol';
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
  // 必须包含至少一个字或字母/数字，防止选中纯空白或纯换行
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(trimmed)) {
    return false;
  }
  return true;
}

export interface ExplainHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseTextSelectionOptions {
  displayedText: string;
  settings: AppSettings;
  clips: ClipItem[];
  pageNumber: number;
  /** 当前页原文段落，用于给划词解释提供所在段落的上下文 */
  sourceBlocks?: SourceBlock[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 计算悬浮微岛的最佳像素坐标与方向
 */
function calculateToolbarPlacement(rect: DOMRect): { top: number; left: number; placement: 'top' | 'bottom' } {
  // 视口避让：若选区顶部距离视口顶端小于 65px，改在选区下方弹出
  const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
  const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;

  // 水平视口边界保护（以微岛宽度 220px 为准，半宽 110px）
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
  } = options;

  // 悬浮微岛胶囊状态
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null);

  // AI 深度伴读解释弹窗状态
  const [isExplainModalOpen, setIsExplainModalOpen] = useState<boolean>(false);
  const [explainTargetText, setExplainTargetText] = useState<string>('');
  const [explainResultText, setExplainResultText] = useState<string>('');
  const [isExplainLoading, setIsExplainLoading] = useState<boolean>(false);
  const [explainHistory, setExplainHistory] = useState<ExplainHistoryItem[]>([]);
  const [explainFollowUpInput, setExplainFollowUpInput] = useState<string>('');
  const [showFollowUpInput, setShowFollowUpInput] = useState<boolean>(false);

  // 划选判定安全锁与延时引用
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. 译文区域（右侧 Markdown）单向划词监听
  const handleMarkdownSelection = useCallback(() => {
    // 使用 requestAnimationFrame 确保读取到浏览器已完全确认的稳定 Range
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

      // 精准匹配当页已剪藏记录
      const existingClip = clips.find(
        c => c.pageNumber === pageNumber && c.text.trim() === text
      );

      // 单向选中：只弹出当前选区的微岛，不触发任何跨屏高亮或滚动
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

      const existingClip = clips.find(
        c => c.pageNumber === pageNumber && c.text.trim() === enText
      );

      // 单向选中：只弹出当前选区的微岛，绝不联动右侧译文高亮或滚动
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
    /** 浮动工具栏、剪藏标记、弹窗、抽屉以及表单控件内的点击不关闭工具栏（均用 data 属性或元素类型判断） */
    const PROTECTED_SELECTOR =
      '[data-interactive-protected="true"], [data-clip-interactive="true"], button, input, textarea';

    const handleGlobalMouseUp = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : e.target instanceof Node ? e.target.parentElement : null;
      if (target?.closest(PROTECTED_SELECTOR)) return;

      // 延迟 80ms 检查选区状态：仅在非剪藏触发的选区真正折叠时关闭浮窗
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        const selection = window.getSelection();
        setFloatingToolbar(prev => {
          // 针对已剪藏条目显示的工具栏保持显示，直到显式关闭
          if (prev?.isClipped) return prev;
          if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return null;
          }
          return prev;
        });
      }, 80);
    };

    // 页面滚动时关闭工具栏，避免位置错位；弹窗或抽屉内部滚动除外
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

  // 4. 打开深度伴读弹窗并流式生成解析
  const handleOpenExplain = async () => {
    if (!floatingToolbar || !floatingToolbar.text) return;
    const textToExplain = floatingToolbar.text;
    setFloatingToolbar(null);
    setExplainTargetText(textToExplain);
    setExplainResultText('');
    setExplainHistory([]);
    setShowFollowUpInput(false);
    setIsExplainModalOpen(true);
    setIsExplainLoading(true);

    try {
      // 尝试根据原文段落块提取精准上下文作为背景辅助
      const matchedBlock = sourceBlocks.find(sb =>
        sb.text.toLowerCase().includes(textToExplain.toLowerCase())
      );
      const contextPrompt = matchedBlock
        ? `【所属段落上下文】\n${matchedBlock.text}\n\n【页面完整翻译】\n${displayedText || ''}`
        : displayedText || '';

      const response = await executeExplainStream({
        selectedText: textToExplain,
        contextText: contextPrompt,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readErrorResponse(response, 'AI 解释服务请求失败'));
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
      console.error(err);
      setExplainResultText(`解析失败: ${errorMessage(err)}`);
    } finally {
      setIsExplainLoading(false);
    }
  };

  // 5. 伴读学者多轮追问
  const handleSendFollowUp = async () => {
    if (!explainFollowUpInput.trim() || isExplainLoading) return;
    const question = explainFollowUpInput.trim();
    setExplainFollowUpInput('');
    setIsExplainLoading(true);

    const newHistory: ExplainHistoryItem[] = [
      ...explainHistory,
      ...(explainResultText && explainHistory.length === 0
        ? [{ role: 'assistant' as const, content: explainResultText }]
        : []),
      { role: 'user' as const, content: question },
    ];
    setExplainHistory(newHistory);

    try {
      const response = await executeExplainStream({
        selectedText: explainTargetText,
        contextText: displayedText || '',
        question,
        history: newHistory,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        provider: settings.provider,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readErrorResponse(response, '追问请求响应异常'));
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
      console.error(err);
      setExplainHistory([
        ...newHistory,
        { role: 'assistant', content: `追问回答出错: ${errorMessage(err)}` },
      ]);
    } finally {
      setIsExplainLoading(false);
    }
  };

  const closeExplainModal = () => setIsExplainModalOpen(false);

  return {
    floatingToolbar,
    setFloatingToolbar,
    handleMarkdownSelection,
    handlePdfSelection,
    isExplainModalOpen,
    setIsExplainModalOpen,
    explainTargetText,
    explainResultText,
    isExplainLoading,
    explainHistory,
    explainFollowUpInput,
    setExplainFollowUpInput,
    showFollowUpInput,
    setShowFollowUpInput,
    handleOpenExplain,
    handleSendFollowUp,
    closeExplainModal,
  };
}
