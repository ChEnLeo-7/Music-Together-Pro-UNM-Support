import { create } from 'zustand'
import type { Track } from '@music-together/shared'
import type { LyricLine as AMLLLyricLine } from '@applemusic-like-lyrics/core'
import { storage } from '@/lib/storage'
import { publishLyricTime } from '@/lib/lyricClock'

interface PlayerStore {
  loadedTrack: Track | null
  isPlaying: boolean
  currentTime: number
  lyricDisplayTimeMs: number
  lyricMotionSuspended: boolean
  lyricFrameSuspended: boolean
  suppressNextRemoteSeekUntil: number
  suppressNextRemoteSeekTarget: number | null
  duration: number
  volume: number
  lyric: string
  tlyric: string
  ttmlLines: AMLLLyricLine[] | null
  lyricLoading: boolean
  syncDrift: number
  localSeek: ((time: number) => void) | null

  setLoadedTrack: (track: Track | null) => void
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number, isSeek?: boolean) => void
  setLyricDisplayTimeMs: (timeMs: number) => void
  setLyricMotionSuspended: (suspended: boolean) => void
  setLyricFrameSuspended: (suspended: boolean) => void
  suppressNextRemoteSeek: (durationMs?: number, targetTime?: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setLyric: (lyric: string, tlyric?: string) => void
  setTtmlLines: (lines: AMLLLyricLine[] | null) => void
  setLyricLoading: (loading: boolean) => void
  setSyncDrift: (drift: number) => void
  setLocalSeek: (seek: ((time: number) => void) | null) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  loadedTrack: null,
  isPlaying: false,
  currentTime: 0,
  lyricDisplayTimeMs: 0,
  lyricMotionSuspended: false,
  lyricFrameSuspended: false,
  suppressNextRemoteSeekUntil: 0,
  suppressNextRemoteSeekTarget: null,
  duration: 0,
  volume: storage.getVolume(),
  lyric: '',
  tlyric: '',
  ttmlLines: null,
  lyricLoading: false,
  syncDrift: 0,
  localSeek: null,

  setLoadedTrack: (track) => set({ loadedTrack: track }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time, isSeek = true) => {
    const timeMs = Math.round(time * 1000)
    publishLyricTime(timeMs, isSeek)
    set({ currentTime: time, lyricDisplayTimeMs: timeMs })
  },
  setLyricDisplayTimeMs: (timeMs) => set({ lyricDisplayTimeMs: Math.max(0, Math.round(timeMs)) }),
  setLyricMotionSuspended: (suspended) => set({ lyricMotionSuspended: suspended }),
  setLyricFrameSuspended: (suspended) => set({ lyricFrameSuspended: suspended }),
  suppressNextRemoteSeek: (durationMs = 500, targetTime) =>
    set({ suppressNextRemoteSeekUntil: Date.now() + durationMs, suppressNextRemoteSeekTarget: targetTime ?? null }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => {
    storage.setVolume(volume)
    set({ volume })
  },
  setLyric: (lyric, tlyric) => set({ lyric, tlyric: tlyric ?? '' }),
  setTtmlLines: (lines) => set({ ttmlLines: lines }),
  setLyricLoading: (loading) => set({ lyricLoading: loading }),
  setSyncDrift: (drift) => set({ syncDrift: drift }),
  setLocalSeek: (seek) => set({ localSeek: seek }),
  reset: () => {
    publishLyricTime(0, true)
    set({
      loadedTrack: null,
      isPlaying: false,
      currentTime: 0,
      lyricDisplayTimeMs: 0,
      lyricMotionSuspended: false,
      lyricFrameSuspended: false,
      suppressNextRemoteSeekUntil: 0,
      suppressNextRemoteSeekTarget: null,
      duration: 0,
      lyric: '',
      tlyric: '',
      ttmlLines: null,
      lyricLoading: false,
      syncDrift: 0,
    })
  },
}))
