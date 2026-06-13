import { create } from 'zustand'
import { storage } from '@/lib/storage'

export type ShortcutAction = 'playPause' | 'chat' | 'next' | 'prev' | 'search' | 'fullscreen' | 'queue' | 'escape'

export type ShortcutMap = Record<ShortcutAction, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  playPause: ' ',
  chat: 'x',
  next: 'c',
  prev: 'z',
  search: 's',
  fullscreen: 'f',
  queue: 'v',
  escape: 'Escape',
}

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  playPause: '播放 / 暂停',
  chat: '打开 / 关闭聊天',
  next: '下一首',
  prev: '上一首',
  search: '打开搜索',
  fullscreen: '播放界面全屏',
  queue: '打开 / 关闭播放列表',
  escape: '返回 / 打开设置',
}

function normalizeKey(key: string): string {
  if (key === 'Spacebar') return ' '
  if (key.length === 1) return key.toLowerCase()
  return key
}

export function formatShortcutKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'Escape') return 'Esc'
  if (key.length === 1) return key.toUpperCase()
  return key
}

interface ShortcutStore {
  shortcuts: ShortcutMap
  setShortcut: (action: ShortcutAction, key: string) => void
  resetShortcuts: () => void
  findAction: (key: string) => ShortcutAction | null
}

export const useShortcutStore = create<ShortcutStore>((set, get) => ({
  shortcuts: storage.getShortcuts(DEFAULT_SHORTCUTS),
  setShortcut: (action, key) => {
    const normalized = normalizeKey(key)
    const next = { ...get().shortcuts }
    for (const [existingAction, existingKey] of Object.entries(next) as [ShortcutAction, string][]) {
      if (existingAction !== action && normalizeKey(existingKey) === normalized) {
        next[existingAction] = ''
      }
    }
    next[action] = normalized
    storage.setShortcuts(next)
    set({ shortcuts: next })
  },
  resetShortcuts: () => {
    storage.setShortcuts(DEFAULT_SHORTCUTS)
    set({ shortcuts: DEFAULT_SHORTCUTS })
  },
  findAction: (key) => {
    const normalized = normalizeKey(key)
    const entry = (Object.entries(get().shortcuts) as [ShortcutAction, string][]).find(([, shortcut]) => shortcut && normalizeKey(shortcut) === normalized)
    return entry?.[0] ?? null
  },
}))
