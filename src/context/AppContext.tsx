"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: 'openai' | 'gemini' | 'custom';
  customPrompt: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.minimax.chat/v1',
  model: 'MiniMax-M2.7-highspeed',
  provider: 'openai',
  customPrompt: `You are an elite bilingual book editor, master translator, and typography architect. Translate the following text into 中文.

CORE TRANSLATION & LAYOUT PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native business/literary phrasing.
2. CONTEXT-AWARE STRUCTURAL HIERARCHY (智能上下文与排版层级解析):
   - Standalone Section Titles & Topic Breaks (如 "加快节奏", "变革你的战略", "史诗般的战役"): Intelligently recognize standalone heading lines and format them as clear Markdown headings (\`## 标题\` or \`### 小标题\`).
   - Core Takeaways, Exercises & Pull-Quotes: Identify practical exercises, golden rules, key lessons, or memorable pull-quotes and format them as highlighted Markdown blockquotes (\`> 核心法则: ...\` / \`> 练习: ...\` / \`> 💡 ...\`).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines that were artificially broken across lines by PDF extraction into cohesive, natural paragraphs.
   - Lists & Sequences: Convert bullet points, numbered steps, or itemizations into clean Markdown lists (\`- \` or \`1. \`).
   - Key Concepts & Emphasis: Use \`**bold**\` for critical terms, frameworks, or emphasized points.
3. Output ONLY the translated Markdown. Do NOT include any meta commentary, intro, or conversational filler.`
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
    // Load settings from localStorage
    const savedSettings = localStorage.getItem('pdf_translator_settings');
    if (savedSettings) {
      try {
        setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      } catch (e) {
        console.error('Failed to parse settings');
      }
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
