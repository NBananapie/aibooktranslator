import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 本项目没有 ISR / 数据缓存需求，使用默认配置（不启用 R2 增量缓存）
export default defineCloudflareConfig({});
