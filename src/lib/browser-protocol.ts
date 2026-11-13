export const BROWSER_HOST_DEFAULT_PORT = 9330
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const

export type BrowserPoint = { x: number; y: number }
export type BrowserTarget = BrowserPoint | { ref: string }
export type BrowserMouseButton = 'left' | 'right' | 'middle'
export type BrowserModifier = 'shift' | 'ctrl' | 'alt' | 'meta'
export type BrowserCredentialField = 'username' | 'email' | 'password' | 'totp'

export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'history'; direction: 'back' | 'forward' | 'reload' }
  | { type: 'screenshot' }
  | { type: 'zoom'; region: [number, number, number, number] }
  | { type: 'click'; target: BrowserTarget; button: BrowserMouseButton; count: 1 | 2 | 3; modifiers?: BrowserModifier[] }
  | { type: 'hover'; target: BrowserTarget }
  | { type: 'drag'; path: BrowserPoint[] }
  | { type: 'mouse'; event: 'down' | 'up' | 'move'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'scroll_to'; ref: string }
  | { type: 'type'; text: string }
  | { type: 'key'; keys: string[]; repeat?: number; holdMs?: number }
  | { type: 'wait'; ms: number }
  | { type: 'read_page'; filter: 'interactive' | 'all'; depth?: number; ref?: string }
  | { type: 'find'; query: string }
  | { type: 'page_text' }
  | { type: 'form_input'; ref: string; value: string | number | boolean }
  | { type: 'file_upload'; target: BrowserTarget; fileIds: string[] }
  | { type: 'credential_list'; query: string }
  | { type: 'credential_fill'; credentialId: string; field: BrowserCredentialField; target: BrowserTarget }
  | { type: 'tab_new'; url?: string }
  | { type: 'tab_switch'; tabId: string }
  | { type: 'tab_close'; tabId: string }
  | { type: 'tab_list' }

export interface BrowserTab {
  id: string
  title: string
  url: string
}

export interface BrowserState {
  tabs: BrowserTab[]
  activeTabId: string
  url: string
  viewport: { width: number; height: number }
  localNetworkRequests?: string[]
}

export interface BrowserImage {
  base64: string
  mediaType: 'image/jpeg' | 'image/png'
}

export type BrowserActionOutcome = { ok: true; text?: string; image?: BrowserImage; status?: number } | { ok: false; error: string }

export type BrowserActionResult = BrowserActionOutcome & { state: BrowserState }

export interface BrowserActionsRequest {
  actions: BrowserAction[]
  tabId?: string
}

export interface BrowserActionsResponse {
  results: BrowserActionResult[]
}

export interface BrowserSessionResponse {
  sessionId: string
  state: BrowserState
}

export interface BrowserStagedFile {
  id: string
  name: string
  size: number
}

export interface BrowserHostHealth {
  version: string
  browserRunning: boolean
  busySessionId: string | null
  protonPassConfigured?: boolean
}

export type BrowserLiveInput = { type: 'pointer'; event: 'down' | 'up' | 'move'; x: number; y: number; button?: BrowserMouseButton } | { type: 'tap'; x: number; y: number } | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number } | { type: 'key'; key: string } | { type: 'text'; text: string }

export type BrowserUserRequestKind = 'login' | 'captcha' | 'confirm' | 'local_network'

export interface BrowserUserRequest {
  id?: string
  kind: BrowserUserRequestKind
  message: string
  url: string
}

export type BrowserUserOutcome = 'done' | 'declined'
