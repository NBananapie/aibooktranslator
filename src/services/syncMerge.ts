/**
 * 云同步的本地合并规则（纯函数，便于单元测试）。
 * 规则：每页译文、每条剪藏、书籍元数据各自按修改时间比较，较新的一方胜出；
 * 删除的剪藏以墓碑（deletedAt）形式参与比较，避免被旧数据复活。
 */

import type { ClipItem, HistoryRecord } from '@/lib/db';
import type { BookMetaPlain } from '@/lib/syncProtocol';

export interface RemotePage {
  page: number;
  text: string;
  updatedAt: number;
}

export interface RemoteChanges {
  meta: (BookMetaPlain & { updatedAt: number }) | null;
  pages: RemotePage[];
  clips: ClipItem[];
}

export interface LocalChanges {
  meta: (BookMetaPlain & { updatedAt: number }) | null;
  pages: RemotePage[];
  clips: ClipItem[];
}

export interface LegacyBookData {
  translations: Record<number, string>;
  clips: ClipItem[];
  lastReadPage?: number;
  totalPages?: number;
  updatedAt: number;
}

/** 某页译文的修改时间；旧数据没有记录时间时使用记录创建时间 */
export function pageTime(record: HistoryRecord, page: number): number {
  return record.translationTimes?.[page] ?? record.date ?? 1;
}

export function clipTime(clip: ClipItem): number {
  return clip.updatedAt ?? clip.deletedAt ?? clip.createdAt ?? 1;
}

export function metaTime(record: HistoryRecord): number {
  return record.metaUpdatedAt ?? record.date ?? 1;
}

export function mergeRemoteIntoRecord(record: HistoryRecord, remote: RemoteChanges): HistoryRecord {
  const translations = { ...(record.translations || {}) };
  const translationTimes: Record<number, number> = { ...(record.translationTimes || {}) };

  for (const p of remote.pages) {
    const hasLocal = !!translations[p.page];
    if (!hasLocal || p.updatedAt > pageTime(record, p.page)) {
      translations[p.page] = p.text;
      translationTimes[p.page] = p.updatedAt;
    }
  }

  const clipMap = new Map<string, ClipItem>();
  for (const c of record.clips || []) clipMap.set(c.id, c);
  for (const c of remote.clips) {
    const local = clipMap.get(c.id);
    if (!local || clipTime(c) > clipTime(local)) clipMap.set(c.id, c);
  }
  const clips = Array.from(clipMap.values()).sort((a, b) => b.createdAt - a.createdAt);

  let next: HistoryRecord = { ...record, translations, translationTimes, clips };

  if (remote.meta && remote.meta.updatedAt > metaTime(record)) {
    next = {
      ...next,
      filename: remote.meta.filename || next.filename,
      totalPages: remote.meta.totalPages > 0 ? remote.meta.totalPages : next.totalPages,
      lastReadPage: remote.meta.lastReadPage > 0 ? remote.meta.lastReadPage : next.lastReadPage,
      metaUpdatedAt: remote.meta.updatedAt,
    };
  }

  return next;
}

/** 收集修改时间晚于 since 的本地数据 */
export function collectLocalChanges(record: HistoryRecord, since: number): LocalChanges {
  const pages: RemotePage[] = [];
  for (const [pageStr, text] of Object.entries(record.translations || {})) {
    const page = Number(pageStr);
    if (!text || !Number.isInteger(page)) continue;
    const updatedAt = pageTime(record, page);
    if (updatedAt > since) pages.push({ page, text, updatedAt });
  }

  const clips = (record.clips || []).filter(c => clipTime(c) > since);

  const updatedAt = metaTime(record);
  const meta =
    updatedAt > since
      ? {
          filename: record.filename,
          totalPages: record.totalPages || 0,
          lastReadPage: record.lastReadPage || 1,
          updatedAt,
        }
      : null;

  return { meta, pages, clips };
}

export function hasChanges(changes: LocalChanges): boolean {
  return !!changes.meta || changes.pages.length > 0 || changes.clips.length > 0;
}

/** 合并旧版（v1）云端数据：只补充本地缺失的页和剪藏，不覆盖本地已有内容 */
export function mergeLegacyIntoRecord(record: HistoryRecord, legacy: LegacyBookData): HistoryRecord {
  const translations = { ...(record.translations || {}) };
  const translationTimes: Record<number, number> = { ...(record.translationTimes || {}) };
  for (const [pageStr, text] of Object.entries(legacy.translations)) {
    const page = Number(pageStr);
    if (!Number.isInteger(page) || page < 1 || typeof text !== 'string' || !text) continue;
    if (!translations[page]) {
      translations[page] = text;
      translationTimes[page] = legacy.updatedAt;
    }
  }

  const existingIds = new Set((record.clips || []).map(c => c.id));
  const clips = [...(record.clips || []), ...legacy.clips.filter(c => !existingIds.has(c.id))].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  const useLegacyProgress = (!record.lastReadPage || record.lastReadPage <= 1) && (legacy.lastReadPage ?? 0) > 1;

  return {
    ...record,
    translations,
    translationTimes,
    clips,
    totalPages: record.totalPages || legacy.totalPages,
    lastReadPage: useLegacyProgress ? legacy.lastReadPage : record.lastReadPage,
  };
}
