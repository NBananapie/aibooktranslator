"use client";

import React from 'react';
import styles from '@/app/page.module.css';
import {
  ArrowLeft,
  Sun,
  Moon,
  Minimize2,
  Maximize2,
  ScanText,
  BookOpen,
  Download,
  Zap,
  BookCheck,
  Layers,
  Loader2,
  RotateCw,
} from 'lucide-react';

export interface MarkdownHeaderProps {
  isImmersive: boolean;
  viewMode: 'translation' | 'ocr_source';
  isTranslating: boolean;
  isOcrLoading: boolean;
  hasCachedTranslation: boolean;
  hasOcrCache: boolean;
  theme: 'light' | 'dark';
  fullWidthReading: boolean;
  fileAvailable: boolean;
  hasAnyTranslationCache: boolean;
  autoTranslate: boolean;
  isPreTranslating: boolean;
  isNextPageCached: boolean;
  canPreTranslate: boolean;
  hasTranslatedText: boolean;
  onBackHome: () => void;
  onSetViewMode: (mode: 'translation' | 'ocr_source') => void;
  onToggleTheme: () => void;
  onToggleFullWidthReading: () => void;
  onRunOcr: () => void;
  onToggleImmersive: () => void;
  onDownloadMarkdown: () => void;
  onToggleAutoTranslate: () => void;
  onPreTranslate: () => void;
  onTranslateCurrentPage: () => void;
}

export function MarkdownHeader({
  isImmersive,
  viewMode,
  isTranslating,
  isOcrLoading,
  hasCachedTranslation,
  hasOcrCache,
  theme,
  fullWidthReading,
  fileAvailable,
  hasAnyTranslationCache,
  autoTranslate,
  isPreTranslating,
  isNextPageCached,
  canPreTranslate,
  hasTranslatedText,
  onBackHome,
  onSetViewMode,
  onToggleTheme,
  onToggleFullWidthReading,
  onRunOcr,
  onToggleImmersive,
  onDownloadMarkdown,
  onToggleAutoTranslate,
  onPreTranslate,
  onTranslateCurrentPage,
}: MarkdownHeaderProps) {
  return (
    <div className={styles.header}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isImmersive && (
          <button className={styles.topNavIconBtn} onClick={onBackHome} data-tooltip="返回首页">
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 style={{ fontSize: '13.5px' }}>
          {viewMode === 'translation' ? 'AI 译文' : 'OCR 原文'}
          {isTranslating ? (
            <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>
              <Zap size={10} style={{ display: 'inline', marginRight: '2px' }} /> 生成中
            </span>
          ) : isOcrLoading ? (
            <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>
              <ScanText size={10} style={{ display: 'inline', marginRight: '2px' }} /> 识别中
            </span>
          ) : hasCachedTranslation ? (
            <span className={styles.badge} style={{ marginLeft: '4px', fontSize: '10px' }}>已就绪</span>
          ) : null}
        </h2>

        {hasOcrCache && (
          <div style={{ display: 'flex', gap: '3px', marginLeft: '4px' }}>
            <button
              type="button"
              className={`${styles.presetBtn} ${viewMode === 'translation' ? styles.presetBtnActive : ''}`}
              style={{ padding: '2px 6px', fontSize: '10px' }}
              onClick={() => onSetViewMode('translation')}
            >
              译文
            </button>
            <button
              type="button"
              className={`${styles.presetBtn} ${viewMode === 'ocr_source' ? styles.presetBtnActive : ''}`}
              style={{ padding: '2px 6px', fontSize: '10px' }}
              onClick={() => onSetViewMode('ocr_source')}
            >
              OCR
            </button>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.topNavIconBtn}
          onClick={onToggleTheme}
          data-tooltip={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {isImmersive && (
          <button
            type="button"
            className={styles.topNavIconBtn}
            onClick={onToggleFullWidthReading}
            data-tooltip={fullWidthReading ? '切换居中阅读' : '切换铺满全宽'}
          >
            {fullWidthReading ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}

        <button
          type="button"
          className={`${styles.topNavIconBtn} ${isOcrLoading ? styles.topNavIconBtnActive : ''}`}
          onClick={onRunOcr}
          disabled={!fileAvailable || isOcrLoading}
          data-tooltip="百度飞桨 PaddleOCR 结构识别"
        >
          <ScanText size={15} />
        </button>

        <button
          type="button"
          className={`${styles.topNavIconBtn} ${isImmersive ? styles.topNavIconBtnActive : ''}`}
          onClick={onToggleImmersive}
          data-tooltip={isImmersive ? '退出沉浸模式' : '进入沉浸阅读模式'}
        >
          <BookOpen size={15} />
        </button>

        <button
          type="button"
          className={styles.topNavIconBtn}
          onClick={onDownloadMarkdown}
          disabled={!hasAnyTranslationCache}
          data-tooltip="导出已翻译 Markdown"
        >
          <Download size={15} />
        </button>

        <button
          type="button"
          className={`${styles.topNavIconBtn} ${autoTranslate ? styles.topNavIconBtnActive : ''}`}
          onClick={onToggleAutoTranslate}
          data-tooltip={autoTranslate ? '自动翻译: 已开启' : '自动翻译: 已关闭 (点击开启)'}
        >
          <Zap size={15} />
        </button>

        <button
          type="button"
          className={`${styles.topNavIconBtn} ${
            isPreTranslating
              ? styles.topNavIconBtnPreloading
              : isNextPageCached
              ? styles.topNavIconBtnCached
              : ''
          }`}
          onClick={onPreTranslate}
          disabled={isPreTranslating}
          data-tooltip={
            isPreTranslating
              ? '正在流水线预读后续多页翻译...'
              : isNextPageCached
              ? '下一页已就绪（点击继续预读后续章节）'
              : '流水线预加载后续多页翻译'
          }
        >
          {isPreTranslating ? (
            <Loader2 size={15} className={styles.spinAnim} />
          ) : isNextPageCached ? (
            <BookCheck size={15} />
          ) : (
            <Layers size={15} />
          )}
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.topNavIconBtnActive}`}
          style={{ width: '32px', height: '32px', padding: 0 }}
          onClick={onTranslateCurrentPage}
          disabled={!fileAvailable || isTranslating || isOcrLoading}
          data-tooltip={isTranslating ? '正在流式生成中...' : hasTranslatedText ? '重新翻译当前页' : '翻译此页'}
        >
          <RotateCw size={14} className={isTranslating ? styles.spinAnim : ''} />
        </button>
      </div>
    </div>
  );
}
