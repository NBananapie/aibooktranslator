import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      text, 
      targetLanguage = '中文', 
      apiKey: clientApiKey, 
      baseUrl: clientBaseUrl, 
      customPrompt 
    } = body;

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // 显式获取环境变量，并增加调试信息
    const envApiKey = process.env.MINIMAX_API_KEY;
    const envBaseUrl = process.env.MINIMAX_BASE_URL;

    const finalApiKey = clientApiKey || envApiKey;
    const finalBaseUrl = clientBaseUrl || envBaseUrl;

    if (!finalApiKey) {
      return NextResponse.json({ 
        error: 'Missing API Key. Please set MINIMAX_API_KEY in Cloudflare dashboard (Settings -> Functions -> Environment variables).' 
      }, { status: 401 });
    }

    const openai = new OpenAI({
      apiKey: finalApiKey,
      baseURL: finalBaseUrl || 'https://api.minimax.chat/v1',
    });

    const systemPrompt = customPrompt || `You are a professional translator. Translate the following text into ${targetLanguage}. 
          
IMPORTANT RULES:
1. Translate with the principle of "信达雅" (Faithful, Expressive, Elegant). Ensure the Chinese translation reads naturally, beautifully, and professionally to a native speaker.
2. Accurately convey the original author's underlying meaning, tone, and metaphors. Do not just translate literally; capture the essence.
3. Preserve the EXACT original formatting, paragraph structure, and line breaks. If there are headings, lists, or code blocks, keep them in Markdown format.
4. Output ONLY the translated text in Markdown. Do NOT include any conversational filler.`;

    const response = await openai.chat.completions.create({
      model: 'MiniMax-M2.7-highspeed',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        } catch (e: any) {
          console.error('Stream error:', e);
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
    console.error('Translation API Error:', error);
    
    // 返回更详细的错误信息给前端
    const errorMessage = error.message || 'Unknown error';
    const errorDetails = error.response?.data || error.stack || '';
    
    return NextResponse.json(
      { 
        error: `API Error: ${errorMessage}`,
        details: errorDetails
      },
      { status: 500 }
    );
  }
}
