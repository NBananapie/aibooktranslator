import { jsonError, readJsonBody } from '@/lib/server/llmProxy';
import { enforceRateLimit } from '@/lib/server/cloudflare';

const DEFAULT_OCR_JOBS_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
/** 允许转发 OCR 作业的域名（含子域名），可用环境变量 OCR_ALLOWED_HOSTS 追加，逗号分隔 */
const BUILTIN_OCR_HOSTS = ['aistudio-app.com', 'aistudio.baidu.com'];
/** OCR 结果文件下载地址允许的域名（飞桨结果存放在百度对象存储） */
const BUILTIN_RESULT_HOSTS = ['aistudio-app.com', 'aistudio.baidu.com', 'bcebos.com', 'baidubce.com'];

/** Base64 图片最大长度，约对应 9 MB 原始图片 */
const MAX_IMAGE_BASE64_CHARS = 12 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_IMAGE_BASE64_CHARS + 64 * 1024;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 1200;
const POLL_MAX_TIMES = 20;
const QUEUE_FULL_CODE = 10010;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function hostAllowed(hostname: string, allowList: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowList.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function extraHosts(): string[] {
  return (process.env.OCR_ALLOWED_HOSTS || '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

/** 校验 https 且域名在白名单内，返回规范化后的地址；不合法返回 null */
function checkUrl(raw: string, allowList: string[]): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!hostAllowed(url.hostname, allowList)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** 递归提取飞桨 OCR / 版面分析结果中的 Markdown 或文本 */
function extractTextFromPaddleResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (!isObject(result)) return '';

  // 1. PaddleOCR-VL / PP-Structure: layoutParsingResults
  if (Array.isArray(result.layoutParsingResults) && result.layoutParsingResults.length > 0) {
    const mdParts: string[] = [];
    for (const item of result.layoutParsingResults) {
      if (typeof item === 'string') {
        mdParts.push(item);
      } else if (isObject(item)) {
        const pruned = item.prunedResult;
        if (str(item.markdown)) {
          mdParts.push(item.markdown as string);
        } else if (typeof pruned === 'string') {
          mdParts.push(pruned);
        } else if (isObject(pruned)) {
          if (str(pruned.markdown)) {
            mdParts.push(pruned.markdown as string);
          } else if (Array.isArray(pruned.parsing_res)) {
            for (const elem of pruned.parsing_res) {
              if (!isObject(elem)) continue;
              const content = str(elem.block_content) || str(elem.text);
              if (content) mdParts.push(content);
            }
          }
        } else if (str(item.text)) {
          mdParts.push(item.text as string);
        }
      }
    }
    if (mdParts.length > 0) return mdParts.join('\n\n').trim();
  }

  // 2. PP-OCR 通用识别：ocrResults / pages
  const collectRecTexts = (list: unknown, prunedKey: 'prunedResult' | 'pruned_result'): string[] => {
    const lines: string[] = [];
    if (!Array.isArray(list)) return lines;
    for (const r of list) {
      if (typeof r === 'string') {
        lines.push(r);
        continue;
      }
      if (!isObject(r)) continue;
      const pruned = r[prunedKey];
      if (isObject(pruned) && Array.isArray(pruned.rec_texts)) {
        lines.push(...pruned.rec_texts.filter((t): t is string => typeof t === 'string' && !!t));
      } else {
        const text = str(r.words) || str(r.text);
        if (text) lines.push(text);
      }
    }
    return lines;
  };

  const ocrLines = collectRecTexts(result.ocrResults, 'prunedResult');
  if (ocrLines.length > 0) return ocrLines.join('\n');
  const pageLines = collectRecTexts(result.pages, 'pruned_result');
  if (pageLines.length > 0) return pageLines.join('\n');

  // 3. 通用字段
  const direct = str(result.markdown) || str(result.text) || str(result.content);
  if (direct) return direct;

  // 4. 深度遍历所有包含文字的字段
  const texts: string[] = [];
  const traverse = (obj: unknown) => {
    if (!isObject(obj) && !Array.isArray(obj)) return;
    if (isObject(obj)) {
      if (str(obj.markdown)) {
        texts.push(obj.markdown as string);
        return;
      }
      if (Array.isArray(obj.rec_texts)) {
        texts.push(...obj.rec_texts.filter((t): t is string => typeof t === 'string' && !!t));
        return;
      }
      for (const key of ['words', 'text', 'word'] as const) {
        const value = str(obj[key]);
        if (value) texts.push(value);
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') traverse(value);
    }
  };
  traverse(result);
  return texts.filter(Boolean).join('\n').trim();
}

async function fetchResultFile(rawUrl: unknown, kind: 'text' | 'json'): Promise<unknown> {
  const url = typeof rawUrl === 'string' ? checkUrl(rawUrl, [...BUILTIN_RESULT_HOSTS, ...extraHosts()]) : null;
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_RESULT_BYTES) return null;
  const text = await res.text();
  if (text.length > MAX_RESULT_BYTES) return null;
  return kind === 'text' ? text : JSON.parse(text);
}

/** 提交飞桨 OCR 作业并轮询结果；队列满时依次尝试候选模型 */
async function runPaddleOcrJob(
  rawToken: string,
  modelName: string,
  imageBytes: Uint8Array,
  jobsUrl: string
): Promise<{ text: string; raw: unknown }> {
  const token = rawToken.replace(/^Bearer\s+/i, '').replace(/^token\s+/i, '').trim();
  const candidateModels = [modelName, 'PP-OCRv6', 'PP-StructureV3'].filter(
    (m, idx, self) => Boolean(m) && self.indexOf(m) === idx
  );
  let lastErrorMsg = '';

  for (const currentModel of candidateModels) {
    const isLastModel = currentModel === candidateModels[candidateModels.length - 1];
    try {
      const formData = new FormData();
      formData.append('model', currentModel);
      formData.append('optionalPayload', JSON.stringify({}));
      formData.append('file', new Blob([imageBytes as BlobPart], { type: 'image/png' }), 'page_screenshot.png');

      const submitRes = await fetch(jobsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const submitText = await submitRes.text();
      let submitData: JsonObject;
      try {
        const parsed: unknown = JSON.parse(submitText);
        submitData = isObject(parsed) ? parsed : { msg: submitText };
      } catch {
        submitData = { msg: submitText };
      }

      const code = submitData.code;
      if (!submitRes.ok || (code !== 0 && code !== undefined)) {
        lastErrorMsg =
          str(submitData.msg) || str(submitData.message) || `飞桨提交失败 (${submitRes.status}): ${submitText.slice(0, 200)}`;
        if (code === QUEUE_FULL_CODE && !isLastModel) continue;
        throw new Error(lastErrorMsg);
      }

      const data = isObject(submitData.data) ? submitData.data : {};
      const jobId = str(data.jobId) || str(submitData.jobId) || str(data.id);
      if (!jobId) throw new Error(`未获取到飞桨 OCR 任务 ID: ${submitText.slice(0, 200)}`);

      for (let i = 0; i < POLL_MAX_TIMES; i++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        const pollRes = await fetch(`${jobsUrl}/${encodeURIComponent(jobId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!pollRes.ok) continue;

        let pollData: JsonObject;
        try {
          const parsed: unknown = await pollRes.json();
          if (!isObject(parsed)) continue;
          pollData = parsed;
        } catch {
          continue;
        }
        if (pollData.code !== 0) continue;

        const pollInner = isObject(pollData.data) ? pollData.data : {};
        const state = str(pollInner.state) || str(pollData.state);

        if (state === 'done' || state === 'success' || state === 'SUCCESS') {
          const resultUrl = isObject(pollInner.resultUrl)
            ? pollInner.resultUrl
            : isObject(pollData.resultUrl)
              ? pollData.resultUrl
              : {};

          // 优先使用结构化 Markdown（保留标题、段落、表格与公式）
          try {
            const md = await fetchResultFile(resultUrl.markdownUrl, 'text');
            if (typeof md === 'string' && md.trim()) return { text: md.trim(), raw: pollData };
          } catch (e) {
            console.warn('Failed to fetch markdownUrl, falling back to jsonUrl', e);
          }
          const resultJson = await fetchResultFile(resultUrl.jsonUrl, 'json');
          if (resultJson) {
            const inner = isObject(resultJson) && resultJson.result ? resultJson.result : resultJson;
            return { text: extractTextFromPaddleResult(inner), raw: resultJson };
          }
          return { text: extractTextFromPaddleResult(pollInner), raw: pollData };
        }

        if (state === 'failed' || state === 'FAILED' || state === 'error') {
          const errMsg = str(pollInner.errorMsg) || str(pollData.errorMsg) || '识别失败';
          throw new Error(`飞桨识别任务失败: ${errMsg}`);
        }
      }
      throw new Error('OCR 识别任务超时，请稍后重试');
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : String(err);
      if (isLastModel) throw new Error(lastErrorMsg);
    }
  }

  throw new Error(lastErrorMsg || 'OCR 识别遇到未知异常');
}

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'API_RATE_LIMITER', 'ocr');
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (body instanceof Response) return body;

  const image = typeof body.image === 'string' ? body.image : '';
  if (!image) return jsonError(400, '未提供图片数据');
  if (image.length > MAX_IMAGE_BASE64_CHARS) return jsonError(413, '图片过大，请降低渲染倍率后重试');

  const clientToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : '';
  const serverToken = process.env.PADDLEOCR_ACCESS_TOKEN?.trim() || '';
  const token = clientToken || serverToken;
  if (!token) {
    return jsonError(
      401,
      '请先在「设置」中配置百度飞桨 AI Studio OCR Token（可前往 https://aistudio.baidu.com/paddleocr 免费注册并获取）。'
    );
  }

  const usingServerToken = !clientToken;
  if (usingServerToken) {
    const llmLimited = await enforceRateLimit(req, 'LLM_RATE_LIMITER', 'ocr-server');
    if (llmLimited) return llmLimited;
  }

  // 使用服务端 Token 时忽略客户端传入的 apiUrl，防止服务端凭证被发往白名单子域下的非官方应用
  const rawApiUrl = usingServerToken
    ? process.env.PADDLEOCR_API_URL?.trim() || DEFAULT_OCR_JOBS_URL
    : typeof body.apiUrl === 'string' && body.apiUrl.trim()
      ? body.apiUrl
      : DEFAULT_OCR_JOBS_URL;
  const jobsUrl = checkUrl(rawApiUrl, [...BUILTIN_OCR_HOSTS, ...extraHosts()]);
  if (!jobsUrl) {
    return jsonError(400, 'OCR 接口地址不在允许列表内（仅支持 https 的飞桨 AI Studio 域名）');
  }

  const model = (typeof body.model === 'string' && body.model.trim()) || 'PaddleOCR-VL-1.6';

  try {
    let cleanBase64 = image.includes('base64,') ? image.split('base64,')[1] : image;
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');
    const imageBytes = base64ToUint8Array(cleanBase64);

    const result = await runPaddleOcrJob(token, model, imageBytes, jobsUrl);
    if (!result.text.trim()) {
      return Response.json({ text: '', markdown: '', message: 'OCR 接口未识别到有效文字内容' });
    }
    return Response.json({ text: result.text, markdown: result.text });
  } catch (error) {
    console.error('OCR Route Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(500, `OCR 处理发生异常: ${message}`);
  }
}
