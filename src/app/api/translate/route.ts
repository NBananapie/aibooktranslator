import {
  DEFAULT_TARGET_LANGUAGE,
  buildTranslateSystemPrompt,
  buildTranslateUserContent,
} from '@/lib/llm/prompts';
import { asTrimmedString, jsonError, proxyChat, readJsonBody, resolveUpstream } from '@/lib/server/llmProxy';
import { enforceRateLimit } from '@/lib/server/cloudflare';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 40_000;
const MAX_PREV_TAIL_CHARS = 2_000;
const MAX_PROMPT_CHARS = 8_000;

export async function POST(req: Request) {
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (body instanceof Response) return body;

  const text = asTrimmedString(body.text, MAX_TEXT_CHARS);
  if (!text) return jsonError(400, '未提供待翻译文本');

  const upstream = resolveUpstream(body);
  if (!upstream.ok) return jsonError(upstream.status, upstream.error);
  if (upstream.usingServerKey) {
    const limited = await enforceRateLimit(req, 'LLM_RATE_LIMITER', 'llm');
    if (limited) return limited;
  }

  const targetLanguage = asTrimmedString(body.targetLanguage, 32) || DEFAULT_TARGET_LANGUAGE;
  const customPrompt = asTrimmedString(body.customPrompt, MAX_PROMPT_CHARS);
  const previousPageTail = asTrimmedString(body.previousPageTail, MAX_PREV_TAIL_CHARS);

  return proxyChat(
    upstream.config,
    {
      system: buildTranslateSystemPrompt(customPrompt, targetLanguage),
      messages: [{ role: 'user', content: buildTranslateUserContent(text, previousPageTail) }],
      temperature: 0.3,
    },
    req.signal
  );
}
