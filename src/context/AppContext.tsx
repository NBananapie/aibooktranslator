"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { LlmProvider } from '@/lib/llm/protocol';

export interface OcrSettings {
  enabled: boolean;
  provider: 'aistudio' | 'custom';
  model: string;
  apiToken: string;
  apiUrl: string;
}

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: LlmProvider;
  providerKeys?: Record<string, string>;
  customPrompt: string;
  ocr: OcrSettings;
  syncKey?: string;
  autoCloudSync?: boolean;
}

export type ReaderFontFamily = 'serif' | 'sans';
export type PreloadCountOption = 0 | 1 | 2 | 4;

export const SETTINGS_VERSION = 'v6.0-no-builtin-key';

/** 已吊销的旧内置 Key 前缀，加载本地设置时清除，避免继续使用 */
const REVOKED_KEY_PREFIXES = ['sk-V9RUJ', 'AQ.Ab8RN6'];

/** 旧版本写入 localStorage 的默认提示词开头，迁移时识别并清空，改用内置提示词 */
const LEGACY_DEFAULT_PROMPT_PREFIX = 'You are an elite bilingual book editor, master translator, and typography architect.';

function isRevokedKey(key?: string): boolean {
  return !!key && REVOKED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  enabled: true,
  provider: 'aistudio',
  model: 'PaddleOCR-VL-1.6',
  apiToken: '',
  apiUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
};

/**
 * apiKey 为空表示使用站点内置额度（由服务端环境变量提供，是否开放取决于部署配置）。
 * customPrompt 为空表示使用内置翻译提示词。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  model: 'agnes-3.0-flash',
  provider: 'openai',
  providerKeys: {
    'agnes': '',
    'minimax': '',
    'gemini': '',
    'openai': '',
  },
  syncKey: '',
  autoCloudSync: true,
  customPrompt: '',
  ocr: DEFAULT_OCR_SETTINGS,
};

export const DEFAULT_FONT_SIZE = 16;

/**
 * 读取 localStorage 中的设置并迁移：
 * - 清除已吊销的旧内置 Key；
 * - 旧版本自动写入的默认提示词清空为 ''（用户自己改过的提示词保留）。
 */
function migrateSettings(parsed: Partial<AppSettings>): AppSettings {
  const providerKeys: Record<string, string> = {
    ...DEFAULT_SETTINGS.providerKeys,
    ...(parsed.providerKeys || {}),
  };
  for (const name of Object.keys(providerKeys)) {
    if (isRevokedKey(providerKeys[name])) providerKeys[name] = '';
  }

  const apiKey = isRevokedKey(parsed.apiKey) ? '' : parsed.apiKey || '';
  const customPrompt = parsed.customPrompt?.trim().startsWith(LEGACY_DEFAULT_PROMPT_PREFIX)
    ? ''
    : parsed.customPrompt || '';

  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    apiKey,
    customPrompt,
    providerKeys,
    ocr: { ...DEFAULT_OCR_SETTINGS, ...(parsed.ocr || {}) },
  };
}

interface AppContextType {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  fontSize: number;
  setFontSize: (size: number | ((prev: number) => number)) => void;
  readerFont: ReaderFontFamily;
  setReaderFont: (font: ReaderFontFamily) => void;
  preloadCount: PreloadCountOption;
  setPreloadCount: (count: PreloadCountOption) => void;
  dimPdfInDark: boolean;
  setDimPdfInDark: (dim: boolean) => void;
  autoAppendCompanionPage: boolean;
  setAutoAppendCompanionPage: (auto: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [theme, setThemeState] = useState<'dark' | 'light'>('light');
  const [fontSize, setFontSizeState] = useState<number>(DEFAULT_FONT_SIZE);
  const [readerFont, setReaderFontState] = useState<ReaderFontFamily>('serif');
  const [preloadCount, setPreloadCountState] = useState<PreloadCountOption>(2);
  const [dimPdfInDark, setDimPdfInDarkState] = useState<boolean>(true);
  const [autoAppendCompanionPage, setAutoAppendCompanionPageState] = useState<boolean>(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const savedSettings = localStorage.getItem('pdf_translator_settings');
    let loaded = DEFAULT_SETTINGS;
    if (savedSettings) {
      try {
        loaded = migrateSettings(JSON.parse(savedSettings) as Partial<AppSettings>);
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    localStorage.setItem('pdf_translator_settings', JSON.stringify(loaded));
    localStorage.setItem('pdf_translator_version', SETTINGS_VERSION);

    // 默认采用暖白纸感浅色主题；若用户曾显式切换过主题则尊重其偏好
    const savedTheme = localStorage.getItem('app_theme');
    const initialTheme: 'light' | 'dark' =
      savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'light';
    document.documentElement.setAttribute('data-theme', initialTheme);

    const savedFontSize = parseFloat(localStorage.getItem('reader_font_size') || '');
    const initialFontSize =
      !isNaN(savedFontSize) && savedFontSize >= 12 && savedFontSize <= 32 ? savedFontSize : DEFAULT_FONT_SIZE;

    const savedFont = localStorage.getItem('reader_font_family');
    const initialFont: ReaderFontFamily = savedFont === 'sans' || savedFont === 'serif' ? savedFont : 'serif';

    const savedPreload = Number(localStorage.getItem('reader_preload_count'));
    const initialPreload: PreloadCountOption =
      savedPreload === 0 || savedPreload === 1 || savedPreload === 2 || savedPreload === 4 ? savedPreload : 2;

    const savedDim = localStorage.getItem('reader_dim_pdf_dark');
    const initialDim = savedDim === null ? true : savedDim === 'true';

    const savedAutoAppend = localStorage.getItem('reader_auto_append_companion');
    const initialAutoAppend = savedAutoAppend === null ? true : savedAutoAppend === 'true';

    // 从 localStorage 读取客户端持久化状态只能在挂载后进行，以避免水合不一致
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettingsState(loaded);
    setThemeState(initialTheme);
    setFontSizeState(initialFontSize);
    setReaderFontState(initialFont);
    setPreloadCountState(initialPreload);
    setDimPdfInDarkState(initialDim);
    setAutoAppendCompanionPageState(initialAutoAppend);
    setIsLoaded(true);
  }, []);

  const setSettings = (newSettings: AppSettings) => {
    setSettingsState(newSettings);
    localStorage.setItem('pdf_translator_settings', JSON.stringify(newSettings));
  };

  const setTheme = (newTheme: 'dark' | 'light') => {
    setThemeState(newTheme);
    localStorage.setItem('app_theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const setFontSize = (sizeOrUpdater: number | ((prev: number) => number)) => {
    setFontSizeState(prev => {
      const nextSize = typeof sizeOrUpdater === 'function' ? sizeOrUpdater(prev) : sizeOrUpdater;
      const clamped = Math.max(12, Math.min(32, Math.round(nextSize * 10) / 10));
      localStorage.setItem('reader_font_size', clamped.toString());
      return clamped;
    });
  };

  const setReaderFont = (font: ReaderFontFamily) => {
    setReaderFontState(font);
    localStorage.setItem('reader_font_family', font);
  };

  const setPreloadCount = (count: PreloadCountOption) => {
    setPreloadCountState(count);
    localStorage.setItem('reader_preload_count', String(count));
  };

  const setDimPdfInDark = (dim: boolean) => {
    setDimPdfInDarkState(dim);
    localStorage.setItem('reader_dim_pdf_dark', String(dim));
  };

  const setAutoAppendCompanionPage = (auto: boolean) => {
    setAutoAppendCompanionPageState(auto);
    localStorage.setItem('reader_auto_append_companion', String(auto));
  };

  if (!isLoaded) return null; // Prevent hydration mismatch

  return (
    <AppContext.Provider
      value={{
        settings,
        setSettings,
        theme,
        setTheme,
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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
