/**
 * PDF 版面段落分析引擎
 * 利用文本块坐标、行距中位数与字号，把 PDF.js 的 TextItem 聚合成带包围盒的段落块。
 * 支持检测双栏排版：先按栏切分，再在每栏内聚合段落，左栏在前、右栏在后。
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export interface SourceBlock {
  id: string; // 例如 "p21_b0"
  pageNumber: number;
  blockIndex: number;
  type: 'heading' | 'paragraph' | 'blockquote' | 'list';
  box: {
    x: number;
    y: number; // 以页面左上角为原点（PDF 点）
    width: number;
    height: number;
  };
  text: string;
}

/** 版面分析只需要 TextItem 的这几个字段 */
export type LayoutTextItem = Pick<TextItem, 'str' | 'transform' | 'width' | 'height'> & { hasEOL?: boolean };

export interface NormalizedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  centerY: number;
}

interface RawVisualLine {
  items: NormalizedItem[];
  minX: number;
  maxX: number;
  top: number;
  bottom: number;
  fontSize: number;
  text: string;
}

type BlockDraft = Omit<SourceBlock, 'id' | 'pageNumber' | 'blockIndex'>;

/** 栏间空白检测：中间区域的取样范围与分箱数量 */
const GUTTER_SEARCH_FROM = 0.35;
const GUTTER_SEARCH_TO = 0.65;
const COVERAGE_BINS = 200;
/** 两栏各自至少需要的文本块数量 */
const MIN_ITEMS_PER_COLUMN = 8;

function normalizeItems(items: LayoutTextItem[], pageHeight: number): NormalizedItem[] {
  return items
    .filter(it => it.str && it.str.trim() && it.transform)
    .map(it => {
      const fontSize = Math.round(Math.abs(it.transform[3]) || it.height || 10);
      const x = it.transform[4];
      const y = Math.max(0, pageHeight - it.transform[5] - fontSize);
      const width = it.width || Math.max(8, it.str.length * fontSize * 0.55);
      const height = it.height || fontSize;
      return { str: it.str, x, y, width, height, fontSize, centerY: y + height / 2 };
    });
}

/**
 * 检测双栏排版的栏间位置。
 * 在页面中部寻找最长的一段"几乎没有文本覆盖"的竖条，且两侧都有足够多的文本块时，返回其中点 x；否则返回 null。
 */
export function detectColumnGutter(items: NormalizedItem[], pageLeft: number, pageWidth: number): number | null {
  if (items.length < MIN_ITEMS_PER_COLUMN * 2 || pageWidth <= 0) return null;

  const coverage = new Array<number>(COVERAGE_BINS).fill(0);
  const binWidth = pageWidth / COVERAGE_BINS;
  for (const it of items) {
    const from = Math.max(0, Math.floor((it.x - pageLeft) / binWidth));
    const to = Math.min(COVERAGE_BINS - 1, Math.floor((it.x + it.width - pageLeft) / binWidth));
    for (let b = from; b <= to; b++) coverage[b]++;
  }

  // 允许少量跨栏元素（如通栏标题、页眉）
  const tolerance = Math.max(1, Math.floor(items.length * 0.05));
  const startBin = Math.floor(COVERAGE_BINS * GUTTER_SEARCH_FROM);
  const endBin = Math.ceil(COVERAGE_BINS * GUTTER_SEARCH_TO);

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let b = startBin; b <= endBin; b++) {
    if (coverage[b] <= tolerance) {
      if (runStart === -1) runStart = b;
      const len = b - runStart + 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  // 栏间距至少约为页宽的 1.5%
  if (bestLen < Math.max(2, COVERAGE_BINS * 0.015)) return null;
  const gutter = pageLeft + (bestStart + bestLen / 2) * binWidth;

  const left = items.filter(it => it.x + it.width <= gutter).length;
  const right = items.filter(it => it.x >= gutter).length;
  return left >= MIN_ITEMS_PER_COLUMN && right >= MIN_ITEMS_PER_COLUMN ? gutter : null;
}

/**
 * 合并两行文本。行尾连字符后接小写字母时视为断词（soft- + ware → software），
 * 后接大写字母或数字时保留连字符（Covid- + 19 → Covid-19）。
 */
export function joinLines(current: string, next: string): string {
  if (/[A-Za-z]-$/.test(current) && /^[a-z]/.test(next)) {
    return current.slice(0, -1) + next;
  }
  if (current.endsWith('-')) return current + next;
  return `${current} ${next}`;
}

function clusterLines(items: NormalizedItem[]): RawVisualLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: RawVisualLine[] = [];

  // 垂直中心线接近的文本块归为同一视觉行
  for (const item of sorted) {
    const matchedLine = lines.find(
      line => Math.abs((line.top + line.bottom) / 2 - item.centerY) <= Math.max(3.5, item.fontSize * 0.3)
    );
    if (matchedLine) {
      matchedLine.items.push(item);
      matchedLine.minX = Math.min(matchedLine.minX, item.x);
      matchedLine.maxX = Math.max(matchedLine.maxX, item.x + item.width);
      matchedLine.top = Math.min(matchedLine.top, item.y);
      matchedLine.bottom = Math.max(matchedLine.bottom, item.y + item.height);
      matchedLine.fontSize = Math.max(matchedLine.fontSize, item.fontSize);
    } else {
      lines.push({
        items: [item],
        minX: item.x,
        maxX: item.x + item.width,
        top: item.y,
        bottom: item.y + item.height,
        fontSize: item.fontSize,
        text: '',
      });
    }
  }

  // 行内按 x 排序拼接文本，间距较大时补空格
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let lineStr = '';
    let lastRight = -1;
    for (const it of line.items) {
      if (lastRight > 0 && it.x - lastRight > it.fontSize * 0.25) lineStr += ' ';
      lineStr += it.str;
      lastRight = it.x + it.width;
    }
    line.text = lineStr.trim();
  }

  return lines.filter(l => l.text.length > 0).sort((a, b) => a.top - b.top);
}

function dominantFontSize(lines: RawVisualLine[]): number {
  const counts: Record<number, number> = {};
  let body = 10;
  let max = 0;
  for (const l of lines) {
    counts[l.fontSize] = (counts[l.fontSize] || 0) + 1;
    if (counts[l.fontSize] > max) {
      max = counts[l.fontSize];
      body = l.fontSize;
    }
  }
  return body;
}

/** 把一组视觉行聚合为段落块 */
function buildBlocks(lines: RawVisualLine[], bodyFontSize: number): BlockDraft[] {
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1].top - lines[i].bottom;
    if (gap >= 0 && gap < bodyFontSize * 3) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 4;
  const breakGapThreshold = Math.max(6, medianGap * 1.4);

  const blocks: BlockDraft[] = [];
  let currentLines: RawVisualLine[] = [];
  let currentType: SourceBlock['type'] = 'paragraph';

  const flush = () => {
    if (currentLines.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let text = '';
    for (const line of currentLines) {
      minX = Math.min(minX, line.minX);
      maxX = Math.max(maxX, line.maxX);
      minY = Math.min(minY, line.top);
      maxY = Math.max(maxY, line.bottom);
      text = text ? joinLines(text, line.text) : line.text;
    }
    const clean = text.trim();
    if (clean) {
      blocks.push({
        type: currentType,
        box: {
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.round(Math.max(20, maxX - minX)),
          height: Math.round(Math.max(12, maxY - minY)),
        },
        text: clean,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const isHeading = line.fontSize >= bodyFontSize * 1.25 && line.fontSize > bodyFontSize + 1.5;
    const isList = /^([•\-*]|\d+[.)])\s+/.test(line.text);
    const type: SourceBlock['type'] = isHeading ? 'heading' : isList ? 'list' : 'paragraph';

    if (currentLines.length === 0) {
      currentLines.push(line);
      currentType = type;
      continue;
    }

    const prev = currentLines[currentLines.length - 1];
    // 断段：垂直间隙明显大于行距、标题与正文切换、新的列表项
    const isGapBreak = line.top - prev.bottom > breakGapThreshold;
    const isTypeBreak = isHeading || (currentType === 'heading' && !isHeading);
    if (isGapBreak || isTypeBreak || isList) {
      flush();
      currentType = type;
    }
    currentLines.push(line);
  }
  flush();
  return blocks;
}

/**
 * 分析单页版面，返回按阅读顺序排列的段落块。
 */
export function analyzePageLayout(
  items: LayoutTextItem[],
  pageView: number[] = [0, 0, 600, 800],
  pageNumber: number = 1
): SourceBlock[] {
  if (!items || items.length === 0) return [];

  const pageLeft = pageView[0] || 0;
  const pageWidth = (pageView[2] || 600) - pageLeft;
  const pageHeight = pageView[3] || 800;
  const normalized = normalizeItems(items, pageHeight);
  if (normalized.length === 0) return [];

  const allLines = clusterLines(normalized);
  const bodyFontSize = dominantFontSize(allLines);

  let drafts: BlockDraft[];
  const gutter = detectColumnGutter(normalized, pageLeft, pageWidth);
  if (gutter === null) {
    drafts = buildBlocks(allLines, bodyFontSize);
  } else {
    const leftItems = normalized.filter(it => it.x + it.width <= gutter);
    const rightItems = normalized.filter(it => it.x >= gutter);
    const spanning = normalized.filter(it => it.x < gutter && it.x + it.width > gutter);
    const columnTop = Math.min(...[...leftItems, ...rightItems].map(it => it.y));

    // 跨栏元素：位于两栏上方的作为页首（标题等），其余放在最后
    const header = buildBlocks(clusterLines(spanning.filter(it => it.y < columnTop)), bodyFontSize);
    const footer = buildBlocks(clusterLines(spanning.filter(it => it.y >= columnTop)), bodyFontSize);
    drafts = [
      ...header,
      ...buildBlocks(clusterLines(leftItems), bodyFontSize),
      ...buildBlocks(clusterLines(rightItems), bodyFontSize),
      ...footer,
    ];
  }

  return drafts.map((d, i) => ({ ...d, id: `p${pageNumber}_b${i}`, pageNumber, blockIndex: i }));
}
