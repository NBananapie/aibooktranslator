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

export const PROMPT_VERSION = 'v4.0-bilingual-map';

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  enabled: true,
  provider: 'aistudio',
  model: 'PaddleOCR-VL-1.6',
  apiToken: '',
  apiUrl: 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
};

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.minimax.chat/v1',
  model: 'MiniMax-M2.7-highspeed',
  provider: 'openai',
  customPrompt: `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into 中文.

CORE TRANSLATION & LAYOUT PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native business/literary phrasing.
2. CONTEXT-AWARE STRUCTURAL HIERARCHY:
   - Standalone Section Titles & Topic Breaks: Intelligently format headings as clear Markdown headings (## 标题 or ### 小标题).
   - Core Takeaways, Exercises & Pull-Quotes: Format key lessons or notable quotes as blockquotes (> 核心要义: ...).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (-  or 1. ).
   - Key Concepts & Emphasis: Use **bold** for critical terms.
3. PRECISE SENTENCE-LEVEL BILINGUAL ALIGNMENT MAP:
   At the very end of your response, after the complete translated markdown text, append a hidden JSON comment block mapping each translated sentence to its original English source sentence for bilingual alignment.
   Format EXACTLY like this:
   <!-- BILINGUAL_MAP:
   [
     {"zh": "一段中文翻译句子", "en": "The exact corresponding English sentence."},
     ...
   ]
   -->
4. Output ONLY the translated Markdown followed by the hidden BILINGUAL_MAP comment block. Do NOT include conversational filler.`,
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
    // Load settings from localStorage with auto-migration to latest prompt version
    const savedSettings = localStorage.getItem('pdf_translator_settings');
    const savedPromptVersion = localStorage.getItem('pdf_translator_prompt_version');
    
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (savedPromptVersion !== PROMPT_VERSION) {
          parsed.customPrompt = DEFAULT_SETTINGS.customPrompt;
          localStorage.setItem('pdf_translator_prompt_version', PROMPT_VERSION);
        }
        // Ensure ocr settings exist with fallback defaults
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
        console.error('Failed to parse settings');
      }
    } else {
      localStorage.setItem('pdf_translator_prompt_version', PROMPT_VERSION);
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
