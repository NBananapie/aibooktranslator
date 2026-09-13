"use client";

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from '@/app/page.module.css';
import { MessageSquare, Sparkles, X } from 'lucide-react';

export interface ExplainModalProps {
  isOpen: boolean;
  targetText: string;
  resultText: string;
  isLoading: boolean;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  showFollowUpInput: boolean;
  followUpInput: string;
  onClose: () => void;
  onShowFollowUpInput: (show: boolean) => void;
  onFollowUpInputChange: (val: string) => void;
  onSendFollowUp: () => void;
}

export function ExplainModal({
  isOpen,
  targetText,
  resultText,
  isLoading,
  history,
  showFollowUpInput,
  followUpInput,
  onClose,
  onShowFollowUpInput,
  onFollowUpInputChange,
  onSendFollowUp,
}: ExplainModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.explainCardOverlay} onClick={onClose}>
      <div className={styles.explainCardModal} onClick={e => e.stopPropagation()}>
        <div className={styles.explainHeader}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={16} style={{ color: 'var(--primary)' }} /> AI 深度伴读解析
          </h3>
          <button className={styles.iconBtn} onClick={onClose} data-tooltip="关闭">
            <X size={15} />
          </button>
        </div>

        <div className={styles.explainBody}>
          <div className={styles.explainSelectionQuote}>
            “{targetText}”
          </div>

          {isLoading && !resultText && history.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--primary)', padding: '20px 0' }}>
              <div className={styles.spinner} style={{ width: '20px', height: '20px' }} />
              <span>正在结合上下文进行深度研读与背景解析...</span>
            </div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {resultText}
            </ReactMarkdown>
          )}

          {history.length > 0 && (
            <div className={styles.explainChatHistory}>
              {history.map((msg, idx) => (
                <div
                  key={idx}
                  className={msg.role === 'user' ? styles.explainChatMessageUser : styles.explainChatMessageAi}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.explainFooter}>
          {!showFollowUpInput ? (
            <button
              className={styles.btnSecondary}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => onShowFollowUpInput(true)}
            >
              <MessageSquare size={14} /> 深入追问与探讨...
            </button>
          ) : (
            <div className={styles.explainInputRow}>
              <input
                type="text"
                className={styles.explainInput}
                placeholder="输入您对该词句或概念的疑问..."
                value={followUpInput}
                onChange={e => onFollowUpInputChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSendFollowUp()}
                autoFocus
              />
              <button
                className={styles.btn}
                style={{ padding: '8px 14px', fontSize: '13px' }}
                onClick={onSendFollowUp}
                disabled={isLoading || !followUpInput.trim()}
              >
                {isLoading ? '生成中...' : '发送'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
