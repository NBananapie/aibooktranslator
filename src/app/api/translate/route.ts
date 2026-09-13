export const runtime = 'edge';

function buildSystemPrompt(customPrompt?: string, targetLanguage = '中文') {
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim();
  }
  return `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into elegant, publishable ${targetLanguage} Markdown.

CORE PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native phrasing.
2. PRESERVE STRUCTURE & TYPOGRAPHY:
   - Section Headings: Format headings as clear Markdown headings (## 标题 or ### 小标题).
   - Core Takeaways & Quotes: Format notable quotes or key lessons as blockquotes (> ...).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (-  or 1. ).
   - Key Terms: Use **bold** for critical concepts and technical terms.
3. OUTPUT FORMAT:
   Output ONLY the translated Chinese Markdown. Do NOT include conversational filler, notes, or JSON metadata.`;
}

// 处理 Google Gemini 原生协议流式输出 (Stream)
async function handleGeminiStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  text: string;
  systemPrompt: string;
}) {
  const { apiKey, baseUrl, model, text, systemPrompt } = params;

  let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
    cleanBaseUrl = `https://${cleanBaseUrl}`;
  }

  // 移除用户可能多填入的子路径，归一化到根路径或指定网关
  cleanBaseUrl = cleanBaseUrl.replace(/\/v1beta.*$/, '').replace(/\/openai.*$/, '');
  const apiUrl = `${cleanBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Gemini API returned ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = `Gemini 错误: ${errorJson.error.message}`;
      }
    } catch {
      errorMessage = `Gemini 错误 (${response.status}): ${errorText.slice(0, 200)}`;
    }
    return Response.json({ error: errorMessage, details: errorText }, { status: response.status });
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
                console.error('Error parsing Gemini stream chunk', e);
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

// 处理 OpenAI 兼容协议流式输出 (MiniMax / OpenAI / DeepSeek 等)
async function handleOpenAIStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  text: string;
  systemPrompt: string;
}) {
  const { apiKey, baseUrl, model, text, systemPrompt } = params;

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
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `API 响应失败 (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson.error) {
        errorMessage = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      }
    } catch {
      errorMessage = `API 错误 (${response.status}): ${errorText.slice(0, 200)}`;
    }
    return Response.json({ error: errorMessage, details: errorText }, { status: response.status });
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
                console.error('Error parsing OpenAI stream chunk', e);
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      text,
      targetLanguage = '中文',
      apiKey: clientApiKey,
      baseUrl: clientBaseUrl,
      model: clientModel,
      provider: clientProvider,
      customPrompt,
    } = body;

    if (!text) {
      return Response.json({ error: '未提供待翻译文本' }, { status: 400 });
    }

    const allowServerKey = process.env.ALLOW_SERVER_API_KEY === 'true';
    const serverKey = process.env.API_KEY || process.env.AGNES_API_KEY || process.env.DASHSCOPE_API_KEY || 'sk-V9RUJxxDq21mUkgN9eVjIdz1Lm7s1h1OUb2SuYVfkjxku0Id';
    const serverBaseUrl = process.env.BASE_URL || 'https://apihub.agnes-ai.com/v1';
    const serverModel = process.env.MODEL || 'agnes-3.0-flash';

    const apiKey = (clientApiKey && clientApiKey.trim()) ? clientApiKey.trim() : (allowServerKey ? serverKey : undefined);

    if (!apiKey) {
      return Response.json(
        { error: '请先在「设置」里填入您的 API Key（数据仅在本地，不会上传）' },
        { status: 401 }
      );
    }

    const systemPrompt = buildSystemPrompt(customPrompt, targetLanguage);

    // 精准判定协议类型：仅当明确选择 gemini 或 BaseURL 为 googleapis 时走原生 Google 协议
    const isGemini =
      clientProvider === 'gemini' ||
      (clientBaseUrl && clientBaseUrl.includes('googleapis.com'));

    if (isGemini) {
      const baseUrl = clientBaseUrl || 'https://generativelanguage.googleapis.com';
      const model = ((clientModel && clientModel.trim()) || 'gemini-3.5-flash-lite').toLowerCase();
      return await handleGeminiStream({
        apiKey,
        baseUrl,
        model,
        text,
        systemPrompt,
      });
    }

    // 默认走标准 OpenAI 兼容协议 (支持 DashScope, MiniMax, OpenAI, DeepSeek, 各种第三方转发网关)
    const baseUrl = (clientApiKey && clientApiKey.trim() && clientBaseUrl) ? clientBaseUrl.trim() : serverBaseUrl;
    const model = (clientApiKey && clientApiKey.trim() && clientModel) ? clientModel.trim() : serverModel;

    return await handleOpenAIStream({
      apiKey,
      baseUrl,
      model,
      text,
      systemPrompt,
    });
  } catch (error: any) {
    console.error('Translate Route Error:', error);
    return Response.json(
      { error: `翻译服务异常: ${error.message || error}` },
      { status: 500 }
    );
  }
}

