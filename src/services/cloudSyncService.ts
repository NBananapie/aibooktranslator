import { HistoryRecord, saveHistoryRecord } from '@/lib/db';

export interface CloudBookMeta {
  book_fingerprint: string;
  filename: string;
  total_pages: number;
  last_read_page: number;
  last_read_time: number;
  updated_at: number;
}

export interface CloudBookDetail {
  bookFingerprint: string;
  filename: string;
  totalPages: number;
  lastReadPage: number;
  lastReadTime: number;
  translations: Record<number, string>;
  clips: any[];
  updatedAt: number;
}

/**
 * 测试同步口令连接，并获取当前口令下的书籍数量
 */
export async function testCloudSyncConnection(syncKey: string): Promise<{ success: boolean; count: number; error?: string }> {
  if (!syncKey || !syncKey.trim()) {
    return { success: false, count: 0, error: '同步口令不能为空' };
  }

  try {
    const res = await fetch(`/api/sync?key=${encodeURIComponent(syncKey.trim())}`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, count: 0, error: data.error || '连接云端失败' };
    }
    return { success: true, count: data.totalCount || (data.books || []).length };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message || '网络请求异常' };
  }
}

/**
 * 获取云端书架中所有书籍的元数据列表（用于多端书架展示）
 */
export async function fetchCloudBookshelf(syncKey: string): Promise<CloudBookMeta[]> {
  if (!syncKey || !syncKey.trim()) return [];

  try {
    const res = await fetch(`/api/sync?key=${encodeURIComponent(syncKey.trim())}`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.books)) {
      return data.books;
    }
    return [];
  } catch (err) {
    console.error('Failed to fetch cloud bookshelf', err);
    return [];
  }
}

/**
 * 根据书籍指纹从云端拉取整本书的翻译与剪藏数据
 */
export async function fetchBookFromCloud(syncKey: string, fingerprint: string): Promise<CloudBookDetail | null> {
  if (!syncKey || !fingerprint) return null;

  try {
    const res = await fetch(
      `/api/sync?key=${encodeURIComponent(syncKey.trim())}&hash=${encodeURIComponent(fingerprint)}`,
      { method: 'GET', headers: { 'Cache-Control': 'no-cache' } }
    );
    const data = await res.json();
    if (data.success && data.record) {
      return data.record;
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch book from cloud', err);
    return null;
  }
}

/**
 * 将本地书籍的翻译与剪藏增量或全量同步至云端
 */
export async function pushBookToCloud(
  record: HistoryRecord,
  syncKey: string,
  isPartial = false,
  partialData?: { translations?: Record<number, string>; clips?: any[] }
): Promise<boolean> {
  if (!syncKey || !record.fingerprint) return false;

  try {
    const payload = {
      syncKey: syncKey.trim(),
      bookFingerprint: record.fingerprint,
      filename: record.filename,
      totalPages: record.totalPages || 0,
      lastReadPage: record.lastReadPage || 1,
      lastReadTime: record.lastReadTime || Date.now(),
      translations: partialData?.translations || record.translations || {},
      clips: partialData?.clips || record.clips || [],
      isPartial,
    };

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('Failed to push book to cloud', err);
    return false;
  }
}

/**
 * 将云端获取的数据与本地 IndexedDB 记录合并，并持久化
 */
export async function mergeCloudDataIntoLocal(
  localRecord: HistoryRecord,
  cloudData: CloudBookDetail
): Promise<HistoryRecord> {
  let hasChanges = false;

  // 1. 合并翻译缓存 (以页面包含有效文本为准，保留较多/较完整的结果)
  const localTrans = { ...(localRecord.translations || {}) };
  const cloudTrans = cloudData.translations || {};

  for (const pageStr of Object.keys(cloudTrans)) {
    const page = parseInt(pageStr, 10);
    const cloudText = cloudTrans[page];
    const localText = localTrans[page];

    if (cloudText && (!localText || cloudText.length > localText.length)) {
      localTrans[page] = cloudText;
      hasChanges = true;
    }
  }

  // 2. 合并剪藏记录 (通过 clip.id 去重合并)
  const localClips = localRecord.clips || [];
  const cloudClips = cloudData.clips || [];
  const clipMap = new Map();

  localClips.forEach(c => clipMap.set(c.id, c));
  cloudClips.forEach(c => {
    if (!clipMap.has(c.id)) {
      clipMap.set(c.id, c);
      hasChanges = true;
    }
  });

  // 3. 补全总页数与阅读进度
  let lastReadPage = localRecord.lastReadPage;
  if (!lastReadPage && cloudData.lastReadPage) {
    lastReadPage = cloudData.lastReadPage;
    hasChanges = true;
  }

  const updatedRecord: HistoryRecord = {
    ...localRecord,
    translations: localTrans,
    clips: Array.from(clipMap.values()),
    lastReadPage,
    totalPages: localRecord.totalPages || cloudData.totalPages,
  };

  if (hasChanges) {
    await saveHistoryRecord(updatedRecord);
  }

  return updatedRecord;
}
