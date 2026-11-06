-- 云同步 v2：按页、按剪藏存储，服务端只保存账户凭证的 SHA-256（account_id），不保存口令。
-- 内容字段均为客户端 AES-GCM 加密后的密文。updated_at 为客户端修改时间（用于后写入者胜出合并），
-- server_updated_at 为服务端写入时间（用于增量拉取）。

CREATE TABLE IF NOT EXISTS sync_books (
    account_id TEXT NOT NULL,
    book_fingerprint TEXT NOT NULL,
    meta TEXT,
    meta_updated_at INTEGER NOT NULL DEFAULT 0,
    server_updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, book_fingerprint)
);

CREATE TABLE IF NOT EXISTS sync_pages (
    account_id TEXT NOT NULL,
    book_fingerprint TEXT NOT NULL,
    page INTEGER NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    server_updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, book_fingerprint, page)
);

CREATE INDEX IF NOT EXISTS idx_sync_pages_server_time
    ON sync_pages (account_id, book_fingerprint, server_updated_at);

CREATE TABLE IF NOT EXISTS sync_clips (
    account_id TEXT NOT NULL,
    book_fingerprint TEXT NOT NULL,
    clip_id TEXT NOT NULL,
    content TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    server_updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, book_fingerprint, clip_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_clips_server_time
    ON sync_clips (account_id, book_fingerprint, server_updated_at);
