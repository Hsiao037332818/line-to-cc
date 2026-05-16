import { Hono } from 'hono'
import { verifySignature } from './signature'
import { parseVerdict } from './permission'
import {
  isMessageEvent,
  isTextMessage,
  isStickerMessage,
  isLocationMessage,
  isMediaMessage,
} from './types'
import type {
  LineWebhookBody,
  LineMediaMessage,
  LineStickerMessage,
  LineLocationMessage,
} from './types'
import type { Verdict } from './permission'

const MAX_SEEN_EVENTS = 1000

// 統一的「收到任何訊息」context
export interface InboundContext {
  userId: string
  eventId: string
  replyTo: string
  timestamp: number
}

interface WebhookAppOptions {
  channelSecret: string
  onTextMessage: (ctx: InboundContext, text: string) => void
  onMediaMessage: (ctx: InboundContext, message: LineMediaMessage) => void
  onStickerMessage: (ctx: InboundContext, message: LineStickerMessage) => void
  onLocationMessage: (ctx: InboundContext, message: LineLocationMessage) => void
  onVerdict: (behavior: Verdict['behavior'], requestId: string) => void
  getLastRequestId?: () => string | null
}

export function createWebhookApp(options: WebhookAppOptions) {
  const app = new Hono()
  const seenEventIds = new Map<string, number>()

  function dedup(eventId: string): boolean {
    if (seenEventIds.has(eventId)) return true
    seenEventIds.set(eventId, Date.now())
    if (seenEventIds.size > MAX_SEEN_EVENTS) {
      const firstKey = seenEventIds.keys().next().value!
      seenEventIds.delete(firstKey)
    }
    return false
  }

  app.post('/webhook', async (c) => {
    // 1. 檢查簽章 header
    const signature = c.req.header('x-line-signature')
    if (!signature) return c.text('Missing x-line-signature', 401)

    // 2. 取原始 body 做簽章驗證（必須是 raw 字串）
    const rawBody = await c.req.text()

    // 3. HMAC-SHA256 驗章
    const valid = await verifySignature(rawBody, options.channelSecret, signature)
    if (!valid) return c.text('Invalid signature', 403)

    // 4. 立刻回 200，避免 LINE retry
    const body: LineWebhookBody = JSON.parse(rawBody)

    queueMicrotask(() => {
      // 空 events 是 LINE 在做 URL 驗證
      if (body.events.length === 0) return

      for (const event of body.events) {
        if (!isMessageEvent(event)) continue
        if (dedup(event.webhookEventId)) continue

        const userId = event.source.userId
        const replyTo = event.source.groupId ?? event.source.roomId ?? userId
        const ctx: InboundContext = {
          userId,
          eventId: event.webhookEventId,
          replyTo,
          timestamp: event.timestamp,
        }

        const msg = event.message

        // 文字訊息：先檢查是不是 permission verdict (yes/no)
        if (isTextMessage(msg)) {
          const verdict = parseVerdict(msg.text, options.getLastRequestId?.() ?? undefined)
          if (verdict) {
            options.onVerdict(verdict.behavior, verdict.requestId)
            continue
          }
          options.onTextMessage(ctx, msg.text)
          continue
        }

        // 媒體訊息（image/video/audio/file）
        if (isMediaMessage(msg)) {
          options.onMediaMessage(ctx, msg)
          continue
        }

        // 貼圖
        if (isStickerMessage(msg)) {
          options.onStickerMessage(ctx, msg)
          continue
        }

        // 位置
        if (isLocationMessage(msg)) {
          options.onLocationMessage(ctx, msg)
          continue
        }

        // 其他類型（template、imagemap...）目前忽略
        console.error(`[line] Ignoring unsupported message type: ${msg.type}`)
      }
    })

    return c.text('OK', 200)
  })

  return app
}