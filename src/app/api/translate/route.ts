import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      text, 
      targetLanguage = '中文', 
      apiKey, 
      baseUrl, 
      customPrompt 
    } = body;

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const openai = new OpenAI({
      apiKey: apiKey || process.env.MINIMAX_API_KEY,
      baseURL: baseUrl || process.env.MINIMAX_BASE_URL,
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
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      stream: true,
      max_tokens: 8192,
    });

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            controller.enqueue(new TextEncoder().encode(content));
          }
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Translation API Error:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during translation' },
      { status: 500 }
    );
  }
}
