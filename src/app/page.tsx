"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext, AppSettings } from '@/context/AppContext';
import { getAllHistoryMetadata, saveHistoryRecord, HistoryRecord, deleteHistoryRecord } from '@/lib/db';
import styles from './page.module.css';

const PROVIDER_PRESETS = [
  { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7-highspeed' },
  { label: 'Gemini（有免费额度）', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: '' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
];

const hintStyle: React.CSSProperties = { fontSize: '12px', color: '#6b6b70', marginTop: '4px', lineHeight: 1.5 };

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
              <label>选择服务商</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {PROVIDER_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setFormSettings({ ...formSettings, baseUrl: preset.baseUrl, model: preset.model })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p style={hintStyle}>
                任何兼容 OpenAI Chat Completions 的服务都能用。没有 Key？可以先去{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                  Google AI Studio
                </a>{' '}
                免费领一个 Gemini Key，再回来选「Gemini」并填入模型名。
              </p>
            </div>
            <div className={styles.formGroup}>
              <label>API Key</label>
              <input 
                type="password" 
                value={formSettings.apiKey} 
                onChange={e => setFormSettings({...formSettings, apiKey: e.target.value})}
                placeholder="填入你自己的 API Key"
              />
              <p style={hintStyle}>Key 只保存在这台浏览器的本地存储里，不会上传，也不会被保存到服务器。</p>
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
              <label>模型名</label>
              <input 
                type="text" 
                value={formSettings.model} 
                onChange={e => setFormSettings({...formSettings, model: e.target.value})}
                placeholder="例如 MiniMax-M2.7-highspeed"
              />
              <p style={hintStyle}>换服务商时必须改成该服务实际可用的模型名，否则请求会被拒绝。</p>
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
