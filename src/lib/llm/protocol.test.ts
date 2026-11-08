import { describe, expect, it } from 'vitest';
import { buildChatRequest, extractSseText, isGeminiEndpoint, toPlainTextStream } from './protocol';
import { buildTranslateSystemPrompt, buildTranslateUserContent } from './prompts';

describe('isGeminiEndpoint', () => {
  it('detects by provider or googleapis host', () => {
    expect(isGeminiEndpoint('gemini', '')).toBe(true);
    expect(isGeminiEndpoint('openai', 'https://generativelanguage.googleapis.com')).toBe(true);
    expect(isGeminiEndpoint('openai', 'https://googleapis.com.evil.example')).toBe(false);
    expect(isGeminiEndpoint('openai', 'https://api.openai.com/v1')).toBe(false);
  });
});

describe('buildChatRequest', () => {
  const request = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.3 };

  it('keeps Gemini key out of the URL', () => {
    const { url, init } = buildChatRequest(
      { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'secret', model: 'Gemini-X' },
      request
    );
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse');
    expect(url).not.toContain('secret');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret');
  });

  it('normalizes OpenAI-compatible URLs', () => {
    const cases: Array<[string, string]> = [
      ['https://api.example.com/v1', 'https://api.example.com/v1/chat/completions'],
      ['https://api.example.com/', 'https://api.example.com/v1/chat/completions'],
      ['https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/chat/completions'],
    ];
    for (const [base, expected] of cases) {
      expect(buildChatRequest({ baseUrl: base, apiKey: 'k', model: 'm' }, request).url).toBe(expected);
    }
  });
});

describe('extractSseText / toPlainTextStream', () => {
  it('extracts deltas for both protocols', () => {
    expect(extractSseText('{"choices":[{"delta":{"content":"你好"}}]}', false)).toBe('你好');
    expect(extractSseText('{"candidates":[{"content":{"parts":[{"text":"a"},{"text":"b"}]}}]}', true)).toBe('ab');
    expect(extractSseText('not json', false)).toBe('');
  });

  it('handles events split across chunks and multibyte characters', async () => {
    const raw = 'data: {"choices":[{"delta":{"content":"中文"}}]}\n\ndata: {"choices":[{"delta":{"content":"翻译"}}]}\n\ndata: [DONE]\n';
    const bytes = new TextEncoder().encode(raw);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        // 在多字节字符中间切分
        controller.enqueue(bytes.slice(0, 37));
        controller.enqueue(bytes.slice(37));
        controller.close();
      },
    });
    const text = await new Response(toPlainTextStream(source, false)).text();
    expect(text).toBe('中文翻译');
  });
});

describe('prompts', () => {
  it('uses custom prompt when provided, otherwise includes target language', () => {
    expect(buildTranslateSystemPrompt('  custom  ')).toBe('custom');
    expect(buildTranslateSystemPrompt('', '日本語')).toContain('日本語');
  });

  it('adds previous page tail only when present', () => {
    expect(buildTranslateUserContent('body')).toBe('body');
    const withTail = buildTranslateUserContent('body', 'tail text');
    expect(withTail).toContain('tail text');
    expect(withTail.endsWith('body')).toBe(true);
  });
});
