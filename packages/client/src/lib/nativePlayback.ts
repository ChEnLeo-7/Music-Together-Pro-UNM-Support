import type { Track } from '@music-together/shared'

export interface NativePlaybackEvent {
  type: 'load' | 'play' | 'pause' | 'end' | 'error'
  trackId?: string
  source?: string
  duration?: number
  message?: string
}

interface NativePlaybackBridge {
  configureSession(config: string): void
  loadSource(source: string, mimeType: string, metadata: string): void
  play(): void
  pause(): void
  seek(positionSeconds: number): void
  getPosition(): number
  getDuration(): number
  isPlaying(): boolean
  setVolume(volume: number): void
  getVolume(): number
  setRate(rate: number): void
  getRate(): number
  getTrackId(): string
  releaseSource(source: string): void
  releaseSession(): void
}

declare global {
  interface Window {
    MusicTogetherAndroid?: NativePlaybackBridge
  }
}

export const NATIVE_PLAYBACK_EVENT = 'music-together-native-playback'

export function getNativePlaybackBridge(): NativePlaybackBridge | null {
  return window.MusicTogetherAndroid ?? null
}

export function configureNativePlayback(config: {
  serverUrl: string
  roomId: string
  userId: string
  nickname: string
  rejoinToken?: string
}): void {
  getNativePlaybackBridge()?.configureSession(JSON.stringify(config))
}

export function releaseNativePlayback(): void {
  getNativePlaybackBridge()?.releaseSession()
}

export function nativeTrackMetadata(track: Track): string {
  return JSON.stringify({
    id: track.id,
    title: track.title,
    artist: track.artist.join(' / '),
    album: track.album,
    cover: track.cover,
  })
}
