"use client";

import React, { useState, useCallback, useMemo } from 'react';
import { pdfjs } from 'react-pdf';
import styles from '@/app/page.module.css';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';
import { ClipItem, activeClips } from '@/lib/db';
import { isLookaheadWindowCached } from '@/lib/pageRanges';
import { exportTranslationsAsMarkdown } from '@/services/exportService';
import { capturePageCanvasAsBase64, requestPaddleOcr } from '@/services/ocrService';
import { schedulePush, syncBook } from '@/services/cloudSyncService';
import { usePdfDocument } from '@/hooks/usePdfDocument';
import { useTranslator } from '@/hooks/useTranslator';
import { useBilingualSync } from '@/hooks/useBilingualSync';
import { useClipsManager } from '@/hooks/useClipsManager';
import { useTextSelection } from '@/hooks/useTextSelection';
import { ReaderHeader } from './reader/ReaderHeader';
import { PdfPane } from './reader/PdfPane';
import { MarkdownPane } from './reader/MarkdownPane';
import { CompanionDrawer } from './reader/CompanionDrawer';
import { FloatingToolbar } from './reader/FloatingToolbar';
import { ReaderOverlays } from './reader/ReaderOverlays';
import { SettingsModal } from './SettingsModal';
import { BookOpen, ArrowRight, X } from 'lucide-react';

export default function PdfTranslator({ fileId }: { fileId: string }) {
  const {
    settings,
    theme,
    toggleTheme,
    fontSize,
    setFontSize,
    readerFont,
    setReaderFont,
    preloadCount,
    setPreloadCount,
    dimPdfInDark,
    setDimPdfInDark,
    autoAppendCompanionPage,
    setAutoAppendCompanionPage,
  } = useAppContext();
  const { showToast } = useToast();
  const router = useRouter();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'llm' | 'ocr' | 'sync'>('llm');
  const [activeCompanionTab, setActiveCompanionTab] = useState<'explain' | 'clips'>('explain');

  const openSettings = useCallback((tab: 'llm' | 'ocr' | 'sync' = 'llm') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  }, []);

  const syncEnabled = !!settings.syncKey?.trim() && settings.autoCloudSync !== false;

  const requestPush = useCallback(() => {
    if (syncEnabled && settings.syncKey) schedulePush(fileId, settings.syncKey);
  }, [syncEnabled, settings.syncKey, fileId]);

  // 1. PDF 视口与文档状态
  const {
    dbRecord,
    setDbRecord,
    file,
    numPages,
    pageNumber,
    goToPage,
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
    resetZoom,
    containerRef,
    leftPaneRef,
    pdfWrapperRef,
    onDocumentLoadSuccess,
    pdfDocument,
    resumePrompt,
    setResumePrompt,
  } = usePdfDocument({ fileId, onMetaChanged: requestPush });

  // 断点续读提示横幅在 15 秒后自动淡出
  React.useEffect(() => {
    if (!resumePrompt) return;
    const timer = setTimeout(() => {
      setResumePrompt(null);
    }, 15000);
    return () => clearTimeout(timer);
  }, [resumePrompt, setResumePrompt]);

  // 打开文档时与云端完整同步一次；页面重新可见时再同步，获取其他设备的修改
  const fingerprint = dbRecord?.fingerprint;
  React.useEffect(() => {
    if (!fingerprint || !syncEnabled || !settings.syncKey) return;
    const syncKey = settings.syncKey;
    let cancelled = false;
    const runSync = () => {
      syncBook(fileId, syncKey)
        .then(updated => {
          if (!cancelled && updated) {
            setDbRecord(prev => (prev && prev.id === updated.id ? updated : prev));
          }
        })
        .catch(e => console.error('云端同步失败', e));
    };
    runSync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') runSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fingerprint, fileId, syncEnabled, settings.syncKey, setDbRecord]);

  // 2. 原文版面分析、段落悬停与原文高亮
  const {
    pdfOriginalView,
    sourceBlocks,
    hoveredBlockId,
    setHoveredBlockId,
    exactHighlightSpans,
    highlightTextInPdf,
    pdfTextItems,
  } = useBilingualSync({
    file,
    pdfDocument,
    pageNumber,
    pdfRenderWidth,
    zoomScale,
    pdfWrapperRef,
  });

  // 3. 翻译引擎调度与预加载
  const {
    displayedText,
    isNoTextPage,
    isThinking,
    isTranslating,
    error,
    setError,
    autoTranslate,
    setAutoTranslate,
    isPreTranslating,
    preloadProgress,
    translationCache,
    extractPagePlainText,
    translateCurrentPage,
    executeTranslateText,
  } = useTranslator({
    file,
    pdfDocument,
    pageNumber,
    numPages,
    settings,
    dbRecord,
    setDbRecord,
    preloadCount,
  });

  // 4. OCR 状态与视图切换
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
    if (!doc) throw new Error('PDF 尚未加载');
    const page = await doc.getPage(pageNumber);
    return capturePageCanvasAsBase64(page, 2.0);
  }, [pdfDocument, file, pageNumber]);

  const runOcrOnCurrentPage = useCallback(
    async (autoTranslateAfter = false) => {
      if ((!file && !pdfDocument) || isOcrLoading) return;
      const token = settings.ocr?.apiToken?.trim();
      if (!token) {
        showToast('请先配置百度飞桨 OCR Access Token', 'warning');
        openSettings('ocr');
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
          showToast('OCR 原文识别完成', 'success');
        }
      } catch (err) {
        console.error('OCR Error:', err);
        setError('OCR 识别失败: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsOcrLoading(false);
      }
    },
    [
      file,
      pdfDocument,
      isOcrLoading,
      settings.ocr,
      captureCurrentPageImage,
      setError,
      pageNumber,
      executeTranslateText,
      showToast,
      openSettings,
    ]
  );

  // 5. 书摘剪藏管理（复用侧栏打开状态 isClipsDrawerOpen 作为统一侧栏状态）
  const handleClipsChange = useCallback(
    (allClips: ClipItem[]) => {
      setDbRecord(prev => (prev ? { ...prev, clips: allClips } : prev));
      requestPush();
    },
    [setDbRecord, requestPush]
  );

  const initialClips = useMemo(() => activeClips(dbRecord?.clips), [dbRecord?.clips]);

  const {
    clips,
    isClipsDrawerOpen: isCompanionOpen,
    setIsClipsDrawerOpen: setIsCompanionOpen,
    toggleClipsDrawer: toggleCompanionDrawer,
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
    fileId,
    file,
    initialClips,
    onClipsChange: handleClipsChange,
  });

  const activateExplainTab = useCallback(() => {
    setActiveCompanionTab('explain');
    setIsCompanionOpen(true);
  }, [setIsCompanionOpen]);

  // 6. 划词选区与跨页伴读解析
  const {
    floatingToolbar,
    setFloatingToolbar,
    handleMarkdownSelection,
    handlePdfSelection,
    contextPages,
    setContextPages,
    toggleContextPage,
    removeContextPage,
    resetContextToCurrentPage,
    includeCurrentPageInContext,
    pageTurnBanner,
    dismissPageTurnBanner,
    explainTargetText,
    explainTargetPage,
    clearExplainSelection,
    explainResultText,
    isExplainLoading,
    explainHistory,
    explainFollowUpInput,
    setExplainFollowUpInput,
    handleOpenExplain,
    handleSendFollowUp,
  } = useTextSelection({
    displayedText,
    settings,
    clips,
    pageNumber,
    sourceBlocks,
    translationCache,
    ocrCache,
    extractPagePlainText,
    isCompanionOpen,
    activeCompanionTab,
    onActivateExplainTab: activateExplainTab,
    autoAppendCompanionPage,
  });

  const handleAddClip = async () => {
    if (!floatingToolbar || !floatingToolbar.text) return;
    const textToClip = floatingToolbar.text;

    if (floatingToolbar.isClipped && floatingToolbar.clipId) {
      await handleDeleteClip(floatingToolbar.clipId);
      setFloatingToolbar(null);
      window.getSelection()?.removeAllRanges();
      showToast('已移除该条书摘');
      return;
    }

    const selection = window.getSelection();
    let startRect = {
      top: floatingToolbar.top,
      left: floatingToolbar.left - 60,
      width: 120,
      height: 30,
    };
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const r = selection.getRangeAt(0).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        startRect = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
    }

    setFloatingToolbar(null);
    window.getSelection()?.removeAllRanges();

    await addClip(textToClip, pageNumber, startRect);
  };

  const handleClippedSpanClick = useCallback(
    (e: React.MouseEvent, clip: ClipItem) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const placement: 'top' | 'bottom' = rect.top < 65 ? 'bottom' : 'top';
      const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
      const toolbarHalfWidth = 110;
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
      const rawLeft = rect.left + rect.width / 2;
      const left = Math.max(
        toolbarHalfWidth + 12,
        Math.min(screenW - toolbarHalfWidth - 12, rawLeft)
      );

      setFloatingToolbar({
        visible: true,
        top,
        left,
        text: clip.text,
        placement,
        isClipped: true,
        clipId: clip.id,
      });
    },
    [setFloatingToolbar]
  );

  const downloadMarkdown = () => {
    if (!file || Object.keys(translationCache).length === 0) return;
    exportTranslationsAsMarkdown({ filename: file.name, translationCache });
    showToast('已导出全书已译章节 (.md)', 'success');
  };

  const cachedPagesCount = Object.keys(translationCache).length;
  const isLookaheadCached =
    autoTranslate &&
    isLookaheadWindowCached(pageNumber, numPages, preloadCount, translationCache);

  return (
    <div className={styles.readerShell}>
      {/* 统一 48px 顶栏 */}
      <ReaderHeader
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
        onBackHome={() => router.push('/')}
        pageNumber={pageNumber}
        numPages={numPages}
        onChangePage={changePage}
        onSeekPage={goToPage}
        isImmersive={isImmersive}
        onToggleImmersive={toggleImmersive}
        viewMode={viewMode}
        hasOcrCache={!!ocrCache[pageNumber]}
        onSetViewMode={setViewMode}
        isTranslating={isTranslating}
        hasCachedTranslation={!!translationCache[pageNumber]}
        cachedPagesCount={cachedPagesCount}
        autoTranslate={autoTranslate}
        onToggleAutoTranslate={() => setAutoTranslate(prev => !prev)}
        preloadCount={preloadCount}
        onChangePreloadCount={setPreloadCount}
        isPreTranslating={isPreTranslating}
        preloadProgress={preloadProgress}
        isLookaheadCached={isLookaheadCached}
        onTranslateCurrentPage={() => translateCurrentPage(true)}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        readerFont={readerFont}
        onChangeReaderFont={setReaderFont}
        fullWidthReading={fullWidthReading}
        onToggleFullWidthReading={() => setFullWidthReading(w => !w)}
        isOcrLoading={isOcrLoading}
        onRunOcrAndTranslate={() => runOcrOnCurrentPage(true)}
        onRunOcrOnly={() => runOcrOnCurrentPage(false)}
        onDownloadMarkdown={downloadMarkdown}
        hasAnyTranslationCache={cachedPagesCount > 0}
        theme={theme}
        onToggleTheme={toggleTheme}
        dimPdfInDark={dimPdfInDark}
        onToggleDimPdfInDark={() => setDimPdfInDark(!dimPdfInDark)}
        onOpenSettings={openSettings}
        isCompanionOpen={isCompanionOpen}
        onToggleCompanion={toggleCompanionDrawer}
        clipsCount={clips.length}
        toggleBtnRef={toggleBtnRef}
      />

      {/* 断点续读轻横幅 */}
      {resumePrompt && (
        <div className={styles.resumeBanner}>
          <div className={styles.resumeBannerText}>
            <BookOpen size={14} className={styles.resumeBannerIcon} />
            <span>
              上次读至第 <strong>{resumePrompt.page}</strong> 页
              {resumePrompt.totalPages ? `（共 ${resumePrompt.totalPages} 页）` : ''}
            </span>
          </div>
          <div className={styles.resumeBannerActions}>
            <button
              type="button"
              className={styles.resumeJumpBtn}
              onClick={() => {
                goToPage(resumePrompt.page);
                setResumePrompt(null);
              }}
            >
              <span>继续阅读</span>
              <ArrowRight size={12} />
            </button>
            <button
              type="button"
              className={styles.resumeDismissBtn}
              onClick={() => setResumePrompt(null)}
              title="留在第 1 页"
            >
              <X size={13} />
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

      {/* 主阅读工作区：左侧对照分栏区 + 右侧非遮挡伴读/书摘侧栏 */}
      <div className={styles.readerWorkspace}>
        <div className={styles.panesSplitArea} ref={containerRef}>
          <PdfPane
            file={file}
            leftPaneRef={leftPaneRef}
            pdfWrapperRef={pdfWrapperRef}
            leftPaneWidth={leftPaneWidth}
            isImmersive={isImmersive}
            pdfRenderWidth={pdfRenderWidth}
            zoomScale={zoomScale}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetZoom={resetZoom}
            dimPdfInDark={dimPdfInDark}
            pageNumber={pageNumber}
            exactHighlightSpans={exactHighlightSpans}
            onDocumentLoadSuccess={onDocumentLoadSuccess}
            onPdfSelection={handlePdfSelection}
            sourceBlocks={sourceBlocks}
            hoveredBlockId={hoveredBlockId}
            onHoverBlock={setHoveredBlockId}
            pdfOriginalView={pdfOriginalView}
            clips={clips}
            pdfTextItems={pdfTextItems}
            onClippedSpanClick={handleClippedSpanClick}
          />

          <div
            className={`${styles.resizer} ${isImmersive ? styles.hiddenPane : ''}`}
            onMouseDown={() => setIsResizing(true)}
            onDoubleClick={() => setLeftPaneWidth(50)}
            title="拖拽调整左右分栏宽度，双击复位 50:50"
          />

          <MarkdownPane
            leftPaneWidth={leftPaneWidth}
            isImmersive={isImmersive}
            viewMode={viewMode}
            isTranslating={isTranslating}
            isOcrLoading={isOcrLoading}
            isNoTextPage={isNoTextPage}
            displayedText={displayedText}
            fullTextThinking={isThinking}
            error={error}
            ocrText={ocrCache[pageNumber]}
            pageNumber={pageNumber}
            fontSize={fontSize}
            readerFont={readerFont}
            fullWidthReading={fullWidthReading}
            autoTranslate={autoTranslate}
            clips={clips}
            onTranslateCurrentPage={() => translateCurrentPage(true)}
            onEnableAutoTranslateAndRun={() => {
              setAutoTranslate(true);
              translateCurrentPage(true);
            }}
            onRunOcrAndTranslate={() => runOcrOnCurrentPage(true)}
            onRunOcrOnly={() => runOcrOnCurrentPage(false)}
            onExecuteTranslateText={executeTranslateText}
            onOpenSettings={openSettings}
            onMarkdownSelection={handleMarkdownSelection}
            onClippedSpanClick={handleClippedSpanClick}
          />
        </div>

        <CompanionDrawer
          isOpen={isCompanionOpen}
          activeTab={activeCompanionTab}
          onChangeTab={setActiveCompanionTab}
          onClose={() => setIsCompanionOpen(false)}
          pageNumber={pageNumber}
          numPages={numPages}
          contextPages={contextPages}
          onSetContextPages={setContextPages}
          onToggleContextPage={toggleContextPage}
          onRemoveContextPage={removeContextPage}
          onResetContextToCurrentPage={resetContextToCurrentPage}
          onIncludeCurrentPageInContext={includeCurrentPageInContext}
          pageTurnBanner={pageTurnBanner}
          onDismissPageTurnBanner={dismissPageTurnBanner}
          autoAppendCompanionPage={autoAppendCompanionPage}
          onChangeAutoAppendCompanionPage={setAutoAppendCompanionPage}
          translationCache={translationCache}
          explainTargetText={explainTargetText}
          explainTargetPage={explainTargetPage}
          onClearExplainSelection={clearExplainSelection}
          explainResultText={explainResultText}
          isExplainLoading={isExplainLoading}
          explainHistory={explainHistory}
          explainFollowUpInput={explainFollowUpInput}
          onFollowUpInputChange={setExplainFollowUpInput}
          onSendQuestion={handleSendFollowUp}
          clips={clips}
          onJumpToPage={(page, text) => {
            goToPage(page);
            highlightTextInPdf(text, page);
          }}
          onCopyClip={handleCopyClip}
          onDeleteClip={handleDeleteClip}
          onCopyAllClips={handleCopyAllClips}
          onExportClipsMarkdown={handleExportClipsMarkdown}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
