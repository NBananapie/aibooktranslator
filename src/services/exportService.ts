/**
 * 文档与剪藏知识导出服务 (Export Service)
 * 遵循第一性原理：标准化文件格式构建与纯净浏览器下载触发器。
 */

import { parseTranslationOutput } from './alignmentEngine';
import { ClipItem } from '@/lib/db';

/**
 * 触发标准浏览器 Blob 文件下载
 */
export function triggerBlobDownload(
  content: string,
  filename: string,
  mimeType = 'text/markdown;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * 导出当前文档的精选剪藏书摘为 Markdown
 */
export function exportClipsAsMarkdown(params: {
  filename: string;
  clips: ClipItem[];
}): void {
  const { filename, clips } = params;
  if (!clips || clips.length === 0) return;

  const baseName = filename.replace(/\.pdf$/i, '');
  let md = `# 📖 《${baseName}》剪藏书摘\n\n`;
  md += `> 共收集 ${clips.length} 处精华摘录 | 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;

  clips.forEach((c, idx) => {
    md += `### 摘录 ${idx + 1}（第 ${c.pageNumber} 页）\n\n`;
    md += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
    md += `*记录于: ${new Date(c.createdAt).toLocaleString()}*\n\n---\n\n`;
  });

  triggerBlobDownload(md, `${baseName}_剪藏书摘.md`);
}

/**
 * 导出已翻译页面的完整双语汇编为出版级 Markdown
 */
export function exportTranslationsAsMarkdown(params: {
  filename: string;
  translationCache: Record<number, string>;
}): void {
  const { filename, translationCache } = params;
  const sortedPages = Object.keys(translationCache || {})
    .map(Number)
    .sort((a, b) => a - b);

  if (sortedPages.length === 0) return;

  const baseName = filename.replace(/\.pdf$/i, '');
  let mdContent = `# 翻译结果: ${filename}\n\n`;

  sortedPages.forEach(page => {
    const { cleanMarkdown } = parseTranslationOutput(translationCache[page]);
    mdContent += `### 第 ${page} 页\n\n`;
    mdContent += `${cleanMarkdown}\n\n---\n\n`;
  });

  const minPage = sortedPages[0];
  const maxPage = sortedPages[sortedPages.length - 1];
  const targetFilename = `${baseName}_Pages_${minPage}_to_${maxPage}.md`;

  const ref = '?utm_source=export&utm_medium=referral&utm_campaign=bilingual_export';
  mdContent += `> 由 [AI PDF Translator](https://aitranslator.justganit.com/${ref}) 生成 —— 完整双语对照阅读，自带 API Key，内容不上传。\n>\n> 更多工具见 [JustGanIt](https://justganit.com/${ref})\n`;

  triggerBlobDownload(mdContent, targetFilename);
}

/**
 * 格式化全部剪藏为纯文本剪贴板格式
 */
export function formatClipsForClipboard(clips: ClipItem[]): string {
  if (!clips || clips.length === 0) return '';
  return clips
    .map((c, i) => `【摘录 ${i + 1}】(第 ${c.pageNumber} 页):\n${c.text}\n`)
    .join('\n---\n\n');
}
