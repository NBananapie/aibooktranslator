"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { getAllHistoryMetadata, saveHistoryRecord, HistoryRecord, deleteHistoryRecord, updateHistoryFilename } from '@/lib/db';
import { ProgressRing } from '@/components/ProgressRing';
import { SettingsModal } from '@/components/SettingsModal';
import styles from './page.module.css';
import {
  Sun,
  Moon,
  Settings as SettingsIcon,
  UploadCloud,
  Pencil,
  Trash2,
  Check,
  X
} from 'lucide-react';

function formatTime(timestamp?: number): string {
  if (!timestamp) return '从未';
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function Home() {
  const router = useRouter();
  const { setActiveFileId, theme, toggleTheme } = useAppContext();
  const [history, setHistory] = useState<Omit<HistoryRecord, 'pdfData'>[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Card rename state
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState<string>('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const records = await getAllHistoryMetadata();
      setHistory(records);
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      alert("请上传标准的 PDF 格式文件！");
      return;
    }
    
    // Create new DB record
    const id = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    
    const record: HistoryRecord = {
      id,
      filename: file.name,
      date: Date.now(),
      lastReadTime: Date.now(),
      pdfData: arrayBuffer,
      translations: {},
    };

    try {
      await saveHistoryRecord(record);
      setActiveFileId(id);
      router.push('/translate');
    } catch (err) {
      console.error("Failed to save file to DB", err);
      alert("上传失败，可能文件过大或浏览器存储空间受限。");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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
    }
  };

  const openHistory = (id: string) => {
    if (editingCardId === id) return;
    setActiveFileId(id);
    router.push('/translate');
  };

  const deleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("确定要删除此文档记录吗？")) {
      await deleteHistoryRecord(id);
      loadHistory();
    }
  };

  const startEditingCard = (e: React.MouseEvent, item: Omit<HistoryRecord, 'pdfData'>) => {
    e.stopPropagation();
    setEditingCardId(item.id);
    setEditingCardName(item.filename);
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
    loadHistory();
  };

  return (
    <div className={styles.homeContainer}>
      <header className={styles.homeHeader}>
        <div className={styles.brand}>
          <h1>AI PDF Translator</h1>
        </div>
        <div className={styles.controls}>
          <button 
            type="button" 
            className={styles.themeToggleBtn} 
            onClick={toggleTheme}
            data-tooltip="切换深色/浅色模式"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
          <button 
            className={styles.btn} 
            onClick={() => setIsSettingsOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <SettingsIcon size={15} />
            <span>引擎设置</span>
          </button>
        </div>
      </header>

      <main className={styles.homeMain}>
        {/* Dropzone */}
        <div 
          className={`${styles.uploadBox} ${isDragging ? styles.uploadBoxActive : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input 
            type="file" 
            id="file-upload" 
            accept="application/pdf" 
            onChange={handleFileInput} 
            style={{ display: 'none' }}
          />
          <div className={styles.uploadIcon}>
            <UploadCloud size={38} style={{ color: 'var(--primary)', strokeWidth: 1.8 }} />
          </div>
          <div className={styles.uploadTitle}>点击或拖拽上传 PDF 文档</div>
          <div className={styles.uploadDesc}>支持双栏流式翻译、百度飞桨多模态 OCR、智能预翻译与带署名 Markdown 导出</div>
        </div>

        {/* History Section */}
        <div className={styles.historySection}>
          <h2>已上传</h2>
          {history.length === 0 ? (
            <div className={styles.emptyText}>暂无已上传的文档，上传 PDF 即可开启实时精读与 OCR 结构化解析</div>
          ) : (
            <div className={styles.historyList}>
              {history.map(item => {
                const translatedCount = Object.keys(item.translations || {}).length;
                const total = item.totalPages || 0;
                const percent = total > 0 ? Math.round((translatedCount / total) * 100) : (translatedCount > 0 ? 100 : 0);

                return (
                  <div key={item.id} className={styles.historyCard} onClick={() => openHistory(item.id)}>
                    {/* 卡片头部：文件名与操作 */}
                    <div className={styles.cardHeader}>
                      {editingCardId === item.id ? (
                        <div className={styles.cardRenameBox} onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingCardName}
                            onChange={e => setEditingCardName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveCardName(e, item.id)}
                            autoFocus
                            className={styles.cardRenameInput}
                          />
                          <button className={styles.btn} style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }} onClick={e => saveCardName(e, item.id)}>
                            <Check size={11} /> 保存
                          </button>
                          <button className={styles.btnSecondary} style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }} onClick={e => { e.stopPropagation(); setEditingCardId(null); }}>
                            <X size={11} /> 取消
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className={styles.cardTitleRow}>
                            <h3 data-tooltip={item.filename}>{item.filename}</h3>
                          </div>
                          <div className={styles.cardActions} onClick={e => e.stopPropagation()}>
                            <button
                              className={styles.iconBtn}
                              onClick={e => startEditingCard(e, item)}
                              data-tooltip="修改文件名"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className={styles.deleteBtn}
                              onClick={(e) => deleteHistory(e, item.id)}
                              data-tooltip="删除此记录"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* 卡片主体：进度圆环与上次阅读时间 */}
                    <div className={styles.cardBody}>
                      <ProgressRing percent={percent} size={48} strokeWidth={4} />
                      <div className={styles.cardProgressMeta}>
                        <div className={styles.cardBadgeRow}>
                          <span className={styles.badge}>
                            已译 {translatedCount} 页 {total > 0 ? `/ 共 ${total} 页` : ''}
                          </span>
                          {item.lastReadPage && item.lastReadPage > 1 && (
                            <span className={styles.badgeSubtle}>
                              读至第 {item.lastReadPage} 页
                            </span>
                          )}
                        </div>

                        <div className={styles.lastReadTimeRow} data-tooltip={`上次阅读时间: ${new Date(item.lastReadTime || item.date).toLocaleString()}`}>
                          <span>上次阅读: {formatTime(item.lastReadTime || item.date)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 卡片底部：独立一行 创建时间 */}
                    <div className={styles.cardFooter}>
                      <span>创建时间: {new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

