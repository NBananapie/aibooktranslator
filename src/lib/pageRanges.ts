/**
 * 页码集合格式化与区间输入解析工具（纯函数，供跨页伴读上下文栏与选页器使用）。
 */

/**
 * 将页码数组压缩为紧凑区间文本，例如：
 * - [42] -> "P.42"
 * - [41, 42, 43] -> "P.41–43"
 * - [41, 42, 43, 46, 48, 49] -> "P.41–43, 46 等"
 */
export function formatPageRanges(pages: number[], fallbackPage = 1, maxSegments = 2): string {
  if (!pages || pages.length === 0) return `P.${fallbackPage}`;
  const sorted = Array.from(new Set(pages.filter(p => Number.isInteger(p) && p >= 1))).sort((a, b) => a - b);
  if (sorted.length === 0) return `P.${fallbackPage}`;

  const segments: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      segments.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  segments.push(start === prev ? `${start}` : `${start}–${prev}`);

  if (segments.length <= maxSegments) {
    return `P.${segments.join(', ')}`;
  }
  return `P.${segments.slice(0, maxSegments).join(', ')} 等`;
}

/**
 * 解析用户输入的页码区间字符串（如 "40-45, 48, 51~53"），限制在 [1, maxPage] 且单次最多 maxCount 页。
 */
export function parsePageRangeInput(raw: string, maxPage: number, maxCount = 40): number[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];
  const limit = Math.max(1, maxPage || 9999);
  const result = new Set<number>();

  const parts = cleaned.split(/[,，;；\s]+/).filter(Boolean);
  for (const part of parts) {
    if (result.size >= maxCount) break;
    const rangeMatch = part.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(limit, Math.max(a, b));
        for (let p = lo; p <= hi && result.size < maxCount; p++) {
          result.add(p);
        }
      }
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n >= 1 && n <= limit) {
        result.add(n);
      }
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

/**
 * 计算当前页后方预读窗口 [startPage + 1, min(numPages, startPage + preloadCount)] 内尚无缓存的页码列表。
 */
export function getLookaheadPagesToPreload(
  startPage: number,
  numPages: number,
  preloadCount: number,
  translationCache: Record<number, string>
): number[] {
  if (preloadCount <= 0 || numPages <= 0 || startPage >= numPages) return [];
  const windowEnd = Math.min(numPages, startPage + preloadCount);
  const pages: number[] = [];
  for (let p = startPage + 1; p <= windowEnd; p++) {
    if (!translationCache[p]) {
      pages.push(p);
    }
  }
  return pages;
}

/**
 * 判断当前页后方预读窗口内的页面是否已全部缓存译文。
 */
export function isLookaheadWindowCached(
  pageNumber: number,
  numPages: number,
  preloadCount: number,
  translationCache: Record<number, string>
): boolean {
  if (preloadCount <= 0 || numPages <= 0 || pageNumber >= numPages) return false;
  return getLookaheadPagesToPreload(pageNumber, numPages, preloadCount, translationCache).length === 0;
}
