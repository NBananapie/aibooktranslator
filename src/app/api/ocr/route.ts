export const runtime = 'edge';

// Web 标准 Base64 转 Uint8Array (Edge Runtime 兼容)
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// 递归提取百度飞桨 OCR / Layout 分析结果中的 Markdown / 结构化文本
function extractTextFromPaddleResult(result: any): string {
  if (!result) return '';

  if (typeof result === 'string') {
    return result;
  }

  // 1. PaddleOCR-VL-1.6 / PP-Structure: layoutParsingResults
  if (Array.isArray(result.layoutParsingResults) && result.layoutParsingResults.length > 0) {
    const mdParts: string[] = [];
    for (const item of result.layoutParsingResults) {
      if (typeof item === 'string') {
        mdParts.push(item);
      } else if (item.markdown && typeof item.markdown === 'string') {
        mdParts.push(item.markdown);
      } else if (item.prunedResult) {
        if (typeof item.prunedResult === 'string') {
          mdParts.push(item.prunedResult);
        } else if (item.prunedResult.markdown) {
          mdParts.push(item.prunedResult.markdown);
        } else if (Array.isArray(item.prunedResult.parsing_res)) {
          for (const elem of item.prunedResult.parsing_res) {
            if (elem.block_content) mdParts.push(elem.block_content);
            else if (elem.text) mdParts.push(elem.text);
          }
        }
      } else if (item.text) {
        mdParts.push(item.text);
      }
    }
    if (mdParts.length > 0) {
      return mdParts.join('\n\n').trim();
    }
  }

  // 2. PP-OCR 通用识别：ocrResults / pages / rec_texts
  if (Array.isArray(result.ocrResults)) {
    const lines: string[] = [];
    for (const r of result.ocrResults) {
      if (typeof r === 'string') {
        lines.push(r);
      } else if (r.prunedResult?.rec_texts && Array.isArray(r.prunedResult.rec_texts)) {
        lines.push(...r.prunedResult.rec_texts.filter(Boolean));
      } else if (r.words || r.text) {
        lines.push(r.words || r.text);
      }
    }
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  if (Array.isArray(result.pages)) {
    const lines: string[] = [];
    for (const page of result.pages) {
      if (page.pruned_result?.rec_texts && Array.isArray(page.pruned_result.rec_texts)) {
        lines.push(...page.pruned_result.rec_texts.filter(Boolean));
      }
    }
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  if (Array.isArray(result.words_result)) {
    return result
      .map((w: any) => (typeof w === 'string' ? w : w.words || ''))
      .filter(Boolean)
      .join('\n');
  }

  if (Array.isArray(result.prism_wordsInfo)) {
    return result
      .map((w: any) => (typeof w === 'string' ? w : w.word || ''))
      .filter(Boolean)
      .join('\n');
  }

  // 3. 通用字段检查
  if (result.markdown && typeof result.markdown === 'string') {
    return result.markdown;
  }
  if (result.text && typeof result.text === 'string') {
    return result.text;
  }
  if (result.content && typeof result.content === 'string') {
    return result.content;
  }

  // 4. 深度遍历所有包含文字的字段
  const texts: string[] = [];
  const traverse = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.markdown && typeof obj.markdown === 'string') {
      texts.push(obj.markdown);
      return;
    }
    if (obj.rec_texts && Array.isArray(obj.rec_texts)) {
      texts.push(...obj.rec_texts.filter(Boolean));
      return;
    }
    if (obj.words && typeof obj.words === 'string') {
      texts.push(obj.words);
    }
    if (obj.text && typeof obj.text === 'string') {
      texts.push(obj.text);
    }
    if (obj.word && typeof obj.word === 'string') {
      texts.push(obj.word);
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        traverse(obj[key]);
      }
    }
  };
  traverse(result);

  return texts.filter(Boolean).join('\n').trim();
}

// 异步提交并轮询百度飞桨 AIStudio PaddleOCR 作业
async function runPaddleOcrJob(
  rawToken: string,
  modelName: string,
  imageBytes: Uint8Array,
  apiUrl?: string
): Promise<{ text: string; raw: any }> {
  // 清洗 Token 前缀，确保标准 Bearer 鉴权
  const token = rawToken.replace(/^Bearer\s+/i, '').replace(/^token\s+/i, '').trim();

  const baseBaseUrl = (apiUrl && apiUrl.includes('/api/v2/ocr/jobs'))
    ? apiUrl.trim().replace(/\/+$/, '')
    : 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';

  const candidateModels = [modelName, 'PP-OCRv6', 'PP-StructureV3'].filter(
    (m, idx, self) => Boolean(m) && self.indexOf(m) === idx
  );
  let lastErrorMsg = '';

  for (const currentModel of candidateModels) {
    try {
      const formData = new FormData();
      formData.append('model', currentModel);
      formData.append('optionalPayload', JSON.stringify({}));
      
      const blob = new Blob([imageBytes as any], { type: 'image/png' });
      formData.append('file', blob, 'page_screenshot.png');

      const submitRes = await fetch(baseBaseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const submitText = await submitRes.text();
      let submitData: any = null;
      try {
        submitData = JSON.parse(submitText);
      } catch {
        submitData = { msg: submitText };
      }

      if (!submitRes.ok || !submitData) {
        lastErrorMsg = submitData?.msg || submitData?.message || `百度提交失败 (${submitRes.status}): ${submitText.slice(0, 200)}`;
        // 如果是队列满，尝试下一个候选模型
        if (submitData?.code === 10010) {
          continue;
        }
        throw new Error(lastErrorMsg);
      }

      if (submitData.code !== 0 && submitData.code !== undefined) {
        lastErrorMsg = submitData.msg || `作业错误 (${submitData.code})`;
        if (submitData.code === 10010) {
          continue;
        }
        throw new Error(lastErrorMsg);
      }

      const jobId = submitData.data?.jobId || submitData.jobId || submitData.data?.id;
      if (!jobId) {
        throw new Error(`未获取到百度飞桨 OCR 任务 ID: ${submitText.slice(0, 200)}`);
      }

      // 轮询等待任务完成 (最多轮询 20 次，约 25 秒)
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const pollRes = await fetch(`${baseBaseUrl}/${jobId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!pollRes.ok) continue;

        const pollText = await pollRes.text();
        let pollData: any = null;
        try {
          pollData = JSON.parse(pollText);
        } catch {
          continue;
        }

        if (!pollData || pollData.code !== 0) continue;

        const state = pollData.data?.state || pollData.state;

        if (state === 'done' || state === 'success' || state === 'SUCCESS') {
          const resultUrl = pollData.data?.resultUrl || pollData.resultUrl;
          // 优先使用 PaddleOCR-VL 生成的高保真结构化 Markdown 文件 (保留标题、段落、表格与公式)
          if (resultUrl?.markdownUrl) {
            try {
              const mdRes = await fetch(resultUrl.markdownUrl);
              if (mdRes.ok) {
                const mdText = await mdRes.text();
                if (mdText.trim()) {
                  return { text: mdText.trim(), raw: pollData };
                }
              }
            } catch (e) {
              console.warn('Failed to fetch markdownUrl, falling back to jsonUrl', e);
            }
          }
          if (resultUrl?.jsonUrl) {
            const jsonRes = await fetch(resultUrl.jsonUrl);
            if (jsonRes.ok) {
              const resultJson = await jsonRes.json();
              const extracted = extractTextFromPaddleResult(resultJson.result || resultJson);
              return { text: extracted, raw: resultJson };
            }
          }

          const extracted = extractTextFromPaddleResult(pollData.data || pollData);
          return { text: extracted, raw: pollData };
        }

        if (state === 'failed' || state === 'FAILED' || state === 'error') {
          const errMsg = pollData.data?.errorMsg || pollData.errorMsg || '识别失败';
          throw new Error(`飞桨识别任务失败: ${errMsg}`);
        }
      }

      throw new Error('OCR 识别任务超时，请稍后重试');
    } catch (err: any) {
      lastErrorMsg = err.message || String(err);
      if (currentModel === candidateModels[candidateModels.length - 1]) {
        throw new Error(lastErrorMsg);
      }
    }
  }

  throw new Error(lastErrorMsg || 'OCR 识别遇到未知异常');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      image,
      apiToken,
      model = 'PaddleOCR-VL-1.6',
      apiUrl,
    } = body;

    if (!image) {
      return Response.json({ error: '未提供图片数据' }, { status: 400 });
    }

    const token = apiToken?.trim() || process.env.PADDLEOCR_ACCESS_TOKEN?.trim();
    if (!token) {
      return Response.json(
        {
          error:
            '请先在「设置」中配置百度飞桨 AI Studio OCR Token（可前往 https://aistudio.baidu.com/paddleocr 免费注册并获取）。',
        },
        { status: 401 }
      );
    }

    // 清洗 Base64 编码，转换为 Uint8Array
    let cleanBase64 = image;
    if (cleanBase64.includes('base64,')) {
      cleanBase64 = cleanBase64.split('base64,')[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');
    const imageBytes = base64ToUint8Array(cleanBase64);

    const result = await runPaddleOcrJob(token, model, imageBytes, apiUrl);

    if (!result.text.trim()) {
      return Response.json({
        text: '',
        markdown: '',
        raw: result.raw,
        message: 'OCR 接口未识别到有效文字内容',
      });
    }

    return Response.json({
      text: result.text,
      markdown: result.text,
      raw: result.raw,
    });
  } catch (error: any) {
    console.error('OCR Route Error:', error);
    return Response.json(
      { error: `OCR 处理发生异常: ${error.message || error}` },
      { status: 500 }
    );
  }
}
