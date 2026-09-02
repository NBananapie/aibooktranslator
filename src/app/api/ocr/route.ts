import { NextResponse } from 'next/server';

export const runtime = 'edge';

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

  // 2. PP-OCR 通用识别：ocrResults / words_result / prism_wordsInfo
  if (Array.isArray(result.ocrResults)) {
    return result
      .map((r: any) => (typeof r === 'string' ? r : r.words || r.text || ''))
      .filter(Boolean)
      .join('\n');
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
      return NextResponse.json({ error: '未提供图片数据' }, { status: 400 });
    }

    const token = apiToken?.trim() || process.env.PADDLEOCR_ACCESS_TOKEN?.trim();
    if (!token) {
      return NextResponse.json(
        {
          error:
            '请先在「设置」中配置百度飞桨 AI Studio OCR Token（可前往 https://aistudio.baidu.com/paddleocr 免费注册并获取）。',
        },
        { status: 401 }
      );
    }

    // 清洗 Base64 编码，去掉开头的 data:image/...;base64,
    let cleanBase64 = image;
    if (cleanBase64.includes('base64,')) {
      cleanBase64 = cleanBase64.split('base64,')[1];
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');

    // 默认请求目标地址（用户自定义 URL 优先）
    const targetUrl =
      apiUrl?.trim() || 'https://aistudio.baidu.com/serving/api/v1/model/predict';

    // 组装百度飞桨 AI Studio API 请求
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: token.startsWith('token ') ? token : `token ${token}`,
    };

    const requestPayload = {
      file: cleanBase64,
      fileType: 1, // 1 表示图片格式
      model: model,
    };

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `百度飞桨 OCR 接口请求失败 (${response.status})`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.errorMsg || errorJson.error_msg) {
          errorMsg = `百度飞桨错误: ${errorJson.errorMsg || errorJson.error_msg}`;
        } else if (errorJson.error?.message) {
          errorMsg = `百度飞桨错误: ${errorJson.error.message}`;
        }
      } catch {
        errorMsg = `百度飞桨错误 (${response.status}): ${errorText.slice(0, 200)}`;
      }
      return NextResponse.json({ error: errorMsg, details: errorText }, { status: response.status });
    }

    const responseData = await response.json();

    if (responseData.errorCode !== undefined && responseData.errorCode !== 0) {
      return NextResponse.json(
        { error: `百度飞桨识别失败 (${responseData.errorCode}): ${responseData.errorMsg || '未知错误'}` },
        { status: 400 }
      );
    }

    const extractedText = extractTextFromPaddleResult(responseData.result || responseData);

    if (!extractedText.trim()) {
      return NextResponse.json({
        text: '',
        markdown: '',
        raw: responseData,
        message: 'OCR 接口未识别到有效文字内容',
      });
    }

    return NextResponse.json({
      text: extractedText,
      markdown: extractedText,
      raw: responseData,
    });
  } catch (error: any) {
    console.error('OCR Route Error:', error);
    return NextResponse.json(
      { error: `OCR 处理发生异常: ${error.message || error}` },
      { status: 500 }
    );
  }
}
