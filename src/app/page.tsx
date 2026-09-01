"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext, AppSettings, DEFAULT_SETTINGS } from '@/context/AppContext';
import { getAllHistoryMetadata, saveHistoryRecord, HistoryRecord, deleteHistoryRecord } from '@/lib/db';
import styles from './page.module.css';

const PROVIDER_PRESETS: { label: string; baseUrl: string; model: string; provider: 'openai' | 'gemini' | 'custom' }[] = [
  { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7-highspeed', provider: 'openai' },
  { label: 'Google Gemini (原生 3.7)', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.7-flash', provider: 'gemini' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' },
];

const hintStyle: React.CSSProperties = { fontSize: '12px', color: '#6b6b70', marginTop: '4px', lineHeight: 1.5 };

export default function Home() {
  const router = useRouter();
  const { settings, setSettings, setActiveFileId, theme, toggleTheme } = useAppContext();
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
    setActiveFileId(id);
    router.push('/translate');
  };

  const deleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("确定要删除这条翻译历史记录吗？")) {
      await deleteHistoryRecord(id);
      loadHistory();
    }
  };

  const saveSettings = () => {
    setSettings(formSettings);
    setIsSettingsOpen(false);
  };

  const isPresetActive = (preset: typeof PROVIDER_PRESETS[0]) => {
    if (preset.provider === 'gemini') {
      return formSettings.provider === 'gemini' || formSettings.baseUrl.includes('googleapis.com');
    }
    return formSettings.baseUrl === preset.baseUrl && formSettings.model === preset.model;
  };

  return (
    <div className={styles.homeContainer}>
      <header className={styles.homeHeader}>
        <div className={styles.brand}>
          <h1>AI PDF Translator</h1>
          <span className={styles.badge}>Astryx 3.7</span>
        </div>
        <div className={styles.controls}>
          <button 
            type="button" 
            className={styles.themeToggleBtn} 
            onClick={toggleTheme}
            title="切换深色/浅色模式"
          >
            {theme === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式'}
          </button>
          <button className={styles.btn} onClick={() => setIsSettingsOpen(true)}>
            ⚙️ 引擎设置
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
          <div className={styles.uploadIcon}>📄</div>
          <div className={styles.uploadTitle}>点击或拖拽上传 PDF 文档</div>
          <div className={styles.uploadDesc}>支持双栏流式翻译、智能预翻译与带署名 Markdown 导出</div>
        </div>

        {/* History Section */}
        <div className={styles.historySection}>
          <h2>历史翻译归档</h2>
          {history.length === 0 ? (
            <div className={styles.emptyText}>暂无历史翻译记录，上传文档即可开启实时精读</div>
          ) : (
            <div className={styles.historyList}>
              {history.map(item => (
                <div key={item.id} className={styles.historyCard} onClick={() => openHistory(item.id)}>
                  <div className={styles.historyInfo}>
                    <h3>{item.filename}</h3>
                    <p>
                      <span className={styles.badge}>已译 {Object.keys(item.translations || {}).length} 页</span>
                      <span>{new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </p>
                  </div>
                  <button className={styles.deleteBtn} onClick={(e) => deleteHistory(e, item.id)} title="删除此记录">
                    🗑️
                  </button>
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
            <h2>翻译引擎与服务商配置</h2>
            <div className={styles.formGroup}>
              <label>选择服务商预设</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {PROVIDER_PRESETS.map(preset => {
                  const active = isPresetActive(preset);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`${styles.presetBtn} ${active ? styles.presetBtnActive : ''}`}
                      onClick={() => setFormSettings({
                        ...formSettings,
                        baseUrl: preset.baseUrl,
                        model: preset.model,
                        provider: preset.provider
                      })}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p style={hintStyle}>
                支持 MiniMax、OpenAI 兼容接口与 Google Gemini 3.x 原生协议。没有 Key？可以先去{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                  Google AI Studio
                </a>{' '}
                免费领一个 Gemini Key（支持 AQ. 授权 Key），再回来点击「Google Gemini」即可。
              </p>
            </div>
            <div className={styles.formGroup}>
              <label>API Key</label>
              <input 
                type="password" 
                value={formSettings.apiKey} 
                onChange={e => setFormSettings({...formSettings, apiKey: e.target.value})}
                placeholder="填入你自己的 API Key (以 AQ. 或 sk- 开头)"
              />
              <p style={hintStyle}>Key 仅保存在浏览器本地 IndexedDB/LocalStorage 中，不会上传服务器。</p>
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
              <label>模型名称 (Model)</label>
              <input 
                type="text" 
                value={formSettings.model} 
                onChange={e => setFormSettings({...formSettings, model: e.target.value})}
                placeholder="例如 gemini-3.7-flash 或 MiniMax-M2.7-highspeed"
              />
            </div>
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>系统翻译提示词 (System Prompt)</label>
                <button 
                  type="button" 
                  className={styles.btnSecondary} 
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => setFormSettings({...formSettings, customPrompt: DEFAULT_SETTINGS.customPrompt})}
                  title="重置为推荐出版级排版提示词"
                >
                  ↺ 恢复推荐提示词
                </button>
              </div>
              <textarea 
                rows={6}
                value={formSettings.customPrompt} 
                onChange={e => setFormSettings({...formSettings, customPrompt: e.target.value})}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setIsSettingsOpen(false)}>取消</button>
              <button className={styles.btn} onClick={saveSettings}>保存设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
