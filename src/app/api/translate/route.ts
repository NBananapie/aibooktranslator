import { NextResponse } from 'next/server';

export const runtime = 'edge';

function buildSystemPrompt(customPrompt?: string, targetLanguage = '中文') {
  return (
    customPrompt ||
    `You are a professional translator. Translate the following text into ${targetLanguage}. 

IMPORTANT RULES:
1. Translate with the principle of "信达雅" (Faithful, Expressive, Elegant). Ensure the Chinese translation reads naturally, beautifully, and professionally to a native speaker.
2. Accurately convey the original author's underlying meaning, tone, and metaphors. Do not just translate literally; capture the essence.
3. Preserve the EXACT original formatting, paragraph structure, and line breaks. If there are headings, lists, or code blocks, keep them in Markdown format.
4. Output ONLY the translated text in Markdown. Do NOT include any conversational filler.`
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
      'Authorization': `Bearer ${apiKey}`,
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

