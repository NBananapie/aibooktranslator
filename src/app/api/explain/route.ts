import { NextResponse } from 'next/server';

export const runtime = 'edge';

function buildExplainSystemPrompt() {
  return `你是一位出版级资深书籍导读学者与智能伴读顾问。
你的任务是针对读者在阅读书籍过程中划词选中的词汇、短语或句子，结合当前书籍页面的上下文提供精辟透彻的解析。

解析准则：
1. 【核心含义】：一针见血解释该词/句在当前段落语境下的确切意图与内涵。
2. 【上下文与逻辑剖析】：解析作者为何在此处这样表达，揭示背后的商业/技术/哲学逻辑或隐喻。
3. 【背景延伸】：如有专业术语、行业行话或文化典故，简要补充关键背景，扫清阅读障碍。
4. 【排版规范】：使用精美工整的 Markdown 结构（可包含加粗、列表或引用块），语言精炼专业，杜绝寒暄客套。`;
}

// 处理 Google Gemini 原生协议流式输出 (Stream)
async function handleGeminiExplainStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  contents: any[];
  systemPrompt: string;
}) {
  const { apiKey, baseUrl, model, contents, systemPrompt } = params;

  let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!cleanBaseUrl.startsWith('http://') && !cleanBaseUrl.startsWith('https://')) {
    cleanBaseUrl = `https://${cleanBaseUrl}`;
  }
  cleanBaseUrl = cleanBaseUrl.replace(/\/v1beta.*$/, '').replace(/\/openai.*$/, '');
  const apiUrl = `${cleanBaseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.4,
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
                console.error('Error parsing Gemini explain chunk', e);
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

// 处理 OpenAI 兼容协议流式输出
async function handleOpenAIExplainStream(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: { role: string; content: string }[];
}) {
  const { apiKey, baseUrl, model, messages } = params;

  let cleanBaseUrl = baseUrl.trim();
  if (!cleanBaseUrl.endsWith('/')) cleanBaseUrl += '/';
  const apiUrl = `${cleanBaseUrl}chat/completions`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
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
                console.error('Error parsing OpenAI explain chunk', e);
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
      selectedText,
      contextText = '',
      question,
      history = [],
      apiKey: clientApiKey,
      baseUrl: clientBaseUrl,
      model: clientModel,
      provider: clientProvider,
    } = body;

    if (!selectedText && !question) {
      return NextResponse.json({ error: '未提供待解释文本或追问内容' }, { status: 400 });
    }

    const allowServerKey = process.env.ALLOW_SERVER_API_KEY === 'true';
    const apiKey = clientApiKey || (allowServerKey ? process.env.MINIMAX_API_KEY : undefined);

    if (!apiKey) {
      return NextResponse.json(
        { error: '请先在「设置」中配置 API Key（不会上传第三方）' },
        { status: 401 }
      );
    }

    const systemPrompt = buildExplainSystemPrompt();

    // 智能判定协议类型
    const isGemini =
      clientProvider === 'gemini' ||
      (clientBaseUrl && clientBaseUrl.includes('googleapis.com')) ||
      (clientModel && clientModel.toLowerCase().startsWith('gemini'));

    // 构造首轮/多轮消息
    let userPrompt = '';
    if (question) {
      userPrompt = `读者针对选段提出追问：\n【用户追问】：${question}\n\n【背景选段】：\n"${selectedText}"\n\n【页面上下文】：\n${contextText.slice(0, 1500)}`;
    } else {
      userPrompt = `请深入解释读者选中的以下词句：\n\n【选中词句】：\n"${selectedText}"\n\n【所在页面上下文参考】：\n${contextText.slice(0, 1500)}\n\n请按【核心含义】、【上下文深度剖析】和【背景延伸】给出精辟解析。`;
    }

    if (isGemini) {
      const baseUrl = clientBaseUrl || 'https://generativelanguage.googleapis.com';
      const model = clientModel || 'gemini-3.7-flash';

      const contents: any[] = [];
      if (Array.isArray(history) && history.length > 0) {
        for (const item of history) {
          contents.push({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.content }],
          });
        }
      }
      contents.push({
        role: 'user',
        parts: [{ text: userPrompt }],
      });

      return await handleGeminiExplainStream({
        apiKey,
        baseUrl,
        model,
        contents,
        systemPrompt,
      });
    }

    // OpenAI 兼容协议
    const baseUrl = clientBaseUrl || process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';
    const model = clientModel || process.env.TRANSLATE_MODEL || 'MiniMax-M2.7-highspeed';

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

    return await handleOpenAIExplainStream({
      apiKey,
      baseUrl,
      model,
      messages,
    });
  } catch (error: any) {
    console.error('Explain Route Error:', error);
    return NextResponse.json(
      { error: `解释服务异常: ${error.message || error}` },
      { status: 500 }
    );
  }
}
