/**
 * 云同步 v2 接口。
 * 鉴权：Authorization: Bearer <authToken>（64 位十六进制，由客户端从口令派生），
 * 服务端只保存 SHA-256(authToken) 作为 account_id，所有内容均为客户端密文。
 */

import { sha256Hex } from '@/lib/crypto';
import { enforceRateLimit, getD1 } from '@/lib/server/cloudflare';
import {
  BOOK_FINGERPRINT_REGEX,
  CLIP_ID_REGEX,
  MAX_ITEM_CHARS,
  MAX_PAGE_NUMBER,
  MAX_PUSH_BYTES,
  MAX_PUSH_ITEMS,
  SYNC_TOKEN_REGEX,
  SyncBookSummary,
  SyncClipItem,
  SyncListResponse,
  SyncMeta,
  SyncPageItem,
  SyncPullResponse,
} from '@/lib/syncProtocol';

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

type Context = { db: D1Database; accountId: string };

/** 限流、鉴权并获取数据库；失败时返回错误响应 */
async function prepare(req: Request): Promise<Context | Response> {
  const limited = await enforceRateLimit(req, 'API_RATE_LIMITER', 'sync');
  if (limited) return limited;

  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim().toLowerCase() : '';
  if (!SYNC_TOKEN_REGEX.test(token)) return jsonError(401, '缺少或非法的同步凭证');

  const db = await getD1();
  if (!db) return jsonError(503, 'D1 数据库绑定未就绪');

  return { db, accountId: await sha256Hex(token) };
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isCipher(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('e2ee:v2:') && value.length <= MAX_ITEM_CHARS;
}

function parseMeta(value: unknown): SyncMeta | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return 'invalid';
  const { content, updatedAt } = value as Record<string, unknown>;
  return isCipher(content) && isTimestamp(updatedAt) ? { content, updatedAt } : 'invalid';
}

function parsePages(value: unknown): SyncPageItem[] | 'invalid' {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return 'invalid';
  const pages: SyncPageItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'invalid';
    const { page, content, updatedAt } = item as Record<string, unknown>;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_PAGE_NUMBER) return 'invalid';
    if (!isCipher(content) || !isTimestamp(updatedAt)) return 'invalid';
    pages.push({ page, content, updatedAt });
  }
  return pages;
}

function parseClips(value: unknown): SyncClipItem[] | 'invalid' {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return 'invalid';
  const clips: SyncClipItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'invalid';
    const { id, content, deleted, updatedAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !CLIP_ID_REGEX.test(id) || !isTimestamp(updatedAt)) return 'invalid';
    if (deleted === true) {
      clips.push({ id, content: null, deleted: true, updatedAt });
    } else if (isCipher(content)) {
      clips.push({ id, content, deleted: false, updatedAt });
    } else {
      return 'invalid';
    }
  }
  return clips;
}

interface BookRow {
  book_fingerprint: string;
  meta: string | null;
  meta_updated_at: number;
  server_updated_at: number;
  page_count: number;
  clip_count: number;
}

interface PageRow {
  page: number;
  content: string;
  updated_at: number;
}

interface ClipRow {
  clip_id: string;
  content: string | null;
  deleted: number;
  updated_at: number;
}

function toMeta(meta: string | null, updatedAt: number): SyncMeta | null {
  return meta ? { content: meta, updatedAt } : null;
}

// GET /api/sync/v2            → 书籍列表
// GET /api/sync/v2?hash=&since= → 单本书在 since（服务端时间）之后变化的数据
export async function GET(req: Request) {
  const ctx = await prepare(req);
  if (ctx instanceof Response) return ctx;
  const { db, accountId } = ctx;

  const url = new URL(req.url);
  const fingerprint = url.searchParams.get('hash')?.trim().toLowerCase();

  try {
    if (!fingerprint) {
      const { results } = await db
        .prepare(
          `SELECT b.book_fingerprint, b.meta, b.meta_updated_at, b.server_updated_at,
                  (SELECT COUNT(*) FROM sync_pages p WHERE p.account_id = b.account_id AND p.book_fingerprint = b.book_fingerprint) AS page_count,
                  (SELECT COUNT(*) FROM sync_clips c WHERE c.account_id = b.account_id AND c.book_fingerprint = b.book_fingerprint AND c.deleted = 0) AS clip_count
           FROM sync_books b WHERE b.account_id = ? ORDER BY b.server_updated_at DESC`
        )
        .bind(accountId)
        .all<BookRow>();
      const books: SyncBookSummary[] = results.map(r => ({
        bookFingerprint: r.book_fingerprint,
        meta: toMeta(r.meta, r.meta_updated_at),
        serverUpdatedAt: r.server_updated_at,
        pageCount: r.page_count,
        clipCount: r.clip_count,
      }));
      return Response.json({ books } satisfies SyncListResponse);
    }

    if (!BOOK_FINGERPRINT_REGEX.test(fingerprint)) return jsonError(400, '非法书籍指纹');
    const sinceRaw = Number(url.searchParams.get('since') || 0);
    const since = Number.isSafeInteger(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const serverTime = Date.now();

    const [bookResult, pageResult, clipResult] = await db.batch([
      db
        .prepare('SELECT meta, meta_updated_at FROM sync_books WHERE account_id = ? AND book_fingerprint = ?')
        .bind(accountId, fingerprint),
      db
        .prepare(
          'SELECT page, content, updated_at FROM sync_pages WHERE account_id = ? AND book_fingerprint = ? AND server_updated_at > ?'
        )
        .bind(accountId, fingerprint, since),
      db
        .prepare(
          'SELECT clip_id, content, deleted, updated_at FROM sync_clips WHERE account_id = ? AND book_fingerprint = ? AND server_updated_at > ?'
        )
        .bind(accountId, fingerprint, since),
    ]);

    const book = (bookResult.results as { meta: string | null; meta_updated_at: number }[])[0];
    const response: SyncPullResponse = {
      serverTime,
      meta: book ? toMeta(book.meta, book.meta_updated_at) : null,
      pages: (pageResult.results as PageRow[]).map(r => ({ page: r.page, content: r.content, updatedAt: r.updated_at })),
      clips: (clipResult.results as ClipRow[]).map(r => ({
        id: r.clip_id,
        content: r.deleted ? null : r.content,
        deleted: !!r.deleted,
        updatedAt: r.updated_at,
      })),
    };
    return Response.json(response);
  } catch (err) {
    console.error('Sync v2 GET error:', err);
    return jsonError(500, '读取云端同步数据失败');
  }
}

// POST /api/sync/v2  推送变化，按客户端修改时间"后写入者胜出"
export async function POST(req: Request) {
  const ctx = await prepare(req);
  if (ctx instanceof Response) return ctx;
  const { db, accountId } = ctx;

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_PUSH_BYTES) return jsonError(413, '单次同步数据过大');
  const raw = await req.text();
  if (raw.length > MAX_PUSH_BYTES) return jsonError(413, '单次同步数据过大');

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError(400, '非法 JSON 数据格式');
  }

  const fingerprint = typeof body.bookFingerprint === 'string' ? body.bookFingerprint.toLowerCase() : '';
  if (!BOOK_FINGERPRINT_REGEX.test(fingerprint)) return jsonError(400, '非法书籍指纹');

  const meta = parseMeta(body.meta);
  const pages = parsePages(body.pages);
  const clips = parseClips(body.clips);
  if (meta === 'invalid' || pages === 'invalid' || clips === 'invalid') return jsonError(400, '同步数据格式错误');
  if (pages.length + clips.length > MAX_PUSH_ITEMS) return jsonError(413, `单次最多推送 ${MAX_PUSH_ITEMS} 条`);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sync_books (account_id, book_fingerprint, meta, meta_updated_at, server_updated_at)
         VALUES (?, ?, NULL, 0, ?)
         ON CONFLICT(account_id, book_fingerprint) DO UPDATE SET server_updated_at = excluded.server_updated_at`
      )
      .bind(accountId, fingerprint, now),
  ];

  if (meta) {
    statements.push(
      db
        .prepare(
          `UPDATE sync_books SET meta = ?, meta_updated_at = ?
           WHERE account_id = ? AND book_fingerprint = ? AND meta_updated_at < ?`
        )
        .bind(meta.content, meta.updatedAt, accountId, fingerprint, meta.updatedAt)
    );
  }

  for (const p of pages) {
    statements.push(
      db
        .prepare(
          `INSERT INTO sync_pages (account_id, book_fingerprint, page, content, updated_at, server_updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, book_fingerprint, page) DO UPDATE SET
             content = excluded.content, updated_at = excluded.updated_at, server_updated_at = excluded.server_updated_at
           WHERE excluded.updated_at > sync_pages.updated_at`
        )
        .bind(accountId, fingerprint, p.page, p.content, p.updatedAt, now)
    );
  }

  for (const c of clips) {
    statements.push(
      db
        .prepare(
          `INSERT INTO sync_clips (account_id, book_fingerprint, clip_id, content, deleted, updated_at, server_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, book_fingerprint, clip_id) DO UPDATE SET
             content = excluded.content, deleted = excluded.deleted,
             updated_at = excluded.updated_at, server_updated_at = excluded.server_updated_at
           WHERE excluded.updated_at > sync_clips.updated_at`
        )
        .bind(accountId, fingerprint, c.id, c.content, c.deleted ? 1 : 0, c.updatedAt, now)
    );
  }

  try {
    await db.batch(statements);
    return Response.json({ success: true, serverTime: now });
  } catch (err) {
    console.error('Sync v2 POST error:', err);
    return jsonError(500, '保存云端同步数据失败');
  }
}

// DELETE /api/sync/v2?hash=  删除单本书的全部云端数据
export async function DELETE(req: Request) {
  const ctx = await prepare(req);
  if (ctx instanceof Response) return ctx;
  const { db, accountId } = ctx;

  const fingerprint = new URL(req.url).searchParams.get('hash')?.trim().toLowerCase() || '';
  if (!BOOK_FINGERPRINT_REGEX.test(fingerprint)) return jsonError(400, '非法书籍指纹');

  try {
    await db.batch(
      ['sync_pages', 'sync_clips', 'sync_books'].map(table =>
        db.prepare(`DELETE FROM ${table} WHERE account_id = ? AND book_fingerprint = ?`).bind(accountId, fingerprint)
      )
    );
    return Response.json({ success: true });
  } catch (err) {
    console.error('Sync v2 DELETE error:', err);
    return jsonError(500, '删除云端数据失败');
  }
}
