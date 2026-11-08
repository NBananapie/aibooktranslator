-- 旧版同步表增加口令哈希列，旧版接口改为按 SHA-256(口令) 查询，客户端不再发送明文口令。
-- 哈希值由接口在首次访问时补齐（D1 SQL 没有 SHA-256 函数）。
ALTER TABLE book_sync_records ADD COLUMN sync_key_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_records_key_hash ON book_sync_records (sync_key_hash);
