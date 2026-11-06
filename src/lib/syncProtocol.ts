/**
 * 云同步 v2 接口的请求/响应结构与校验常量，客户端与服务端共用。
 */

export const SYNC_TOKEN_REGEX = /^[a-f0-9]{64}$/;
export const BOOK_FINGERPRINT_REGEX = /^[a-f0-9]{64}$/;
export const CLIP_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/** 单次推送最多条目数（页 + 剪藏） */
export const MAX_PUSH_ITEMS = 50;
/** 单次推送请求体上限 */
export const MAX_PUSH_BYTES = 3 * 1024 * 1024;
/** 单条密文上限（D1 单行上限为 2 MB） */
export const MAX_ITEM_CHARS = 1024 * 1024;
export const MAX_PAGE_NUMBER = 100_000;

export interface SyncMeta {
  /** 加密的 { filename, totalPages, lastReadPage } */
  content: string;
  updatedAt: number;
}

export interface SyncPageItem {
  page: number;
  content: string;
  updatedAt: number;
}

export interface SyncClipItem {
  id: string;
  /** 已删除的剪藏不上传内容 */
  content: string | null;
  deleted: boolean;
  updatedAt: number;
}

export interface SyncPushRequest {
  bookFingerprint: string;
  meta?: SyncMeta;
  pages?: SyncPageItem[];
  clips?: SyncClipItem[];
}

export interface SyncPullResponse {
  serverTime: number;
  meta: SyncMeta | null;
  pages: SyncPageItem[];
  clips: SyncClipItem[];
}

export interface SyncBookSummary {
  bookFingerprint: string;
  meta: SyncMeta | null;
  serverUpdatedAt: number;
  pageCount: number;
  clipCount: number;
}

export interface SyncListResponse {
  books: SyncBookSummary[];
}

/** 解密后的书籍元数据 */
export interface BookMetaPlain {
  filename: string;
  totalPages: number;
  lastReadPage: number;
}

/** 解密后的剪藏内容 */
export interface ClipPlain {
  pageNumber: number;
  text: string;
  sourceText?: string;
  note?: string;
  createdAt: number;
}
