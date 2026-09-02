export interface ClipItem {
  id: string;
  pageNumber: number;
  text: string;
  sourceText?: string;
  note?: string;
  createdAt: number;
}

export interface HistoryRecord {
  id: string;
  filename: string;
  date: number;
  lastReadTime?: number;
  totalPages?: number;
  lastReadPage?: number;
  pdfData: ArrayBuffer;
  translations: Record<number, string>;
  clips?: ClipItem[];
}

const DB_NAME = 'PdfTranslatorDB';
const STORE_NAME = 'history';
const DB_VERSION = 1;

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveHistoryRecord(record: HistoryRecord): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getHistoryRecord(id: string): Promise<HistoryRecord | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function updateHistoryFilename(id: string, newFilename: string): Promise<void> {
  const record = await getHistoryRecord(id);
  if (!record) return;
  record.filename = newFilename;
  await saveHistoryRecord(record);
}

export async function updateHistoryProgress(
  id: string,
  data: { totalPages?: number; lastReadPage?: number; lastReadTime?: number }
): Promise<void> {
  const record = await getHistoryRecord(id);
  if (!record) return;
  if (data.totalPages !== undefined) record.totalPages = data.totalPages;
  if (data.lastReadPage !== undefined) record.lastReadPage = data.lastReadPage;
  if (data.lastReadTime !== undefined) record.lastReadTime = data.lastReadTime;
  await saveHistoryRecord(record);
}

export async function addHistoryClip(id: string, clip: ClipItem): Promise<void> {
  const record = await getHistoryRecord(id);
  if (!record) return;
  const existingClips = record.clips || [];
  // 避免重复剪藏完全相同的文本
  const filtered = existingClips.filter(c => c.id !== clip.id);
  record.clips = [clip, ...filtered];
  await saveHistoryRecord(record);
}

export async function deleteHistoryClip(id: string, clipId: string): Promise<void> {
  const record = await getHistoryRecord(id);
  if (!record || !record.clips) return;
  record.clips = record.clips.filter(c => c.id !== clipId);
  await saveHistoryRecord(record);
}

export async function getAllHistoryMetadata(): Promise<Omit<HistoryRecord, 'pdfData'>[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      // Strip out the heavy pdfData to return just metadata for the list
      const records = request.result.map(record => ({
        id: record.id,
        filename: record.filename,
        date: record.date,
        lastReadTime: record.lastReadTime || record.date,
        totalPages: record.totalPages,
        lastReadPage: record.lastReadPage,
        translations: record.translations || {},
        clips: record.clips || []
      }));
      // Sort by lastReadTime or date descending
      records.sort((a, b) => (b.lastReadTime || b.date) - (a.lastReadTime || a.date));
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteHistoryRecord(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
