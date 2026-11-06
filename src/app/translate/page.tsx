import { Suspense } from 'react';
import TranslateClient from './TranslateClient';

export default function TranslatePage() {
  return (
    <Suspense fallback={null}>
      <TranslateClient />
    </Suspense>
  );
}
