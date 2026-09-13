"use client";

import React, { useState, useCallback } from 'react';
import { pdfjs } from 'react-pdf';
import styles from '@/app/page.module.css';
import { useAppContext } from '@/context/AppContext';
import { useRouter } from 'next/navigation';
import { ClipItem } from '@/lib/db';
import { exportTranslationsAsMarkdown } from '@/services/exportService';
import { capturePageCanvasAsBase64, requestPaddleOcr } from '@/services/ocrService';
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

export default function PdfTranslator() {
  const { settings, activeFileId, theme, toggleTheme } = useAppContext();
  const router = useRouter();

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
  } = usePdfDocument({ activeFileId });

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
  const {
    clips,
    isClipsDrawerOpen,
    setIsClipsDrawerOpen,
    toggleClipsDrawer,
    toggleBtnRef,
    ghostFlyStyle,
    ghostFlyText,
    addClip,
    deleteClip: handleDeleteClip,
    copyClip: handleCopyClip,
    copyAllClips: handleCopyAllClips,
    exportClips: handleExportClipsMarkdown,
  } = useClipsManager({
    activeFileId,
    file,
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
      setFloatingToolbar(prev => (prev ? { ...prev, isClipped: false, clipId: undefined } : null));
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

    const newClip = await addClip(textToClip, pageNumber, startRect);
    if (newClip) {
      setFloatingToolbar(prev => (prev ? { ...prev, isClipped: true, clipId: newClip.id } : null));
    }
  };

  const handleClippedSpanClick = useCallback((e: React.MouseEvent, clip: ClipItem) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
    const top = placement === 'bottom' ? rect.bottom + 10 : rect.top;
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
    triggerHighlightFromZh(clip.text, undefined, undefined, targetBlocks);
  }, [triggerHighlightFromZh, targetBlocks]);

  const downloadMarkdown = () => {
    if (!file || Object.keys(translationCache).length === 0) return;
    exportTranslationsAsMarkdown({ filename: file.name, translationCache });
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <ReaderOverlays
        isLoadingFile={!file}
        ghostFlyStyle={ghostFlyStyle}
        ghostFlyText={ghostFlyText}
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
    </div>
  );
}
