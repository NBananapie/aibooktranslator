"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { useToast } from '@/components/Toast';
import {
  getAllHistoryRecords,
  HistoryRecord,
  activeClips,
  createHistoryRecord,
  deleteHistoryRecord,
  savePdfData,
  updateHistoryFilename,
  updateHistoryRecord,
  getHistoryRecordByFingerprint,
  calculatePdfFingerprint,
} from '@/lib/db';
import { fetchCloudBookshelf, CloudBookMeta } from '@/services/cloudSyncService';
import { ProgressRing } from '@/components/ProgressRing';
import { SettingsModal, SettingsTabId } from '@/components/SettingsModal';
import styles from './page.module.css';
import {
  Sun,
  Moon,
  Settings as SettingsIcon,
  Upload,
  Pencil,
  Trash2,
  Check,
  X,
  Cloud,
  DownloadCloud,
  BookOpen,
  KeyRound,
  ArrowRight,
} from 'lucide-react';

function formatTime(timestamp?: number): string {
  if (!timestamp) return '从未';
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function renderBreakableTitle(title: string): React.ReactNode {
  const parts = title.split(/([_-])/);
  if (parts.length <= 1) return title;
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const word = parts[i];
    const sep = parts[i + 1] || '';
    nodes.push(
      <React.Fragment key={i}>
        {word}
        {sep}
        {sep ? <wbr /> : null}
      </React.Fragment>
    );
  }
  return nodes;
}

export default function Home() {
  const router = useRouter();
  const { settings, theme, toggleTheme } = useAppContext();
  const { showToast } = useToast();

  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [cloudBooks, setCloudBooks] = useState<CloudBookMeta[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('llm');
  const [isDragging, setIsDragging] = useState(false);

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openSettings = (tab: SettingsTabId = 'llm') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getAllHistoryRecords());
    } catch (err) {
      console.error('Failed to load history', err);
    }
    if (settings.syncKey?.trim()) {
      fetchCloudBookshelf(settings.syncKey)
        .then(setCloudBooks)
        .catch(e => console.error('Failed to load cloud bookshelf', e));
    } else {
      setCloudBooks([]);
    }
  }, [settings.syncKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHistory();
  }, [loadHistory]);

  const openReader = (id: string) => router.push(`/translate?id=${encodeURIComponent(id)}`);

  const handleFileUpload = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('请选择标准的 PDF 格式文件', 'warning');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fingerprint = await calculatePdfFingerprint(arrayBuffer);

      const existing = await getHistoryRecordByFingerprint(fingerprint);
      if (existing) {
        await savePdfData(existing.id, arrayBuffer);
        await updateHistoryRecord(existing.id, r => ({ ...r, lastReadTime: Date.now() }));
        openReader(existing.id);
        return;
      }

      const now = Date.now();
      const record: HistoryRecord = {
        id: crypto.randomUUID(),
        fingerprint,
        filename: file.name,
        date: now,
        lastReadTime: now,
        translations: {},
        clips: [],
      };
      await createHistoryRecord(record, arrayBuffer);
      openReader(record.id);
    } catch (err) {
      console.error('Failed to save file to DB', err);
      showToast('导入失败，文件可能过大或浏览器存储受限', 'error');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const openHistory = (id: string) => {
    if (editingCardId === id || confirmDeleteId === id) return;
    openReader(id);
  };

  const confirmDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteHistoryRecord(id);
    setConfirmDeleteId(null);
    showToast('已从本机书架移除该文档');
    loadHistory();
  };

  const startEditingCard = (e: React.MouseEvent, item: HistoryRecord) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    setEditingCardId(item.id);
    setEditingCardName(item.filename.replace(/\.pdf$/i, ''));
  };

  const saveCardName = async (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
    if (!editingCardName.trim()) {
      setEditingCardId(null);
      return;
    }
    let newName = editingCardName.trim();
    if (!newName.toLowerCase().endsWith('.pdf')) {
      newName += '.pdf';
    }
    await updateHistoryFilename(id, newName);
    setEditingCardId(null);
    showToast('书名已更新', 'success');
    loadHistory();
  };

  const unimportedCloudBooks = cloudBooks.filter(
    cb => !history.some(h => h.fingerprint === cb.bookFingerprint)
  );
  const hasAnyBooks = history.length > 0 || unimportedCloudBooks.length > 0;
  const isApiKeyMissing = !settings.apiKey?.trim();
  const isSyncConnected = Boolean(settings.syncKey?.trim());

  return (
    <div
      className={styles.homeContainer}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />

      {isDragging && hasAnyBooks && (
        <div className={styles.globalDropOverlay}>
          <div className={styles.globalDropCard}>
            <Upload size={26} />
            <span>松开鼠标，立即导入并打开 PDF 书籍</span>
          </div>
        </div>
      )}

      {/* 书架顶栏 */}
      <header className={styles.homeHeader}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>阅译</span>
          <span className={styles.brandDivider}>/</span>
          <span className={styles.brandSub}>双栏沉浸式外文研读</span>
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => router.push('/sync')}
            title={isSyncConnected ? '管理云端同步书架' : '开启跨设备端到端加密同步'}
          >
            <Cloud size={14} />
            <span>{isSyncConnected ? '云同步已连接' : '多端同步'}</span>
            {isSyncConnected && <span className={styles.onlineDot} />}
          </button>

          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => openSettings('llm')}
            title="配置翻译模型与 OCR"
          >
            <SettingsIcon size={14} />
            <span>{isApiKeyMissing ? '配置 API Key' : settings.model || '引擎设置'}</span>
            {isApiKeyMissing && <span className={styles.unconfiguredDot} />}
          </button>

          <button
            type="button"
            className={styles.headerIconSquareBtn}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换为暖白纸感模式' : '切换为深色夜间模式'}
            title={theme === 'dark' ? '切换为暖白纸感模式' : '切换为深色夜间模式'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className={styles.homeMain}>
        {/* 首次未配置 API Key 时的温和引导条 */}
        {isApiKeyMissing && (
          <div className={styles.onboardingBanner}>
            <div className={styles.onboardingBannerText}>
              <KeyRound size={15} className={styles.onboardingBannerIcon} />
              <span>尚未填入大模型 API Key，完成配置后即可开启流式对照精译与跨页伴读。</span>
            </div>
            <button
              type="button"
              className={styles.onboardingBannerBtn}
              onClick={() => openSettings('llm')}
            >
              <span>立即配置</span>
              <ArrowRight size={13} />
            </button>
          </div>
        )}

        {/* 自适应上传区：无书时展示完整欢迎卡片，有书时收拢为克制单行导入条 */}
        {!hasAnyBooks ? (
          <div
            className={`${styles.uploadHero} ${isDragging ? styles.uploadHeroActive : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={styles.uploadHeroIcon}>
              <BookOpen size={26} />
            </div>
            <h2 className={styles.uploadHeroTitle}>导入第一本 PDF 书籍或学术论文</h2>
            <p className={styles.uploadHeroDesc}>
              支持左右双栏原文对照、多页连续上下文伴读解析、书摘归档与扫描版多模态 OCR
            </p>
            <button
              type="button"
              className={styles.btn}
              onClick={e => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Upload size={14} />
              <span>选择本地 PDF 文件</span>
            </button>
            <span className={styles.uploadHeroFootnote}>亦可直接将 PDF 文件拖拽至此窗口任意位置</span>
          </div>
        ) : (
          <>
            <div className={styles.shelfHeader}>
              <div>
                <h1 className={styles.shelfTitle}>我的书架</h1>
                <p className={styles.shelfSubtitle}>
                  共 {history.length} 本本地藏书
                  {unimportedCloudBooks.length > 0
                    ? ` · ${unimportedCloudBooks.length} 本云端记录待关联本地文件`
                    : ''}
                </p>
              </div>

              <button
                type="button"
                className={styles.btn}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} />
                <span>导入 PDF</span>
              </button>
            </div>

            <div className={styles.booksGrid}>
              {history.map(item => {
                const translatedCount = Object.keys(item.translations || {}).length;
                const total = item.totalPages || 0;
                const currentPage = item.lastReadPage || 1;
                const readPercent =
                  total > 0
                    ? Math.min(100, Math.round((Math.max(currentPage, translatedCount) / total) * 100))
                    : translatedCount > 0
                      ? 100
                      : 0;
                const clipsLen = activeClips(item.clips).length;
                const cleanBookTitle = item.filename.replace(/\.pdf$/i, '');

                return (
                  <div
                    key={item.id}
                    className={styles.bookCard}
                    onClick={() => openHistory(item.id)}
                  >
                    {/* 左侧书脊进度条 */}
                    <div className={styles.bookSpine} aria-hidden="true">
                      <div
                        className={styles.bookSpineFill}
                        style={{ height: `${Math.max(8, readPercent)}%` }}
                      />
                    </div>

                    <div className={styles.bookCardMain}>
                      <div className={styles.bookCardTop}>
                        {editingCardId === item.id ? (
                          <div
                            className={styles.cardRenameBox}
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={editingCardName}
                              onChange={e => setEditingCardName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveCardName(e, item.id);
                                if (e.key === 'Escape') setEditingCardId(null);
                              }}
                              autoFocus
                              className={styles.cardRenameInput}
                            />
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={e => saveCardName(e, item.id)}
                              title="保存"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={e => {
                                e.stopPropagation();
                                setEditingCardId(null);
                              }}
                              title="取消"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h3 className={styles.bookTitle} title={item.filename}>
                              {renderBreakableTitle(cleanBookTitle)}
                            </h3>

                            <div
                              className={styles.bookCardActions}
                              onClick={e => e.stopPropagation()}
                            >
                              {confirmDeleteId === item.id ? (
                                <div className={styles.inlineConfirmGroup}>
                                  <button
                                    type="button"
                                    className={styles.inlineConfirmDanger}
                                    onClick={e => confirmDeleteHistory(e, item.id)}
                                  >
                                    确认移除
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.inlineConfirmCancel}
                                    onClick={() => setConfirmDeleteId(null)}
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={styles.iconBtn}
                                    onClick={e => startEditingCard(e, item)}
                                    title="重命名书籍"
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.deleteBtn}
                                    onClick={() => setConfirmDeleteId(item.id)}
                                    title="从本机移除"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      <div className={styles.bookCardBody}>
                        <ProgressRing percent={readPercent} size={40} strokeWidth={3.2} />
                        <div className={styles.bookStatsCol}>
                          <div className={styles.bookMetaLine}>
                            <span>
                              读至第 <strong>{currentPage}</strong>
                              {total > 0 ? ` / ${total}` : ''} 页
                            </span>
                            <span className={styles.metaDot}>·</span>
                            <span>已译 {translatedCount} 页</span>
                            {clipsLen > 0 && (
                              <>
                                <span className={styles.metaDot}>·</span>
                                <span>书摘 {clipsLen}</span>
                              </>
                            )}
                          </div>
                          <div className={styles.bookFooterLine}>
                            最近阅读：{formatTime(item.lastReadTime || item.date)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 云端已有记录、待关联本地 PDF 的书籍 */}
              {unimportedCloudBooks.map(cb => (
                <div
                  key={cb.bookFingerprint}
                  className={`${styles.bookCard} ${styles.bookCardCloud}`}
                  onClick={() => {
                    showToast(
                      `请选择本地对应的《${cb.filename}》，系统将通过指纹自动恢复全部译文与书摘`,
                      { variant: 'info', durationMs: 4800 }
                    );
                    fileInputRef.current?.click();
                  }}
                >
                  <div className={styles.bookSpine} aria-hidden="true" />
                  <div className={styles.bookCardMain}>
                    <div className={styles.bookCardTop}>
                      <h3 className={styles.bookTitle} title={cb.filename}>
                        {renderBreakableTitle(cb.filename.replace(/\.pdf$/i, ''))}
                      </h3>
                      <span className={styles.badge}>云端待载入</span>
                    </div>

                    <div className={styles.bookCardBody}>
                      <div className={styles.cloudBookIconCircle}>
                        <DownloadCloud size={18} />
                      </div>
                      <div className={styles.bookStatsCol}>
                        <div className={styles.bookMetaLine}>
                          <span>点击选择对应本地 PDF 自动合并译文</span>
                        </div>
                        <div className={styles.bookFooterLine}>
                          {cb.totalPages > 0 ? `共 ${cb.totalPages} 页 · ` : ''}
                          同步于 {formatTime(cb.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsTab}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
