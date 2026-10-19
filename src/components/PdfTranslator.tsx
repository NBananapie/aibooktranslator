"use client";

import React, { useState, useCallback } from 'react';
import { pdfjs } from 'react-pdf';
import styles from '@/app/page.module.css';
import { useAppContext } from '@/context/AppContext';
import { useRouter } from 'next/navigation';
import { ClipItem } from '@/lib/db';
import { exportTranslationsAsMarkdown } from '@/services/exportService';
import { capturePageCanvasAsBase64, requestPaddleOcr } from '@/services/ocrService';
import { fetchBookFromCloud, mergeCloudDataIntoLocal, pushBookToCloud } from '@/services/cloudSyncService';
import { usePdfDocument } from '@/hooks/usePdfDocument';
import { useTranslator } from '@/hooks/useTranslator';
import { useBilingualSync } from '@/hooks/useBilingualSync';
import { useClipsManager } from '@/hooks/useClipsManager';
import { useTextSelection } from '@/hooks/useTextSelection';
import { PdfPane } from './reader/PdfPane';
import { MarkdownPane } from './reader/MarkdownPane';
import { FloatingToolbar } from './reader/FloatingToolbar';
import { ExplainModal } from './reader/ExplainModal';
import { ReaderOverlays } from './reader/ReaderOverlays';
import { SettingsModal } from './SettingsModal';
import { BookOpen, ArrowRight, X } from 'lucide-react';

export default function PdfTranslator() {
  const { settings, activeFileId, theme, toggleTheme, fontSize, setFontSize } = useAppContext();
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 1. PDF 视口与文档状态
  const {
    dbRecord,
    setDbRecord,
    file,
    numPages,
    pageNumber,
    setPageNumber,
    changePage,
    isEditingTitle,
    setIsEditingTitle,
    editTitleValue,
    setEditTitleValue,
    handleSaveTitle,
    leftPaneWidth,
    setLeftPaneWidth,
    isImmersive,
    toggleImmersive,
    setIsResizing,
    pdfRenderWidth,
    zoomScale,
    zoomIn,
    zoomOut,
    containerRef,
    leftPaneRef,
    pdfWrapperRef,
    onDocumentLoadSuccess,
    pdfDocument,
    resumePrompt,
    setResumePrompt,
  } = usePdfDocument({ activeFileId });

  // 断点续读提示横幅在 15 秒后自动淡出
  React.useEffect(() => {
    if (!resumePrompt) return;
    const timer = setTimeout(() => {
      setResumePrompt(null);
    }, 15000);
    return () => clearTimeout(timer);
  }, [resumePrompt, setResumePrompt]);

  // 自动从 Cloudflare D1 拉取云端最新翻译与剪藏数据
  React.useEffect(() => {
    if (!dbRecord?.fingerprint || !settings.syncKey?.trim() || settings.autoCloudSync === false) return;

    fetchBookFromCloud(settings.syncKey, dbRecord.fingerprint)
      .then(async cloudData => {
        if (cloudData) {
          const merged = await mergeCloudDataIntoLocal(dbRecord, cloudData);
          setDbRecord(merged);
        }
      })
      .catch(e => console.error('Cloud pull error', e));
  }, [dbRecord?.fingerprint, settings.syncKey, settings.autoCloudSync]);

  // 2. OCR 状态与视图切换
  const [ocrCache, setOcrCache] = useState<Record<number, string>>({});
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'translation' | 'ocr_source'>('translation');
  const [fullWidthReading, setFullWidthReading] = useState<boolean>(false);

  const captureCurrentPageImage = useCallback(async (): Promise<string> => {
    if (!pdfDocument && !file) throw new Error('PDF 尚未加载');
    let doc = pdfDocument;
    if (!doc && file) {
      const arrayBuffer = await file.arrayBuffer();
      doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    }
    const page = await doc.getPage(pageNumber);
    return capturePageCanvasAsBase64(page, 2.0);
  }, [pdfDocument, file, pageNumber]);

  const runOcrOnCurrentPage = useCallback(
    async (autoTranslateAfter = false) => {
      if ((!file && !pdfDocument) || isOcrLoading) return;
      const token = settings.ocr?.apiToken?.trim();
      if (!token) {
        alert('请先在首页「设置」中配置百度飞桨 AI Studio OCR Access Token。\n\n注册链接：https://aistudio.baidu.com/paddleocr');
        return;
      }

      setIsOcrLoading(true);
      setError('');
      try {
        const imageBase64 = await captureCurrentPageImage();
        const result = await requestPaddleOcr({
          imageBase64,
          apiToken: token,
          model: settings.ocr.model || 'PaddleOCR-VL-1.6',
          apiUrl: settings.ocr.apiUrl,
        });

        setOcrCache(prev => ({ ...prev, [pageNumber]: result.markdown }));

        if (autoTranslateAfter) {
          setViewMode('translation');
          await executeTranslateText(result.markdown, pageNumber);
        } else {
          setViewMode('ocr_source');
        }
      } catch (err: any) {
        console.error('OCR Error:', err);
        setError('OCR 识别失败: ' + (err.message || err));
      } finally {
        setIsOcrLoading(false);
      }
    },
    [file, pdfDocument, isOcrLoading, settings.ocr, captureCurrentPageImage]
  );

  // 3. 双语版面分析、几何度量与精准荧光高亮
  const {
    pdfOriginalView,
    sourceBlocks,
    hoveredBlockId,
    setHoveredBlockId,
    blockLayoutMetrics,
    syncScrollToBlock,
    bilingualMapCache,
    setBilingualMapCache,
    exactHighlightSpans,
    activeSentenceZh,
    activeSentenceBlockId,
    clearHighlights,
    triggerHighlightFromZh,
    triggerHighlightFromEn,
    pdfTextItems,
  } = useBilingualSync({
    file,
    pdfDocument,
    pageNumber,
    pdfRenderWidth,
    zoomScale,
    pdfWrapperRef,
  });

  // 4. 翻译引擎调度与预加载
  const {
    translatedText,
    displayedText,
    targetBlocks,
    fullTextRef,
    isTranslating,
    error,
    setError,
    autoTranslate,
    setAutoTranslate,
    isPreTranslating,
    preloadProgress,
    translationCache,
    translateCurrentPage,
    executeTranslateText,
    preTranslatePipeline,
  } = useTranslator({
    file,
    pdfDocument,
    pageNumber,
    numPages,
    settings,
    activeFileId,
    dbRecord,
    setDbRecord,
    sourceBlocks,
    onBilingualMapExtracted: (page, map) => {
      setBilingualMapCache(prev => ({ ...prev, [page]: map }));
    },
  });

  // 5. 知识剪藏库管理
  const handleClipsChange = useCallback(
    (nextClips: ClipItem[]) => {
      // 1. 同步更新 dbRecord 内存状态，防止后续被旧缓存覆写
      setDbRecord(prev => (prev ? { ...prev, clips: nextClips } : prev));

      // 2. 自动增量静默同步至 Cloudflare D1
      if (settings?.syncKey?.trim() && settings?.autoCloudSync !== false && dbRecord?.fingerprint) {
        pushBookToCloud(
          { ...dbRecord, clips: nextClips },
          settings.syncKey!,
          true,
          { clips: nextClips }
        ).catch(err => console.error('Auto cloud sync clips error', err));
      }
    },
    [dbRecord, settings.syncKey, settings.autoCloudSync, setDbRecord]
  );

  const {
    clips,
    isClipsDrawerOpen,
    setIsClipsDrawerOpen,
    toggleClipsDrawer,
    toggleBtnRef,
    flightPayload,
    handleAbsorb,
    handleFlightComplete,
    addClip,
    deleteClip: handleDeleteClip,
    copyClip: handleCopyClip,
    copyAllClips: handleCopyAllClips,
    exportClips: handleExportClipsMarkdown,
  } = useClipsManager({
    activeFileId,
    file,
    initialClips: dbRecord?.clips,
    onClipsChange: handleClipsChange,
  });

  // 6. 划词选区与伴读学者
  const {
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
  } = useTextSelection({
    displayedText,
    settings,
    clips,
    pageNumber,
    bilingualMapCache,
    onTriggerHighlightFromZh: (text, contextParagraph, blockId) =>
      triggerHighlightFromZh(text, contextParagraph, blockId, targetBlocks),
    onTriggerHighlightFromEn: (text, hintBlockId) =>
      triggerHighlightFromEn(text, hintBlockId, targetBlocks),
    onClearHighlights: clearHighlights,
    sourceBlocks,
    targetBlocks,
  });

  const handleAddClip = async () => {
    if (!floatingToolbar || !floatingToolbar.text || !activeFileId) return;
    const textToClip = floatingToolbar.text;

    if (floatingToolbar.isClipped && floatingToolbar.clipId) {
      await handleDeleteClip(floatingToolbar.clipId);
      setFloatingToolbar(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    const selection = window.getSelection();
    let startRect = { top: floatingToolbar.top, left: floatingToolbar.left - 60, width: 120, height: 30 };
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const r = selection.getRangeAt(0).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        startRect = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }

    // 立即关闭悬浮胶囊浮窗，避免其在页面残留悬停，并清空划选状态
    setFloatingToolbar(null);
    window.getSelection()?.removeAllRanges();

    await addClip(textToClip, pageNumber, startRect);
  };

  const handleClippedSpanClick = useCallback((e: React.MouseEvent, clip: ClipItem) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
    const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
    const toolbarHalfWidth = 110;
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const rawLeft = rect.left + rect.width / 2;
    const left = Math.max(toolbarHalfWidth + 12, Math.min(screenW - toolbarHalfWidth - 12, rawLeft));

    setFloatingToolbar({
      visible: true,
      top,
      left,
      text: clip.text,
      placement,
      isClipped: true,
      clipId: clip.id,
    });
  }, [setFloatingToolbar]);

  const downloadMarkdown = () => {
    if (!file || Object.keys(translationCache).length === 0) return;
    exportTranslationsAsMarkdown({ filename: file.name, translationCache });
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {/* 断点续读提示横幅 */}
      {resumePrompt && (
        <div className={styles.resumeBanner}>
          <div className={styles.resumeBannerText}>
            <BookOpen size={15} className={styles.resumeBannerIcon} />
            <span>检测到您上次阅读至第 <strong>{resumePrompt.page}</strong> 页{resumePrompt.totalPages ? ` (共 ${resumePrompt.totalPages} 页)` : ''}</span>
          </div>
          <div className={styles.resumeBannerActions}>
            <button
              type="button"
              className={styles.resumeJumpBtn}
              onClick={() => {
                setPageNumber(resumePrompt.page);
                setResumePrompt(null);
              }}
            >
              立即跳转 <ArrowRight size={13} />
            </button>
            <button
              type="button"
              className={styles.resumeDismissBtn}
              onClick={() => setResumePrompt(null)}
              data-tooltip="留在第 1 页"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <ReaderOverlays
        isLoadingFile={!file}
        flightPayload={flightPayload}
        onAbsorb={handleAbsorb}
        onFlightComplete={handleFlightComplete}
        isImmersive={isImmersive}
        pageNumber={pageNumber}
        numPages={numPages}
      />

      <FloatingToolbar
        toolbar={floatingToolbar}
        onAddOrRemoveClip={handleAddClip}
        onOpenExplain={handleOpenExplain}
        onCopy={() => {
          if (floatingToolbar?.text && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(floatingToolbar.text).catch(e => console.error(e));
          }
        }}
      />

      <PdfPane
        file={file}
        leftPaneRef={leftPaneRef}
        pdfWrapperRef={pdfWrapperRef}
        leftPaneWidth={leftPaneWidth}
        isImmersive={isImmersive}
        pdfRenderWidth={pdfRenderWidth}
        zoomScale={zoomScale}
        pageNumber={pageNumber}
        numPages={numPages}
        exactHighlightSpans={exactHighlightSpans}
        onDocumentLoadSuccess={onDocumentLoadSuccess}
        onPdfSelection={handlePdfSelection}
        fileName={file?.name}
        isEditingTitle={isEditingTitle}
        editTitleValue={editTitleValue}
        onStartEditTitle={() => {
          setEditTitleValue(file?.name || '');
          setIsEditingTitle(true);
        }}
        onTitleChange={setEditTitleValue}
        onSaveTitle={handleSaveTitle}
        onCancelEditTitle={() => setIsEditingTitle(false)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onChangePage={changePage}
        onSeekPage={setPageNumber}
        onBackHome={() => router.push('/')}
        sourceBlocks={sourceBlocks}
        hoveredBlockId={hoveredBlockId}
        activeSentenceBlockId={activeSentenceBlockId}
        onHoverBlock={setHoveredBlockId}
        onClickBlock={id => syncScrollToBlock(id, 'pdf')}
        pdfOriginalView={pdfOriginalView}
        clips={clips}
        pdfTextItems={pdfTextItems}
        onClippedSpanClick={handleClippedSpanClick}
      />

      <div
        className={`${styles.resizer} ${isImmersive ? styles.hiddenPane : ''}`}
        onMouseDown={() => setIsResizing(true)}
        onDoubleClick={() => setLeftPaneWidth(50)}
        data-tooltip="按住拖拽宽度，双击复位 50:50"
      />

      <MarkdownPane
        leftPaneWidth={leftPaneWidth}
        isImmersive={isImmersive}
        viewMode={viewMode}
        isTranslating={isTranslating}
        isOcrLoading={isOcrLoading}
        hasCachedTranslation={!!translationCache[pageNumber]}
        hasOcrCache={!!ocrCache[pageNumber]}
        theme={theme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        fullWidthReading={fullWidthReading}
        fileAvailable={!!file}
        hasAnyTranslationCache={Object.keys(translationCache).length > 0}
        autoTranslate={autoTranslate}
        isPreTranslating={isPreTranslating}
        isNextPageCached={!!translationCache[pageNumber + 1]}
        canPreTranslate={!!file && pageNumber < numPages && !isPreTranslating}
        hasTranslatedText={!!translatedText}
        displayedText={displayedText}
        fullTextThinking={fullTextRef.current.includes('<think>')}
        error={error}
        ocrText={ocrCache[pageNumber]}
        pageNumber={pageNumber}
        activeSentenceZh={activeSentenceZh}
        activeSentenceBlockId={activeSentenceBlockId}
        clips={clips}
        isOpen={isClipsDrawerOpen}
        toggleBtnRef={toggleBtnRef}
        onBackHome={() => router.push('/')}
        onSetViewMode={setViewMode}
        onToggleTheme={toggleTheme}
        onToggleFullWidthReading={() => setFullWidthReading(w => !w)}
        onRunOcr={() => runOcrOnCurrentPage(false)}
        onToggleImmersive={toggleImmersive}
        onDownloadMarkdown={downloadMarkdown}
        onToggleAutoTranslate={() => setAutoTranslate(prev => !prev)}
        onPreTranslate={() => preTranslatePipeline(pageNumber, 3)}
        onTranslateCurrentPage={() => translateCurrentPage(true)}
        onExecuteTranslateText={executeTranslateText}
        onMarkdownSelection={handleMarkdownSelection}
        onClippedSpanClick={handleClippedSpanClick}
        onToggle={toggleClipsDrawer}
        onClose={() => setIsClipsDrawerOpen(false)}
        onCopyAll={handleCopyAllClips}
        onExportMarkdown={handleExportClipsMarkdown}
        onJumpToPage={(page, text) => {
          setPageNumber(page);
          triggerHighlightFromZh(text, undefined, undefined, targetBlocks);
        }}
        onCopyClip={handleCopyClip}
        onDeleteClip={handleDeleteClip}
        sourceBlocks={sourceBlocks}
        targetBlocks={targetBlocks}
        hoveredBlockId={hoveredBlockId}
        onHoverBlock={setHoveredBlockId}
        onClickBlock={id => syncScrollToBlock(id, 'markdown')}
        blockLayoutMetrics={blockLayoutMetrics}
        totalPages={numPages}
        cachedPagesCount={Object.keys(translationCache).length}
        preloadProgress={preloadProgress}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <ExplainModal
        isOpen={isExplainModalOpen}
        targetText={explainTargetText}
        resultText={explainResultText}
        isLoading={isExplainLoading}
        history={explainHistory}
        showFollowUpInput={showFollowUpInput}
        followUpInput={explainFollowUpInput}
        onClose={() => setIsExplainModalOpen(false)}
        onShowFollowUpInput={setShowFollowUpInput}
        onFollowUpInputChange={setExplainFollowUpInput}
        onSendFollowUp={handleSendFollowUp}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
