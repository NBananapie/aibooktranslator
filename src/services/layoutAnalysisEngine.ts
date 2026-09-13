/**
 * PDF 版面段落分析引擎 (PDF Layout & Block Analysis Engine)
 * 基于第一性原理：利用字符绝对坐标、基线高度与行距统计中位数，
 * 将离散的 PDF TextItems 聚合成带绝对几何包围盒 (BBox) 的物理段落块。
 */

export interface SourceBlock {
  id: string; // 例如 "p21_b0"
  pageNumber: number;
  blockIndex: number;
  type: 'heading' | 'paragraph' | 'blockquote' | 'list';
  box: {
    x: number;
    y: number; // 统一归一化为以左上角为原点的坐标 (PDF 点度量)
    width: number;
    height: number;
  };
  text: string;
}

interface RawVisualLine {
  items: any[];
  minX: number;
  maxX: number;
  top: number;
  bottom: number;
  fontSize: number;
  text: string;
}

/**
 * 聚类与提取页面的结构化段落块
 */
export function analyzePageLayout(
  items: any[],
  pageView: number[] = [0, 0, 600, 800],
  pageNumber: number = 1
): SourceBlock[] {
  if (!items || items.length === 0) return [];

  const pageHeight = pageView[3] || 800;

  // 1. 坐标转换与归一化 (PDF 原始坐标系为左下角原点，转换为屏幕标准的左上角原点)
  const normalizedItems = items
    .filter(it => it.str && it.str.trim() && it.transform)
    .map(it => {
      const fontSize = Math.round(Math.abs(it.transform[3]) || it.height || 10);
      const x = it.transform[4];
      const y = Math.max(0, pageHeight - it.transform[5] - fontSize);
      const width = it.width || Math.max(8, it.str.length * fontSize * 0.55);
      const height = it.height || fontSize;
      return {
        str: it.str,
        hasEOL: it.hasEOL,
        x,
        y,
        width,
        height,
        fontSize,
        centerY: y + height / 2,
      };
    });

  if (normalizedItems.length === 0) return [];

  // 2. 物理行聚类 (Visual Line Clustering)
  // 将垂直中心线差距小于 3.5px 的字符块聚合成同一视觉物理行
  normalizedItems.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: RawVisualLine[] = [];
  for (const item of normalizedItems) {
    let matchedLine: RawVisualLine | null = null;
    for (const line of lines) {
      const lineCenterY = (line.top + line.bottom) / 2;
      if (Math.abs(lineCenterY - item.centerY) <= Math.max(3.5, item.fontSize * 0.3)) {
        matchedLine = line;
        break;
      }
    }

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

  // 对行内字符按 X 从小到大排序并拼装文本
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let lineStr = '';
    let lastRight = -1;
    for (const it of line.items) {
      if (lastRight > 0 && it.x - lastRight > it.fontSize * 0.25) {
        lineStr += ' ';
      }
      lineStr += it.str;
      lastRight = it.x + it.width;
    }
    line.text = lineStr.trim();
  }

  // 过滤掉纯空行，并按顶部 Y 排序
  const validLines = lines.filter(l => l.text.length > 0).sort((a, b) => a.top - b.top);
  if (validLines.length === 0) return [];

  // 3. 计算行距中位数 (Median Line Gap) 与 正文字号基准
  const fontSizes = validLines.map(l => l.fontSize);
  const sizeCounts: Record<number, number> = {};
  let bodyFontSize = 10;
  let maxCount = 0;
  for (const s of fontSizes) {
    sizeCounts[s] = (sizeCounts[s] || 0) + 1;
    if (sizeCounts[s] > maxCount) {
      maxCount = sizeCounts[s];
      bodyFontSize = s;
    }
  }

  const gaps: number[] = [];
  for (let i = 0; i < validLines.length - 1; i++) {
    const gap = validLines[i + 1].top - validLines[i].bottom;
    if (gap >= 0 && gap < bodyFontSize * 3) {
      gaps.push(gap);
    }
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 4;
  const breakGapThreshold = Math.max(6, medianGap * 1.4);

  // 4. 段落与标题聚类 (Paragraph & Heading Clustering)
  const blocks: SourceBlock[] = [];
  let currentBlockLines: RawVisualLine[] = [];
  let currentBlockType: 'heading' | 'paragraph' | 'blockquote' | 'list' = 'paragraph';

  const flushBlock = () => {
    if (currentBlockLines.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let combinedText = '';

    for (let i = 0; i < currentBlockLines.length; i++) {
      const line = currentBlockLines[i];
      minX = Math.min(minX, line.minX);
      maxX = Math.max(maxX, line.maxX);
      minY = Math.min(minY, line.top);
      maxY = Math.max(maxY, line.bottom);

      // 处理英文单词断字连字符 (如 'soft-' + 'ware' -> 'software')
      if (line.text.endsWith('-') && i < currentBlockLines.length - 1) {
        combinedText += line.text.slice(0, -1);
      } else {
        combinedText += line.text + (i < currentBlockLines.length - 1 ? ' ' : '');
      }
    }

    const cleanText = combinedText.trim();
    if (cleanText.length > 0) {
      blocks.push({
        id: `p${pageNumber}_b${blocks.length}`,
        pageNumber,
        blockIndex: blocks.length,
        type: currentBlockType,
        box: {
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.round(Math.max(20, maxX - minX)),
          height: Math.round(Math.max(12, maxY - minY)),
        },
        text: cleanText,
      });
    }

    currentBlockLines = [];
  };

  for (let i = 0; i < validLines.length; i++) {
    const line = validLines[i];
    const isHeading = line.fontSize >= bodyFontSize * 1.25 && line.fontSize > bodyFontSize + 1.5;
    const isList = /^([•\-\*]|\d+[\.\)])\s+/.test(line.text);

    if (currentBlockLines.length === 0) {
      currentBlockLines.push(line);
      currentBlockType = isHeading ? 'heading' : isList ? 'list' : 'paragraph';
      continue;
    }

    const prevLine = currentBlockLines[currentBlockLines.length - 1];
    const gap = line.top - prevLine.bottom;

    // 断段判定准则：
    // 1. 字号突变为标题行，或从标题行切回正文
    // 2. 垂直间隙明显超出正常行间距
    // 3. 项目符号列表项
    const isGapBreak = gap > breakGapThreshold;
    const isTypeBreak = isHeading || (currentBlockType === 'heading' && !isHeading);
    const isListBreak = isList && currentBlockLines.length > 0;

    if (isGapBreak || isTypeBreak || isListBreak) {
      flushBlock();
      currentBlockLines.push(line);
      currentBlockType = isHeading ? 'heading' : isList ? 'list' : 'paragraph';
    } else {
      currentBlockLines.push(line);
    }
  }

  flushBlock();
  return blocks;
}
