"use client";

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';

// PDF.js 依赖浏览器环境，阅读器只在客户端渲染
const PdfTranslator = dynamic(() => import('@/components/PdfTranslator'), {
  ssr: false,
});

/** 阅读页：书籍 id 放在 URL 中（/translate?id=...），刷新或收藏链接后仍可打开同一本书 */
export default function TranslateClient() {
  const router = useRouter();
  const fileId = useSearchParams().get('id');

  useEffect(() => {
    if (!fileId) router.replace('/');
  }, [fileId, router]);

  if (!fileId) return null;

  return (
    <main style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <PdfTranslator key={fileId} fileId={fileId} />
    </main>
  );
}
