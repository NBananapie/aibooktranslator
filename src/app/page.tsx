"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext, AppSettings, DEFAULT_SETTINGS, DEFAULT_OCR_SETTINGS } from '@/context/AppContext';
import { getAllHistoryMetadata, saveHistoryRecord, HistoryRecord, deleteHistoryRecord, updateHistoryFilename } from '@/lib/db';
import styles from './page.module.css';
import {
  Sun,
  Moon,
  Settings as SettingsIcon,
  UploadCloud,
  FileText,
  Pencil,
  Trash2,
  ScanText,
  RotateCcw,
  Globe,
  Sparkles,
  Check,
  X
} from 'lucide-react';

const PROVIDER_PRESETS: { label: string; baseUrl: string; model: string; provider: 'openai' | 'gemini' | 'custom' }[] = [
  { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7-highspeed', provider: 'openai' },
  { label: 'Google Gemini (2.5 Flash 推荐)', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', provider: 'gemini' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' },
];

const OCR_MODEL_PRESETS = [
  { label: 'PaddleOCR-VL-1.6 (版面/表格/公式解析)', model: 'PaddleOCR-VL-1.6' },
  { label: 'PP-OCRv6 (高精度通用文本识别)', model: 'PP-OCRv6' },
];

const hintStyle: React.CSSProperties = { fontSize: '12px', color: '#6b6b70', marginTop: '4px', lineHeight: 1.5 };

// SVG 环形进度条组件
function ProgressRing({ percent, size = 48, strokeWidth = 4 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = radius * 2 * Math.PI;
  const validPercent = Math.min(100, Math.max(0, percent));
  const offset = circumference - (validPercent / 100) * circumference;

  return (
    <div className={styles.progressRingWrapper} style={{ width: size, height: size }} data-tooltip={`阅读进度: ${validPercent}%`}>
      <svg className={styles.progressRingSvg} width={size} height={size}>
        <circle
          className={styles.progressRingBg}
          strokeWidth={strokeWidth}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={styles.progressRingFill}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset: offset }}
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <span className={styles.progressRingText}>{validPercent}%</span>
    </div>
  );
}

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
  const { settings, setSettings, setActiveFileId, theme, toggleTheme } = useAppContext();
  const [history, setHistory] = useState<Omit<HistoryRecord, 'pdfData'>[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Settings form state
  const [formSettings, setFormSettings] = useState<AppSettings>(settings);

  // Card rename state
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardName, setEditingCardName] = useState<string>('');

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
                        <div className={styles.cardTitleRow}>
                          <h3 data-tooltip={item.filename}>{item.filename}</h3>
                          <button
                            className={styles.iconBtn}
                            onClick={e => startEditingCard(e, item)}
                            data-tooltip="修改文件名"
                            style={{ padding: '3px' }}
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      )}

                      <button className={styles.deleteBtn} onClick={(e) => deleteHistory(e, item.id)} data-tooltip="删除此记录">
                        <Trash2 size={13} />
                      </button>
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
      {isSettingsOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsSettingsOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SettingsIcon size={18} style={{ color: 'var(--primary)' }} /> 引擎与服务商配置
              </h2>
              <button className={styles.iconBtn} onClick={() => setIsSettingsOpen(false)} data-tooltip="关闭">
                <X size={16} />
              </button>
            </div>
            
            {/* LLM 翻译配置板块 */}
            <div className={styles.settingsSectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} style={{ color: 'var(--primary)' }} /> AI 翻译大模型配置
            </div>
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
                免费领一个 Gemini Key，再回来点击「Google Gemini」即可。
              </p>
            </div>
            
            <div className={styles.formGroup}>
              <label>LLM API Key</label>
              <input 
                type="password" 
                value={formSettings.apiKey} 
                onChange={e => setFormSettings({...formSettings, apiKey: e.target.value})}
                placeholder="填入你自己的 API Key (以 AQ. 或 sk- 开头)"
              />
              <p style={hintStyle}>Key 仅保存在浏览器本地，不会上传第三方服务器。</p>
            </div>
            
            <div className={styles.formGroup}>
              <label>LLM Base URL</label>
              <input 
                type="text" 
                value={formSettings.baseUrl} 
                onChange={e => setFormSettings({...formSettings, baseUrl: e.target.value})}
              />
            </div>
            
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>模型名称 (Model)</label>
                {/* 快捷推荐模型 */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(formSettings.provider === 'gemini' || formSettings.baseUrl.includes('googleapis.com')) ? (
                    <>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                        onClick={() => setFormSettings({ ...formSettings, model: 'gemini-2.5-flash' })}
                      >
                        gemini-2.5-flash (推荐)
                      </button>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                        onClick={() => setFormSettings({ ...formSettings, model: 'gemini-2.0-flash-lite' })}
                      >
                        gemini-2.0-flash-lite
                      </button>
                    </>
                  ) : formSettings.baseUrl.includes('minimax') ? (
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      onClick={() => setFormSettings({ ...formSettings, model: 'MiniMax-M2.7-highspeed' })}
                    >
                      MiniMax-M2.7-highspeed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      onClick={() => setFormSettings({ ...formSettings, model: 'gpt-4o-mini' })}
                    >
                      gpt-4o-mini
                    </button>
                  )}
                </div>
              </div>
              <input 
                type="text" 
                value={formSettings.model} 
                onChange={e => setFormSettings({...formSettings, model: e.target.value})}
                placeholder="例如 gemini-2.5-flash 或 MiniMax-M2.7-highspeed"
              />
            </div>

            {/* 百度飞桨 PaddleOCR 配置专区 */}
            <div className={styles.settingsDivider} />
            <div className={styles.settingsSectionTitle} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ScanText size={14} style={{ color: 'var(--primary)' }} /> 百度飞桨 PaddleOCR 识别配置 (AI Studio)
            </div>
            
            <div className={styles.formGroup}>
              <label>OCR 模型选择</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {OCR_MODEL_PRESETS.map(preset => {
                  const active = (formSettings.ocr?.model || DEFAULT_OCR_SETTINGS.model) === preset.model;
                  return (
                    <button
                      key={preset.model}
                      type="button"
                      className={`${styles.presetBtn} ${active ? styles.presetBtnActive : ''}`}
                      onClick={() => setFormSettings({
                        ...formSettings,
                        ocr: {
                          ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                          model: preset.model,
                        }
                      })}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p style={hintStyle}>
                用于全自动适配扫描件、带复杂表格/公式的书籍与图片 PDF。没有 Access Token？请前往{' '}
                <a href="https://aistudio.baidu.com/paddleocr" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                  百度飞桨 AI Studio (https://aistudio.baidu.com/paddleocr)
                </a>{' '}
                免费注册获取属于您的专属 Access Token。
              </p>
            </div>

            <div className={styles.formGroup}>
              <label>AI Studio Access Token</label>
              <input 
                type="password" 
                value={formSettings.ocr?.apiToken || ''} 
                onChange={e => setFormSettings({
                  ...formSettings,
                  ocr: {
                    ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                    apiToken: e.target.value
                  }
                })}
                placeholder="填入百度飞桨 AI Studio Access Token"
              />
            </div>

            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>PaddleOCR API Endpoint (可选自定义)</label>
                <button 
                  type="button" 
                  className={styles.btnSecondary} 
                  style={{ padding: '2px 6px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                  onClick={() => setFormSettings({
                    ...formSettings,
                    ocr: {
                      ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                      apiUrl: DEFAULT_OCR_SETTINGS.apiUrl
                    }
                  })}
                >
                  <RotateCcw size={10} /> 恢复默认地址
                </button>
              </div>
              <input 
                type="text" 
                value={formSettings.ocr?.apiUrl || ''} 
                onChange={e => setFormSettings({
                  ...formSettings,
                  ocr: {
                    ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                    apiUrl: e.target.value
                  }
                })}
                placeholder="https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
              />
              <p style={hintStyle}>默认使用百度飞桨 AIStudio App v2 异步作业地址。原生 PDF 文本页无需开启 OCR。</p>
            </div>

            {/* 系统提示词 */}
            <div className={styles.settingsDivider} />
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>系统翻译提示词 (System Prompt)</label>
                <button 
                  type="button" 
                  className={styles.btnSecondary} 
                  style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => setFormSettings({...formSettings, customPrompt: DEFAULT_SETTINGS.customPrompt})}
                  data-tooltip="重置为推荐出版级排版提示词"
                >
                  <RotateCcw size={11} /> 恢复推荐提示词
                </button>
              </div>
              <textarea 
                rows={5}
                value={formSettings.customPrompt} 
                onChange={e => setFormSettings({...formSettings, customPrompt: e.target.value})}
              />
            </div>

            <div className={styles.modalActions}>
              <a 
                href="https://justganit.com" 
                target="_blank" 
                rel="noopener noreferrer" 
                className={styles.btnSecondary}
                style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                data-tooltip="访问 JustGanIt 探索更多 AI 工具"
              >
                <Globe size={14} /> 联系开发者 (JustGanIt)
              </a>
              <button className={styles.btnSecondary} onClick={() => setIsSettingsOpen(false)}>取消</button>
              <button className={styles.btn} onClick={saveSettings}>保存设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

