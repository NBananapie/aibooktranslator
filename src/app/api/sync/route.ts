import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// 单次请求最大允许体积：5MB
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;
// SHA-256 64位十六进制哈希正则
const HASH_REGEX = /^[a-f0-9]{64}$/i;

function getD1Database(): any {
  if (typeof process !== 'undefined' && (process.env as any).DB) {
    return (process.env as any).DB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).DB) {
    return (globalThis as any).DB;
  }
  return null;
}

/**
 * 安全提取同步口令
 * 方案 2：优先从 Authorization: Bearer <key> 请求头获取，避免 URL 查询参数在日志中泄露
 */
function getAuthorizedSyncKey(req: NextRequest, body?: any): string | null {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7).trim();
  }
  const { searchParams } = new URL(req.url);
  const queryKey = searchParams.get('key')?.trim();
  if (queryKey) return queryKey;
  if (body && typeof body.syncKey === 'string' && body.syncKey.trim()) {
    return body.syncKey.trim();
  }
  return null;
}

/**
 * 方案 1：强制高熵口令校验（阻断弱口令爆破）
 */
function validateSyncKey(syncKey: string | null): { valid: boolean; error?: string } {
  if (!syncKey) {
    return { valid: false, error: '未提供同步口令凭证 (请在 Authorization 请求头中传入 Bearer 口令)' };
  }
  if (syncKey.length < 16) {
    return { valid: false, error: '口令强度不足：同步口令至少需 16 位高熵字符以防暴力破解' };
  }
  if (syncKey.length > 128) {
    return { valid: false, error: '口令长度超限 (最多 128 位字符)' };
  }
  return { valid: true };
}

// GET: 获取指定书籍的云端数据，或者获取口令下的所有书籍列表
export async function GET(req: NextRequest) {
  const syncKey = getAuthorizedSyncKey(req);
  const keyCheck = validateSyncKey(syncKey);
  if (!keyCheck.valid) {
    return NextResponse.json({ success: false, error: keyCheck.error }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const bookFingerprint = searchParams.get('hash')?.trim();

  // 方案 3：校验指纹合法性
  if (bookFingerprint && !HASH_REGEX.test(bookFingerprint)) {
    return NextResponse.json({ success: false, error: '非法书籍指纹格式（需为 64 位 SHA-256 哈希值）' }, { status: 400 });
  }

  const db = getD1Database();
  if (!db) {
    return NextResponse.json(
      { success: false, error: 'Cloudflare D1 数据库绑定未就绪，请在 Cloudflare Pages 线上环境中使用。' },
      { status: 503 }
    );
  }

  try {
    // 1. 如果传了书籍指纹，获取单本书籍的所有翻译与剪藏数据 (支持 E2EE 密文透传)
    if (bookFingerprint) {
      const stmt = db.prepare(
        `SELECT sync_key, book_fingerprint, filename, total_pages, last_read_page, last_read_time, translations, clips, updated_at 
         FROM book_sync_records 
         WHERE sync_key = ? AND book_fingerprint = ?`
      );
      const row = await stmt.bind(syncKey, bookFingerprint).first();

      if (!row) {
        return NextResponse.json({ success: true, record: null });
      }

      // 如果存储的是 E2EE 密文字符串 (e2ee:v1:...)，直接透传由客户端在本地解密；若为明文则尝试解析 JSON
      let translationsData: any = row.translations || '{}';
      if (typeof row.translations === 'string' && !row.translations.startsWith('e2ee:v1:')) {
        try {
          translationsData = JSON.parse(row.translations);
        } catch {}
      }

      let clipsData: any = row.clips || '[]';
      if (typeof row.clips === 'string' && !row.clips.startsWith('e2ee:v1:')) {
        try {
          clipsData = JSON.parse(row.clips);
        } catch {}
      }

      return NextResponse.json({
        success: true,
        record: {
          bookFingerprint: row.book_fingerprint,
          filename: row.filename,
          totalPages: row.total_pages,
          lastReadPage: row.last_read_page,
          lastReadTime: row.last_read_time,
          translations: translationsData,
          clips: clipsData,
          updatedAt: row.updated_at,
        },
      });
    }

    // 2. 如果未传指纹，则获取该口令下的所有书籍元数据列表（用于云端书架呈现）
    const stmt = db.prepare(
      `SELECT book_fingerprint, filename, total_pages, last_read_page, last_read_time, updated_at,
              LENGTH(translations) as translations_len
       FROM book_sync_records 
       WHERE sync_key = ? 
       ORDER BY updated_at DESC`
    );
    const { results } = await stmt.bind(syncKey).all();

    return NextResponse.json({
      success: true,
      books: results || [],
      totalCount: (results || []).length,
    });
  } catch (err: any) {
    console.error('D1 GET Error:', err);
    return NextResponse.json({ success: false, error: err.message || '读取云端同步数据失败' }, { status: 500 });
  }
}

// POST: 增量或全量保存书籍的翻译与剪藏数据
export async function POST(req: NextRequest) {
  // 方案 3：输入报文体积截断与防御
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
    return NextResponse.json(
      { success: false, error: '请求体积超限：单次同步数据包不能超过 5MB' },
      { status: 413 }
    );
  }

  let body: any;
  try {
    const rawText = await req.text();
    if (rawText.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { success: false, error: '请求体积超限：单次同步数据包不能超过 5MB' },
        { status: 413 }
      );
    }
    body = JSON.parse(rawText);
  } catch (e) {
    return NextResponse.json({ success: false, error: '非法 JSON 数据格式' }, { status: 400 });
  }

  // 方案 2：优先从 Header 提取口令
  const syncKey = getAuthorizedSyncKey(req, body);
  const keyCheck = validateSyncKey(syncKey);
  if (!keyCheck.valid) {
    return NextResponse.json({ success: false, error: keyCheck.error }, { status: 400 });
  }

  const {
    bookFingerprint,
    filename = '未命名文档.pdf',
    totalPages = 0,
    lastReadPage = 1,
    lastReadTime = Date.now(),
    translations = {},
    clips = [],
    isPartial = false,
  } = body;

  // 方案 3：字段清洗与合法性校验
  if (!bookFingerprint || !HASH_REGEX.test(bookFingerprint)) {
    return NextResponse.json(
      { success: false, error: '缺少或非法的书籍指纹 (需为 64 位 SHA-256 哈希值)' },
      { status: 400 }
    );
  }

  // 元数据安全截断
  const safeFilename = String(filename).slice(0, 255);
  const safeTotalPages = Math.max(0, Math.min(100000, Number(totalPages) || 0));
  const safeLastReadPage = Math.max(1, Math.min(100000, Number(lastReadPage) || 1));
  const safeLastReadTime = typeof lastReadTime === 'number' && lastReadTime > 0 ? lastReadTime : Date.now();

  const db = getD1Database();
  if (!db) {
    return NextResponse.json(
      { success: false, error: 'Cloudflare D1 数据库绑定未就绪，请在 Cloudflare Pages 线上环境中使用。' },
      { status: 503 }
    );
  }

  const now = Date.now();

  // 方案 5 存储适配：如果是 E2EE 密文字符串直接存，如果是未加密对象则序列化
  const serializedTranslations =
    typeof translations === 'string' ? translations : JSON.stringify(translations || {});
  const serializedClips = typeof clips === 'string' ? clips : JSON.stringify(clips || []);

  try {
    // 局部增量更新逻辑
    if (isPartial) {
      const selectStmt = db.prepare(
        `SELECT translations, clips, filename, total_pages FROM book_sync_records WHERE sync_key = ? AND book_fingerprint = ?`
      );
      const existing = await selectStmt.bind(syncKey, bookFingerprint).first();

      let finalTranslations = serializedTranslations;
      let finalClips = serializedClips;

      // 如果两端都是明文且不是 E2EE 密文，执行服务端合并；若为 E2EE 密文，直接采用最新客户端传入的密文
      if (
        existing &&
        typeof existing.translations === 'string' &&
        !existing.translations.startsWith('e2ee:v1:') &&
        !serializedTranslations.startsWith('e2ee:v1:')
      ) {
        try {
          const mergedTrans = JSON.parse(existing.translations);
          if (translations && typeof translations === 'object') {
            Object.assign(mergedTrans, translations);
            finalTranslations = JSON.stringify(mergedTrans);
          }
        } catch {}
      }

      if (
        existing &&
        typeof existing.clips === 'string' &&
        !existing.clips.startsWith('e2ee:v1:') &&
        !serializedClips.startsWith('e2ee:v1:')
      ) {
        try {
          const mergedClips = JSON.parse(existing.clips);
          if (Array.isArray(clips) && clips.length > 0) {
            const clipMap = new Map();
            mergedClips.forEach((c: any) => clipMap.set(c.id, c));
            clips.forEach((c: any) => clipMap.set(c.id, c));
            finalClips = JSON.stringify(Array.from(clipMap.values()));
          }
        } catch {}
      }

      const upsertStmt = db.prepare(
        `INSERT INTO book_sync_records (
            sync_key, book_fingerprint, filename, total_pages, last_read_page, last_read_time, translations, clips, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sync_key, book_fingerprint) DO UPDATE SET
            filename = COALESCE(excluded.filename, book_sync_records.filename),
            total_pages = CASE WHEN excluded.total_pages > 0 THEN excluded.total_pages ELSE book_sync_records.total_pages END,
            last_read_page = excluded.last_read_page,
            last_read_time = excluded.last_read_time,
            translations = excluded.translations,
            clips = excluded.clips,
            updated_at = excluded.updated_at`
      );

      await upsertStmt
        .bind(
          syncKey,
          bookFingerprint,
          safeFilename || existing?.filename || '未命名文档.pdf',
          safeTotalPages || existing?.total_pages || 0,
          safeLastReadPage,
          safeLastReadTime,
          finalTranslations,
          finalClips,
          now
        )
        .run();

      return NextResponse.json({ success: true, updatedAt: now });
    }

    // 全量同步更新
    const upsertStmt = db.prepare(
      `INSERT INTO book_sync_records (
          sync_key, book_fingerprint, filename, total_pages, last_read_page, last_read_time, translations, clips, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sync_key, book_fingerprint) DO UPDATE SET
          filename = excluded.filename,
          total_pages = excluded.total_pages,
          last_read_page = excluded.last_read_page,
          last_read_time = excluded.last_read_time,
          translations = excluded.translations,
          clips = excluded.clips,
          updated_at = excluded.updated_at`
    );

    await upsertStmt
      .bind(
        syncKey,
        bookFingerprint,
        safeFilename,
        safeTotalPages,
        safeLastReadPage,
        safeLastReadTime,
        serializedTranslations,
        serializedClips,
        now
      )
      .run();

    return NextResponse.json({ success: true, updatedAt: now });
  } catch (err: any) {
    console.error('D1 POST Error:', err);
    return NextResponse.json({ success: false, error: err.message || '保存云端同步数据失败' }, { status: 500 });
  }
}

// DELETE: 删除指定书籍的云端数据
export async function DELETE(req: NextRequest) {
  const syncKey = getAuthorizedSyncKey(req);
  const keyCheck = validateSyncKey(syncKey);
  if (!keyCheck.valid) {
    return NextResponse.json({ success: false, error: keyCheck.error }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const bookFingerprint = searchParams.get('hash')?.trim();

  if (!bookFingerprint || !HASH_REGEX.test(bookFingerprint)) {
    return NextResponse.json({ success: false, error: '缺少或非法的书籍指纹 (需为 64 位 SHA-256 哈希值)' }, { status: 400 });
  }

  const db = getD1Database();
  if (!db) {
    return NextResponse.json({ success: false, error: 'D1 未就绪' }, { status: 503 });
  }

  try {
    const stmt = db.prepare(`DELETE FROM book_sync_records WHERE sync_key = ? AND book_fingerprint = ?`);
    await stmt.bind(syncKey, bookFingerprint).run();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
