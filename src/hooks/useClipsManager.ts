"use client";

import { useState, useRef, useEffect } from 'react';
import { ClipItem, addHistoryClip, deleteHistoryClip } from '@/lib/db';
import { exportClipsAsMarkdown, formatClipsForClipboard } from '@/services/exportService';
import { isValidClippedText } from './useTextSelection';
import styles from '@/app/page.module.css';

export interface UseClipsManagerOptions {
  activeFileId: string | null;
  initialClips?: ClipItem[];
  file?: File | null;
  onClipsChange?: (clips: ClipItem[]) => void;
}

export function useClipsManager(options: UseClipsManagerOptions) {
  const { activeFileId, initialClips, file, onClipsChange } = options;

  // 自动过滤历史中的纯标点脏数据
  const [clips, setClips] = useState<ClipItem[]>(() =>
    (initialClips || []).filter(c => isValidClippedText(c.text))
  );

  // 监听 initialClips（异步从 IndexedDB 或云端加载后响应式更新）
  useEffect(() => {
    if (initialClips === undefined) return;
    const valid = initialClips.filter(c => isValidClippedText(c.text));
    setClips(prev => {
      if (prev.length === valid.length && prev.every((item, i) => item.id === valid[i]?.id)) {
        return prev;
      }
      return valid;
    });
  }, [initialClips]);
  const [isClipsDrawerOpen, setIsClipsDrawerOpen] = useState<boolean>(false);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);

  // 飞行微动效状态
  const [ghostFlyStyle, setGhostFlyStyle] = useState<React.CSSProperties | null>(null);
  const [ghostFlyText, setGhostFlyText] = useState<string>('');

  // 1. 触发飞行微动效并持久化剪藏
  const addClip = async (
    textToClip: string,
    pageNumber: number,
    startBoundingRect?: { top: number; left: number; width?: number; height?: number }
  ): Promise<ClipItem | undefined> => {
    // 严格有效性校验：纯标点或空白绝对禁止入库
    if (!isValidClippedText(textToClip) || !activeFileId) return;

    const startRect = startBoundingRect || {
      top: window.innerHeight / 2,
      left: window.innerWidth / 2,
      width: 120,
      height: 30,
    };

    const startW = Math.min(240, Math.max(100, startRect.width || 120));
    const startH = startRect.height || 30;

    // 动态计算目标中心点坐标（侧边栏打开时飞入抽屉顶部列表，收起时飞入折叠小把手）
    let targetX: number;
    let targetY: number;

    if (isClipsDrawerOpen) {
      targetX = window.innerWidth - 160;
      targetY = 90;
    } else {
      const btnRect = toggleBtnRef.current?.getBoundingClientRect();
      if (btnRect) {
        targetX = btnRect.left + btnRect.width / 2;
        targetY = btnRect.top + btnRect.height / 2;
      } else {
        targetX = window.innerWidth - 15;
        targetY = window.innerHeight / 2;
      }
    }

    const deltaX = targetX - (startRect.left + startW / 2);
    const deltaY = targetY - (startRect.top + startH / 2);

    setGhostFlyText(textToClip.slice(0, 26) + (textToClip.length > 26 ? '...' : ''));
    setGhostFlyStyle({
      top: `${startRect.top}px`,
      left: `${startRect.left}px`,
      width: `${startW}px`,
      ['--delta-x' as any]: `${deltaX}px`,
      ['--delta-y' as any]: `${deltaY}px`,
    });

    setTimeout(() => {
      setGhostFlyStyle(null);
      setGhostFlyText('');

      // 落地吸收瞬间，触发侧边栏小把手的物理吸入共振冲击波
      const btn = toggleBtnRef.current;
      if (btn) {
        btn.classList.remove(styles.toggleBtnAbsorbPulse);
        void btn.offsetWidth; // 触发 reflow 重新触发关键帧
        btn.classList.add(styles.toggleBtnAbsorbPulse);
        setTimeout(() => {
          btn.classList.remove(styles.toggleBtnAbsorbPulse);
        }, 550);
      }
    }, 650);

    const newClip: ClipItem = {
      id: crypto.randomUUID(),
      pageNumber,
      text: textToClip,
      sourceText: `第 ${pageNumber} 页书摘`,
      createdAt: Date.now(),
    };

    await addHistoryClip(activeFileId, newClip);
    const nextClips = [newClip, ...clips.filter(c => c.id !== newClip.id)];
    setClips(nextClips);
    onClipsChange?.(nextClips);
    return newClip;
  };

  // 2. 删除剪藏
  const deleteClip = async (clipId: string) => {
    if (!activeFileId) return;
    await deleteHistoryClip(activeFileId, clipId);
    const nextClips = clips.filter(c => c.id !== clipId);
    setClips(nextClips);
    onClipsChange?.(nextClips);
  };

  // 3. 复制单条剪藏
  const copyClip = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(err => console.error('Copy failed', err));
    }
  };

  // 4. 复制全部剪藏
  const copyAllClips = () => {
    if (clips.length === 0) return;
    const content = formatClipsForClipboard(clips);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).catch(err => console.error('Copy failed', err));
    }
  };

  // 5. 导出剪藏为 Markdown 文件
  const exportClips = () => {
    if (clips.length === 0 || !file) return;
    exportClipsAsMarkdown({ filename: file.name, clips });
  };

  // 6. 切换抽屉状态
  const toggleClipsDrawer = () => setIsClipsDrawerOpen(prev => !prev);

  return {
    clips,
    setClips,
    isClipsDrawerOpen,
    setIsClipsDrawerOpen,
    toggleClipsDrawer,
    toggleBtnRef,
    ghostFlyStyle,
    ghostFlyText,
    addClip,
    deleteClip,
    copyClip,
    copyAllClips,
    exportClips,
  };
}
