/**
 * LLM 请求构造与流式响应解析，浏览器与服务端（Workers）共用。
 * 只依赖标准 fetch / ReadableStream / TextDecoder。
 */

export type LlmProvider = 'openai' | 'gemini' | 'custom';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmEndpointConfig {
  provider?: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  temperature: number;
}

export const DEFAULT_OPENAI_BASE_URL = 'https://apihub.agnes-ai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'agnes-3.0-flash';
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function getHostname(url: string): string {
  try {
    return new URL(normalizeBaseUrl(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 去掉首尾空白与结尾斜杠，缺少协议时补 https:// */
export function normalizeBaseUrl(baseUrl: string): string {
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean && !/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return clean;
}

export function isGeminiEndpoint(provider: LlmProvider | undefined, baseUrl: string | undefined): boolean {
  if (provider === 'gemini') return true;
  if (!baseUrl) return false;
  const host = getHostname(baseUrl);
  return host === 'googleapis.com' || host.endsWith('.googleapis.com');
}

function buildGeminiUrl(baseUrl: string, model: string): string {
  const root = normalizeBaseUrl(baseUrl || DEFAULT_GEMINI_BASE_URL)
    .replace(/\/v1beta.*$/, '')
    .replace(/\/openai.*$/, '');
  const cleanModel = (model.trim() || DEFAULT_GEMINI_MODEL).toLowerCase();
  return `${root}/v1beta/models/${encodeURIComponent(cleanModel)}:streamGenerateContent?alt=sse`;
}

function buildOpenAIUrl(baseUrl: string): string {
  const clean = normalizeBaseUrl(baseUrl || DEFAULT_OPENAI_BASE_URL);
  if (clean.endsWith('/chat/completions')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

/**
 * 按服务商协议构造流式聊天请求。API Key 只放在请求头中，不拼进 URL。
 */
export function buildChatRequest(
  config: LlmEndpointConfig,
  request: ChatRequest,
  signal?: AbortSignal
): { url: string; init: RequestInit } {
  if (isGeminiEndpoint(config.provider, config.baseUrl)) {
    return {
      url: buildGeminiUrl(config.baseUrl, config.model),
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({
          contents: request.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          systemInstruction: { parts: [{ text: request.system }] },
          generationConfig: { temperature: request.temperature },
        }),
        signal,
      },
    };
  }

  return {
    url: buildOpenAIUrl(config.baseUrl),
    init: {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model.trim() || DEFAULT_OPENAI_MODEL,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        temperature: request.temperature,
        stream: true,
      }),
      signal,
    },
  };
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

interface OpenAIChunk {
  choices?: { delta?: { content?: string | null } }[];
}

/** 从单条 SSE data 负载中提取文本增量 */
export function extractSseText(data: string, gemini: boolean): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (gemini) {
      const parts = (parsed as GeminiChunk).candidates?.[0]?.content?.parts ?? [];
      return parts.map(p => p.text ?? '').join('');
    }
    return (parsed as OpenAIChunk).choices?.[0]?.delta?.content ?? '';
  } catch {
    return '';
  }
}

/**
 * 把上游 SSE 流转换为纯文本流（UTF-8 字节）。
 */
export function toPlainTextStream(
  body: ReadableStream<Uint8Array>,
  gemini: boolean
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  let buffer = '';

  const emitLine = (line: string, controller: ReadableStreamDefaultController<Uint8Array>): boolean => {
    const cleaned = line.trim();
    if (!cleaned.startsWith('data:')) return false;
    const payload = cleaned.slice(5).trim();
    if (!payload || payload === '[DONE]') return false;
    const text = extractSseText(payload, gemini);
    if (!text) return false;
    controller.enqueue(encoder.encode(text));
    return true;
  };

  return new ReadableStream<Uint8Array>({
    // 每次 pull 必须至少输出一块或结束流：若 pull 返回时既未 enqueue 也未 close，流不会再次调用 pull 而停滞。
    // 上游一个网络分片可能不含完整的一行（或只有心跳、空行），因此循环读取直到有输出。
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer) emitLine(buffer, controller);
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          let emitted = false;
          for (const line of lines) {
            if (emitLine(line, controller)) emitted = true;
          }
          if (emitted) return;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** 读取上游错误响应并提取可读的错误信息 */
export async function readUpstreamError(response: Response, gemini: boolean): Promise<string> {
  const errorText = await response.text().catch(() => '');
  const label = gemini ? 'Gemini' : 'API';
  try {
    const json = JSON.parse(errorText) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return `${label} 错误: ${json.error}`;
    if (json.error?.message) return `${label} 错误: ${json.error.message}`;
    if (json.message) return `${label} 错误: ${json.message}`;
  } catch {
    // 非 JSON 响应，使用原始文本
  }
  return `${label} 响应失败 (${response.status})${errorText ? `: ${errorText.slice(0, 200)}` : ''}`;
}

/**
 * 发起流式聊天请求。成功时返回纯文本流响应；上游 HTTP 错误时返回 JSON 错误响应。
 * 网络错误（含浏览器 CORS 拦截）与 AbortError 会向上抛出。
 */
export async function streamChat(
  config: LlmEndpointConfig,
  request: ChatRequest,
  signal?: AbortSignal
): Promise<Response> {
  const gemini = isGeminiEndpoint(config.provider, config.baseUrl);
  const { url, init } = buildChatRequest(config, request, signal);
  const upstream = await fetch(url, init);

  if (!upstream.ok) {
    const error = await readUpstreamError(upstream, gemini);
    return Response.json({ error }, { status: upstream.status });
  }
  if (!upstream.body) {
    return Response.json({ error: '上游未返回响应流' }, { status: 502 });
  }

  return new Response(toPlainTextStream(upstream.body, gemini), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/** 从 JSON 错误响应中提取 error 字段 */
export async function readErrorResponse(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { error?: string };
    if (json.error) return json.error;
  } catch {
    // 非 JSON
  }
  return text ? `HTTP ${response.status}: ${text.slice(0, 150)}` : `${fallback} (HTTP ${response.status})`;
}

/**
 * 逐块读取纯文本流，每收到一块回调一次累计文本，返回完整文本。
 */
export async function consumeTextStream(
  response: Response,
  onText?: (fullText: string) => void
): Promise<string> {
  if (!response.body) throw new Error('当前浏览器不支持 ReadableStream。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      full += decoder.decode(value, { stream: true });
      onText?.(full);
    }
  }
  full += decoder.decode();
  return full;
}
