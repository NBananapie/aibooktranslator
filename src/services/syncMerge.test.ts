import { describe, expect, it } from 'vitest';
import type { HistoryRecord } from '@/lib/db';
import { collectLocalChanges, hasChanges, mergeLegacyIntoRecord, mergeRemoteIntoRecord } from './syncMerge';

function record(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'r1',
    fingerprint: 'f'.repeat(64),
    filename: 'book.pdf',
    date: 1000,
    translations: {},
    translationTimes: {},
    clips: [],
    ...overrides,
  };
}

describe('mergeRemoteIntoRecord', () => {
  it('takes the newer translation per page', () => {
    const local = record({
      translations: { 1: 'local-1', 2: 'local-2' },
      translationTimes: { 1: 2000, 2: 5000 },
    });
    const merged = mergeRemoteIntoRecord(local, {
      meta: null,
      pages: [
        { page: 1, text: 'remote-1', updatedAt: 3000 },
        { page: 2, text: 'remote-2', updatedAt: 4000 },
        { page: 3, text: 'remote-3', updatedAt: 1 },
      ],
      clips: [],
    });
    expect(merged.translations).toEqual({ 1: 'remote-1', 2: 'local-2', 3: 'remote-3' });
    expect(merged.translationTimes?.[1]).toBe(3000);
  });

  it('does not resurrect deleted clips and applies remote deletions', () => {
    const local = record({
      clips: [
        { id: 'a', pageNumber: 1, text: 'A', createdAt: 1, updatedAt: 10, deletedAt: 10 },
        { id: 'b', pageNumber: 1, text: 'B', createdAt: 2, updatedAt: 5 },
      ],
    });
    const merged = mergeRemoteIntoRecord(local, {
      meta: null,
      pages: [],
      clips: [
        { id: 'a', pageNumber: 1, text: 'A', createdAt: 1, updatedAt: 3 },
        { id: 'b', pageNumber: 0, text: '', createdAt: 8, updatedAt: 8, deletedAt: 8 },
      ],
    });
    expect(merged.clips?.find(c => c.id === 'a')?.deletedAt).toBe(10);
    expect(merged.clips?.find(c => c.id === 'b')?.deletedAt).toBe(8);
  });

  it('applies newer remote progress', () => {
    const local = record({ lastReadPage: 3, metaUpdatedAt: 100 });
    const merged = mergeRemoteIntoRecord(local, {
      meta: { filename: 'renamed.pdf', totalPages: 50, lastReadPage: 20, updatedAt: 200 },
      pages: [],
      clips: [],
    });
    expect(merged.lastReadPage).toBe(20);
    expect(merged.filename).toBe('renamed.pdf');

    const stale = mergeRemoteIntoRecord(local, {
      meta: { filename: 'old.pdf', totalPages: 50, lastReadPage: 1, updatedAt: 50 },
      pages: [],
      clips: [],
    });
    expect(stale.lastReadPage).toBe(3);
  });
});

describe('collectLocalChanges', () => {
  it('returns only items changed after the given time', () => {
    const r = record({
      translations: { 1: 'a', 2: 'b' },
      translationTimes: { 1: 100, 2: 300 },
      clips: [
        { id: 'x', pageNumber: 1, text: 'x', createdAt: 50, updatedAt: 50 },
        { id: 'y', pageNumber: 1, text: 'y', createdAt: 250, updatedAt: 250 },
      ],
      metaUpdatedAt: 150,
    });
    const changes = collectLocalChanges(r, 200);
    expect(changes.pages.map(p => p.page)).toEqual([2]);
    expect(changes.clips.map(c => c.id)).toEqual(['y']);
    expect(changes.meta).toBeNull();
    expect(hasChanges(changes)).toBe(true);
    expect(hasChanges(collectLocalChanges(r, 1000))).toBe(false);
  });
});

describe('mergeLegacyIntoRecord', () => {
  it('fills missing pages and clips without overwriting local data', () => {
    const local = record({ translations: { 1: 'local' }, lastReadPage: 1, sync: { pushedAt: 1500 } });
    const merged = mergeLegacyIntoRecord(
      local,
      {
        translations: { 1: 'legacy-1', 2: 'legacy-2' },
        clips: [{ id: 'c1', pageNumber: 2, text: 'clip', createdAt: 5 }],
        lastReadPage: 7,
        totalPages: 10,
        updatedAt: 999,
      },
      2000
    );
    expect(merged.translations).toEqual({ 1: 'local', 2: 'legacy-2' });
    expect(merged.translationTimes?.[2]).toBe(2000);
    expect(merged.clips?.map(c => c.id)).toEqual(['c1']);
    expect(merged.clips?.[0].updatedAt).toBe(2000);
    expect(merged.lastReadPage).toBe(7);
    expect(merged.totalPages).toBe(10);
    expect(merged.metaUpdatedAt).toBe(2000);

    // 迁移进来的数据必须能被后续推送收集
    const changes = collectLocalChanges(merged, merged.sync?.pushedAt ?? 0);
    expect(changes.pages.map(p => p.page)).toEqual([2]);
    expect(changes.clips.map(c => c.id)).toEqual(['c1']);
    expect(changes.meta?.lastReadPage).toBe(7);
  });
});
