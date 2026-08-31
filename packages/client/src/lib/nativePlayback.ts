import type { Track } from '@music-together/shared'

export interface NativePlaybackEvent {
  type: 'load' | 'play' | 'pause' | 'seek' | 'snapshot' | 'end' | 'error'
  trackId?: string
  source?: string
  duration?: number
  position?: number
  message?: string
  isPlaying?: boolean
  volume?: number
  rate?: number
  playbackRevision?: number
}

export interface NativePlaybackSnapshot {
  position: number
  duration: number
  isPlaying: boolean
  volume: number
  rate: number
  trackId: string
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
  getPlaybackSnapshot(): string
  setPlayerFullscreen(enabled: boolean): void
  releaseSource(source: string): void
  releaseSession(): void
}

declare global {
  interface Window {
    MusicTogetherAndroid?: NativePlaybackBridge
  }
}

export const NATIVE_PLAYBACK_EVENT = 'music-together-native-playback'
export const NATIVE_FULLSCREEN_EXIT_EVENT = 'music-together-native-fullscreen-exit'

export function getNativePlaybackBridge(): NativePlaybackBridge | null {
  return window.MusicTogetherAndroid ?? null
}

export function configureNativePlayback(config: {
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
