export interface PlaybackAnchor {
  currentTime: number
  serverTimestamp: number
  isPlaying: boolean
  duration?: number
}

export function projectPlaybackPosition(anchor: PlaybackAnchor, serverNow: number): number {
  const currentTime = Number.isFinite(anchor.currentTime) ? Math.max(0, anchor.currentTime) : 0
  const elapsed = anchor.isPlaying && Number.isFinite(serverNow) && Number.isFinite(anchor.serverTimestamp)
    ? Math.max(0, serverNow - anchor.serverTimestamp) / 1000
    : 0
  const projected = currentTime + elapsed
  return Number.isFinite(anchor.duration) && anchor.duration! > 0
    ? Math.min(projected, anchor.duration!)
    : projected
}
