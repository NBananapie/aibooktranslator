/**
 * PDF 文本提取、模型输出清洗与原文定位（纯函数，无 DOM 依赖）。
 */

import type { LayoutTextItem } from './layoutAnalysisEngine';

/** 定位所需的 TextItem 字段 */
export type LocatableTextItem = Pick<LayoutTextItem, 'str' | 'transform' | 'width'>;

/**
 * 按字号与行距把 TextItem 拼接为 Markdown 文本。
 * 字号明显大于正文（≥ 1.2 倍）的行标记为二级标题。版面分析得不到段落块时作为兜底使用。
 */
export function extractPdfTextWithHierarchy(items: LayoutTextItem[]): string {
  if (!items || items.length === 0) return '';

  // 统计正文字号（出现次数最多的字号）
  const sizeCounts: Record<number, number> = {};
  let bodyFontSize = 10;
  let maxCount = 0;
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const size = Math.round(Math.abs(item.transform[3]) || item.height || 10);
    if (size <= 0) continue;
    sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    if (sizeCounts[size] > maxCount) {
      maxCount = sizeCounts[size];
      bodyFontSize = size;
    }
  }

  let extracted = '';
  let lastY: number | undefined;
  let inHeading = false;

  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;
    const str = item.str || '';
    const fontSize = Math.round(Math.abs(item.transform[3]) || item.height || bodyFontSize);
    const currentY = item.transform[5];
    const isHeadingFont = fontSize >= bodyFontSize * 1.2 && fontSize > bodyFontSize + 1.5;

    if (lastY !== undefined) {
      const yDiff = Math.abs(lastY - currentY);
      if (yDiff > 13 || isHeadingFont || inHeading) {
        extracted += '\n\n';
        inHeading = false;
      } else if (yDiff > 4) {
        extracted += '\n';
      }
    }

    if (isHeadingFont && str.trim().length > 0 && !inHeading) {
      if (!extracted.endsWith('\n\n') && extracted.length > 0) {
        extracted += '\n\n';
      }
      extracted += '## ';
      inHeading = true;
    }

    extracted += str;
    if (item.hasEOL) {
      extracted += '\n';
      inHeading = false;
    }

    if (str.trim() !== '') {
      lastY = currentY;
    }
  }

  return extracted.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 清洗模型输出：去掉 <think> 思考过程（含未闭合的流式片段）以及模型偶尔附带的 HTML 注释。
 */
export function parseTranslationOutput(rawText: string): { cleanMarkdown: string } {
  if (!rawText) return { cleanMarkdown: '' };
  const cleanMarkdown = rawText
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .trim();
  return { cleanMarkdown };
}

function toWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * 在页面 TextItem 中查找与给定英文句子连续匹配的部分，返回命中的 TextItem。
 * 匹配单词数需达到句子单词数的 65%（短句需全部命中），避免零散单词误命中。
 */
export function findContiguousItemsForSentence<T extends LocatableTextItem>(sentence: string, items: T[]): T[] {
  if (!sentence.trim() || items.length === 0) return [];

  const targetWords = toWords(sentence);
  if (targetWords.length === 0) return [];

  const flatWords: Array<{ word: string; itemIdx: number }> = [];
  items.forEach((item, idx) => {
    for (const w of toWords(item.str || '')) flatWords.push({ word: w, itemIdx: idx });
  });
  if (flatWords.length === 0) return [];

  let bestStart = -1;
  let bestLen = 0;
  for (let k = 0; k < targetWords.length; k++) {
    for (let i = 0; i < flatWords.length; i++) {
      if (flatWords[i].word !== targetWords[k]) continue;
      let m = 0;
      while (k + m < targetWords.length && i + m < flatWords.length && flatWords[i + m].word === targetWords[k + m]) {
        m++;
      }
      if (m > bestLen) {
        bestLen = m;
        bestStart = i;
      }
    }
  }

  const minMatchLen = targetWords.length <= 2 ? targetWords.length : Math.max(3, Math.floor(targetWords.length * 0.65));
  if (bestStart < 0 || bestLen < minMatchLen) return [];

  const matched = new Set<number>();
  for (let f = bestStart; f < bestStart + bestLen; f++) matched.add(flatWords[f].itemIdx);
  return items.filter((_, idx) => matched.has(idx));
}

export interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把 TextItem 的 PDF 坐标换算为页面渲染坐标（左上角原点） */
export function textItemToRect(item: LocatableTextItem, pageHeight: number, scale: number): HighlightRect {
  const x = item.transform[4];
  const y = item.transform[5];
  const fontHeight = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 12;
  const w = item.width || (item.str || '').length * fontHeight * 0.55;
  return {
    left: x * scale,
    top: (pageHeight - y - fontHeight * 0.95) * scale,
    width: w * scale,
    height: fontHeight * 1.15 * scale,
  };
}
