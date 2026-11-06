/**
 * 浏览器端 LLM 调用。
 * 配置了 API Key 时优先由浏览器直连服务商；仅当直连遇到网络错误（通常是 CORS 拦截）时，
 * 才回退到本站 /api/translate、/api/explain 代理转发（此时 Key 会经过本站服务端）。
 * 未配置 Key 时直接走代理，使用站点内置额度（是否开放由服务端 ALLOW_SERVER_API_KEY 决定）。
 */

import {
  ChatMessage,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  LlmEndpointConfig,
  LlmProvider,
  isGeminiEndpoint,
  normalizeBaseUrl,
  streamChat,
} from './llm/protocol';
import {
  DEFAULT_TARGET_LANGUAGE,
  EXPLAIN_SYSTEM_PROMPT,
  buildExplainUserPrompt,
  buildTranslateSystemPrompt,
  buildTranslateUserContent,
} from './llm/prompts';

export interface LlmClientSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  provider?: LlmProvider;
  signal?: AbortSignal;
}

export interface TranslateParams extends LlmClientSettings {
  text: string;
  previousPageTail?: string;
  targetLanguage?: string;
  customPrompt?: string;
}

export interface ExplainParams extends LlmClientSettings {
  selectedText: string;
  contextText?: string;
  question?: string;
  history?: ChatMessage[];
}

const TRANSLATE_TEMPERATURE = 0.3;
const EXPLAIN_TEMPERATURE = 0.4;

/** 本次会话中直连失败过的服务商地址，后续请求直接走代理，避免每次都先失败一次 */
const directBlockedEndpoints = new Set<string>();

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

function resolveDirectConfig(settings: LlmClientSettings): LlmEndpointConfig | null {
  const apiKey = settings.apiKey?.trim();
  if (!apiKey) return null;
  const gemini = isGeminiEndpoint(settings.provider, settings.baseUrl);
  const baseUrl = settings.baseUrl?.trim() || (gemini ? DEFAULT_GEMINI_BASE_URL : DEFAULT_OPENAI_BASE_URL);
  const model = settings.model?.trim() || (gemini ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);
  return { provider: gemini ? 'gemini' : settings.provider, baseUrl, apiKey, model };
}

async function tryDirect(
  config: LlmEndpointConfig | null,
  run: (config: LlmEndpointConfig) => Promise<Response>
): Promise<Response | null> {
  if (!config) return null;
  const endpointId = normalizeBaseUrl(config.baseUrl);
  if (directBlockedEndpoints.has(endpointId)) return null;
  try {
    return await run(config);
  } catch (err) {
    if (isAbortError(err)) throw err;
    // fetch 网络错误（含 CORS）抛 TypeError；HTTP 错误已由 streamChat 转为 JSON 响应，不会到这里
    if (err instanceof TypeError) {
      directBlockedEndpoints.add(endpointId);
      console.warn('浏览器直连失败，改用本站代理转发:', err.message);
      return null;
    }
    throw err;
  }
}

function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * 翻译流式请求，返回纯文本流响应；出错时返回带 error 字段的 JSON 响应。
 */
export async function executeTranslateStream(params: TranslateParams): Promise<Response> {
  const {
    text,
    previousPageTail,
    targetLanguage = DEFAULT_TARGET_LANGUAGE,
    customPrompt,
    signal,
  } = params;

  const direct = await tryDirect(resolveDirectConfig(params), config =>
    streamChat(
      config,
      {
        system: buildTranslateSystemPrompt(customPrompt, targetLanguage),
        messages: [{ role: 'user', content: buildTranslateUserContent(text, previousPageTail) }],
        temperature: TRANSLATE_TEMPERATURE,
      },
      signal
    )
  );
  if (direct) return direct;

  return postJson(
    '/api/translate',
    {
      text,
      previousPageTail,
      targetLanguage,
      customPrompt,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      provider: params.provider,
    },
    signal
  );
}

/**
 * 划词解释流式请求（支持多轮追问）。
 */
export async function executeExplainStream(params: ExplainParams): Promise<Response> {
  const { selectedText, contextText = '', question, history = [], signal } = params;

  const direct = await tryDirect(resolveDirectConfig(params), config =>
    streamChat(
      config,
      {
        system: EXPLAIN_SYSTEM_PROMPT,
        messages: [
          ...history,
          { role: 'user', content: buildExplainUserPrompt({ selectedText, contextText, question }) },
        ],
        temperature: EXPLAIN_TEMPERATURE,
      },
      signal
    )
  );
  if (direct) return direct;

  return postJson(
    '/api/explain',
    {
      selectedText,
      contextText,
      question,
      history,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      provider: params.provider,
    },
    signal
  );
}
