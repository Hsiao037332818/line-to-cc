const PUSH_API_URL = 'https://api.line.me/v2/bot/message/push'
const WEBHOOK_ENDPOINT_URL = 'https://api.line.me/v2/bot/channel/webhook/endpoint'
const WEBHOOK_TEST_URL = 'https://api.line.me/v2/bot/channel/webhook/test'
// 重要：媒體下載的 host 是 api-data.line.me，不是 api.line.me
const CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message'
const MAX_TEXT_LENGTH = 5000

// MIME → 副檔名對照表
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
}

export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength))
  }
  return chunks
}

export function createLineClient(accessToken: string) {
  let messageCount = 0

  async function pushMessage(userId: string, text: string): Promise<void> {
    const chunks = splitText(text, MAX_TEXT_LENGTH)
    for (const chunk of chunks) {
      const res = await fetch(PUSH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text: chunk }],
        }),
      })
      messageCount++
      if (!res.ok) {
        const body = await res.text()
        console.error(`[line] Push API error (${res.status}): ${body}`)
      }
      if (messageCount % 50 === 0) {
        console.error(`[line] ${messageCount} messages sent this session`)
      }
    }
  }

  async function pushRawMessages(userId: string, messages: unknown[]): Promise<void> {
    const res = await fetch(PUSH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to: userId, messages }),
    })
    messageCount++
    if (!res.ok) {
      const body = await res.text()
      console.error(`[line] Push API error (${res.status}): ${body}`)
    }
  }

  // 下載媒體訊息原始 binary
  async function getMessageContent(messageId: string): Promise<{
    buffer: Buffer
    contentType: string
    ext: string
  }> {
    const url = `${CONTENT_API_BASE}/${messageId}/content`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Failed to download message ${messageId} (HTTP ${res.status}): ${body}`)
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = Buffer.from(await res.arrayBuffer())
    const cleanCT = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = MIME_TO_EXT[cleanCT] ?? cleanCT.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') ?? 'bin'
    return { buffer, contentType, ext }
  }

  // 下載外部 URL 的檔案（contentProvider.type === 'external'）
  async function downloadExternalContent(url: string): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to download external content (HTTP ${res.status})`)
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = Buffer.from(await res.arrayBuffer())
    const cleanCT = contentType.split(';')[0]!.trim().toLowerCase()
    const ext = MIME_TO_EXT[cleanCT] ?? cleanCT.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '') ?? 'bin'
    return { buffer, contentType, ext }
  }

  async function setWebhookUrl(endpoint: string): Promise<boolean> {
    const res = await fetch(WEBHOOK_ENDPOINT_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[line] Failed to set webhook URL (${res.status}): ${body}`)
      return false
    }
    return true
  }

  async function getWebhookUrl(): Promise<string | null> {
    const res = await fetch(WEBHOOK_ENDPOINT_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { endpoint: string; active: boolean }
    return data.endpoint
  }

  async function testWebhook(): Promise<{ success: boolean; statusCode?: number; reason?: string }> {
    const res = await fetch(WEBHOOK_TEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[line] Webhook test request failed (${res.status}): ${body}`)
      return { success: false }
    }
    const data = await res.json() as { success: boolean; statusCode: number; reason: string }
    return data
  }

  return {
    pushMessage,
    pushRawMessages,
    getMessageContent,
    downloadExternalContent,
    setWebhookUrl,
    getWebhookUrl,
    testWebhook,
  }
}

export type LineClient = ReturnType<typeof createLineClient>