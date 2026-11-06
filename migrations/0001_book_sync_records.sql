CREATE TABLE IF NOT EXISTS book_sync_records (
    sync_key TEXT NOT NULL,
    book_fingerprint TEXT NOT NULL,
    filename TEXT NOT NULL,
    total_pages INTEGER DEFAULT 0,
    last_read_page INTEGER DEFAULT 1,
    last_read_time INTEGER,
    translations TEXT,
    clips TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (sync_key, book_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_key ON book_sync_records (sync_key);
