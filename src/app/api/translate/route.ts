import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      text, 
      targetLanguage = '中文', 
      apiKey: clientApiKey, 
      baseUrl: clientBaseUrl, 
      model: clientModel,
      customPrompt 
    } = body;

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // 默认只接受调用方自带的 Key。若要临时开放服务端 Key，需显式设置 ALLOW_SERVER_API_KEY=true。
    const allowServerKey = process.env.ALLOW_SERVER_API_KEY === 'true';
    const apiKey = clientApiKey || (allowServerKey ? process.env.MINIMAX_API_KEY : undefined);
    let baseUrl = clientBaseUrl || process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';
    
    // 自动修正 baseUrl 格式
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const apiUrl = `${baseUrl}chat/completions`;

    // 模型名随 Key 一起由调用方决定，这样任何 OpenAI 兼容端点都能直接用。
    const model = clientModel || process.env.TRANSLATE_MODEL || 'MiniMax-M2.7-highspeed';

    if (!apiKey) {
      return NextResponse.json(
        { error: '请先在「设置」里填入你自己的 API Key（不会上传或保存）' },
        { status: 401 }
      );
    }

    const systemPrompt = customPrompt || `You are a professional translator. Translate the following text into ${targetLanguage}. 
          
IMPORTANT RULES:
1. Translate with the principle of "信达雅" (Faithful, Expressive, Elegant). Ensure the Chinese translation reads naturally, beautifully, and professionally to a native speaker.
2. Accurately convey the original author's underlying meaning, tone, and metaphors. Do not just translate literally; capture the essence.
3. Preserve the EXACT original formatting, paragraph structure, and line breaks. If there are headings, lists, or code blocks, keep them in Markdown format.
4. Output ONLY the translated text in Markdown. Do NOT include any conversational filler.`;

    // 使用原生 fetch 代替 openai 库，确保在 Cloudflare Edge 上 100% 稳定
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
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ 
        error: `API returned ${response.status}`, 
        details: errorText 
      }, { status: response.status });
    }

    // 处理流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
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
                  const content = data.choices[0]?.delta?.content || '';
                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch (e) {
                  console.error('Error parsing stream chunk', e);
                }
              }
            }
          }
        } catch (e) {
          controller.error(e);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error: any) {
    console.error('Edge Route Error:', error);
    return NextResponse.json(
      { error: `Internal Server Error: ${error.message}` },
      { status: 500 }
    );
  }
}
