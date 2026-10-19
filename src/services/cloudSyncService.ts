import { HistoryRecord, saveHistoryRecord } from '@/lib/db';
import { isStrongSyncKey, encryptE2EE, decryptE2EE } from '@/lib/crypto';

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
 * 方案 1 & 2：强口令校验与 Header 凭据传输
 */
export async function testCloudSyncConnection(syncKey: string): Promise<{ success: boolean; count: number; error?: string }> {
  if (!syncKey || !syncKey.trim()) {
    return { success: false, count: 0, error: '同步口令不能为空' };
  }

  if (!isStrongSyncKey(syncKey)) {
    return { success: false, count: 0, error: '口令长度不足：需至少 16 位高熵字符以防暴力破解' };
  }

  try {
    const res = await fetch('/api/sync', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey.trim()}`,
        'Cache-Control': 'no-cache',
      },
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
 * 方案 2：口令移至 Authorization 请求头，避免在 URL 中暴露
 */
export async function fetchCloudBookshelf(syncKey: string): Promise<CloudBookMeta[]> {
  if (!syncKey || !isStrongSyncKey(syncKey)) return [];

  try {
    const res = await fetch('/api/sync', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey.trim()}`,
        'Cache-Control': 'no-cache',
      },
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
 * 方案 5：下载后在前端执行 AES-GCM 端到端解密，兼容历史明文
 */
export async function fetchBookFromCloud(syncKey: string, fingerprint: string): Promise<CloudBookDetail | null> {
  if (!syncKey || !fingerprint || !isStrongSyncKey(syncKey)) return null;

  try {
    const res = await fetch(`/api/sync?hash=${encodeURIComponent(fingerprint)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${syncKey.trim()}`,
        'Cache-Control': 'no-cache',
      },
    });
    const data = await res.json();
    if (data.success && data.record) {
      const record = data.record;

      // 端到端解密 translations 与 clips
      const decryptedTranslations = await decryptE2EE(record.translations, syncKey);
      const decryptedClips = await decryptE2EE(record.clips, syncKey);

      return {
        ...record,
        translations: (decryptedTranslations && typeof decryptedTranslations === 'object') ? decryptedTranslations : {},
        clips: Array.isArray(decryptedClips) ? decryptedClips : [],
      };
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch book from cloud', err);
    return null;
  }
}

/**
 * 将本地书籍的翻译与剪藏增量或全量同步至云端
 * 方案 5：发送前在客户端执行 AES-GCM 256 位端到端加密
 * 方案 2：口令置于 Authorization 请求头，Body 中不含口令
 */
export async function pushBookToCloud(
  record: HistoryRecord,
  syncKey: string,
  isPartial = false,
  partialData?: { translations?: Record<number, string>; clips?: any[] }
): Promise<boolean> {
  if (!syncKey || !record.fingerprint || !isStrongSyncKey(syncKey)) return false;

  try {
    const rawTranslations = partialData?.translations || record.translations || {};
    const rawClips = partialData?.clips || record.clips || [];

    // 本地执行端到端加密
    const encryptedTranslations = await encryptE2EE(rawTranslations, syncKey);
    const encryptedClips = await encryptE2EE(rawClips, syncKey);

    const payload = {
      bookFingerprint: record.fingerprint,
      filename: record.filename,
      totalPages: record.totalPages || 0,
      lastReadPage: record.lastReadPage || 1,
      lastReadTime: record.lastReadTime || Date.now(),
      translations: encryptedTranslations,
      clips: encryptedClips,
      isPartial,
    };

    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${syncKey.trim()}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('Failed to push book to cloud with E2EE', err);
    return false;
  }
}

/**
 * 删除指定书籍在云端的同步数据
 */
export async function deleteBookFromCloud(syncKey: string, fingerprint: string): Promise<boolean> {
  if (!syncKey || !fingerprint || !isStrongSyncKey(syncKey)) return false;

  try {
    const res = await fetch(`/api/sync?hash=${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${syncKey.trim()}`,
      },
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error('Failed to delete book from cloud', err);
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
