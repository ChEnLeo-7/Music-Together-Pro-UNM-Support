export interface LyricClockUpdate {
  timeMs: number
  isSeek: boolean
}

type LyricClockListener = (update: LyricClockUpdate) => void

let snapshot: LyricClockUpdate = { timeMs: 0, isSeek: true }
const listeners = new Set<LyricClockListener>()

export function publishLyricTime(timeMs: number, isSeek = false): void {
  if (!Number.isFinite(timeMs)) return
  const next = { timeMs: Math.max(0, Math.round(timeMs)), isSeek }
  const unchangedPlaybackTick = !isSeek && !snapshot.isSeek && next.timeMs === snapshot.timeMs
  snapshot = next
  if (unchangedPlaybackTick) return
  listeners.forEach((listener) => listener(next))
}

export function getLyricTime(): LyricClockUpdate {
  return snapshot
}

export function subscribeLyricTime(listener: LyricClockListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasLyricTimeSubscribers(): boolean {
  return listeners.size > 0
}
