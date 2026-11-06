"use client";

import { useState, useRef, useEffect, useCallback, startTransition } from 'react';
import { ClipItem, activeClips, addHistoryClip, deleteHistoryClip } from '@/lib/db';
import { exportClipsAsMarkdown, formatClipsForClipboard } from '@/services/exportService';
import { isValidClippedText } from './useTextSelection';
import styles from '@/app/page.module.css';
import { FlightPayload } from '@/components/reader/ClipFlightCanvas';

export interface UseClipsManagerOptions {
  fileId: string | null;
  /** 当前未删除的剪藏（来自 IndexedDB 或云端合并后的记录） */
  initialClips?: ClipItem[];
  file?: File | null;
  /** 本地写入后回调，参数为记录中的全部剪藏（含删除墓碑） */
  onClipsChange?: (allClips: ClipItem[]) => void;
}

function sameIds(a: ClipItem[], b: ClipItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item.id === b[i]?.id);
}

export function useClipsManager(options: UseClipsManagerOptions) {
  const { fileId, initialClips, file, onClipsChange } = options;

  // 过滤纯标点等无效历史数据
  const [clips, setClips] = useState<ClipItem[]>(() =>
    (initialClips || []).filter(c => isValidClippedText(c.text))
  );

  // 记录异步加载或云端合并后同步到本地状态（渲染期间按 id 比较后更新，避免多余的 effect）
  const [prevInitialClips, setPrevInitialClips] = useState(initialClips);
  if (initialClips !== prevInitialClips) {
    setPrevInitialClips(initialClips);
    const valid = (initialClips || []).filter(c => isValidClippedText(c.text));
    if (!sameIds(clips, valid)) setClips(valid);
  }

  const [isClipsDrawerOpen, setIsClipsDrawerOpen] = useState<boolean>(false);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);
  const absorbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 剪藏飞行动画载荷
  const [flightPayload, setFlightPayload] = useState<FlightPayload | null>(null);

  useEffect(() => {
    return () => {
      if (absorbTimerRef.current) clearTimeout(absorbTimerRef.current);
    };
  }, []);

  // 动画落地时，侧边栏把手播放吸入脉冲
  const handleAbsorb = useCallback(() => {
    const btn = toggleBtnRef.current;
    if (!btn) return;
    btn.classList.remove(styles.toggleBtnAbsorbPulse);
    void btn.offsetWidth;
    btn.classList.add(styles.toggleBtnAbsorbPulse);
    if (absorbTimerRef.current) clearTimeout(absorbTimerRef.current);
    absorbTimerRef.current = setTimeout(() => {
      btn.classList.remove(styles.toggleBtnAbsorbPulse);
    }, 550);
  }, []);

  const handleFlightComplete = useCallback(() => {
    setFlightPayload(null);
  }, []);

  const applyRecordClips = (allClips: ClipItem[] | undefined) => {
    if (!allClips) return;
    const visible = activeClips(allClips).filter(c => isValidClippedText(c.text));
    // 降低重渲染优先级，避免阻塞飞行动画
    startTransition(() => {
      setClips(visible);
      onClipsChange?.(allClips);
    });
  };

  // 1. 播放飞行动画并持久化剪藏
  const addClip = async (
    textToClip: string,
    pageNumber: number,
    startBoundingRect?: { top: number; left: number; width?: number; height?: number }
  ): Promise<ClipItem | undefined> => {
    if (!isValidClippedText(textToClip) || !fileId) return;

    const startRect = startBoundingRect || {
      top: window.innerHeight / 2,
      left: window.innerWidth / 2,
      width: 140,
      height: 32,
    };

    const startX = startRect.left + (startRect.width || 120) / 2;
    const startY = startRect.top + (startRect.height || 32) / 2;

    // 抽屉打开时飞向抽屉顶部列表，收起时飞向折叠把手
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

    setFlightPayload({ startX, startY, targetX, targetY, text: textToClip });

    const now = Date.now();
    const newClip: ClipItem = {
      id: crypto.randomUUID(),
      pageNumber,
      text: textToClip,
      sourceText: `第 ${pageNumber} 页书摘`,
      createdAt: now,
      updatedAt: now,
    };

    const updated = await addHistoryClip(fileId, newClip);
    applyRecordClips(updated?.clips);
    return newClip;
  };

  // 2. 删除剪藏（本地保留墓碑以便同步删除）
  const deleteClip = async (clipId: string) => {
    if (!fileId) return;
    const updated = await deleteHistoryClip(fileId, clipId);
    applyRecordClips(updated?.clips);
  };

  // 3. 复制单条剪藏
  const copyClip = (text: string) => {
    navigator.clipboard?.writeText(text).catch(err => console.error('Copy failed', err));
  };

  // 4. 复制全部剪藏
  const copyAllClips = () => {
    if (clips.length === 0) return;
    navigator.clipboard?.writeText(formatClipsForClipboard(clips)).catch(err => console.error('Copy failed', err));
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
    isClipsDrawerOpen,
    setIsClipsDrawerOpen,
    toggleClipsDrawer,
    toggleBtnRef,
    flightPayload,
    handleAbsorb,
    handleFlightComplete,
    addClip,
    deleteClip,
    copyClip,
    copyAllClips,
    exportClips,
  };
}
