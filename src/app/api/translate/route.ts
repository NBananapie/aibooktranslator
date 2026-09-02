import { NextResponse } from 'next/server';

export const runtime = 'edge';

function buildSystemPrompt(customPrompt?: string, targetLanguage = '中文') {
  return (
    customPrompt ||
    `You are an elite bilingual book editor, master translator, and typography architect. Translate the following English text into ${targetLanguage}.

CORE TRANSLATION & LAYOUT PRINCIPLES:
1. "信达雅" (Faithful, Expressive, Elegant): Ensure the translation reads like a professionally published Chinese masterwork with natural, fluent, native business/literary phrasing.
2. CONTEXT-AWARE STRUCTURAL HIERARCHY:
   - Standalone Section Titles & Topic Breaks: Intelligently format headings as clear Markdown headings (\`## 标题\` or \`### 小标题\`).
   - Core Takeaways, Exercises & Pull-Quotes: Format key lessons or notable quotes as blockquotes (\`> 核心要义: ...\`).
   - Paragraph Synthesis: Smoothly reconnect fragmented lines into cohesive paragraphs.
   - Lists & Sequences: Convert bullet points into clean Markdown lists (\`- \` or \`1. \`).
   - Key Concepts & Emphasis: Use \`**bold**\` for critical terms.
3. PRECISE SENTENCE-LEVEL BILINGUAL ALIGNMENT MAP:
   At the very end of your response, after the complete translated markdown text, append a hidden JSON comment block mapping each translated sentence to its original English source sentence for bilingual alignment.
   Format EXACTLY like this:
   <!-- BILINGUAL_MAP:
   [
     {"zh": "一段中文翻译句子", "en": "The exact corresponding English sentence."},
     ...
   ]
   -->
4. Output ONLY the translated Markdown followed by the hidden BILINGUAL_MAP comment block. Do NOT include conversational filler.`
  );
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
    return NextResponse.json({ error: errorMessage, details: errorText }, { status: response.status });
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

  let cleanBaseUrl = baseUrl.trim();
  if (!cleanBaseUrl.endsWith('/')) cleanBaseUrl += '/';
  const apiUrl = `${cleanBaseUrl}chat/completions`;

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
    let errorMessage = `API returned ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson.error) {
        errorMessage = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      }
    } catch {
      errorMessage = `Status ${response.status}: ${errorText.slice(0, 200)}`;
    }
    return NextResponse.json({ error: errorMessage, details: errorText }, { status: response.status });
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
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const allowServerKey = process.env.ALLOW_SERVER_API_KEY === 'true';
    const apiKey = clientApiKey || (allowServerKey ? process.env.MINIMAX_API_KEY : undefined);

    if (!apiKey) {
      return NextResponse.json(
        { error: '请先在「设置」里填入你自己的 API Key（不会上传或保存）' },
        { status: 401 }
      );
    }

    const systemPrompt = buildSystemPrompt(customPrompt, targetLanguage);

    // 智能判定协议类型
    const isGemini =
      clientProvider === 'gemini' ||
      (clientBaseUrl && clientBaseUrl.includes('googleapis.com')) ||
      (clientModel && clientModel.toLowerCase().startsWith('gemini'));

    if (isGemini) {
      const baseUrl = clientBaseUrl || 'https://generativelanguage.googleapis.com';
      const model = clientModel || 'gemini-3.7-flash';
      return await handleGeminiStream({
        apiKey,
        baseUrl,
        model,
        text,
        systemPrompt,
      });
    }

    // 默认 OpenAI 兼容协议
    const baseUrl = clientBaseUrl || process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';
    const model = clientModel || process.env.TRANSLATE_MODEL || 'MiniMax-M2.7-highspeed';

    return await handleOpenAIStream({
      apiKey,
      baseUrl,
      model,
      text,
      systemPrompt,
    });
  } catch (error: any) {
    console.error('Edge Route Error:', error);
    return NextResponse.json(
      { error: `Internal Server Error: ${error.message}` },
      { status: 500 }
    );
  }
}

