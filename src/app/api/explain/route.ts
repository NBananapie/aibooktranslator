import { ChatMessage } from '@/lib/llm/protocol';
import { EXPLAIN_SYSTEM_PROMPT, buildExplainUserPrompt } from '@/lib/llm/prompts';
import { asTrimmedString, jsonError, proxyChat, readJsonBody, resolveUpstream } from '@/lib/server/llmProxy';

export const runtime = 'edge';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SELECTED_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 20_000;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_ITEM_CHARS = 8_000;

function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_ITEMS)
    .filter((item): item is { role?: unknown; content?: unknown } => !!item && typeof item === 'object')
    .map(item => ({
      role: item.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: asTrimmedString(item.content, MAX_HISTORY_ITEM_CHARS),
    }))
    .filter(item => item.content);
}

export async function POST(req: Request) {
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (body instanceof Response) return body;

  const selectedText = asTrimmedString(body.selectedText, MAX_SELECTED_CHARS);
  const question = asTrimmedString(body.question, MAX_QUESTION_CHARS);
  if (!selectedText && !question) return jsonError(400, '未提供待解释文本或追问内容');

  const upstream = resolveUpstream(body);
  if (!upstream.ok) return jsonError(upstream.status, upstream.error);

  const contextText = asTrimmedString(body.contextText, MAX_CONTEXT_CHARS);

  return proxyChat(
    upstream.config,
    {
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [
        ...parseHistory(body.history),
        { role: 'user', content: buildExplainUserPrompt({ selectedText, contextText, question: question || undefined }) },
      ],
      temperature: 0.4,
    },
    req.signal
  );
}
