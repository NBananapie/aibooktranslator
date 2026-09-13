"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
  provider?: 'openai' | 'gemini' | 'custom';
  customPrompt: string;
  ocr: OcrSettings;
}

export const SETTINGS_VERSION = 'v5.1-stream-speed';

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  enabled: true,
  provider: 'aistudio',
  model: 'PaddleOCR-VL-1.6',
  apiToken: '',
  apiUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: 'sk-V9RUJxxDq21mUkgN9eVjIdz1Lm7s1h1OUb2SuYVfkjxku0Id',
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  model: 'agnes-3.0-flash',
  provider: 'openai',
  customPrompt: `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into elegant, publishable Chinese Markdown.

CORE PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native phrasing.
2. PRESERVE STRUCTURE & TYPOGRAPHY:
   - Section Headings: Format headings as clear Markdown headings (## 标题 or ### 小标题).
   - Core Takeaways & Quotes: Format notable quotes or key points as blockquotes (> ...).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (-  or 1. ).
   - Key Terms: Use **bold** for critical concepts and technical terms.
3. OUTPUT FORMAT:
   Output ONLY the translated Chinese Markdown. Do NOT include conversational filler, notes, or JSON metadata.`,
  ocr: DEFAULT_OCR_SETTINGS,
};

interface AppContextType {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  activeFileId: string | null;
  setActiveFileId: (id: string | null) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load settings from localStorage with auto-migration to latest Agnes defaults
    const savedSettings = localStorage.getItem('pdf_translator_settings');
    const savedSettingsVersion = localStorage.getItem('pdf_translator_version');
    
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        
        // 自动迁移检测：如果是旧版本的默认配置或旧模型，自动无缝升级到 Agnes 3.0 Flash
        const isOldDefaultKey = !parsed.apiKey || parsed.apiKey.startsWith('AQ.Ab8RN6');
        const isOldDefaultModel = parsed.model === 'gemini-3.5-flash-lite' || parsed.model === 'MiniMax-M2.7-highspeed';
        
        if (savedSettingsVersion !== SETTINGS_VERSION || isOldDefaultKey || isOldDefaultModel) {
          if (isOldDefaultKey) {
            parsed.apiKey = DEFAULT_SETTINGS.apiKey;
          }
          if (isOldDefaultModel || parsed.baseUrl?.includes('googleapis.com')) {
            parsed.baseUrl = DEFAULT_SETTINGS.baseUrl;
            parsed.model = DEFAULT_SETTINGS.model;
            parsed.provider = DEFAULT_SETTINGS.provider;
          }
          parsed.customPrompt = DEFAULT_SETTINGS.customPrompt;
          localStorage.setItem('pdf_translator_version', SETTINGS_VERSION);
        }

        const mergedOcr: OcrSettings = {
          ...DEFAULT_OCR_SETTINGS,
          ...(parsed.ocr || {})
        };
        const mergedSettings: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          ocr: mergedOcr
        };
        localStorage.setItem('pdf_translator_settings', JSON.stringify(mergedSettings));
        setSettingsState(mergedSettings);
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    } else {
      localStorage.setItem('pdf_translator_version', SETTINGS_VERSION);
      localStorage.setItem('pdf_translator_settings', JSON.stringify(DEFAULT_SETTINGS));
    }

    // Load theme from localStorage
    const savedTheme = localStorage.getItem('app_theme') as 'dark' | 'light' | null;
    const initialTheme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
    setThemeState(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);

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
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  };

  if (!isLoaded) return null; // Prevent hydration mismatch

  return (
    <AppContext.Provider value={{ 
      settings, 
      setSettings, 
      activeFileId, 
      setActiveFileId, 
      theme, 
      setTheme, 
      toggleTheme 
    }}>
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
