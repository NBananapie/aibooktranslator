"use client";

import React, { useState, useEffect } from 'react';
import { useAppContext, AppSettings, DEFAULT_SETTINGS, DEFAULT_OCR_SETTINGS } from '@/context/AppContext';
import styles from '@/app/page.module.css';
import {
  Settings as SettingsIcon,
  RotateCcw,
  Globe,
  Sparkles,
  ScanText,
  X,
} from 'lucide-react';

const PROVIDER_PRESETS: { label: string; baseUrl: string; model: string; provider: 'openai' | 'gemini' | 'custom' }[] = [
  { label: 'Agnes (3.0 Flash 默认)', baseUrl: 'https://apihub.agnes-ai.com/v1', model: 'agnes-3.0-flash', provider: 'openai' },
  { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7-highspeed', provider: 'openai' },
  { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.5-flash-lite', provider: 'gemini' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' },
];

const OCR_MODEL_PRESETS = [
  { label: 'PaddleOCR-VL-1.6 (版面/表格/公式解析)', model: 'PaddleOCR-VL-1.6' },
  { label: 'PP-OCRv6 (高精度通用文本识别)', model: 'PP-OCRv6' },
];

const hintStyle: React.CSSProperties = { fontSize: '12px', color: '#6b6b70', marginTop: '4px', lineHeight: 1.5 };

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, setSettings } = useAppContext();
  const [formSettings, setFormSettings] = useState<AppSettings>(settings);
  const isBackdropMouseDownRef = React.useRef(false);

  useEffect(() => {
    if (isOpen) {
      setFormSettings(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const getPresetKey = (cfg: { baseUrl: string; provider?: string }): string => {
    if (cfg.baseUrl.includes('agnes-ai.com')) return 'agnes';
    if (cfg.baseUrl.includes('googleapis.com') || cfg.provider === 'gemini') return 'gemini';
    if (cfg.baseUrl.includes('minimax')) return 'minimax';
    return 'openai';
  };

  const handleApiKeyChange = (newKey: string) => {
    const currentPKey = getPresetKey(formSettings);
    setFormSettings(prev => ({
      ...prev,
      apiKey: newKey,
      providerKeys: {
        ...(prev.providerKeys || {}),
        [currentPKey]: newKey,
      },
    }));
  };

  const handleSwitchPreset = (preset: typeof PROVIDER_PRESETS[0]) => {
    const currentPKey = getPresetKey(formSettings);
    const targetPKey = getPresetKey(preset);

    const updatedKeys = {
      ...(formSettings.providerKeys || {}),
      [currentPKey]: formSettings.apiKey,
    };

    const targetKey =
      updatedKeys[targetPKey] !== undefined
        ? updatedKeys[targetPKey]
        : targetPKey === 'agnes'
        ? DEFAULT_SETTINGS.apiKey
        : '';

    setFormSettings({
      ...formSettings,
      baseUrl: preset.baseUrl,
      model: preset.model,
      provider: preset.provider,
      apiKey: targetKey,
      providerKeys: updatedKeys,
    });
  };

  const saveSettings = () => {
    const currentPKey = getPresetKey(formSettings);
    const finalSettings: AppSettings = {
      ...formSettings,
      providerKeys: {
        ...(formSettings.providerKeys || {}),
        [currentPKey]: formSettings.apiKey,
      },
    };
    setSettings(finalSettings);
    onClose();
  };

  const isPresetActive = (preset: typeof PROVIDER_PRESETS[0]) => {
    if (preset.provider === 'gemini') {
      return formSettings.provider === 'gemini' || formSettings.baseUrl.includes('googleapis.com');
    }
    return formSettings.baseUrl === preset.baseUrl && formSettings.model === preset.model;
  };

  return (
    <div
      className={styles.modalOverlay}
      onMouseDown={e => {
        isBackdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        if (e.target === e.currentTarget && isBackdropMouseDownRef.current) {
          onClose();
        }
        isBackdropMouseDownRef.current = false;
      }}
    >
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <SettingsIcon size={18} style={{ color: 'var(--primary)' }} /> 引擎与服务商配置
          </h2>
          <button className={styles.iconBtn} onClick={onClose} data-tooltip="关闭">
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
                  onClick={() => handleSwitchPreset(preset)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <p style={hintStyle}>
            默认集成 Agnes 3.0 Flash 极速引擎，兼容 MiniMax、OpenAI 接口与 Google Gemini 3.x。
          </p>
        </div>

        <div className={styles.formGroup}>
          <label>LLM API Key</label>
          <input 
            type="password" 
            value={formSettings.apiKey} 
            onChange={e => handleApiKeyChange(e.target.value)}
            placeholder="填入你自己的 API Key (以 sk- 或 AQ. 开头)"
          />
          <p style={hintStyle}>Key 仅加密存储于浏览器本地，不经过任何第三方中转。</p>
        </div>

        <div className={styles.formGroup}>
          <label>LLM Base URL</label>
          <input 
            type="text" 
            value={formSettings.baseUrl} 
            onChange={e => setFormSettings({ ...formSettings, baseUrl: e.target.value })}
          />
        </div>

        <div className={styles.formGroup}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>模型名称 (Model)</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ padding: '2px 6px', fontSize: '10px' }}
                onClick={() => setFormSettings({ ...formSettings, model: 'agnes-3.0-flash' })}
              >
                agnes-3.0-flash
              </button>
              {(formSettings.provider === 'gemini' || formSettings.baseUrl.includes('googleapis.com')) ? (
                <>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                    onClick={() => setFormSettings({ ...formSettings, model: 'gemini-3.5-flash-lite' })}
                  >
                    gemini-3.5-flash-lite
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                    onClick={() => setFormSettings({ ...formSettings, model: 'gemini-2.5-flash' })}
                  >
                    gemini-2.5-flash
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
            onChange={e => setFormSettings({ ...formSettings, model: e.target.value })}
            placeholder="例如 agnes-3.0-flash, gemini-3.5-flash-lite 等"
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
            用于全自动适配扫描件、带复杂表格/公式的书籍与图片 PDF。获取 Access Token 请访问{' '}
            <a href="https://aistudio.baidu.com/paddleocr" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              百度飞桨 AI Studio
            </a>。
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
              onClick={() => setFormSettings({ ...formSettings, customPrompt: DEFAULT_SETTINGS.customPrompt })}
              data-tooltip="重置为极速出版级提示词"
            >
              <RotateCcw size={11} /> 恢复推荐提示词
            </button>
          </div>
          <textarea 
            rows={5}
            value={formSettings.customPrompt} 
            onChange={e => setFormSettings({ ...formSettings, customPrompt: e.target.value })}
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
          <button type="button" className={styles.btnSecondary} onClick={onClose}>取消</button>
          <button type="button" className={styles.btn} onClick={saveSettings}>保存设置</button>
        </div>
      </div>
    </div>
  );
}
