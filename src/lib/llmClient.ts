/**
 * 客户端直连大模型服务模块 (Client-Side Direct LLM Service)
 * 遵循第一性原理：当用户在设置中配置了 API Key 时，浏览器直接与大模型官方 API 通信，
 * 避免中间层服务器 (Cloudflare Worker) 的二次转发延迟与 500 运行时崩溃风险。
 */

export interface TranslateParams {
  text: string;
  targetLanguage?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: 'openai' | 'gemini' | 'custom';
  customPrompt?: string;
  signal?: AbortSignal;
}

export interface ExplainParams {
  selectedText: string;
  contextText?: string;
  question?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: 'openai' | 'gemini' | 'custom';
  signal?: AbortSignal;
}

const BILINGUAL_MAP_INSTRUCTION = `

PRECISE SENTENCE-LEVEL BILINGUAL ALIGNMENT MAP:
At the very end of your response, after the complete translated markdown text, append a hidden JSON comment block mapping each translated sentence to its original English source sentence for bilingual alignment.
Format EXACTLY like this:
<!-- BILINGUAL_MAP:
[
  {"zh": "一段中文翻译句子", "en": "The exact corresponding English sentence."},
  ...
]
-->
Output ONLY the translated Markdown followed by the hidden BILINGUAL_MAP comment block. Do NOT include conversational filler.`;

function buildSystemPrompt(customPrompt?: string, targetLanguage = '中文') {
  const basePrompt = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into ${targetLanguage}.

CORE TRANSLATION & LAYOUT PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native business/literary phrasing.
2. CONTEXT-AWARE STRUCTURAL HIERARCHY:
   - Standalone Section Titles & Topic Breaks: Intelligently format headings as clear Markdown headings (\`## 标题\` or \`### 小标题\`).
   - Core Takeaways, Exercises & Pull-Quotes: Format key lessons or notable quotes as blockquotes (\`> 核心要义: ...\`).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (\`- \` or \`1. \`).
   - Key Concepts & Emphasis: Use \`**bold**\` for critical terms.`;

  if (!basePrompt.includes('BILINGUAL_MAP')) {
    return `${basePrompt}\n\n${BILINGUAL_MAP_INSTRUCTION}`;
  }
  return basePrompt;
}

function buildExplainSystemPrompt() {
  return `你是一位出版级资深书籍导读学者与智能伴读顾问。
你的任务是针对读者在阅读书籍过程中划词选中的词汇、短语或句子，结合当前书籍页面的上下文提供精辟透彻的解析。

解析准则：
1. 【核心含义】：一针见血解释该词/句在当前段落语境下的确切意图与内涵。
2. 【上下文与逻辑剖析】：解析作者为何在此处这样表达，揭示背后的商业/技术/哲学逻辑或隐喻。
3. 【背景延伸】：如有专业术语、行业行话或文化典故，简要补充关键背景，扫清阅读障碍。
4. 【排版规范】：使用精美工整的 Markdown 结构（可包含加粗、列表或引用块），语言精炼专业，杜绝寒暄客套。`;
}

// 客户端直接处理 Google Gemini 原生流式输出
async function fetchGeminiDirectStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  contents: any[];
  systemInstruction: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const { apiKey, baseUrl, model, contents, systemInstruction, signal } = params;

  let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
    cleanBaseUrl = `https://${cleanBaseUrl}`;
  }
  cleanBaseUrl = cleanBaseUrl.replace(/\/v1beta.*$/, '').replace(/\/openai.*$/, '');
  
  const apiUrl = `${cleanBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        temperature: 0.3,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let errorMessage = `Gemini API 响应异常 (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = `Gemini 错误: ${errorJson.error.message}`;
      }
    } catch {
      if (errorText) errorMessage += `: ${errorText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder('utf-8');
      const encoder = new TextEncoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanedLine = line.trim();
            if (!cleanedLine || cleanedLine === 'data: [DONE]') continue;

            if (cleanedLine.startsWith('data: ')) {
              try {
                const data = JSON.parse(cleanedLine.slice(6));
                const candidates = data.candidates || [];
                if (candidates.length > 0 && candidates[0].content?.parts) {
                  for (const part of candidates[0].content.parts) {
                    if (part.text) {
                      controller.enqueue(encoder.encode(part.text));
                    }
                  }
                }
              } catch (e) {
                console.error('解析 Gemini 数据块异常', e);
              }
            }
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

// 客户端直接处理 OpenAI 兼容协议流式输出 (MiniMax, OpenAI, DeepSeek 等)
async function fetchOpenAIDirectStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
}): Promise<Response> {
  const { apiKey, baseUrl, model, messages, signal } = params;

  let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  let apiUrl = '';
  if (cleanBaseUrl.endsWith('/chat/completions')) {
    apiUrl = cleanBaseUrl;
  } else if (cleanBaseUrl.endsWith('/v1')) {
    apiUrl = `${cleanBaseUrl}/chat/completions`;
  } else {
    apiUrl = `${cleanBaseUrl}/v1/chat/completions`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    let errorMessage = `API 响应异常 (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      if (errorText) errorMessage += `: ${errorText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder('utf-8');
      const encoder = new TextEncoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanedLine = line.trim();
            if (!cleanedLine || cleanedLine === 'data: [DONE]') continue;

            if (cleanedLine.startsWith('data: ')) {
              try {
                const data = JSON.parse(cleanedLine.slice(6));
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch (e) {
                console.error('解析 OpenAI 数据块异常', e);
              }
            }
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * 执行翻译流式请求
 * 策略：如果客户端提供了 API Key，优先客户端直连大模型（毫秒响应且彻底免疫 Cloudflare 500）；
 * 若直连遭遇 CORS 错误或未填 Key，无缝回退到 /api/translate 代理。
 */
export async function executeTranslateStream(params: TranslateParams): Promise<Response> {
  const {
    text,
    targetLanguage = '中文',
    apiKey,
    baseUrl = 'https://api.minimax.chat/v1',
    model = 'MiniMax-M2.7-highspeed',
    provider = 'openai',
    customPrompt,
    signal,
  } = params;

  const systemPrompt = buildSystemPrompt(customPrompt, targetLanguage);

  if (apiKey && apiKey.trim()) {
    const isGemini = provider === 'gemini' || baseUrl.includes('googleapis.com');
    try {
      if (isGemini) {
        const cleanBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com';
        const targetModel = (model && model.trim()) || 'gemini-3.5-flash-lite';
        return await fetchGeminiDirectStream({
          apiKey: apiKey.trim(),
          baseUrl: cleanBaseUrl,
          model: targetModel,
          contents: [{ role: 'user', parts: [{ text }] }],
          systemInstruction: systemPrompt,
          signal,
        });
      } else {
        return await fetchOpenAIDirectStream({
          apiKey: apiKey.trim(),
          baseUrl,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          signal,
        });
      }
    } catch (err: any) {
      // 若非主动取消且出现网络/跨域问题，尝试走后端中转
      if (err.name === 'AbortError') throw err;
      console.warn('客户端直连请求遇到异常，尝试回退至服务端代理:', err);
    }
  }

  // 服务端代理兜底请求
  const serverResponse = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      targetLanguage,
      apiKey,
      baseUrl,
      model,
      provider,
      customPrompt,
    }),
    signal,
  });

  return serverResponse;
}

/**
 * 执行划词导读流式请求
 */
export async function executeExplainStream(params: ExplainParams): Promise<Response> {
  const {
    selectedText,
    contextText = '',
    question,
    history = [],
    apiKey,
    baseUrl = 'https://api.minimax.chat/v1',
    model = 'MiniMax-M2.7-highspeed',
    provider = 'openai',
    signal,
  } = params;

  const systemPrompt = buildExplainSystemPrompt();

  let userPrompt = '';
  if (question) {
    userPrompt = `读者针对选段提出追问：\n【用户追问】：${question}\n\n【背景选段】：\n"${selectedText}"\n\n【页面上下文】：\n${contextText.slice(0, 1500)}`;
  } else {
    userPrompt = `请深入解释读者选中的以下词句：\n\n【选中词句】：\n"${selectedText}"\n\n【所在页面上下文参考】：\n${contextText.slice(0, 1500)}\n\n请按【核心含义】、【上下文深度剖析】和【背景延伸】给出精辟解析。`;
  }

  if (apiKey && apiKey.trim()) {
    const isGemini = provider === 'gemini' || baseUrl.includes('googleapis.com');
    try {
      if (isGemini) {
        const cleanBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com';
        const targetModel = (model && model.trim()) || 'gemini-3.5-flash-lite';
        
        const contents: any[] = [];
        if (Array.isArray(history) && history.length > 0) {
          for (const item of history) {
            contents.push({
              role: item.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: item.content }],
            });
          }
        }
        contents.push({ role: 'user', parts: [{ text: userPrompt }] });

        return await fetchGeminiDirectStream({
          apiKey: apiKey.trim(),
          baseUrl: cleanBaseUrl,
          model: targetModel,
          contents,
          systemInstruction: systemPrompt,
          signal,
        });
      } else {
        const messages: { role: string; content: string }[] = [{ role: 'system', content: systemPrompt }];
        if (Array.isArray(history) && history.length > 0) {
          for (const item of history) {
            messages.push({
              role: item.role === 'assistant' ? 'assistant' : 'user',
              content: item.content,
            });
          }
        }
        messages.push({ role: 'user', content: userPrompt });

        return await fetchOpenAIDirectStream({
          apiKey: apiKey.trim(),
          baseUrl,
          model,
          messages,
          signal,
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      console.warn('客户端解释直连异常，尝试服务端代理:', err);
    }
  }

  const serverResponse = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedText,
      contextText,
      question,
      history,
      apiKey,
      baseUrl,
      model,
      provider,
    }),
    signal,
  });

  return serverResponse;
}
