/**
 * 翻译与划词解释的提示词，浏览器直连与服务端代理共用同一份。
 */

export const DEFAULT_TARGET_LANGUAGE = '中文';

/** 解释请求中页面上下文的最大字符数 */
export const MAX_EXPLAIN_CONTEXT_CHARS = 1500;

export function buildDefaultTranslatePrompt(targetLanguage = DEFAULT_TARGET_LANGUAGE): string {
  return `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into elegant, publishable ${targetLanguage} Markdown.

CORE PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published ${targetLanguage} masterwork with natural, fluent, native phrasing.
2. PRESERVE STRUCTURE & TYPOGRAPHY:
   - Section Headings: Format headings as clear Markdown headings (## 标题 or ### 小标题).
   - Core Takeaways & Quotes: Format notable quotes or key points as blockquotes (> ...).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (-  or 1. ).
   - Key Terms: Use **bold** for critical concepts and technical terms.
3. OUTPUT FORMAT:
   Output ONLY the translated ${targetLanguage} Markdown. Do NOT include conversational filler, notes, or JSON metadata.`;
}

/**
 * 用户自定义提示词非空时优先使用，否则使用内置提示词（会带入目标语言）。
 */
export function buildTranslateSystemPrompt(customPrompt?: string, targetLanguage = DEFAULT_TARGET_LANGUAGE): string {
  const custom = customPrompt?.trim();
  return custom ? custom : buildDefaultTranslatePrompt(targetLanguage);
}

/**
 * 翻译当前页时附带上一页结尾，帮助模型衔接跨页断开的句子。
 * 上一页结尾只作参考，要求模型不要重复翻译。
 */
export function buildTranslateUserContent(text: string, previousPageTail?: string): string {
  const tail = previousPageTail?.trim();
  if (!tail) return text;
  return `[CONTEXT FROM PREVIOUS PAGE — for continuity only, do NOT translate or repeat it]
${tail}
[END CONTEXT]

${text}`;
}

export const EXPLAIN_SYSTEM_PROMPT = `你是一位出版级资深书籍导读学者与智能伴读顾问。
你的任务是针对读者在阅读书籍过程中划词选中的词汇、短语或句子，结合当前书籍页面的上下文提供精辟透彻的解析。

解析准则：
1. 【核心含义】：一针见血解释该词/句在当前段落语境下的确切意图与内涵。
2. 【上下文与逻辑剖析】：解析作者为何在此处这样表达，揭示背后的商业/技术/哲学逻辑或隐喻。
3. 【背景延伸】：如有专业术语、行业行话或文化典故，简要补充关键背景，扫清阅读障碍。
4. 【排版规范】：使用精美工整的 Markdown 结构（可包含加粗、列表或引用块），语言精炼专业，杜绝寒暄客套。`;

export function buildExplainUserPrompt(params: {
  selectedText: string;
  contextText?: string;
  question?: string;
}): string {
  const { selectedText, contextText = '', question } = params;
  const context = contextText.slice(0, MAX_EXPLAIN_CONTEXT_CHARS);
  if (question) {
    return `读者针对选段提出追问：\n【用户追问】：${question}\n\n【背景选段】：\n"${selectedText}"\n\n【页面上下文】：\n${context}`;
  }
  return `请深入解释读者选中的以下词句：\n\n【选中词句】：\n"${selectedText}"\n\n【所在页面上下文参考】：\n${context}\n\n请按【核心含义】、【上下文深度剖析】和【背景延伸】给出精辟解析。`;
}
