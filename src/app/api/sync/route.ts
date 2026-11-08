/**
 * 旧版（v1）云同步接口，仅保留只读，用于客户端把旧数据迁移到 v2。
 * 鉴权：Authorization: Bearer <SHA-256(口令) 十六进制>，客户端不再发送明文口令。
 * v1 表中的 sync_key 列是明文口令，接口在首次访问时为尚无哈希的行补齐 sync_key_hash。
 */

import { NextRequest, NextResponse } from 'next/server';
import { sha256Hex } from '@/lib/crypto';
import { enforceRateLimit, getD1 } from '@/lib/server/cloudflare';

const HASH_REGEX = /^[a-f0-9]{64}$/;
/** 每次请求最多补齐的行数 */
const BACKFILL_BATCH = 200;

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

let backfillDone = false;

/** 为没有 sync_key_hash 的旧行计算哈希 */
async function backfillKeyHashes(db: D1Database): Promise<void> {
  if (backfillDone) return;
  const { results } = await db
    .prepare(
      'SELECT DISTINCT sync_key FROM book_sync_records WHERE sync_key_hash IS NULL LIMIT ?'
    )
    .bind(BACKFILL_BATCH)
    .all<{ sync_key: string }>();
  if (results.length === 0) {
    backfillDone = true;
    return;
  }
  const statements = await Promise.all(
    results.map(async r =>
      db
        .prepare('UPDATE book_sync_records SET sync_key_hash = ? WHERE sync_key = ? AND sync_key_hash IS NULL')
        .bind(await sha256Hex(r.sync_key.trim()), r.sync_key)
    )
  );
  await db.batch(statements);
  if (results.length < BACKFILL_BATCH) backfillDone = true;
}

function getKeyHash(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const hash = auth.slice(7).trim().toLowerCase();
  return HASH_REGEX.test(hash) ? hash : null;
}

// GET: ?hash= 读取单本书；不带 hash 读取书籍列表
export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, 'API_RATE_LIMITER', 'sync');
  if (limited) return limited;

  const keyHash = getKeyHash(req);
  if (!keyHash) {
    return NextResponse.json({ success: false, error: '缺少或非法的同步凭证' }, { status: 401 });
  }

  const bookFingerprint = req.nextUrl.searchParams.get('hash')?.trim().toLowerCase();
  if (bookFingerprint && !HASH_REGEX.test(bookFingerprint)) {
    return NextResponse.json({ success: false, error: '非法书籍指纹' }, { status: 400 });
  }

  const db = await getD1();
  if (!db) {
    return NextResponse.json({ success: false, error: 'D1 数据库绑定未就绪' }, { status: 503 });
  }

  try {
    await backfillKeyHashes(db);

    if (bookFingerprint) {
      const row = await db
        .prepare(
          `SELECT book_fingerprint, filename, total_pages, last_read_page, last_read_time, translations, clips, updated_at
           FROM book_sync_records WHERE sync_key_hash = ? AND book_fingerprint = ?`
        )
        .bind(keyHash, bookFingerprint)
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
         FROM book_sync_records WHERE sync_key_hash = ? ORDER BY updated_at DESC`
      )
      .bind(keyHash)
      .all<Pick<LegacyRow, 'book_fingerprint' | 'filename' | 'total_pages' | 'last_read_page' | 'updated_at'>>();
    return NextResponse.json({ success: true, books: results });
  } catch (err) {
    console.error('Legacy sync GET error:', err);
    return NextResponse.json({ success: false, error: '读取旧版云端数据失败' }, { status: 500 });
  }
}
