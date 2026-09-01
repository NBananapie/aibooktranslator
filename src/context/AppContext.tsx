"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: 'openai' | 'gemini' | 'custom';
  customPrompt: string;
}

export const PROMPT_VERSION = 'v3.8-typography-amber';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.minimax.chat/v1',
  model: 'MiniMax-M2.7-highspeed',
  provider: 'openai',
  customPrompt: `You are an elite bilingual book translator and publishing editor. Translate the following text into 中文.

TRANSLATION & TYPOGRAPHY STANDARDS:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a published Chinese masterwork with natural, fluent, native phrasing.
2. Structure & Markdown:
   - Preserve all Markdown headings (##, ###), lists (-), and blockquotes (>).
   - If standalone lines represent chapter or section titles (e.g. "加快节奏", "变革你的战略", "史诗般的战役"), format them as Markdown headings (## 标题 or ### 小标题).
   - Format practical exercises, key takeaways, or golden rules as highlighted blockquotes (> 核心法则: ... / > 练习: ... / > 💡 ...).
   - Intelligently stitch together lines that were broken mid-sentence into cohesive paragraphs.
3. Output ONLY the translated Markdown. Do NOT include any conversational meta commentary.`
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
          localStorage.setItem('pdf_translator_settings', JSON.stringify({ ...DEFAULT_SETTINGS, ...parsed }));
        }
        setSettingsState({ ...DEFAULT_SETTINGS, ...parsed });
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
