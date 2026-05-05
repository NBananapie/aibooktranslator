"use client";

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';

// Dynamically import the translator to avoid SSR issues with PDF.js
const PdfTranslator = dynamic(() => import('@/components/PdfTranslator'), {
  ssr: false,
});

export default function TranslatePage() {
  const { activeFileId } = useAppContext();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!activeFileId) {
      router.push('/');
    }
  }, [activeFileId, router]);

  if (!mounted || !activeFileId) return null;

  return (
    <main style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <PdfTranslator />
    </main>
  );
}
