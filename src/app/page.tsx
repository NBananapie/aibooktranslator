"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext, AppSettings } from '@/context/AppContext';
import { getAllHistoryMetadata, saveHistoryRecord, HistoryRecord, deleteHistoryRecord } from '@/lib/db';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const { settings, setSettings, setActiveFileId } = useAppContext();
  const [history, setHistory] = useState<Omit<HistoryRecord, 'pdfData'>[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Settings form state
  const [formSettings, setFormSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    loadHistory();
    setFormSettings(settings);
  }, [settings]);

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
      alert("请上传 PDF 文件！");
      return;
    }
    
    // Create new DB record
    const id = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    
    const record: HistoryRecord = {
      id,
      filename: file.name,
      date: Date.now(),
      pdfData: arrayBuffer,
      translations: {},
    };

    try {
      await saveHistoryRecord(record);
      setActiveFileId(id);
      router.push('/translate');
    } catch (err) {
      console.error("Failed to save file to DB", err);
      alert("上传失败，可能文件过大或者浏览器存储空间不足。");
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
    setActiveFileId(id);
    router.push('/translate');
  };

  const deleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("确定要删除这条历史记录吗？")) {
      await deleteHistoryRecord(id);
      loadHistory();
    }
  };

  const saveSettings = () => {
    setSettings(formSettings);
    setIsSettingsOpen(false);
  };

  return (
    <div className={styles.homeContainer}>
      <header className={styles.homeHeader}>
        <h1>📚 AI PDF Translator</h1>
        <button className={styles.btn} onClick={() => setIsSettingsOpen(true)}>⚙️ 设置</button>
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
          <div className={styles.uploadIcon}>📄</div>
          <div className={styles.uploadTitle}>点击或拖拽上传 PDF</div>
          <div className={styles.uploadDesc}>开启您的 AI 翻译之旅</div>
        </div>

        {/* History Section */}
        <div className={styles.historySection}>
          <h2>历史翻译记录</h2>
          {history.length === 0 ? (
            <p className={styles.emptyText}>暂无历史记录</p>
          ) : (
            <div className={styles.historyList}>
              {history.map(item => (
                <div key={item.id} className={styles.historyCard} onClick={() => openHistory(item.id)}>
                  <div className={styles.historyInfo}>
                    <h3>{item.filename}</h3>
                    <p>{new Date(item.date).toLocaleString()} • 已翻译 {Object.keys(item.translations).length} 页</p>
                  </div>
                  <button className={styles.deleteBtn} onClick={(e) => deleteHistory(e, item.id)}>🗑️</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsSettingsOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>引擎设置</h2>
            <div className={styles.formGroup}>
              <label>API Key</label>
              <input 
                type="password" 
                value={formSettings.apiKey} 
                onChange={e => setFormSettings({...formSettings, apiKey: e.target.value})}
                placeholder="留空则使用默认环境变量"
              />
            </div>
            <div className={styles.formGroup}>
              <label>Base URL</label>
              <input 
                type="text" 
                value={formSettings.baseUrl} 
                onChange={e => setFormSettings({...formSettings, baseUrl: e.target.value})}
              />
            </div>
            <div className={styles.formGroup}>
              <label>翻译提示词 (System Prompt)</label>
              <textarea 
                rows={8}
                value={formSettings.customPrompt} 
                onChange={e => setFormSettings({...formSettings, customPrompt: e.target.value})}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setIsSettingsOpen(false)}>取消</button>
              <button className={styles.btn} onClick={saveSettings}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
