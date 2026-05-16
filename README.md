# line-to-cc

將 LINE Messaging API 實作為 Claude Code Channels 的自訂通道外掛，可透過 LINE 操作本機的 Claude Code Session。

## Features

* LINE <-> Claude Code 雙向文字聊天
* Permission relay（工具執行的允許/拒絕，可透過 LINE 的 Flex Message 按鈕操作）
* Sender gating（使用配對碼方式，只允許特定使用者）
* 自動啟動 cloudflared tunnel + 自動設定 Webhook URL + 連線測試

## Prerequisites

* [Claude Code](https://claude.ai/claude-code) v2.1.80+
* [Bun](https://bun.sh/) 最新版
* [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)（`brew install cloudflared`）

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/elchika-inc/line-to-cc.git
cd line-to-cc
bun install
```

### 2. LINE Developers Console

1. 登入 [LINE Developers Console](https://developers.line.biz/)
2. 建立 Provider（也可使用既有 Provider）
3. 新增「Messaging API」Channel
4. 記下 **Channel Secret**（Basic settings 分頁）與 **Channel Access Token**（於 Messaging API 分頁中 Issue）

### 3. Credentials

```bash
cp .env.example .env
```

編輯 `.env`，填入 Channel Secret 與 Channel Access Token：

```env
LINE_CHANNEL_SECRET=your_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
```

### 4. Start

```bash
claude --dangerously-load-development-channels server:line
```

啟動後會自動：

1. 啟動 HTTP Server（port 8788）
2. 啟動 cloudflared tunnel
3. 自動設定 LINE Webhook URL
4. 執行連線測試
5. 顯示 `LINE channel ready`

### 5. Pairing

1. 在 LINE App 中加入 Bot 好友
2. 傳送任意訊息
3. LINE 會回傳配對碼
4. 在 Claude Code Session 中使用 `line_verify_pairing` tool 輸入配對碼

## Architecture

```text
LINE App
  -> LINE Platform (Webhook POST)
    -> Cloudflare Tunnel (localhost:8788)
      -> Hono (POST /webhook)
        -> HMAC-SHA256 簽章驗證 -> sender gating -> verdict 判定
          -> MCP notification -> Claude Code Session
            -> line_reply tool -> Push API -> LINE App
```

## MCP Tools

| Tool                  | Description    |
| --------------------- | -------------- |
| `line_reply`          | 傳送訊息給 LINE 使用者 |
| `line_verify_pairing` | 驗證配對碼並允許使用者    |

## Permission Relay

當 Claude Code 要求工具執行授權時，LINE 會收到 Flex Message 卡片。

可點擊卡片中的「Allow」「Deny」按鈕，或直接輸入 `yes` / `no` 回覆。

> Note: 僅在使用 `--permission-mode default` 啟動時有效。`bypassPermissions` 模式不會觸發。

## Project Structure

```text
src/
  server.ts          # MCP Server + HTTP + tunnel 啟動
  webhook.ts         # Hono Webhook handler
  line-api.ts        # LINE Push API client
  signature.ts       # HMAC-SHA256 簽章驗證
  access-control.ts  # 配對與 sender gating
  permission.ts      # Permission relay（Flex Message）
  tunnel.ts          # cloudflared 自動啟動
  types.ts           # LINE Webhook 型別定義
tests/               # Bun 測試（46 tests）
skills/              # /line:configure, /line:access
```

## Configuration

| Environment Variable        | Required | Description               |
| --------------------------- | -------- | ------------------------- |
| `LINE_CHANNEL_SECRET`       | Yes      | HMAC-SHA256 簽章驗證          |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes      | Push API / Webhook API 驗證 |
| `LINE_WEBHOOK_PORT`         | No       | HTTP Server Port（預設：8788） |

## Tests

```bash
bun test
```

## Limitations

* Claude Code Channels 為 Research Preview（需使用 `--dangerously-load-development-channels`）
* LINE 免費方案每月限制 200 則訊息
* Quick tunnel 的 URL 會在程序重啟後改變（會自動重新設定）
* 僅支援文字訊息（不支援圖片與檔案）

## License

MIT
