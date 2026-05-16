# line-to-cc 架構解說

此專案將 LINE Messaging API 實作為 **Claude Code 的 Custom Channel Plugin**，讓使用者可以直接透過 LINE 操作本機的 Claude Code Session。

---

## 整體架構

```mermaid
flowchart TB
    subgraph LINE["LINE Platform"]
        LApp["LINE App"]
        LPF["LINE Platform\n(Webhook / Push API)"]
        LApp <-->|訊息| LPF
    end

    subgraph Local["本機環境（開發者 PC）"]
        subgraph Process["server.ts Process"]
            MCP["MCP Server\n(stdio)"]
            HTTP["Hono HTTP Server\nlocalhost:8788"]
            AC["Access Control\n(pairing / allowlist)"]
            PR["Permission Relay\n(Flex Message builder)"]
            MCP --- HTTP
            HTTP --- AC
            MCP --- PR
        end
        CF["cloudflared\nQuick Tunnel"]
        CC["Claude Code"]
        CC <-->|"JSON-RPC\n(stdio)"| MCP
        HTTP <-->|"localhost"| CF
    end

    LPF -->|"POST /webhook\n(HTTPS)"| CF
    PR -->|"Push API"| LPF
```

### 元件列表

| 元件                   | 技術                          | 功能                      |
| -------------------- | --------------------------- | ----------------------- |
| **MCP Server**       | `@modelcontextprotocol/sdk` | 與 Claude Code 之間的通訊橋接   |
| **HTTP Server**      | Hono on Bun                 | 接收 LINE Webhook         |
| **cloudflared**      | Quick Tunnel                | 將 localhost 對外公開為 HTTPS |
| **Access Control**   | in-memory + JSON            | 配對與 sender gating       |
| **Permission Relay** | Flex Message                | 將 Claude 的授權請求轉送到 LINE  |

---

## 啟動流程

```mermaid
sequenceDiagram
    participant Dev as 開發者 Terminal
    participant CC as Claude Code
    participant Srv as server.ts
    participant CF as cloudflared
    participant LINE as LINE Platform

    Dev->>CC: claude --dangerously-load-development-channels server:line
    CC->>Srv: 作為子程序啟動（stdio）
    Srv->>CC: MCP connect（stdio transport）
    Note over Srv: 啟動 HTTP Server（localhost:8788）
    Srv->>CF: 啟動 cloudflared tunnel
    CF-->>Srv: https://xxxx.trycloudflare.com（監聽 stdout/stderr）
    Srv->>LINE: PUT /webhook（自動設定 Webhook URL）
    LINE-->>Srv: 200 OK（包含連線驗證）
    Srv->>LINE: GET /webhook（驗證 URL）
    Srv->>LINE: POST /webhook/test（連線測試）
    LINE-->>Srv: 200 OK
    Srv->>CC: MCP notification "LINE channel ready"
    Note over Dev: 聊天畫面顯示 "LINE channel ready"
```

> **設計重點**：先建立 MCP 連線，再設定 tunnel，這樣才能把「tunnel 已完成」通知送到聊天畫面。

---

## 訊息接收流程

以下是從 LINE 收到訊息，到顯示在 Claude Code 聊天中的完整流程。

```mermaid
sequenceDiagram
    participant LApp as LINE App
    participant LINE as LINE Platform
    participant Hono as Hono (/webhook)
    participant AC as Access Control
    participant MCP as MCP Server

    LApp->>LINE: 傳送訊息
    LINE->>Hono: POST /webhook\n（含 x-line-signature header）
    Hono->>Hono: HMAC-SHA256 簽章驗證
    Hono-->>LINE: 200 OK（立即回傳）

    Note over Hono: 使用 queueMicrotask 非同步處理

    Hono->>Hono: 使用 webhookEventId 去重
    Hono->>AC: isAllowed(userId)?

    alt 未註冊使用者（pairing 模式）
        AC-->>Hono: false
        Hono->>LINE: Push「配對碼：xxxxxx」
        Hono->>MCP: notification（配對通知）
    else 已允許使用者
        AC-->>Hono: true
        Hono->>MCP: notification\n"notifications/claude/channel"
        MCP->>MCP: 顯示於 Claude Code 聊天
    end
```

### 為什麼要立即回傳 200

```
LINE 官方建議：Webhook 接收後需於 1 秒內回傳 200
→ 使用 queueMicrotask() 將處理拆成非同步
→ HTTP 層只負責驗證並立即回應
→ 真正事件處理放到下一個 microtask queue
```

---

## MCP Protocol 的應用

此專案的核心，是使用 MCP 實作 Claude Code 的 **Custom Channel 功能**。

```mermaid
flowchart LR
    subgraph CC["Claude Code"]
        Chat["聊天 UI"]
        PM["Permission Manager"]
    end

    subgraph Srv["server.ts（MCP Server）"]
        Tools["MCP Tools\nline_reply\nline_verify_pairing"]
        Notif["MCP Notifications\nclaude/channel\nclaude/channel/permission"]
    end

    subgraph LINE["LINE"]
        User["使用者"]
        Flex["Flex Message\n(Permission Card)"]
    end

    User -->|"文字"| Notif
    Notif -->|"notifications/claude/channel"| Chat
    Chat -->|"CallTool: line_reply"| Tools
    Tools -->|"Push API"| User

    PM -->|"notifications/claude/channel/permission_request"| Notif
    Notif -->|"Flex Message"| Flex
    Flex -->|"yes / no"| Notif
    Notif -->|"notifications/claude/channel/permission"| PM
```

### MCP 訊息列表

| 訊息                                                | 方向                   | 用途                      |
| ------------------------------------------------- | -------------------- | ----------------------- |
| `notifications/claude/channel`                    | server → Claude Code | 將 LINE 訊息送進聊天           |
| `notifications/claude/channel/permission_request` | Claude Code → server | 工具執行授權請求                |
| `notifications/claude/channel/permission`         | server → Claude Code | 回傳使用者 yes/no 判定         |
| `CallTool: line_reply`                            | Claude Code → server | 將 Claude 回覆 Push 到 LINE |
| `CallTool: line_verify_pairing`                   | Claude Code → server | 驗證配對碼                   |

> **重點**：`notifications/claude/channel` 是 Claude Code 的擴充功能。
> 透過 `capabilities.experimental['claude/channel']` 宣告 capability，讓 Claude Code 能辨識。

---

## Permission Relay 流程

當 Claude Code 需要執行高風險工具時，會將授權請求轉送到 LINE，由手機端確認。

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Srv as server.ts
    participant LINE as LINE App

    CC->>Srv: MCP notification\npermission_request\n{request_id, tool_name, description}
    Srv->>Srv: 取得 lastReplyTo（最後回覆對象）
    Srv->>LINE: Push Flex Message\n（Permission Card）

    Note over LINE: 顯示 Allow / Deny 按鈕
    Note over LINE: 或輸入 "yes" / "no"

    LINE->>Srv: POST /webhook "yes"
    Srv->>Srv: parseVerdict("yes", lastPendingRequestId)
    Srv->>CC: MCP notification\nclaude/channel/permission\n{request_id, behavior: "allow"}
    CC->>CC: 繼續執行工具
```

### Verdict Parsing 規則

```
"yes abcde"   → 明確指定 request_id（5碼）
"no"          → 使用 bare verdict（採用 lastPendingRequestId）
"y"           → "yes" 簡寫
```

> 配對碼採用不含 `l` 的小寫 a-z 五碼。
> 避免手機鍵盤上 `l` 與 `1`、`I` 混淆。

---

## 配對流程

安全地加入首次使用者。

```mermaid
sequenceDiagram
    participant LUser as LINE 使用者
    participant LINE as LINE Platform
    participant Srv as server.ts
    participant Dev as 開發者（Claude Code）

    LUser->>LINE: 傳送任意訊息
    LINE->>Srv: POST /webhook
    Srv->>Srv: isAllowed(userId) → false
    Srv->>Srv: startPairing(userId)\n產生六碼配對碼
    Srv->>LINE: Push「配對碼：ab3x9z」
    Srv->>Dev: MCP notification\n（Terminal 通知）

    Dev->>Dev: /line:access pair ab3x9z
    Dev->>Srv: CallTool: line_verify_pairing {code: "ab3x9z"}
    Srv->>Srv: verifyPairing(code)\n加入 allowed_users
    Srv->>Srv: 儲存至 ~/.claude/channels/line/access.json
    Srv->>LINE: Push「配對完成！」
    Srv-->>Dev: "Paired successfully with user Uxxxx"
```

### 存取模式

| 模式          | 行為              |
| ----------- | --------------- |
| `pairing`   | 首次訊息自動發送配對碼（預設） |
| `allowlist` | 僅允許已配對使用者       |
| `disabled`  | 全部封鎖            |

---

## 安全性設計

```mermaid
flowchart TD
    WH["POST /webhook"] --> SIG{"簽章驗證\nHMAC-SHA256\n(timing-safe)"}
    SIG -->|"不符"| R403["403 Forbidden"]
    SIG -->|"符合"| DEDUP{"重複檢查\nwebhookEventId"}
    DEDUP -->|"重複"| DROP["忽略"]
    DEDUP -->|"新事件"| AC{"存取控制\nisAllowed(userId)"}
    AC -->|"拒絕"| PAIR["配對或忽略"]
    AC -->|"允許"| PROC["處理事件"]
```

| 防護                   | 實作                                                |
| -------------------- | ------------------------------------------------- |
| **簽章驗證**             | `crypto.subtle.verify`（WebCrypto API，timing-safe） |
| **Raw body 驗證**      | JSON parse 前先驗證原始位元資料                             |
| **Replay Attack 防護** | 使用 `webhookEventId` 去重（最多 1000 筆 in-memory）       |
| **網路隔離**             | HTTP Server 僅綁定 `127.0.0.1`                       |
| **程序隔離**             | 啟動 cloudflared 前先 kill 舊程序，避免 port 衝突             |

---

## cloudflared Quick Tunnel 機制

使用 Cloudflare 提供的免費功能，在沒有固定網域與認證的情況下，將 localhost 對外公開為 HTTPS。

```mermaid
sequenceDiagram
    participant Srv as server.ts
    participant CF as cloudflared Process
    participant CFN as Cloudflare Network
    participant LINE as LINE Platform

    Srv->>CF: spawn('cloudflared', ['tunnel', '--url', 'http://localhost:8788'])
    CF->>CFN: 建立 TLS tunnel
    CFN-->>CF: 分配 https://xxxx.trycloudflare.com
    CF->>CF: 將 URL 輸出至 stdout/stderr
    Srv->>Srv: 監聽 stdout/stderr\n透過 regex 擷取 URL
    Srv->>LINE: PUT /v2/bot/channel/webhook/endpoint\n{"webhookEndpointUrl": "https://xxxx.trycloudflare.com/webhook"}
    LINE-->>Srv: 200 OK
    Note over Srv,LINE: 後續 LINE 將透過 tunnel POST
```

> **注意**：Quick Tunnel 的 URL 每次程序重啟都會改變。
> 但因為會自動更新 LINE Webhook URL，因此幾乎沒有維運成本。

---

## 檔案結構

```text
src/
├── server.ts          # 協調器：MCP + HTTP + tunnel 啟動與整體 wiring
├── webhook.ts         # Hono：簽章驗證、去重、事件路由
├── line-api.ts        # LINE API client：push、webhook 設定
├── signature.ts       # HMAC-SHA256 簽章驗證（WebCrypto）
├── access-control.ts  # 配對、sender gating、allowlist 管理
├── permission.ts      # Verdict parsing + Flex Message builder
├── tunnel.ts          # cloudflared 啟動 + URL 擷取
└── types.ts           # LINE Webhook event type 與 type guard
```

---

## Tech Stack

| 技術                            | 選擇原因                          |
| ----------------------------- | ----------------------------- |
| **Bun**                       | 啟動速度快、內建測試工具、支援 Web API       |
| **Hono**                      | 輕量、型別安全、原生支援 Bun              |
| **@modelcontextprotocol/sdk** | 與 Claude Code 通訊必需            |
| **cloudflared**               | 免費、免驗證、自動 HTTPS               |
| **WebCrypto API**             | timing-safe 簽章驗證、無 Node.js 依賴 |
