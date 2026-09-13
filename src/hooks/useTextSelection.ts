"use client";

import { useState, useRef, useEffect } from 'react';
import { AppSettings } from '@/context/AppContext';
import { ClipItem } from '@/lib/db';
import { executeExplainStream } from '@/lib/llmClient';

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
 * 校验剪藏文本的语义有效性：
 * 1. 非空且去除首尾空白
 * 2. 长度至少大于等于 2 字符 (防止单一标点或字符误触)
 * 3. 必须包含实质性的汉字、英文字母或数字，排除纯标点符号
 */
export function isValidClippedText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(trimmed)) {
    return false;
  }
  const purePunctuationRegex = /^[，。！？、；：“”‘’（）《》【】…—～·\s\-.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=]+$/;
  if (purePunctuationRegex.test(trimmed)) {
    return false;
  }
  return true;
}

import { SourceBlock } from '@/services/layoutAnalysisEngine';
import { TargetBlock } from '@/services/alignmentEngine';

export interface ExplainHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseTextSelectionOptions {
  displayedText: string;
  settings: AppSettings;
  clips: ClipItem[];
  pageNumber: number;
  bilingualMapCache: Record<number, Array<{ zh: string; en: string }>>;
  onTriggerHighlightFromZh: (text: string, contextParagraph?: string, blockId?: string) => void;
  onTriggerHighlightFromEn: (text: string, hintBlockId?: string) => void;
  onClearHighlights: () => void;
  sourceBlocks?: SourceBlock[];
  targetBlocks?: TargetBlock[];
}

export function useTextSelection(options: UseTextSelectionOptions) {
  const {
    displayedText,
    settings,
    clips,
    pageNumber,
    bilingualMapCache,
    onTriggerHighlightFromZh,
    onTriggerHighlightFromEn,
    onClearHighlights,
    sourceBlocks = [],
    targetBlocks = [],
  } = options;

  // Floating Toolbar 状态
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null);

  // AI Explain Modal 状态
  const [isExplainModalOpen, setIsExplainModalOpen] = useState<boolean>(false);
  const [explainTargetText, setExplainTargetText] = useState<string>('');
  const [explainResultText, setExplainResultText] = useState<string>('');
  const [isExplainLoading, setIsExplainLoading] = useState<boolean>(false);
  const [explainHistory, setExplainHistory] = useState<ExplainHistoryItem[]>([]);
  const [explainFollowUpInput, setExplainFollowUpInput] = useState<string>('');
  const [showFollowUpInput, setShowFollowUpInput] = useState<boolean>(false);

  // 1. 划词选区监听与悬浮微岛工具栏 (右侧 Markdown 划选中文)
  const handleMarkdownSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    // 严格有效性校验：纯标点或过短选区坚决不触发微岛
    if (!isValidClippedText(text)) {
      setFloatingToolbar(null);
      return;
    }

    const anchorNode = selection.anchorNode;
    const cardEl =
      anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element).closest('[id^="target-"]')
        : anchorNode?.parentElement?.closest('[id^="target-"]');
    const blockId = cardEl?.id?.replace('target-', '') || undefined;

    const pEl =
      anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element).closest('p')
        : anchorNode?.parentElement?.closest('p');
    const contextParagraph = pEl?.textContent || '';

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 视口智能避让逻辑：若上方空间受限 (< 65px)，改为在选区下方弹出
    const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
    const top = placement === 'bottom' ? rect.bottom + 10 : rect.top;

    // 水平视口边界保护，防止超出左右可视范围
    const toolbarHalfWidth = 110;
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const rawLeft = rect.left + rect.width / 2;
    const left = Math.max(toolbarHalfWidth + 12, Math.min(screenW - toolbarHalfWidth - 12, rawLeft));

    // 严格精准匹配已有剪藏（排除包含关系的误报）
    const existingClip = clips.find(
      c => c.pageNumber === pageNumber && c.text.trim() === text.trim()
    );

    setFloatingToolbar({
      visible: true,
      top,
      left,
      text,
      placement,
      isClipped: !!existingClip,
      clipId: existingClip?.id,
    });

    onTriggerHighlightFromZh(text, contextParagraph, blockId);
  };

  // 2. 从左侧 PDF 划选英文文本，双向唤起微岛并反查高亮右侧中文译文
  const handlePdfSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    const enText = selection.toString().trim();

    if (!isValidClippedText(enText)) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
    const top = placement === 'bottom' ? rect.bottom + 10 : rect.top;

    const toolbarHalfWidth = 110;
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const rawLeft = rect.left + rect.width / 2;
    const left = Math.max(toolbarHalfWidth + 12, Math.min(screenW - toolbarHalfWidth - 12, rawLeft));

    const existingClip = clips.find(
      c => c.pageNumber === pageNumber && c.text.trim() === enText.trim()
    );

    setFloatingToolbar({
      visible: true,
      top,
      left,
      text: enText,
      placement,
      isClipped: !!existingClip,
      clipId: existingClip?.id,
    });

    // 寻找用户所在段落块 hintBlockId
    let hintBlockId: string | undefined = undefined;
    const cleanEn = enText.toLowerCase();

    // 1. 优先通过几何空间包含判定：检查 selection 中心点落在哪个 pdfBlockOverlay 内
    if (sourceBlocks.length > 0 && typeof document !== 'undefined') {
      const pdfWrapper = document.querySelector('[class*="pdfWrapper"]');
      if (pdfWrapper) {
        const selCenterY = rect.top + rect.height / 2;
        const selCenterX = rect.left + rect.width / 2;
        const overlays = Array.from(pdfWrapper.querySelectorAll('[class*="pdfBlockOverlay"]'));
        for (let i = 0; i < overlays.length && i < sourceBlocks.length; i++) {
          const oRect = overlays[i].getBoundingClientRect();
          if (
            selCenterY >= oRect.top - 8 &&
            selCenterY <= oRect.bottom + 8 &&
            selCenterX >= oRect.left - 15 &&
            selCenterX <= oRect.right + 15
          ) {
            hintBlockId = sourceBlocks[i].id;
            break;
          }
        }
      }
    }

    // 2. 回退策略：按包含关系检索，优先单词边界正则
    if (!hintBlockId) {
      const wordRegex = new RegExp(`\\b${cleanEn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const matchedSb = sourceBlocks.find(sb => wordRegex.test(sb.text));
      if (matchedSb) {
        hintBlockId = matchedSb.id;
      } else {
        const fallbackSb = sourceBlocks.find(sb => sb.text.toLowerCase().includes(cleanEn));
        if (fallbackSb) hintBlockId = fallbackSb.id;
      }
    }

    onTriggerHighlightFromEn(enText, hintBlockId);
  };

  // 3. 全局释放鼠标时检测是否取消选区
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : (e.target as any)?.parentElement || null;
      if (
        target && (
          target.closest('[data-interactive-protected="true"]') ||
          target.closest('[class*="floatingToolbar"]') ||
          target.closest('[class*="modal"]') ||
          target.closest('[class*="Drawer"]') ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('textarea')
        )
      ) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setFloatingToolbar(null);
        onClearHighlights();
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [onClearHighlights]);

  // 4. 打开深度伴读弹窗并流式生成首轮解析
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
      const matchedBlock = sourceBlocks?.find(sb =>
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
        throw new Error('AI 解释服务请求失败');
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
    } catch (err: any) {
      console.error(err);
      setExplainResultText(`解析失败: ${err.message || err}`);
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
        throw new Error('追问请求响应异常');
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
    } catch (err: any) {
      console.error(err);
      setExplainHistory([
        ...newHistory,
        { role: 'assistant', content: `追问回答出错: ${err.message || err}` },
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
