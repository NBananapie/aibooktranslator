"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import { ClipItem } from '@/lib/db';
import { isValidClippedText } from '@/hooks/useTextSelection';
import {
  BookmarkCheck,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';

export interface ClipsDrawerProps {
  clips: ClipItem[];
  isOpen: boolean;
  toggleBtnRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onCopyAll: () => void;
  onExportMarkdown: () => void;
  onJumpToPage: (page: number, text: string) => void;
  onCopyClip: (text: string) => void;
  onDeleteClip: (id: string) => void;
}

export function ClipsDrawer({
  clips,
  isOpen,
  toggleBtnRef,
  onToggle,
  onClose,
  onCopyAll,
  onExportMarkdown,
  onJumpToPage,
  onCopyClip,
  onDeleteClip,
}: ClipsDrawerProps) {
  const validClips = clips.filter(c => isValidClippedText(c.text));

  return (
    <>
      {/* 小三角伸缩手柄 */}
      <button
        ref={toggleBtnRef}
        type="button"
        className={`${styles.clipsSidebarToggle} ${isOpen ? styles.clipsSidebarToggleActive : ''}`}
        onClick={onToggle}
        data-tooltip={isOpen ? '收起剪藏栏' : '展开剪藏侧栏'}
      >
        {isOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        <span className={styles.clipsBadgeMini}>{validClips.length}</span>
      </button>

      {/* 平级并排剪藏栏 */}
      <div className={`${styles.inlineClipsSidebar} ${!isOpen ? styles.inlineClipsSidebarClosed : ''}`}>
        <div className={styles.clipsHeader}>
          <h3 style={{ fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BookmarkCheck size={16} style={{ color: 'var(--primary)' }} /> 本书剪藏 ({validClips.length})
          </h3>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className={styles.topNavIconBtn}
              style={{ width: '26px', height: '26px' }}
              onClick={onCopyAll}
              disabled={validClips.length === 0}
              data-tooltip="一键复制全部剪藏"
            >
              <Copy size={12} />
            </button>
            <button
              className={styles.topNavIconBtn}
              style={{ width: '26px', height: '26px' }}
              onClick={onExportMarkdown}
              disabled={validClips.length === 0}
              data-tooltip="导出为 Markdown 书摘"
            >
              <Download size={12} />
            </button>
            <button
              className={styles.topNavIconBtn}
              style={{ width: '26px', height: '26px' }}
              onClick={onClose}
              data-tooltip="收起剪藏栏"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className={styles.clipsList}>
          {validClips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <BookmarkPlus size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
              <p>暂无剪藏内容</p>
              <p style={{ fontSize: '11.5px', marginTop: '6px' }}>在译文中划词选中文字，点击【剪藏】即可收录</p>
            </div>
          ) : (
            validClips.map(clip => (
              <div key={clip.id} className={styles.clipCard} style={{ padding: '12px' }}>
                <div className={styles.clipMeta}>
                  <span
                    style={{
                      cursor: 'pointer',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      fontSize: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                    onClick={() => onJumpToPage(clip.pageNumber, clip.text)}
                    data-tooltip={`跳转至第 ${clip.pageNumber} 页`}
                  >
                    第 {clip.pageNumber} 页 <ExternalLink size={11} />
                  </span>
                  <span style={{ fontSize: '10.5px' }}>{new Date(clip.createdAt).toLocaleDateString()}</span>
                </div>
                <p className={styles.clipContent} style={{ fontSize: '12.5px', lineHeight: '1.65' }}>
                  {clip.text}
                </p>
                <div className={styles.clipActions}>
                  <button
                    className={styles.btnSecondary}
                    style={{ padding: '2px 6px', fontSize: '10.5px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    onClick={() => onCopyClip(clip.text)}
                    data-tooltip="复制此段"
                  >
                    <Copy size={11} /> 复制
                  </button>
                  <button
                    className={styles.btnSecondary}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10.5px',
                      color: 'var(--accent-rose)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                    onClick={() => onDeleteClip(clip.id)}
                    data-tooltip="删除此条剪藏"
                  >
                    <Trash2 size={11} /> 删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
