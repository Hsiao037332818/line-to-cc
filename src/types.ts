// 訊息根結構
export interface LineWebhookBody {
  destination: string
  events: LineEvent[]
}

// LineEvent 包含可能的 message 類型
export interface LineEvent {
  type: string
  webhookEventId: string
  timestamp: number
  source: LineSource
  replyToken?: string
  message?: LineMessage
  deliveryContext?: {
    isRedelivery: boolean
  }
}

export interface LineSource {
  type: 'user' | 'group' | 'room'
  userId?: string
  groupId?: string
  roomId?: string
}

// LineMessage 是 union type，涵蓋 LINE 的 7 種訊息類型
export type LineMessage =
  | LineTextMessage
  | LineImageMessage
  | LineVideoMessage
  | LineAudioMessage
  | LineFileMessage
  | LineStickerMessage
  | LineLocationMessage
  | LineUnknownMessage

interface LineMessageBase {
  type: string
  id: string
}

export interface LineTextMessage extends LineMessageBase {
  type: 'text'
  text: string
}

export interface LineImageMessage extends LineMessageBase {
  type: 'image'
  contentProvider: { type: 'line' } | { type: 'external'; originalContentUrl: string; previewImageUrl: string }
  imageSet?: { id: string; index: number; total?: number }
}

export interface LineVideoMessage extends LineMessageBase {
  type: 'video'
  duration: number
  contentProvider: { type: 'line' } | { type: 'external'; originalContentUrl: string; previewImageUrl: string }
}

export interface LineAudioMessage extends LineMessageBase {
  type: 'audio'
  duration: number
  contentProvider: { type: 'line' } | { type: 'external'; originalContentUrl: string }
}

export interface LineFileMessage extends LineMessageBase {
  type: 'file'
  fileName: string
  fileSize: number
}

export interface LineStickerMessage extends LineMessageBase {
  type: 'sticker'
  packageId: string
  stickerId: string
  stickerResourceType: string
  keywords?: string[]
  text?: string  // 訊息貼圖內含的文字
}

export interface LineLocationMessage extends LineMessageBase {
  type: 'location'
  title?: string
  address?: string
  latitude: number
  longitude: number
}

export interface LineUnknownMessage extends LineMessageBase {
  type: string
}

// Event variants
export interface LineMessageEvent extends LineEvent {
  type: 'message'
  message: LineMessage
  source: LineSource & { userId: string }
}

// Type guards
export function isMessageEvent(event: LineEvent): event is LineMessageEvent {
  return event.type === 'message' && !!event.message && typeof event.source.userId === 'string'
}

export function isTextMessage(msg: LineMessage): msg is LineTextMessage {
  return msg.type === 'text'
}

export function isImageMessage(msg: LineMessage): msg is LineImageMessage {
  return msg.type === 'image'
}

export function isVideoMessage(msg: LineMessage): msg is LineVideoMessage {
  return msg.type === 'video'
}

export function isAudioMessage(msg: LineMessage): msg is LineAudioMessage {
  return msg.type === 'audio'
}

export function isFileMessage(msg: LineMessage): msg is LineFileMessage {
  return msg.type === 'file'
}

export function isStickerMessage(msg: LineMessage): msg is LineStickerMessage {
  return msg.type === 'sticker'
}

export function isLocationMessage(msg: LineMessage): msg is LineLocationMessage {
  return msg.type === 'location'
}

// 媒體類訊息（要下載 binary 的）
export type LineMediaMessage = LineImageMessage | LineVideoMessage | LineAudioMessage | LineFileMessage

export function isMediaMessage(msg: LineMessage): msg is LineMediaMessage {
  return msg.type === 'image' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'file'
}

// 保留向後相容的 isTextMessageEvent
export interface LineTextMessageEvent extends LineEvent {
  type: 'message'
  source: LineSource & { userId: string }
  message: LineTextMessage
}

export function isTextMessageEvent(event: LineEvent): event is LineTextMessageEvent {
  return isMessageEvent(event) && isTextMessage(event.message)
}

// 以下維持原樣
export interface AccessConfig {
  mode: 'pairing' | 'allowlist' | 'disabled'
  allowed_users: AllowedUser[]
}

export interface AllowedUser {
  id: string
  name: string
  paired_at: string
}

export interface PairingState {
  userId: string
  code: string
  createdAt: number
  attempts: number
}