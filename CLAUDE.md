# CLAUDE.md

## Project Overview

此專案將 LINE Messaging API 實作為 Claude Code Channels 的自訂通道外掛。作為 MCP（Model Context Protocol）Server 運作，接收 LINE Webhook 並轉送至 Claude Code Session。

## Tech Stack

* Runtime: Bun
* HTTP: Hono
* MCP: @modelcontextprotocol/sdk
* Validation: zod
* Tunnel: cloudflared（Quick tunnel）

## Key Commands

```bash
# 執行測試
bun test

# 使用 Claude Code 啟動開發模式
claude --dangerously-load-development-channels server:line

# 型別檢查（僅 src/，測試檔存在已知的 bun mock 型別問題）
bunx tsc --noEmit
```

## Architecture

* `src/server.ts` 為入口點，負責啟動 MCP Server（stdio）+ HTTP Server（Hono）+ cloudflared tunnel
* LINE Webhook 由 `POST /webhook` 接收，依序執行：簽章驗證 -> sender gating -> verdict 判定 -> MCP notification
* 立即回傳 200，事件處理透過 `queueMicrotask` 非同步執行（LINE 官方建議方式）
* Permission relay 透過 Flex Message 卡片 + footer 按鈕轉送到 LINE，同時支援直接輸入 `yes` / `no` 回覆

## File Responsibilities

| File                    | Responsibility                                |
| ----------------------- | --------------------------------------------- |
| `src/server.ts`         | 協調器：MCP + HTTP + tunnel + 全部 wiring           |
| `src/webhook.ts`        | Hono app：簽章檢查、去重、事件路由                         |
| `src/line-api.ts`       | LINE API client：push、Webhook URL 設定/取得/測試     |
| `src/signature.ts`      | 透過 Web Crypto API 實作 HMAC-SHA256（timing-safe） |
| `src/access-control.ts` | 配對 + allowlist + 三模式 gating                   |
| `src/permission.ts`     | Verdict parsing + Flex Message builder        |
| `src/tunnel.ts`         | cloudflared 啟動 + URL 解析 + cleanup             |
| `src/types.ts`          | LINE Webhook event types + type guards        |

## State Files

* `~/.claude/channels/line/access.json` - 已配對使用者與存取模式
* `.env` - LINE 憑證（禁止 commit）

## Testing

* 共 46 個測試，分布於 5 個檔案
* 測試檔因 Bun mock 型別定義問題存在 TypeScript 錯誤，屬於預期狀況，不影響執行
* `tests/webhook.test.ts` 使用 `computeSignature` helper 產生合法 HMAC 簽章供測試使用

## Security Notes

* 簽章驗證使用 `crypto.subtle.verify`（timing-safe）
* JSON parsing 前會先驗證原始 request body
* 使用 `webhookEventId` 去重，防止 replay attack
* HTTP Server 僅綁定 `127.0.0.1`（localhost）
* 啟動時會執行 `pkill -f "cloudflared tunnel"`，避免殘留舊 tunnel
