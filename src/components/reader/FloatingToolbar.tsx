"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import { FloatingToolbarState } from '@/hooks/useTextSelection';
import { BookmarkPlus, Check, Copy, Sparkles } from 'lucide-react';

export interface FloatingToolbarProps {
  toolbar: FloatingToolbarState | null;
  onAddOrRemoveClip: () => void;
  onOpenExplain: () => void;
  onCopy: () => void;
}

export function FloatingToolbar({
  toolbar,
  onAddOrRemoveClip,
  onOpenExplain,
  onCopy,
}: FloatingToolbarProps) {
  const [copied, setCopied] = React.useState(false);

  if (!toolbar || !toolbar.visible) return null;

  const handleCopyClick = () => {
    try {
      onCopy();
    } catch (e) {
      console.error(e);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      data-interactive-protected="true"
      className={styles.floatingToolbar}
      style={{
        top: `${toolbar.top}px`,
        left: `${toolbar.left}px`,
        transform: toolbar.placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        marginTop: toolbar.placement === 'bottom' ? '10px' : '-10px',
      }}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        className={`${styles.capsuleBtn} ${styles.capsuleBtnPrimary}`}
        onClick={onAddOrRemoveClip}
      >
        {toolbar.isClipped ? <Check size={13} /> : <BookmarkPlus size={13} />}
        <span>{toolbar.isClipped ? '已剪藏' : '剪藏'}</span>
      </button>
      <button type="button" className={styles.capsuleBtn} onClick={onOpenExplain}>
        <Sparkles size={13} />
        <span>解释</span>
      </button>
      <button type="button" className={styles.capsuleBtn} onClick={handleCopyClick}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
    </div>
  );
}
