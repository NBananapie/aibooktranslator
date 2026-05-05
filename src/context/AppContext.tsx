"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  customPrompt: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.minimax.chat/v1',
  customPrompt: `You are a professional translator. Translate the following text into 中文. 
          
IMPORTANT RULES:
1. Translate with the principle of "信达雅" (Faithful, Expressive, Elegant). Ensure the Chinese translation reads naturally, beautifully, and professionally to a native speaker.
2. Accurately convey the original author's underlying meaning, tone, and metaphors. Do not just translate literally; capture the essence.
3. Preserve the EXACT original formatting, paragraph structure, and line breaks. If there are headings, lists, or code blocks, keep them in Markdown format.
4. Output ONLY the translated text in Markdown. Do NOT include any conversational filler.`
};

interface AppContextType {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  activeFileId: string | null;
  setActiveFileId: (id: string | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('pdf_translator_settings');
    if (saved) {
      try {
        setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (e) {
        console.error('Failed to parse settings');
      }
    }
    setIsLoaded(true);
  }, []);

  const setSettings = (newSettings: AppSettings) => {
    setSettingsState(newSettings);
    localStorage.setItem('pdf_translator_settings', JSON.stringify(newSettings));
  };

  if (!isLoaded) return null; // Prevent hydration mismatch

  return (
    <AppContext.Provider value={{ settings, setSettings, activeFileId, setActiveFileId }}>
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
