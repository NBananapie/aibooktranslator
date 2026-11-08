# AI PDF Translator（aibooktranslator）

浏览器端的 PDF 双栏翻译阅读器：左侧显示 PDF 原文，右侧流式显示译文（Markdown）。支持划词解释、知识剪藏、扫描页 OCR，以及端到端加密的多设备同步。

## 功能

- **逐页流式翻译**：从 PDF 文本层提取段落（支持双栏版面），附带上一页结尾作为上下文，结果按页缓存在本地。开启自动翻译后会在后台预翻译后续页面。
- **模型服务**：OpenAI 兼容协议（默认 Agnes `agnes-3.0-flash`，可切换 MiniMax、OpenAI 或任意兼容网关）与 Gemini 原生协议。
- **划词伴读**：选中文字后可复制、剪藏或请模型解释，支持多轮追问。
- **知识剪藏**：剪藏按页保存，可在原文和译文中标出，可导出为 Markdown。
- **OCR**：扫描页可手动调用百度飞桨 AI Studio PaddleOCR 识别后再翻译。
- **云同步**：设置同步口令后，译文、剪藏和阅读进度以每页、每条为单位加密同步到 Cloudflare D1。

## 数据与隐私

| 数据 | 存放位置 |
|---|---|
| PDF 原文件 | 只保存在本浏览器 IndexedDB，不上传 |
| 译文、剪藏、阅读进度 | 本浏览器 IndexedDB；开启同步后以密文形式存入 D1 |
| 用户自填的 API Key、OCR Token、同步口令 | 本浏览器 localStorage（明文） |

- 首次使用可在「引擎与服务商配置」中前往 `https://apihub.agnes-ai.com` 免费注册获取 API Key。填写了 API Key 时，浏览器优先直连模型服务；只有服务商不允许浏览器跨域访问时，才通过本站 `/api/translate`、`/api/explain` 转发，此时 Key 和待翻译文本会经过本站服务端（不存储）。
- 默认不开放游客服务端内置额度（`ALLOW_SERVER_API_KEY="false"`）；如需在私有部署中开放内置额度，可将 `ALLOW_SERVER_API_KEY` 设为 `true` 并配置 `API_KEY`（按 IP 限流）。
- 云同步：同步口令只在本地使用。客户端用 PBKDF2（60 万次）+ HKDF 从口令派生两把独立密钥：一把作为访问凭证发给服务端（服务端只保存其 SHA-256），另一把用于 AES-GCM 加密，服务端拿不到。每条密文绑定书籍指纹和页码/剪藏 ID。口令丢失后云端数据无法恢复。

## 本地开发

需要 Node.js 20 及以上。

```bash
npm install
cp .dev.vars.example .dev.vars        # 仅 npm run preview 需要
# 新建 .env.local，内容见下方“环境变量”
npm run db:migrate:local               # 初始化本地 D1（next dev 中的绑定为本地模拟）
npm run dev                            # http://localhost:3000
```

常用命令：

| 命令 | 说明 |
|---|---|
| `npm run dev` | Next.js 开发服务器（可访问本地模拟的 D1 与限流绑定） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试 |
| `npm run preview` | 用 OpenNext 构建并在本地 Workers 运行时中预览 |
| `npm run cf-typegen` | 根据 `wrangler.jsonc` 重新生成 `cloudflare-env.d.ts` |

## 环境变量

本地写在 `.env.local`（已被 `.gitignore` 忽略）；线上在 Cloudflare 控制台设置，密钥用 `npx wrangler secret put <名称>`。

| 名称 | 必填 | 说明 |
|---|---|---|
| `ALLOW_SERVER_API_KEY` | 否 | 为 `true` 时，未填 Key 的用户可使用站点内置额度 |
| `API_KEY` | 开放内置额度时必填 | 内置额度使用的模型服务 Key（密钥） |
| `LLM_PROVIDER` | 否 | `openai`（默认）或 `gemini` |
| `BASE_URL` | 否 | 内置额度的服务地址，默认 `https://apihub.agnes-ai.com/v1` |
| `MODEL` | 否 | 内置额度的模型，默认 `agnes-3.0-flash` |
| `PADDLEOCR_ACCESS_TOKEN` | 否 | 站点内置 OCR Token（用户未填写时使用，密钥） |
| `PADDLEOCR_API_URL` | 否 | 站点内置 OCR 服务地址（使用内置 Token 时固定走此地址） |
| `OCR_ALLOWED_HOSTS` | 否 | 额外允许的 OCR 服务域名，逗号分隔 |

非敏感的 `LLM_PROVIDER`、`BASE_URL`、`MODEL`、`ALLOW_SERVER_API_KEY` 已写在 `wrangler.jsonc` 的 `vars` 中。

## 部署（Cloudflare Workers + OpenNext）

项目使用 [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) 部署为 Cloudflare Worker。

1. 登录：`npx wrangler login`
2. D1 数据库已在 `wrangler.jsonc` 中绑定为 `DB`（`bookreader-db`）。应用迁移：`npm run db:migrate:remote`
3. 设置密钥：`npx wrangler secret put API_KEY`（如需 OCR 内置额度再设置 `PADDLEOCR_ACCESS_TOKEN`）
4. 部署：`npm run deploy`

`wrangler.jsonc` 中声明了两个限流绑定（`LLM_RATE_LIMITER`：内置额度翻译/解释每 IP 每分钟 20 次；`API_RATE_LIMITER`：同步与 OCR 每 IP 每分钟 120 次），按需调整。

> 从 Cloudflare Pages（`@cloudflare/next-on-pages`）迁移：OpenNext 部署目标是 Workers，需要在 Cloudflare 控制台新建 Worker（或通过 Workers Builds 连接仓库），把原 Pages 项目的自定义域名和环境变量迁到新 Worker，确认可用后再删除 Pages 项目。

## 云同步数据迁移

- `migrations/0001_book_sync_records.sql`：旧版同步表。`/api/sync` 现在只读。
- `migrations/0002_sync_v2.sql`：新版按页/按剪藏存储的表，接口为 `/api/sync/v2`。
- `migrations/0003_legacy_key_hash.sql`：为旧表增加 `sync_key_hash` 列，`/api/sync` 改为按 `SHA-256(口令)` 鉴权，客户端不再发送明文口令。

用户在任一设备打开某本书时，客户端会读取旧表中该书的数据，合并到本地后以新格式加密推送。确认所有用户已迁移后，可删除旧表 `book_sync_records` 与 `/api/sync` 接口。

## 目录结构

```
src/
  app/                 页面与 API 路由（api/translate、api/explain、api/ocr、api/sync、api/sync/v2）
  components/          阅读器界面
  hooks/               文档加载、翻译、剪藏、划词、原文版面数据
  lib/
    llm/               浏览器与服务端共用的提示词和流式协议
    server/            服务端代理与 Cloudflare 绑定访问
    crypto.ts          同步口令派生与加解密
    db.ts              IndexedDB 存储
    syncProtocol.ts    同步接口数据结构
  services/            版面分析、同步、合并规则、导出、OCR
migrations/            D1 迁移
```

## 许可证

MIT，见 [LICENSE](./LICENSE)。
