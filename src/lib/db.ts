/**
 * 本地 IndexedDB 存储。
 *
 * v2 结构：
 * - history：书籍元数据、译文、剪藏、同步状态（不含 PDF 原文件），按 fingerprint 建索引；
 * - pdfFiles：PDF 原文件，按记录 id 存放，只在打开阅读器时读取。
 */

export interface ClipItem {
  id: string;
  pageNumber: number;
  text: string;
  sourceText?: string;
  note?: string;
  createdAt: number;
  /** 最后修改时间，用于多端合并 */
  updatedAt?: number;
  /** 删除时间（墓碑）。存在时界面不显示，但保留用于同步删除 */
  deletedAt?: number;
}

export interface BookSyncState {
  /** 上次从云端拉取时的服务端时间，下次只拉取之后变化的数据 */
  pulledAt?: number;
  /** 上次成功推送的本地时间，之后修改的数据需要推送 */
  pushedAt?: number;
  /** 是否已检查并迁移旧版（v1）云端数据 */
  legacyChecked?: boolean;
}

export interface HistoryRecord {
  id: string;
  fingerprint?: string; // SHA-256 PDF 内容指纹
  filename: string;
  date: number;
  lastReadTime?: number;
  totalPages?: number;
  lastReadPage?: number;
  /** 文件名或阅读进度的最后修改时间 */
  metaUpdatedAt?: number;
  translations: Record<number, string>;
  /** 每页译文的最后修改时间 */
  translationTimes?: Record<number, number>;
  clips?: ClipItem[];
  sync?: BookSyncState;
}

/** 旧版记录中内嵌了 PDF 数据 */
type LegacyHistoryRecord = HistoryRecord & { pdfData?: ArrayBuffer };

interface PdfFileEntry {
  id: string;
  data: ArrayBuffer;
}

export async function calculatePdfFingerprint(arrayBuffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 过滤掉已删除的剪藏 */
export function activeClips(clips?: ClipItem[]): ClipItem[] {
  return (clips || []).filter(c => !c.deletedAt);
}

const DB_NAME = 'PdfTranslatorDB';
const HISTORY_STORE = 'history';
const PDF_STORE = 'pdfFiles';
const FINGERPRINT_INDEX = 'fingerprint';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function upgradeDatabase(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  const history = db.objectStoreNames.contains(HISTORY_STORE)
    ? tx.objectStore(HISTORY_STORE)
    : db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });

  if (!history.indexNames.contains(FINGERPRINT_INDEX)) {
    history.createIndex(FINGERPRINT_INDEX, 'fingerprint', { unique: false });
  }

  const pdfStore = db.objectStoreNames.contains(PDF_STORE)
    ? tx.objectStore(PDF_STORE)
    : db.createObjectStore(PDF_STORE, { keyPath: 'id' });

  // v1 -> v2：把内嵌在记录里的 PDF 数据移到 pdfFiles
  if (oldVersion > 0 && oldVersion < 2) {
    const cursorRequest = history.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const record = cursor.value as LegacyHistoryRecord;
      if (record.pdfData) {
        pdfStore.put({ id: record.id, data: record.pdfData } satisfies PdfFileEntry);
        delete record.pdfData;
        cursor.update(record);
      }
      cursor.continue();
    };
  }
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      // 其他标签页升级数据库时关闭连接，下次调用重新打开
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = event => {
      const tx = request.transaction;
      if (tx) upgradeDatabase(request.result, tx, event.oldVersion);
    };
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务已中止'));
  });
}

/** 新建书籍记录与 PDF 文件（同一事务） */
export async function createHistoryRecord(record: HistoryRecord, pdfData: ArrayBuffer): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([HISTORY_STORE, PDF_STORE], 'readwrite');
  tx.objectStore(HISTORY_STORE).put(record);
  tx.objectStore(PDF_STORE).put({ id: record.id, data: pdfData } satisfies PdfFileEntry);
  await transactionDone(tx);
}

export async function saveHistoryRecord(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(HISTORY_STORE, 'readwrite');
  tx.objectStore(HISTORY_STORE).put(record);
  await transactionDone(tx);
}

export async function savePdfData(id: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(PDF_STORE, 'readwrite');
  tx.objectStore(PDF_STORE).put({ id, data } satisfies PdfFileEntry);
  await transactionDone(tx);
}

export async function getPdfData(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  const entry = await requestToPromise<PdfFileEntry | undefined>(
    db.transaction(PDF_STORE, 'readonly').objectStore(PDF_STORE).get(id)
  );
  return entry?.data;
}

export async function getHistoryRecord(id: string): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  return requestToPromise<HistoryRecord | undefined>(
    db.transaction(HISTORY_STORE, 'readonly').objectStore(HISTORY_STORE).get(id)
  );
}

export async function getHistoryRecordByFingerprint(fingerprint: string): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  const index = db.transaction(HISTORY_STORE, 'readonly').objectStore(HISTORY_STORE).index(FINGERPRINT_INDEX);
  return requestToPromise<HistoryRecord | undefined>(index.get(fingerprint));
}

/** 所有书籍记录（不含 PDF 文件），按最近阅读时间倒序 */
export async function getAllHistoryRecords(): Promise<HistoryRecord[]> {
  const db = await getDB();
  const records = await requestToPromise<HistoryRecord[]>(
    db.transaction(HISTORY_STORE, 'readonly').objectStore(HISTORY_STORE).getAll()
  );
  return records.sort((a, b) => (b.lastReadTime || b.date) - (a.lastReadTime || a.date));
}

/**
 * 在单个读写事务内读取、修改并写回记录，避免并发修改互相覆盖。
 * updater 必须是同步函数；返回修改后的记录，记录不存在时返回 undefined。
 */
export async function updateHistoryRecord(
  id: string,
  updater: (record: HistoryRecord) => HistoryRecord
): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  const tx = db.transaction(HISTORY_STORE, 'readwrite');
  const store = tx.objectStore(HISTORY_STORE);
  let updated: HistoryRecord | undefined;
  const getRequest = store.get(id);
  getRequest.onsuccess = () => {
    const current = getRequest.result as HistoryRecord | undefined;
    if (!current) return;
    updated = updater(current);
    store.put(updated);
  };
  await transactionDone(tx);
  return updated;
}

export function updateHistoryFilename(id: string, newFilename: string): Promise<HistoryRecord | undefined> {
  return updateHistoryRecord(id, record => ({ ...record, filename: newFilename, metaUpdatedAt: Date.now() }));
}

export function updateHistoryProgress(
  id: string,
  data: { totalPages?: number; lastReadPage?: number; lastReadTime?: number }
): Promise<HistoryRecord | undefined> {
  return updateHistoryRecord(id, record => {
    const next = { ...record };
    if (data.totalPages !== undefined) next.totalPages = data.totalPages;
    if (data.lastReadTime !== undefined) next.lastReadTime = data.lastReadTime;
    if (data.lastReadPage !== undefined && data.lastReadPage !== record.lastReadPage) {
      next.lastReadPage = data.lastReadPage;
      next.metaUpdatedAt = Date.now();
    }
    return next;
  });
}

/** 写入单页译文 */
export function setPageTranslation(id: string, page: number, text: string): Promise<HistoryRecord | undefined> {
  return updateHistoryRecord(id, record => ({
    ...record,
    translations: { ...(record.translations || {}), [page]: text },
    translationTimes: { ...(record.translationTimes || {}), [page]: Date.now() },
  }));
}

export function addHistoryClip(id: string, clip: ClipItem): Promise<HistoryRecord | undefined> {
  const now = Date.now();
  return updateHistoryRecord(id, record => ({
    ...record,
    clips: [{ ...clip, updatedAt: now }, ...(record.clips || []).filter(c => c.id !== clip.id)],
  }));
}

/** 删除剪藏：保留墓碑记录，便于同步到其他设备 */
export function deleteHistoryClip(id: string, clipId: string): Promise<HistoryRecord | undefined> {
  const now = Date.now();
  return updateHistoryRecord(id, record => ({
    ...record,
    clips: (record.clips || []).map(c => (c.id === clipId ? { ...c, deletedAt: now, updatedAt: now } : c)),
  }));
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([HISTORY_STORE, PDF_STORE], 'readwrite');
  tx.objectStore(HISTORY_STORE).delete(id);
  tx.objectStore(PDF_STORE).delete(id);
  await transactionDone(tx);
}
