import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

function getD1Database(): any {
  if (typeof process !== 'undefined' && (process.env as any).DB) {
    return (process.env as any).DB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).DB) {
    return (globalThis as any).DB;
  }
  return null;
}

// GET: 获取指定书籍的云端数据，或者获取口令下的所有书籍列表
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const syncKey = searchParams.get('key')?.trim();
  const bookFingerprint = searchParams.get('hash')?.trim();

  if (!syncKey) {
    return NextResponse.json({ success: false, error: '缺少同步口令 (syncKey)' }, { status: 400 });
  }

  const db = getD1Database();
  if (!db) {
    return NextResponse.json(
      { success: false, error: 'Cloudflare D1 数据库绑定未就绪，请在 Cloudflare Pages 线上环境中使用。' },
      { status: 503 }
    );
  }

  try {
    // 1. 如果传了书籍指纹，获取单本书籍的所有翻译与剪藏数据
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

      let parsedTranslations = {};
      let parsedClips = [];
      try {
        if (row.translations) parsedTranslations = JSON.parse(row.translations);
      } catch (e) {
        console.error('Failed to parse translations JSON', e);
      }
      try {
        if (row.clips) parsedClips = JSON.parse(row.clips);
      } catch (e) {
        console.error('Failed to parse clips JSON', e);
      }

      return NextResponse.json({
        success: true,
        record: {
          bookFingerprint: row.book_fingerprint,
          filename: row.filename,
          totalPages: row.total_pages,
          lastReadPage: row.last_read_page,
          lastReadTime: row.last_read_time,
          translations: parsedTranslations,
          clips: parsedClips,
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
  try {
    const body = await req.json();
    const {
      syncKey,
      bookFingerprint,
      filename,
      totalPages = 0,
      lastReadPage = 1,
      lastReadTime = Date.now(),
      translations = {},
      clips = [],
      isPartial = false,
    } = body;

    if (!syncKey || !bookFingerprint) {
      return NextResponse.json(
        { success: false, error: '缺少关键参数: syncKey 与 bookFingerprint 为必填项' },
        { status: 400 }
      );
    }

    const db = getD1Database();
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'Cloudflare D1 数据库绑定未就绪，请在 Cloudflare Pages 线上环境中使用。' },
        { status: 503 }
      );
    }

    const now = Date.now();

    // 如果是局部增量更新（例如单页翻译或新增一条剪藏）
    if (isPartial) {
      const selectStmt = db.prepare(
        `SELECT translations, clips, filename, total_pages FROM book_sync_records WHERE sync_key = ? AND book_fingerprint = ?`
      );
      const existing = await selectStmt.bind(syncKey, bookFingerprint).first();

      let mergedTranslations: Record<string, string> = {};
      let mergedClips: any[] = [];

      if (existing) {
        try {
          if (existing.translations) mergedTranslations = JSON.parse(existing.translations);
        } catch (e) {}
        try {
          if (existing.clips) mergedClips = JSON.parse(existing.clips);
        } catch (e) {}
      }

      // 合并传入的 translations (单页或多页覆盖)
      if (translations && typeof translations === 'object') {
        Object.assign(mergedTranslations, translations);
      }

      // 合并传入的 clips (去重覆盖)
      if (Array.isArray(clips) && clips.length > 0) {
        const clipMap = new Map();
        mergedClips.forEach(c => clipMap.set(c.id, c));
        clips.forEach(c => clipMap.set(c.id, c));
        mergedClips = Array.from(clipMap.values());
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
          filename || existing?.filename || '未命名文档.pdf',
          totalPages || existing?.total_pages || 0,
          lastReadPage,
          lastReadTime,
          JSON.stringify(mergedTranslations),
          JSON.stringify(mergedClips),
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
        filename || '未命名文档.pdf',
        totalPages,
        lastReadPage,
        lastReadTime,
        JSON.stringify(translations || {}),
        JSON.stringify(clips || []),
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
  const { searchParams } = new URL(req.url);
  const syncKey = searchParams.get('key')?.trim();
  const bookFingerprint = searchParams.get('hash')?.trim();

  if (!syncKey || !bookFingerprint) {
    return NextResponse.json({ success: false, error: '缺少 syncKey 或 bookFingerprint' }, { status: 400 });
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
