/**
 * 翻译与跨页伴读解释的提示词，浏览器直连与服务端代理共用同一份。
 */

export const DEFAULT_TARGET_LANGUAGE = '中文';

/** 解释与跨页伴读请求中页面上下文的最大字符数（与 /api/explain 的 20,000 上限对齐） */
export const MAX_EXPLAIN_CONTEXT_CHARS = 18_000;

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
你的任务是结合读者当前选定的单页或多页书籍上下文，精准解答读者划词选中的词句，或直接回应读者针对这些书页内容的提问、归纳与跨页对比。

解析准则：
1. 若读者提供了【选中词句】且无具体追问：
   - **语境释义**：一针见血解释该词/句在当前段落语境下的确切意图与内涵；
   - **逻辑剖析**：解析作者为何在此处这样表达，揭示背后的技术/商业/学术逻辑或隐喻；
   - **背景延伸**：如有专业术语或关键前置概念，简明补充，扫清阅读障碍。
2. 若读者提出了【伴读提问】：
   - 紧密围绕所提供的各页上下文（注意引用如“P.42”等页码线索），给出条理清晰、直击要害的解答；若跨越多页，主动串联各页之间的论证演进关系。
3. 排版规范：使用干净克制的 Markdown（加粗核心概念、精炼要点列表），语言专业自然，杜绝空洞寒暄。`;

export function buildExplainUserPrompt(params: {
  selectedText: string;
  contextText?: string;
  question?: string;
}): string {
  const { selectedText, contextText = '', question } = params;
  const trimmedSelected = selectedText.trim();
  const context = contextText.slice(0, MAX_EXPLAIN_CONTEXT_CHARS);

  if (question && trimmedSelected) {
    return `读者针对选段与书页上下文提出问题：\n【伴读提问】：${question}\n\n【关联划词选段】：\n"${trimmedSelected}"\n\n【所选书页上下文】：\n${context}`;
  }

  if (question) {
    return `读者基于所选书页上下文提出问题：\n【伴读提问】：${question}\n\n【所选书页上下文】：\n${context}`;
  }

  return `请深入解释读者选中的以下词句：\n\n【选中词句】：\n"${trimmedSelected}"\n\n【所选书页上下文参考】：\n${context}\n\n请按**语境释义**、**逻辑剖析**与必要的**背景延伸**给出精炼解析。`;
}
