/**
 * 旧版（v1）云同步接口，仅保留只读，用于客户端把旧数据迁移到 v2。
 * v1 以明文口令作为 sync_key 存储；新数据不再写入此表。
 */

import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getD1 } from '@/lib/server/cloudflare';

const HASH_REGEX = /^[a-f0-9]{64}$/i;

interface LegacyRow {
  book_fingerprint: string;
  filename: string;
  total_pages: number;
  last_read_page: number;
  last_read_time: number | null;
  translations: string | null;
  clips: string | null;
  updated_at: number;
}

function getSyncKey(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const key = auth.slice(7).trim();
  return key.length >= 16 && key.length <= 128 ? key : null;
}

// GET: ?hash= 读取单本书；不带 hash 读取书籍列表
export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, 'API_RATE_LIMITER', 'sync');
  if (limited) return limited;

  const syncKey = getSyncKey(req);
  if (!syncKey) {
    return NextResponse.json({ success: false, error: '缺少或非法的同步口令' }, { status: 401 });
  }

  const bookFingerprint = req.nextUrl.searchParams.get('hash')?.trim();
  if (bookFingerprint && !HASH_REGEX.test(bookFingerprint)) {
    return NextResponse.json({ success: false, error: '非法书籍指纹' }, { status: 400 });
  }

  const db = await getD1();
  if (!db) {
    return NextResponse.json({ success: false, error: 'D1 数据库绑定未就绪' }, { status: 503 });
  }

  try {
    if (bookFingerprint) {
      const row = await db
        .prepare(
          `SELECT book_fingerprint, filename, total_pages, last_read_page, last_read_time, translations, clips, updated_at
           FROM book_sync_records WHERE sync_key = ? AND book_fingerprint = ?`
        )
        .bind(syncKey, bookFingerprint)
        .first<LegacyRow>();
      if (!row) return NextResponse.json({ success: true, record: null });

      return NextResponse.json({
        success: true,
        record: {
          bookFingerprint: row.book_fingerprint,
          filename: row.filename,
          totalPages: row.total_pages,
          lastReadPage: row.last_read_page,
          lastReadTime: row.last_read_time,
          translations: row.translations,
          clips: row.clips,
          updatedAt: row.updated_at,
        },
      });
    }

    const { results } = await db
      .prepare(
        `SELECT book_fingerprint, filename, total_pages, last_read_page, updated_at
         FROM book_sync_records WHERE sync_key = ? ORDER BY updated_at DESC`
      )
      .bind(syncKey)
      .all<Pick<LegacyRow, 'book_fingerprint' | 'filename' | 'total_pages' | 'last_read_page' | 'updated_at'>>();
    return NextResponse.json({ success: true, books: results });
  } catch (err) {
    console.error('Legacy sync GET error:', err);
    return NextResponse.json({ success: false, error: '读取旧版云端数据失败' }, { status: 500 });
  }
}
