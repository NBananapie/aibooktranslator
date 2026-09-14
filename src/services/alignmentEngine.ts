/**
 * 双语对齐与文本定位算法引擎 (Bilingual Alignment & Layout Engine)
 * 遵循第一性原理：纯函数化设计，无 DOM 副作用，便于独立单元测试与跨端复用。
 */

import { SourceBlock } from './layoutAnalysisEngine';

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform: number[]; // [scaleX, skewY, skewX, scaleY, transX, transY]
  height?: number;
  width?: number;
}

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

export interface BilingualMapEntry {
  zh: string;
  en: string;
}

export interface ParsedTranslationResult {
  cleanMarkdown: string;
  alignmentMap: BilingualMapEntry[];
}

export interface TargetBlock {
  id: string; // 对应 sourceBlock.id
  blockIndex: number;
  text: string; // 中文译文
}

export interface ParsedBlockTranslationResult {
  blocks: TargetBlock[];
  cleanMarkdown: string;
  alignmentMap: BilingualMapEntry[];
}

/**
 * 1. 基于字号统计中位数与排版坐标进行 Markdown 层级结构识别
 * 自动识别大字号标题（>= 1.2x 基准字号）并追加 '## ' 二级标题标记，平滑缝合孤立行
 */
export function extractPdfTextWithHierarchy(items: any[]): string {
  if (!items || items.length === 0) return '';

  // 统计正文基准字号 (Dominant body font size)
  const fontSizes: number[] = [];
  for (const item of items) {
    if (item.str && item.str.trim()) {
      const size = Math.round(Math.abs(item.transform[3]) || item.height || 10);
      if (size > 0) fontSizes.push(size);
    }
  }

  const sizeCounts: Record<number, number> = {};
  let bodyFontSize = 10;
  let maxCount = 0;
  for (const size of fontSizes) {
    sizeCounts[size] = (sizeCounts[size] || 0) + 1;
    if (sizeCounts[size] > maxCount) {
      maxCount = sizeCounts[size];
      bodyFontSize = size;
    }
  }

  // 基于字号与排版坐标进行层级识别
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

    // 若当前行为大字号标题行，自动补充 Markdown 二级标题标记
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
 * 2. 智能句子级切分工具函数
 */
export function splitSentences(text: string, isZh = false): SentenceSpan[] {
  if (!text) return [];
  const sentences: SentenceSpan[] = [];
  const regex = isZh
    ? /[^。！？!?；;\n]+[。！？!?；;\n]*/g
    : /[^.!?\n]+[.!?\n]*/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      sentences.push({
        text: trimmed,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return sentences;
}

/**
 * 3. 提取纯净 Markdown 与隐藏双向对齐映射 (BILINGUAL_MAP)
 * 剔除大模型 <think> 思维链标签以及未闭合/已闭合的隐藏 JSON 映射块
 */
export function parseTranslationOutput(rawText: string): ParsedTranslationResult {
  if (!rawText) return { cleanMarkdown: '', alignmentMap: [] };

  let cleanMarkdown = rawText;
  let alignmentMap: BilingualMapEntry[] = [];

  // 1. 尝试提取已完整闭合的 <!-- BILINGUAL_MAP: [...] -->
  const mapMatch = rawText.match(/<!--\s*BILINGUAL_MAP:?\s*([\s\S]*?)-->/i);
  if (mapMatch && mapMatch[1]) {
    try {
      const jsonStr = mapMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        alignmentMap = parsed.filter(item => item && (item.zh || item.en));
      }
    } catch {
      // JSON 解析容错
    }
  }

  // 2. 彻底从渲染内容中切除 BILINGUAL_MAP 块：
  // 无论是正在流式输出末尾中 (未闭合)，还是已输出完毕 (已闭合)，一律不展示在正文中
  cleanMarkdown = cleanMarkdown.replace(/<!--\s*BILINGUAL_MAP[\s\S]*$/i, '').trim();

  // 3. 移除大模型 <think> 思维链标签 (实时流式过滤)
  cleanMarkdown = cleanMarkdown.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

  return { cleanMarkdown, alignmentMap };
}

/**
 * 将段落块格式化为带 [B0], [B1]... 协议标记的输入文本
 */
export function formatSourceBlocksForPrompt(blocks: SourceBlock[]): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks.map((b, idx) => `[B${idx}] ${b.text}`).join('\n\n');
}

/**
 * 结构化段落对照解析器：
 * 将大模型流式或全量输出解析为 1:1 对应的 TargetBlock[] 序列。
 * 若输出含有 [B0]、[B1] 标记，按标记精准拆分；若无，按段落回退对齐。
 */
export function parseBlockTranslation(
  rawText: string,
  sourceBlocks: SourceBlock[] = []
): ParsedBlockTranslationResult {
  const { cleanMarkdown, alignmentMap } = parseTranslationOutput(rawText);
  if (!cleanMarkdown.trim()) {
    return { blocks: [], cleanMarkdown: '', alignmentMap };
  }

  // 1. 尝试匹配 [B0], [B1]... 结构化段落标记
  const blockRegex = /(?:^|\n)\[B(\d+)\]\s*([\s\S]*?)(?=(?:\n\[B\d+\]|$))/g;
  const matches = [...cleanMarkdown.matchAll(blockRegex)];

  if (matches.length > 0) {
    const blocksMap: Record<number, string> = {};
    for (const match of matches) {
      const idx = parseInt(match[1], 10);
      const content = match[2].trim();
      blocksMap[idx] = content;
    }

    const blocks: TargetBlock[] = sourceBlocks.map((sb, idx) => ({
      id: sb.id,
      blockIndex: idx,
      text: blocksMap[idx] || '',
    }));

    // 若 sourceBlocks 数量少于匹配出的 block，补充其余 block
    for (const idxStr of Object.keys(blocksMap)) {
      const idx = parseInt(idxStr, 10);
      if (!blocks[idx]) {
        blocks[idx] = {
          id: sourceBlocks[idx]?.id || `p_b${idx}`,
          blockIndex: idx,
          text: blocksMap[idx],
        };
      }
    }

    // 组合纯净 Markdown (保留内联排版)
    const formattedMarkdown = blocks
      .filter(b => b && b.text)
      .map(b => b.text)
      .join('\n\n');

    return { blocks, cleanMarkdown: formattedMarkdown, alignmentMap };
  }

  // 2. 优雅回退：若未包含 [B...] 标记，按双换行段落顺序映射到 sourceBlocks
  const rawParagraphs = cleanMarkdown.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const blocks: TargetBlock[] = sourceBlocks.map((sb, idx) => ({
    id: sb.id,
    blockIndex: idx,
    text: rawParagraphs[idx] || '',
  }));

  if (rawParagraphs.length > sourceBlocks.length && blocks.length > 0) {
    const rest = rawParagraphs.slice(sourceBlocks.length).join('\n\n');
    blocks[blocks.length - 1].text += '\n\n' + rest;
  }

  return { blocks, cleanMarkdown, alignmentMap };
}

/**
 * 4. 基于单词流连续滑动窗口的 PDF 精准高亮匹配算法，杜绝全页模糊误涂
 */
export function findContiguousItemsForSentence(sentence: string, items: any[]): any[] {
  if (!sentence.trim() || items.length === 0) return [];

  // 1. 提取句子的连续英文单词序列
  const targetWords = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (targetWords.length === 0) return [];

  // 2. 将 items 扁平化为带 itemIdx 的单词流
  const flatWords: Array<{ word: string; itemIdx: number }> = [];
  for (let idx = 0; idx < items.length; idx++) {
    const str = items[idx].str || '';
    const words = str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    for (const w of words) {
      flatWords.push({ word: w, itemIdx: idx });
    }
  }
  if (flatWords.length === 0) return [];

  // 3. 在 flatWords 中寻找与 targetWords 最长匹配的连续子序列 (双向任意位置滑动窗口)
  let bestStartFlat = -1;
  let bestEndFlat = -1;
  let bestMatchLen = 0;

  for (let k = 0; k < targetWords.length; k++) {
    for (let i = 0; i < flatWords.length; i++) {
      if (flatWords[i].word === targetWords[k]) {
        let m = 0;
        while (
          k + m < targetWords.length &&
          i + m < flatWords.length &&
          flatWords[i + m].word === targetWords[k + m]
        ) {
          m++;
        }
        if (m > bestMatchLen) {
          bestMatchLen = m;
          bestStartFlat = i;
          bestEndFlat = i + m - 1;
        }
      }
    }
  }

  // 4. 命中判定：高精度连续单词流匹配
  // 必须达到足够的匹配比例，杜绝凭一两个数字匹配整句或多句
  const minMatchLen = targetWords.length <= 2 ? targetWords.length : Math.max(3, Math.floor(targetWords.length * 0.65));
  if (bestStartFlat >= 0 && bestMatchLen >= minMatchLen) {
    // 仅提取真正落在匹配单词窗口内的 item 索引，严禁基于下标粗暴 slice 污染跨段 items
    const matchedItemIndices = new Set<number>();
    for (let f = bestStartFlat; f <= bestEndFlat; f++) {
      matchedItemIndices.add(flatWords[f].itemIdx);
    }
    return items.filter((_, idx) => matchedItemIndices.has(idx));
  }

  return [];
}

/**
 * 5. 精准子句提取：当 LLM 将多句话合并为一条映射时，按标点精确截取与用户划选对应的英文子句，彻底杜绝连带扩选
 */
export function extractSpecificEnForQuery(entryZh: string, entryEn: string, queryZh: string): string {
  // 按句末标点拆分为分句
  const zhSubSentences = entryZh.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(Boolean);
  const enSubSentences = entryEn.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(Boolean);

  // 若中英文分句数量对齐 (如大模型合并了 2 句话)
  if (zhSubSentences.length > 1 && zhSubSentences.length === enSubSentences.length) {
    for (let i = 0; i < zhSubSentences.length; i++) {
      if (zhSubSentences[i].includes(queryZh) || queryZh.includes(zhSubSentences[i])) {
        return enSubSentences[i];
      }
    }
  }

  // 若数量不对齐但含有多个分句，计算相对比例定位
  if (zhSubSentences.length > 1 && enSubSentences.length > 1) {
    let matchedZhIdx = -1;
    for (let i = 0; i < zhSubSentences.length; i++) {
      if (zhSubSentences[i].includes(queryZh) || queryZh.includes(zhSubSentences[i])) {
        matchedZhIdx = i;
        break;
      }
    }
    if (matchedZhIdx >= 0) {
      const ratio = matchedZhIdx / zhSubSentences.length;
      const targetEnIdx = Math.min(enSubSentences.length - 1, Math.floor(ratio * enSubSentences.length));
      return enSubSentences[targetEnIdx];
    }
  }

  return entryEn;
}

/**
 * 6. 原文划任意英文词/短语 -> 精准锁定译文对应中文句子 (杜绝误选/错选/漏选)
 */
export function findMatchingZhSentenceForEnQuery(params: {
  enQuery: string;
  sourceBlocks?: SourceBlock[];
  targetBlocks?: TargetBlock[];
  bilingualMap?: BilingualMapEntry[];
  hintBlockId?: string;
}): { matchedZhSentence: string; matchedBlockId?: string; matchedEnSentence: string } {
  const { enQuery, sourceBlocks = [], targetBlocks = [], bilingualMap = [], hintBlockId } = params;
  const cleanQuery = enQuery.trim().toLowerCase();
  if (!cleanQuery) return { matchedZhSentence: '', matchedEnSentence: '' };

  // 1. 先精准锁定用户所在的段落块 (通过 hintBlockId 或包含该词的 sourceBlock)
  let targetBlockIndex = -1;
  if (hintBlockId) {
    targetBlockIndex = sourceBlocks.findIndex(sb => sb.id === hintBlockId);
  }
  if (targetBlockIndex === -1 && sourceBlocks.length > 0) {
    const wordRegex = new RegExp(`\\b${cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    targetBlockIndex = sourceBlocks.findIndex(sb => wordRegex.test(sb.text));
    if (targetBlockIndex === -1) {
      targetBlockIndex = sourceBlocks.findIndex(sb => sb.text.toLowerCase().includes(cleanQuery));
    }
  }

  const sb = targetBlockIndex >= 0 ? sourceBlocks[targetBlockIndex] : null;
  const tb = targetBlockIndex >= 0
    ? (targetBlocks[targetBlockIndex] || targetBlocks.find(b => b.id === sb?.id))
    : null;

  // 2. 如果锁定了段落，提取包含划选词的英文原句
  let targetEnSentence = '';
  let matchedEnIdx = -1;
  let enSentences: SentenceSpan[] = [];
  let zhSentences: SentenceSpan[] = [];

  if (sb && sb.text) {
    enSentences = splitSentences(sb.text, false);
    for (let i = 0; i < enSentences.length; i++) {
      if (enSentences[i].text.toLowerCase().includes(cleanQuery)) {
        targetEnSentence = enSentences[i].text.trim();
        matchedEnIdx = i;
        break;
      }
    }
  }

  if (tb && tb.text) {
    zhSentences = splitSentences(tb.text, true);
  }

  // 3. 在 bilingualMap 中寻找匹配条目：
  // 必须是 entry.en 包含用户的划词 cleanQuery (严禁反向用短 entry 吞并长单词)
  if (bilingualMap.length > 0) {
    // 优先找属于当前英文原句 targetEnSentence 的 entry
    if (targetEnSentence) {
      for (const entry of bilingualMap) {
        if (!entry.en || !entry.zh) continue;
        const entryEnLower = entry.en.toLowerCase();
        if (
          entryEnLower.includes(cleanQuery) &&
          (entryEnLower.includes(targetEnSentence.toLowerCase()) || targetEnSentence.toLowerCase().includes(entryEnLower))
        ) {
          return {
            matchedZhSentence: entry.zh.trim(),
            matchedEnSentence: entry.en.trim(),
            matchedBlockId: tb?.id || sb?.id,
          };
        }
      }
    }

    // 其次：如果当前段落内找到了包含划选词且存在于当前段落文本的 entry
    if (sb) {
      for (const entry of bilingualMap) {
        if (!entry.en || !entry.zh) continue;
        const entryEnLower = entry.en.toLowerCase();
        if (entryEnLower.includes(cleanQuery) && sb.text.toLowerCase().includes(entryEnLower)) {
          return {
            matchedZhSentence: entry.zh.trim(),
            matchedEnSentence: entry.en.trim(),
            matchedBlockId: tb?.id || sb?.id,
          };
        }
      }
    }

    // 兜底：全页检索包含 cleanQuery 的 entry
    for (const entry of bilingualMap) {
      if (!entry.en || !entry.zh) continue;
      const entryEnLower = entry.en.toLowerCase();
      if (entryEnLower.includes(cleanQuery)) {
        return {
          matchedZhSentence: entry.zh.trim(),
          matchedEnSentence: entry.en.trim(),
          matchedBlockId: tb?.id || sb?.id,
        };
      }
    }
  }

  // 4. 段落级句对齐兜底：根据句子索引比例对齐
  if (matchedEnIdx >= 0 && zhSentences.length > 0) {
    const ratio = enSentences.length > 1 ? matchedEnIdx / (enSentences.length - 1) : 0;
    const zhIdx = Math.min(zhSentences.length - 1, Math.round(ratio * (zhSentences.length - 1)));
    return {
      matchedZhSentence: zhSentences[zhIdx].text.trim(),
      matchedEnSentence: targetEnSentence || enSentences[matchedEnIdx].text.trim(),
      matchedBlockId: tb?.id || sb?.id,
    };
  }

  if (tb && tb.text.trim()) {
    return {
      matchedZhSentence: (zhSentences[0]?.text || tb.text.slice(0, 100)).trim(),
      matchedEnSentence: targetEnSentence || (sb?.text ? sb.text.trim() : cleanQuery),
      matchedBlockId: tb.id,
    };
  }

  return { matchedZhSentence: '', matchedEnSentence: '' };
}

/**
 * 7. 译文划任意中文词/短语 -> 精准锁定原文对应英文句子 (杜绝误选/错选/漏选)
 */
export function findMatchingEnSentenceForZhQuery(params: {
  zhQuery: string;
  sourceBlocks?: SourceBlock[];
  targetBlocks?: TargetBlock[];
  bilingualMap?: BilingualMapEntry[];
  hintBlockId?: string;
  contextParagraph?: string;
}): { matchedEnSentence: string; matchedBlockId?: string; matchedZhSentence: string } {
  const {
    zhQuery,
    sourceBlocks = [],
    targetBlocks = [],
    bilingualMap = [],
    hintBlockId,
    contextParagraph,
  } = params;
  const cleanQuery = zhQuery.trim();
  if (!cleanQuery) return { matchedEnSentence: '', matchedZhSentence: '' };

  // 1. 精准定位目标段落卡片
  let targetBlockIndex = -1;
  if (hintBlockId) {
    targetBlockIndex = targetBlocks.findIndex(tb => tb.id === hintBlockId);
  }
  if (targetBlockIndex === -1 && targetBlocks.length > 0) {
    targetBlockIndex = targetBlocks.findIndex(tb => tb.text.includes(cleanQuery));
  }

  const tb = targetBlockIndex >= 0 ? targetBlocks[targetBlockIndex] : null;
  const sb = targetBlockIndex >= 0
    ? (sourceBlocks[targetBlockIndex] || sourceBlocks.find(b => b.id === tb?.id))
    : null;

  // 2. 提取当前中文句子
  let targetZhSentence = '';
  let matchedZhIdx = -1;
  let zhSentences: SentenceSpan[] = [];
  let enSentences: SentenceSpan[] = [];

  if (tb && tb.text) {
    zhSentences = splitSentences(tb.text, true);
    for (let i = 0; i < zhSentences.length; i++) {
      if (zhSentences[i].text.includes(cleanQuery)) {
        targetZhSentence = zhSentences[i].text.trim();
        matchedZhIdx = i;
        break;
      }
    }
  }

  if (sb && sb.text) {
    enSentences = splitSentences(sb.text, false);
  }

  // 3. 在 bilingualMap 中精准查找
  if (bilingualMap.length > 0) {
    // 优先：包含 targetZhSentence 的 entry
    if (targetZhSentence) {
      for (const entry of bilingualMap) {
        if (!entry.zh || !entry.en) continue;
        if (
          entry.zh.includes(cleanQuery) &&
          (entry.zh.includes(targetZhSentence) || targetZhSentence.includes(entry.zh))
        ) {
          const specificEn = extractSpecificEnForQuery(entry.zh, entry.en, cleanQuery);
          return {
            matchedEnSentence: specificEn,
            matchedZhSentence: entry.zh.trim(),
            matchedBlockId: tb?.id || sb?.id,
          };
        }
      }
    }

    // 其次：属于当前中文段落文本的 entry
    if (tb) {
      for (const entry of bilingualMap) {
        if (!entry.zh || !entry.en) continue;
        if (entry.zh.includes(cleanQuery) && tb.text.includes(entry.zh)) {
          const specificEn = extractSpecificEnForQuery(entry.zh, entry.en, cleanQuery);
          return {
            matchedEnSentence: specificEn,
            matchedZhSentence: entry.zh.trim(),
            matchedBlockId: tb?.id || sb?.id,
          };
        }
      }
    }

    // 兜底：全局查找包含 cleanQuery 的 entry
    for (const entry of bilingualMap) {
      if (!entry.zh || !entry.en) continue;
      if (entry.zh.includes(cleanQuery)) {
        const specificEn = extractSpecificEnForQuery(entry.zh, entry.en, cleanQuery);
        return {
          matchedEnSentence: specificEn,
          matchedZhSentence: entry.zh.trim(),
          matchedBlockId: tb?.id || sb?.id,
        };
      }
    }
  }

  // 4. 段落级句对齐兜底
  if (matchedZhIdx >= 0 && enSentences.length > 0) {
    const ratio = zhSentences.length > 1 ? matchedZhIdx / (zhSentences.length - 1) : 0;
    const enIdx = Math.min(enSentences.length - 1, Math.round(ratio * (enSentences.length - 1)));
    return {
      matchedEnSentence: enSentences[enIdx].text.trim(),
      matchedZhSentence: targetZhSentence || zhSentences[matchedZhIdx].text.trim(),
      matchedBlockId: tb?.id || sb?.id,
    };
  }

  if (sb && sb.text.trim()) {
    return {
      matchedEnSentence: (enSentences[0]?.text || sb.text.slice(0, 100)).trim(),
      matchedZhSentence: targetZhSentence || cleanQuery,
      matchedBlockId: sb.id,
    };
  }

  return { matchedEnSentence: '', matchedZhSentence: '' };
}
