/**
 * 百度飞桨 OCR 图像捕获与异步作业调度服务 (OCR Service)
 */

export interface OcrRequestParams {
  imageBase64: string;
  apiToken: string;
  model?: string;
  apiUrl?: string;
}

export interface OcrResult {
  text: string;
  markdown: string;
  raw?: any;
}

/**
 * 将 PDF.js 页面对象渲染到离屏 Canvas 并导出为 PNG Base64 编码
 * 预填纯白底色，杜绝透明背景在部分渲染引擎中变黑导致 OCR 无法识别
 */
export async function capturePageCanvasAsBase64(
  page: any,
  scale = 2.0
): Promise<string> {
  if (!page) throw new Error('PDF 页面对象不存在');
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 上下文初始化失败');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await (page.render as any)({ canvasContext: context, viewport, canvas }).promise;
  return canvas.toDataURL('image/png');
}

/**
 * 异步提交 OCR 作业并获取结构化 Markdown
 */
export async function requestPaddleOcr(params: OcrRequestParams): Promise<OcrResult> {
  const { imageBase64, apiToken, model = 'PaddleOCR-VL-1.6', apiUrl } = params;

  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      apiToken,
      model,
      apiUrl,
    }),
  });

  const resText = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(resText);
  } catch {
    data = { error: resText || `HTTP ${res.status} OCR 服务异常` };
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || `OCR 识别请求失败 (${res.status})`);
  }

  const ocrMarkdown = data.markdown || data.text || '';
  if (!ocrMarkdown.trim()) {
    throw new Error('百度飞桨 OCR 未在此页识别到文本或图表内容。');
  }

  return {
    text: data.text || ocrMarkdown,
    markdown: ocrMarkdown,
    raw: data.raw,
  };
}
