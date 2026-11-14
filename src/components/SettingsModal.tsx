"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext, AppSettings, DEFAULT_OCR_SETTINGS } from '@/context/AppContext';
import { useToast } from '@/components/Toast';
import { buildDefaultTranslatePrompt } from '@/lib/llm/prompts';
import styles from '@/app/page.module.css';
import {
  RotateCcw,
  Globe,
  Sparkles,
  ScanText,
  X,
  Cloud,
  Key,
  RefreshCw,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { testCloudSyncConnection } from '@/services/cloudSyncService';
import { isStrongSyncKey, generateStrongSyncKey } from '@/lib/crypto';

const PROVIDER_PRESETS: { label: string; baseUrl: string; model: string; provider: 'openai' | 'gemini' | 'custom' }[] = [
  { label: 'Agnes 3.0 Flash', baseUrl: 'https://apihub.agnes-ai.com/v1', model: 'agnes-3.0-flash', provider: 'openai' },
  { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.5-flash-lite', provider: 'gemini' },
  { label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.7-highspeed', provider: 'openai' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', provider: 'openai' },
];

const OCR_MODEL_PRESETS = [
  { label: 'PaddleOCR-VL-1.6 (版面/表格/公式解析)', model: 'PaddleOCR-VL-1.6' },
  { label: 'PP-OCRv6 (高精度通用文本识别)', model: 'PP-OCRv6' },
];

export type SettingsTabId = 'llm' | 'ocr' | 'sync';

export interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTabId;
  onClose: () => void;
}

export function SettingsModal({ isOpen, initialTab = 'llm', onClose }: SettingsModalProps) {
  const router = useRouter();
  const { settings, setSettings } = useAppContext();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [showAdvancedLlm, setShowAdvancedLlm] = useState<boolean>(false);
  const [formSettings, setFormSettings] = useState<AppSettings>(settings);
  const [syncTestStatus, setSyncTestStatus] = useState<{
    testing: boolean;
    message?: string;
    success?: boolean;
  }>({ testing: false });
  const isBackdropMouseDownRef = React.useRef(false);

  // 每次打开时同步当前设置与指定初始分栏（渲染期间对比，零额外 effect）
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  if (isOpen !== wasOpen || initialTab !== prevInitialTab) {
    setWasOpen(isOpen);
    setPrevInitialTab(initialTab);
    if (isOpen) {
      setFormSettings(settings);
      setActiveTab(initialTab);
      setSyncTestStatus({ testing: false });
      setShowAdvancedLlm(Boolean(settings.customPrompt?.trim()));
    }
  }

  if (!isOpen) return null;

  const generateRandomSyncKey = () => {
    const key = generateStrongSyncKey();
    setFormSettings(prev => ({ ...prev, syncKey: key }));
    setSyncTestStatus({ testing: false });
  };

  const handleTestSync = async () => {
    if (!formSettings.syncKey?.trim()) {
      setSyncTestStatus({ testing: false, success: false, message: '请先输入或生成同步口令' });
      return;
    }
    if (!isStrongSyncKey(formSettings.syncKey)) {
      setSyncTestStatus({
        testing: false,
        success: false,
        message: '口令长度不足：需至少 16 位高熵字符以保证端到端加密安全',
      });
      return;
    }
    setSyncTestStatus({ testing: true, message: '正在验证 Cloudflare D1 安全连接...' });
    const result = await testCloudSyncConnection(formSettings.syncKey);
    if (result.success) {
      setSyncTestStatus({
        testing: false,
        success: true,
        message: `连接成功，云端已有 ${result.count} 本书籍同步记录（AES-GCM 端到端加密已启用）。`,
      });
    } else {
      setSyncTestStatus({
        testing: false,
        success: false,
        message: `连接失败: ${result.error}`,
      });
    }
  };

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

  const handleSwitchPreset = (preset: (typeof PROVIDER_PRESETS)[0]) => {
    const currentPKey = getPresetKey(formSettings);
    const targetPKey = getPresetKey(preset);

    const updatedKeys = {
      ...(formSettings.providerKeys || {}),
      [currentPKey]: formSettings.apiKey,
    };

    const targetKey = updatedKeys[targetPKey] ?? '';

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
    if (formSettings.syncKey && formSettings.syncKey.trim()) {
      if (!isStrongSyncKey(formSettings.syncKey)) {
        setActiveTab('sync');
        setSyncTestStatus({
          testing: false,
          success: false,
          message: '保存未通过：同步口令需至少 16 位字符，建议点击「随机生成口令」',
        });
        return;
      }
    }
    const currentPKey = getPresetKey(formSettings);
    const finalSettings: AppSettings = {
      ...formSettings,
      providerKeys: {
        ...(formSettings.providerKeys || {}),
        [currentPKey]: formSettings.apiKey,
      },
    };
    setSettings(finalSettings);
    showToast('偏好与引擎配置已保存', 'success');
    onClose();
  };

  const isPresetActive = (preset: (typeof PROVIDER_PRESETS)[0]) => {
    if (preset.provider === 'gemini') {
      return formSettings.provider === 'gemini' || formSettings.baseUrl.includes('googleapis.com');
    }
    return formSettings.baseUrl === preset.baseUrl && formSettings.model === preset.model;
  };

  return (
    <div
      className={styles.modalOverlay}
      data-interactive-protected="true"
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
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle}>引擎与阅读偏好</h2>
            <p className={styles.modalSubtitle}>密钥仅加密保存在当前浏览器本地，支持直连主流大模型</p>
          </div>
          <button
            type="button"
            className={styles.headerIconBtn}
            onClick={onClose}
            aria-label="关闭设置"
          >
            <X size={16} />
          </button>
        </div>

        {/* 三栏渐进披露导航 */}
        <div className={styles.modalTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'llm'}
            className={`${styles.modalTab} ${activeTab === 'llm' ? styles.modalTabActive : ''}`}
            onClick={() => setActiveTab('llm')}
          >
            <Sparkles size={13} />
            <span>AI 翻译引擎</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ocr'}
            className={`${styles.modalTab} ${activeTab === 'ocr' ? styles.modalTabActive : ''}`}
            onClick={() => setActiveTab('ocr')}
          >
            <ScanText size={13} />
            <span>扫描件 OCR</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sync'}
            className={`${styles.modalTab} ${activeTab === 'sync' ? styles.modalTabActive : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <Cloud size={13} />
            <span>多端云同步</span>
          </button>
        </div>

        <div className={styles.modalBody}>
          {activeTab === 'llm' && (
            <>
              <div className={styles.formGroup}>
                <label>服务商预设</label>
                <div className={styles.presetGrid}>
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
              </div>

              <div className={styles.formGroup}>
                <div className={styles.formLabelRow}>
                  <label>API Key</label>
                  <a
                    href="https://apihub.agnes-ai.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.formExternalLink}
                  >
                    获取免费 Agnes API Key →
                  </a>
                </div>
                <input
                  type="password"
                  value={formSettings.apiKey}
                  onChange={e => handleApiKeyChange(e.target.value)}
                  placeholder="粘贴当前服务商的 API Key"
                />
                <p className={styles.settingsHint}>
                  各服务商的 API Key 独立记忆，切换预设时无需重复粘贴。优先由浏览器直连，跨域受限时自动经无状态代理转发。
                </p>
              </div>

              <div className={styles.formGroup}>
                <div className={styles.formLabelRow}>
                  <label>模型名称 (Model)</label>
                  <div className={styles.modelQuickPills}>
                    <button
                      type="button"
                      className={styles.modelQuickPill}
                      onClick={() => setFormSettings({ ...formSettings, model: 'agnes-3.0-flash' })}
                    >
                      agnes-3.0-flash
                    </button>
                    {formSettings.provider === 'gemini' ||
                    formSettings.baseUrl.includes('googleapis.com') ? (
                      <>
                        <button
                          type="button"
                          className={styles.modelQuickPill}
                          onClick={() =>
                            setFormSettings({ ...formSettings, model: 'gemini-3.5-flash-lite' })
                          }
                        >
                          gemini-3.5-flash-lite
                        </button>
                        <button
                          type="button"
                          className={styles.modelQuickPill}
                          onClick={() =>
                            setFormSettings({ ...formSettings, model: 'gemini-2.5-flash' })
                          }
                        >
                          gemini-2.5-flash
                        </button>
                      </>
                    ) : formSettings.baseUrl.includes('minimax') ? (
                      <button
                        type="button"
                        className={styles.modelQuickPill}
                        onClick={() =>
                          setFormSettings({ ...formSettings, model: 'MiniMax-M2.7-highspeed' })
                        }
                      >
                        MiniMax-M2.7-highspeed
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.modelQuickPill}
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
                  placeholder="例如 agnes-3.0-flash"
                />
              </div>

              {/* 渐进披露：自定义 Base URL 与系统提示词 */}
              <button
                type="button"
                className={styles.advancedToggleBtn}
                onClick={() => setShowAdvancedLlm(prev => !prev)}
              >
                <span>高级选项（自定义接口地址与翻译提示词）</span>
                {showAdvancedLlm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showAdvancedLlm && (
                <div className={styles.advancedPanel}>
                  <div className={styles.formGroup}>
                    <label>接口地址 (Base URL)</label>
                    <input
                      type="text"
                      value={formSettings.baseUrl}
                      onChange={e => setFormSettings({ ...formSettings, baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                    <div className={styles.formLabelRow}>
                      <label>系统翻译提示词 (System Prompt)</label>
                      <button
                        type="button"
                        className={styles.modelQuickPill}
                        onClick={() => setFormSettings({ ...formSettings, customPrompt: '' })}
                      >
                        <RotateCcw size={10} />
                        <span>恢复默认出版级提示词</span>
                      </button>
                    </div>
                    <textarea
                      rows={4}
                      value={formSettings.customPrompt}
                      onChange={e =>
                        setFormSettings({ ...formSettings, customPrompt: e.target.value })
                      }
                      placeholder={buildDefaultTranslatePrompt()}
                    />
                    <p className={styles.settingsHint}>留空时默认使用内置出版级信达雅提示词。</p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'ocr' && (
            <>
              <div className={styles.formGroup}>
                <label>识别引擎选择</label>
                <div className={styles.presetGrid}>
                  {OCR_MODEL_PRESETS.map(preset => {
                    const active =
                      (formSettings.ocr?.model || DEFAULT_OCR_SETTINGS.model) === preset.model;
                    return (
                      <button
                        key={preset.model}
                        type="button"
                        className={`${styles.presetBtn} ${active ? styles.presetBtnActive : ''}`}
                        onClick={() =>
                          setFormSettings({
                            ...formSettings,
                            ocr: {
                              ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                              model: preset.model,
                            },
                          })
                        }
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <p className={styles.settingsHint}>
                  针对影印古籍、扫描版书籍及复杂公式表格页面，提取高保真 Markdown 版面。前往{' '}
                  <a
                    href="https://aistudio.baidu.com/paddleocr"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    百度飞桨 AI Studio
                  </a>{' '}
                  可免费获取个人 Access Token。
                </p>
              </div>

              <div className={styles.formGroup}>
                <label>AI Studio Access Token</label>
                <input
                  type="password"
                  value={formSettings.ocr?.apiToken || ''}
                  onChange={e =>
                    setFormSettings({
                      ...formSettings,
                      ocr: {
                        ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                        apiToken: e.target.value,
                      },
                    })
                  }
                  placeholder="粘贴百度飞桨 AI Studio Access Token"
                />
              </div>

              <div className={styles.formGroup}>
                <div className={styles.formLabelRow}>
                  <label>PaddleOCR 接口地址（可选）</label>
                  <button
                    type="button"
                    className={styles.modelQuickPill}
                    onClick={() =>
                      setFormSettings({
                        ...formSettings,
                        ocr: {
                          ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                          apiUrl: DEFAULT_OCR_SETTINGS.apiUrl,
                        },
                      })
                    }
                  >
                    <RotateCcw size={10} />
                    <span>恢复默认</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={formSettings.ocr?.apiUrl || ''}
                  onChange={e =>
                    setFormSettings({
                      ...formSettings,
                      ocr: {
                        ...(formSettings.ocr || DEFAULT_OCR_SETTINGS),
                        apiUrl: e.target.value,
                      },
                    })
                  }
                  placeholder={DEFAULT_OCR_SETTINGS.apiUrl}
                />
              </div>
            </>
          )}

          {activeTab === 'sync' && (
            <>
              <div className={styles.formGroup}>
                <div className={styles.formLabelRow}>
                  <label>端到端加密同步口令 (Sync Key)</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className={styles.modelQuickPill}
                      onClick={generateRandomSyncKey}
                    >
                      <Key size={11} />
                      <span>随机生成新口令</span>
                    </button>
                    <button
                      type="button"
                      className={styles.modelQuickPill}
                      onClick={() => {
                        onClose();
                        router.push('/sync');
                      }}
                    >
                      <span>管理云端书架 →</span>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={formSettings.syncKey || ''}
                    onChange={e => setFormSettings({ ...formSettings, syncKey: e.target.value })}
                    placeholder="至少 16 位字符，推荐点击右上角随机生成"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleTestSync}
                    disabled={syncTestStatus.testing}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <RefreshCw size={13} className={syncTestStatus.testing ? styles.spinAnim : ''} />
                    <span>{syncTestStatus.testing ? '检测中' : '测试连接'}</span>
                  </button>
                </div>

                {formSettings.syncKey &&
                  formSettings.syncKey.trim().length > 0 &&
                  formSettings.syncKey.trim().length < 16 && (
                    <p className={styles.statusInlineError}>
                      当前 {formSettings.syncKey.trim().length} 位，需至少 16 位字符以启用 AES-GCM 端到端加密
                    </p>
                  )}

                {formSettings.syncKey && formSettings.syncKey.trim().length >= 16 && (
                  <p className={styles.statusInlineSuccess}>
                    <Check size={12} />
                    <span>口令强度达标，本地 AES-GCM 256 位加密已就绪</span>
                  </p>
                )}

                {syncTestStatus.message && (
                  <p
                    className={
                      syncTestStatus.success ? styles.statusInlineSuccess : styles.statusInlineError
                    }
                  >
                    {syncTestStatus.message}
                  </p>
                )}

                <p className={styles.settingsHint}>
                  无需上传体积庞大的 PDF 原件。多台设备输入相同口令并打开同一本本地 PDF，即按文件 SHA-256 指纹自动拉取已译章节、阅读进度与书摘。
                </p>
              </div>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={formSettings.autoCloudSync !== false}
                  onChange={e =>
                    setFormSettings({ ...formSettings, autoCloudSync: e.target.checked })
                  }
                />
                <span>翻译、翻页或新增书摘时静默增量同步至云端</span>
              </label>
            </>
          )}
        </div>

        <div className={styles.modalActions}>
          <a
            href="https://justganit.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.formExternalLink}
            style={{ marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <Globe size={13} />
            <span>JustGanIt</span>
          </a>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            取消
          </button>
          <button type="button" className={styles.btn} onClick={saveSettings}>
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
