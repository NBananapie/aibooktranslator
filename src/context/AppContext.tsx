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
  customPrompt: `You are a professional translator. Translate the following text into 中文. 
          
IMPORTANT RULES:
1. Translate with the principle of "信达雅" (Faithful, Expressive, Elegant). Ensure the Chinese translation reads naturally, beautifully, and professionally to a native speaker.
2. Accurately convey the original author's underlying meaning, tone, and metaphors. Do not just translate literally; capture the essence.
3. Preserve the EXACT original formatting, paragraph structure, and line breaks. If there are headings, lists, or code blocks, keep them in Markdown format.
4. HIGHLIGHT CALLOUTS & EXERCISES:
   - When encountering practical exercises, action items, key takeaways, tips, warnings, or case studies (e.g. text starting with "Exercise:", "• Exercise:", "Takeaway:", "Note:", "Action Item:"), ALWAYS format them as Markdown blockquotes starting with \`> 练习: \` or \`> 核心要点: \` or \`> 提示: \` to ensure consistent, beautiful card formatting.
5. Output ONLY the translated text in Markdown. Do NOT include any conversational filler.`
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
