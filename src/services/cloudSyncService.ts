/**
 * 云同步客户端（v2）。
 * - 口令只在本地使用：派生出的 authToken 用于鉴权，encKey 用于加密，二者互相独立；
 * - 按页、按剪藏增量推送与拉取，合并规则见 syncMerge.ts；
 * - 首次同步某本书时，自动读取旧版（v1）云端数据并合并到本地，随后以 v2 格式推送。
 */

import { ClipItem, HistoryRecord, getHistoryRecord, updateHistoryRecord } from '@/lib/db';
import { decryptLegacyV1, decryptV2, deriveSyncKeys, encryptV2, isStrongSyncKey, sha256Hex, SyncKeys } from '@/lib/crypto';
import {
  BookMetaPlain,
  ClipPlain,
  MAX_PUSH_ITEMS,
  SyncClipItem,
  SyncListResponse,
  SyncPageItem,
  SyncPullResponse,
  SyncPushRequest,
} from '@/lib/syncProtocol';
import {
  LegacyBookData,
  RemoteChanges,
  collectLocalChanges,
  hasChanges,
  mergeLegacyIntoRecord,
  mergeRemoteIntoRecord,
} from './syncMerge';

const V2_ENDPOINT = '/api/sync/v2';
const LEGACY_ENDPOINT = '/api/sync';
/** 单次推送请求的密文总长度上限（服务端上限 3 MB，留出余量） */
const PUSH_CHUNK_CHARS = 2 * 1024 * 1024;
/** 增量拉取时间窗口重叠量，避免与并发写入错过 */
const PULL_OVERLAP_MS = 5_000;
const PUSH_DEBOUNCE_MS = 2_000;

export interface CloudBookMeta {
  bookFingerprint: string;
  filename: string;
  totalPages: number;
  lastReadPage: number;
  updatedAt: number;
  pageCount?: number;
  /** 仅存在于旧版（v1）表中，尚未迁移 */
  legacy: boolean;
}

interface LegacyRecordResponse {
  success?: boolean;
  error?: string;
  record?: {
    translations?: unknown;
    clips?: unknown;
    totalPages?: number;
    lastReadPage?: number;
    updatedAt?: number;
  } | null;
  books?: { book_fingerprint: string; filename: string; total_pages: number; last_read_page: number; updated_at: number }[];
}

const aad = {
  meta: (fp: string) => `${fp}|meta`,
  page: (fp: string, page: number) => `${fp}|page|${page}`,
  clip: (fp: string, id: string) => `${fp}|clip|${id}`,
};

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' };
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 同一本书的同步操作串行执行 */
const bookLocks = new Map<string, Promise<unknown>>();
function withBookLock<T>(recordId: string, task: () => Promise<T>): Promise<T> {
  const previous = bookLocks.get(recordId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  bookLocks.set(recordId, next);
  next.finally(() => {
    if (bookLocks.get(recordId) === next) bookLocks.delete(recordId);
  }).catch(() => undefined);
  return next;
}

// ---------- 旧版数据迁移 ----------

function toLegacyClips(raw: unknown): ClipItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ClipItem =>
      !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.pageNumber === 'number'
  ).map(c => ({ ...c, createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now() }));
}

async function migrateLegacy(record: HistoryRecord, syncKey: string): Promise<void> {
  if (record.sync?.legacyChecked || !record.fingerprint) return;

  const keyHash = await sha256Hex(syncKey.trim());
  const res = await fetch(`${LEGACY_ENDPOINT}?hash=${encodeURIComponent(record.fingerprint)}`, {
    headers: authHeaders(keyHash),
  });
  // 仅当接口明确返回 200 时才标记为已检查，避免 429/5xx 等临时错误导致永久跳过旧数据迁移
  if (!res.ok) return;

  let legacy: LegacyBookData | null = null;
  const data = (await res.json()) as LegacyRecordResponse;
  if (data.record) {
    const translations = await decryptLegacyV1(data.record.translations, syncKey);
    const clips = await decryptLegacyV1(data.record.clips, syncKey);
    legacy = {
      translations: translations && typeof translations === 'object' ? (translations as Record<number, string>) : {},
      clips: toLegacyClips(clips),
      lastReadPage: data.record.lastReadPage,
      totalPages: data.record.totalPages,
      updatedAt: data.record.updatedAt || Date.now(),
    };
  }

  await updateHistoryRecord(record.id, r => ({
    ...(legacy ? mergeLegacyIntoRecord(r, legacy) : r),
    sync: { ...r.sync, legacyChecked: true },
  }));
}

// ---------- 拉取 ----------

async function pull(record: HistoryRecord, keys: SyncKeys): Promise<void> {
  const fp = record.fingerprint!;
  const since = record.sync?.pulledAt ?? 0;
  const res = await fetch(`${V2_ENDPOINT}?hash=${fp}&since=${since}`, { headers: authHeaders(keys.authToken) });
  if (!res.ok) throw new Error(`拉取云端数据失败: ${await readError(res)}`);
  const data = (await res.json()) as SyncPullResponse;

  const remote: RemoteChanges = { meta: null, pages: [], clips: [] };
  let hasDecryptError = false;

  if (data.meta) {
    try {
      const meta = await decryptV2<BookMetaPlain>(data.meta.content, keys.encKey, aad.meta(fp));
      remote.meta = { ...meta, updatedAt: data.meta.updatedAt };
    } catch (err) {
      hasDecryptError = true;
      console.warn('云端书籍信息解密失败', err);
    }
  }

  for (const p of data.pages) {
    try {
      const text = await decryptV2<string>(p.content, keys.encKey, aad.page(fp, p.page));
      remote.pages.push({ page: p.page, text, updatedAt: p.updatedAt });
    } catch (err) {
      hasDecryptError = true;
      console.warn(`云端第 ${p.page} 页译文解密失败`, err);
    }
  }

  for (const c of data.clips) {
    if (c.deleted || !c.content) {
      remote.clips.push({ id: c.id, pageNumber: 0, text: '', createdAt: c.updatedAt, updatedAt: c.updatedAt, deletedAt: c.updatedAt });
      continue;
    }
    try {
      const plain = await decryptV2<ClipPlain>(c.content, keys.encKey, aad.clip(fp, c.id));
      remote.clips.push({ ...plain, id: c.id, updatedAt: c.updatedAt });
    } catch (err) {
      hasDecryptError = true;
      console.warn('云端剪藏解密失败', err);
    }
  }

  await updateHistoryRecord(record.id, r => ({
    ...mergeRemoteIntoRecord(r, remote),
    sync: {
      ...r.sync,
      pulledAt: hasDecryptError ? r.sync?.pulledAt : Math.max(0, data.serverTime - PULL_OVERLAP_MS),
    },
  }));
}

// ---------- 推送 ----------

async function push(recordId: string, keys: SyncKeys): Promise<void> {
  const record = await getHistoryRecord(recordId);
  if (!record?.fingerprint) return;
  const fp = record.fingerprint;

  const startedAt = Date.now() - 1;
  const changes = collectLocalChanges(record, record.sync?.pushedAt ?? 0);
  if (!hasChanges(changes)) return;

  const pages: SyncPageItem[] = await Promise.all(
    changes.pages.map(async p => ({
      page: p.page,
      content: await encryptV2(p.text, keys.encKey, aad.page(fp, p.page)),
      updatedAt: p.updatedAt,
    }))
  );

  const clips: SyncClipItem[] = await Promise.all(
    changes.clips.map(async c => {
      const updatedAt = c.updatedAt ?? c.deletedAt ?? c.createdAt;
      if (c.deletedAt) return { id: c.id, content: null, deleted: true, updatedAt };
      const plain: ClipPlain = {
        pageNumber: c.pageNumber,
        text: c.text,
        sourceText: c.sourceText,
        note: c.note,
        createdAt: c.createdAt,
      };
      return { id: c.id, content: await encryptV2(plain, keys.encKey, aad.clip(fp, c.id)), deleted: false, updatedAt };
    })
  );

  const meta = changes.meta
    ? {
        content: await encryptV2(
          { filename: changes.meta.filename, totalPages: changes.meta.totalPages, lastReadPage: changes.meta.lastReadPage },
          keys.encKey,
          aad.meta(fp)
        ),
        updatedAt: changes.meta.updatedAt,
      }
    : undefined;

  // 按条数与体积分批
  const batches: SyncPushRequest[] = [];
  let current: SyncPushRequest = { bookFingerprint: fp, meta, pages: [], clips: [] };
  let currentChars = meta?.content.length ?? 0;
  const flush = () => {
    batches.push(current);
    current = { bookFingerprint: fp, pages: [], clips: [] };
    currentChars = 0;
  };
  const add = (kind: 'pages' | 'clips', item: SyncPageItem | SyncClipItem, size: number) => {
    const count = (current.pages?.length ?? 0) + (current.clips?.length ?? 0);
    if (count > 0 && (count >= MAX_PUSH_ITEMS || currentChars + size > PUSH_CHUNK_CHARS)) flush();
    if (kind === 'pages') current.pages!.push(item as SyncPageItem);
    else current.clips!.push(item as SyncClipItem);
    currentChars += size;
  };
  pages.forEach(p => add('pages', p, p.content.length));
  clips.forEach(c => add('clips', c, c.content?.length ?? 0));
  flush();

  for (const batch of batches) {
    const res = await fetch(V2_ENDPOINT, {
      method: 'POST',
      headers: { ...authHeaders(keys.authToken), 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`推送云端数据失败: ${await readError(res)}`);
  }

  await updateHistoryRecord(recordId, r => ({ ...r, sync: { ...r.sync, pushedAt: startedAt } }));
}

// ---------- 对外接口 ----------

/**
 * 完整同步一本书：迁移旧数据 → 拉取 → 推送。返回同步后的本地记录。
 */
export function syncBook(recordId: string, syncKey: string): Promise<HistoryRecord | undefined> {
  return withBookLock(recordId, async () => {
    const keys = await deriveSyncKeys(syncKey);
    let record = await getHistoryRecord(recordId);
    if (!record?.fingerprint) return record;

    await migrateLegacy(record, syncKey);
    record = (await getHistoryRecord(recordId))!;
    await pull(record, keys);
    await push(recordId, keys);
    return getHistoryRecord(recordId);
  });
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 防抖推送本地变化（翻译完成、剪藏增删、进度或文件名变化后调用） */
export function schedulePush(recordId: string, syncKey: string, delay = PUSH_DEBOUNCE_MS): void {
  if (!isStrongSyncKey(syncKey)) return;
  const existing = pushTimers.get(recordId);
  if (existing) clearTimeout(existing);
  pushTimers.set(
    recordId,
    setTimeout(() => {
      pushTimers.delete(recordId);
      withBookLock(recordId, async () => push(recordId, await deriveSyncKeys(syncKey))).catch(err =>
        console.error('云端同步推送失败', err)
      );
    }, delay)
  );
}

/** 云端书架：v2 书籍 + 尚未迁移的旧版书籍 */
export async function fetchCloudBookshelf(syncKey: string): Promise<CloudBookMeta[]> {
  if (!isStrongSyncKey(syncKey)) return [];
  const [keys, keyHash] = await Promise.all([deriveSyncKeys(syncKey), sha256Hex(syncKey.trim())]);

  const [v2Res, legacyRes] = await Promise.all([
    fetch(V2_ENDPOINT, { headers: authHeaders(keys.authToken) }),
    fetch(LEGACY_ENDPOINT, { headers: authHeaders(keyHash) }).catch(() => null),
  ]);
  if (!v2Res.ok) throw new Error(await readError(v2Res));

  const { books } = (await v2Res.json()) as SyncListResponse;
  const result: CloudBookMeta[] = [];
  for (const b of books) {
    let meta: BookMetaPlain = { filename: '未命名文档.pdf', totalPages: 0, lastReadPage: 1 };
    if (b.meta) {
      try {
        meta = await decryptV2<BookMetaPlain>(b.meta.content, keys.encKey, aad.meta(b.bookFingerprint));
      } catch (err) {
        console.warn('云端书籍信息解密失败', err);
      }
    }
    result.push({
      bookFingerprint: b.bookFingerprint,
      filename: meta.filename,
      totalPages: meta.totalPages,
      lastReadPage: meta.lastReadPage,
      updatedAt: b.serverUpdatedAt,
      pageCount: b.pageCount,
      legacy: false,
    });
  }

  if (legacyRes?.ok) {
    const legacy = (await legacyRes.json()) as LegacyRecordResponse;
    const known = new Set(result.map(b => b.bookFingerprint));
    for (const b of legacy.books || []) {
      if (known.has(b.book_fingerprint)) continue;
      result.push({
        bookFingerprint: b.book_fingerprint,
        filename: b.filename,
        totalPages: b.total_pages,
        lastReadPage: b.last_read_page,
        updatedAt: b.updated_at,
        legacy: true,
      });
    }
  }

  return result;
}

export async function testCloudSyncConnection(syncKey: string): Promise<{ success: boolean; count: number; error?: string }> {
  if (!syncKey?.trim()) return { success: false, count: 0, error: '同步口令不能为空' };
  if (!isStrongSyncKey(syncKey)) return { success: false, count: 0, error: '同步口令需为 16–128 个字符' };
  try {
    const books = await fetchCloudBookshelf(syncKey);
    return { success: true, count: books.length };
  } catch (err) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : '网络请求异常' };
  }
}

/** 删除 v2 云端数据（旧版数据只读，无法通过此接口删除） */
export async function deleteBookFromCloud(syncKey: string, fingerprint: string): Promise<boolean> {
  if (!isStrongSyncKey(syncKey)) return false;
  try {
    const keys = await deriveSyncKeys(syncKey);
    const res = await fetch(`${V2_ENDPOINT}?hash=${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
      headers: authHeaders(keys.authToken),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to delete book from cloud', err);
    return false;
  }
}
