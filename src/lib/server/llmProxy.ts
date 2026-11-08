/**
 * /api/translate 与 /api/explain 共用的服务端代理逻辑。
 *
 * 安全约束：
 * - 请求携带用户自己的 API Key 时，按用户提供的 baseUrl/model/provider 转发；
 * - 请求未携带 Key 且服务端开启 ALLOW_SERVER_API_KEY 时，使用服务端环境变量中的 Key，
 *   此时忽略客户端传入的 baseUrl/model/provider，避免服务端 Key 被发往任意地址。
 */

import {
  ChatRequest,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  LlmEndpointConfig,
  LlmProvider,
  isGeminiEndpoint,
  normalizeBaseUrl,
  streamChat,
} from '@/lib/llm/protocol';

export interface ClientLlmFields {
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  provider?: unknown;
}

export type UpstreamResolution =
  | { ok: true; config: LlmEndpointConfig; fallbackConfig?: LlmEndpointConfig; usingServerKey: boolean }
  | { ok: false; status: number; error: string };

const PROVIDERS: readonly LlmProvider[] = ['openai', 'gemini', 'custom'];
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_DEFAULT_MODEL = 'qwen-plus';

export function asTrimmedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function asProvider(value: unknown): LlmProvider | undefined {
  return PROVIDERS.includes(value as LlmProvider) ? (value as LlmProvider) : undefined;
}

/** 用户自填的服务商地址只允许 https，且不能带用户名密码 */
function validateClientBaseUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(normalizeBaseUrl(raw));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function resolveUpstream(fields: ClientLlmFields): UpstreamResolution {
  const clientKey = asTrimmedString(fields.apiKey, 512);

  if (clientKey) {
    const provider = asProvider(fields.provider);
    const rawBaseUrl = asTrimmedString(fields.baseUrl, 2048);
    const gemini = isGeminiEndpoint(provider, rawBaseUrl);
    const baseUrl = rawBaseUrl
      ? validateClientBaseUrl(rawBaseUrl)
      : gemini
        ? DEFAULT_GEMINI_BASE_URL
        : DEFAULT_OPENAI_BASE_URL;
    if (!baseUrl) {
      return { ok: false, status: 400, error: 'Base URL 无效：仅支持 https 地址' };
    }
    return {
      ok: true,
      usingServerKey: false,
      config: {
        provider: gemini ? 'gemini' : provider,
        baseUrl,
        apiKey: clientKey,
        model: asTrimmedString(fields.model, 200),
      },
    };
  }

  const configuredBaseUrl = process.env.BASE_URL?.trim();
  const dashscopeKey = process.env.DASHSCOPE_API_KEY?.trim();
  const primaryKey = process.env.API_KEY?.trim() || process.env.AGNES_API_KEY?.trim();
  const useDashScopePrimary =
    !!configuredBaseUrl?.includes('dashscope.aliyuncs.com') || (!primaryKey && !!dashscopeKey);

  const serverKey = useDashScopePrimary ? dashscopeKey || primaryKey : primaryKey || dashscopeKey;
  if (process.env.ALLOW_SERVER_API_KEY !== 'true' || !serverKey) {
    return {
      ok: false,
      status: 401,
      error: '请先在「设置」中填写 API Key（本站未开放内置额度）',
    };
  }

  const config: LlmEndpointConfig = useDashScopePrimary
    ? {
        provider: 'openai',
        baseUrl: configuredBaseUrl || DASHSCOPE_BASE_URL,
        apiKey: serverKey,
        model: process.env.MODEL?.trim() || DASHSCOPE_DEFAULT_MODEL,
      }
    : {
        provider: asProvider(process.env.LLM_PROVIDER) ?? 'openai',
        baseUrl: configuredBaseUrl || DEFAULT_OPENAI_BASE_URL,
        apiKey: serverKey,
        model: process.env.MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      };

  const fallbackConfig: LlmEndpointConfig | undefined =
    !useDashScopePrimary && dashscopeKey
      ? {
          provider: 'openai',
          baseUrl: DASHSCOPE_BASE_URL,
          apiKey: dashscopeKey,
          model: process.env.DASHSCOPE_MODEL?.trim() || DASHSCOPE_DEFAULT_MODEL,
        }
      : undefined;

  return {
    ok: true,
    usingServerKey: true,
    config,
    fallbackConfig,
  };
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) return jsonError(413, '请求体过大');
  if (!req.body) return jsonError(400, '请求体为空');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return jsonError(413, '请求体过大');
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(merged);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonError(400, '请求体必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
  } catch {
    return jsonError(400, '非法 JSON 数据格式');
  }
}

/** 等待上游返回响应头的最长时间；之后的流式输出不受此限制 */
const UPSTREAM_HEADER_TIMEOUT_MS = 30_000;

/** 转发到上游，网络异常或超时统一转为 502/504；若提供备用上游且主上游返回 429/5xx 则自动切换 */
export async function proxyChat(
  config: LlmEndpointConfig,
  request: ChatRequest,
  signal?: AbortSignal,
  fallbackConfig?: LlmEndpointConfig
): Promise<Response> {
  const attempt = async (target: LlmEndpointConfig): Promise<Response> => {
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onClientAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_HEADER_TIMEOUT_MS);

    try {
      return await streamChat(target, request, controller.signal);
    } catch (err) {
      if (timedOut) return jsonError(504, '模型服务响应超时，请稍后重试');
      const message = err instanceof Error ? err.message : String(err);
      return jsonError(502, `无法连接模型服务: ${message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onClientAbort);
    }
  };

  const primaryRes = await attempt(config);
  if (fallbackConfig && (primaryRes.status === 429 || primaryRes.status >= 500) && !signal?.aborted) {
    return attempt(fallbackConfig);
  }
  return primaryRes;
}
