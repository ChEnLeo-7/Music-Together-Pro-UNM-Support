import { useCallback, useEffect, useRef } from 'react'
import { Howl, Howler } from 'howler'
import type { Track } from '@music-together/shared'
import { SERVER_URL } from '@/lib/config'
import { usePlayerStore } from '@/stores/playerStore'
import {
  CURRENT_TIME_THROTTLE_MS,
  HOWL_UNMUTE_DELAY_SEEK_MS,
  HOWL_UNMUTE_DELAY_DEFAULT_MS,
  LOAD_COMPENSATION_THRESHOLD_S,
  MAX_LOAD_COMPENSATION_S,
} from '@/lib/constants'
import { toast } from 'sonner'

/** Max wait (ms) for Howler `unlock` event before giving up and skipping */
const PLAY_ERROR_TIMEOUT_MS = 3000

/** If playback reports playing() but currentTime doesn't advance for this
 *  many milliseconds, treat it as stalled (network drop mid-stream). */
const STALLED_TIMEOUT_MS = 8000

export interface AudioEngine {
  play(id?: number): number
  pause(id?: number): unknown
  seek(): number
  seek(time: number): unknown
  duration(): number
  volume(): number
  volume(value: number): unknown
  fade(from: number, to: number, duration: number): unknown
  playing(id?: number): boolean
  unload(): unknown
  rate(): number
  rate(value: number): unknown
  once(event: string, fn: (id?: number, message?: unknown) => void): unknown
  load(): unknown
}

interface NativeAudioOptions {
  src: string
  type?: string
  volume: number
  onload: () => void
  onplay: () => void
  onpause: () => void
  onend: () => void
  onloaderror: (id: number | null, message: unknown) => void
  onplayerror: (id: number, message: unknown) => void
}

class NativeAudioEngine implements AudioEngine {
  private readonly audio: HTMLAudioElement
  private readonly soundId = 1
  private readonly onceHandlers = new Map<string, Array<(id?: number, message?: unknown) => void>>()
  private fadeFrame = 0
  private loaded = false
  private destroyed = false

  constructor(private readonly options: NativeAudioOptions) {
    this.audio = document.createElement('audio')
    this.audio.preload = 'auto'
    this.audio.volume = options.volume

    const source = document.createElement('source')
    source.src = options.src
    if (options.type) source.type = options.type
    this.audio.appendChild(source)

    this.audio.addEventListener('loadedmetadata', this.handleLoaded)
    this.audio.addEventListener('canplay', this.handleLoaded)
    this.audio.addEventListener('play', this.handlePlay)
    this.audio.addEventListener('pause', this.handlePause)
    this.audio.addEventListener('ended', this.handleEnded)
    this.audio.addEventListener('error', this.handleError)
    this.audio.load()
  }

  play(): number {
    const promise = this.audio.play()
    if (promise) {
      promise.catch((err) => {
        if (!this.destroyed) this.options.onplayerror(this.soundId, err)
      })
    }
    return this.soundId
  }

  pause(): this {
    this.audio.pause()
    return this
  }

  seek(): number
  seek(time: number): this
  seek(time?: number): number | this {
    if (typeof time !== 'number') return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0
    this.audio.currentTime = Math.max(0, time)
    return this
  }

  duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  volume(): number
  volume(value: number): this
  volume(value?: number): number | this {
    if (typeof value !== 'number') return this.audio.volume
    this.audio.volume = Math.max(0, Math.min(1, value))
    return this
  }

  fade(from: number, to: number, duration: number): this {
    cancelAnimationFrame(this.fadeFrame)
    const startedAt = performance.now()
    this.audio.volume = Math.max(0, Math.min(1, from))
    const tick = (now: number) => {
      if (this.destroyed) return
      const progress = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration)
      this.audio.volume = from + (to - from) * progress
      if (progress < 1) {
        this.fadeFrame = requestAnimationFrame(tick)
      }
    }
    this.fadeFrame = requestAnimationFrame(tick)
    return this
  }

  playing(): boolean {
    return !this.audio.paused && !this.audio.ended
  }

  unload(): this {
    this.destroyed = true
    cancelAnimationFrame(this.fadeFrame)
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.querySelectorAll('source').forEach((source) => source.remove())
    this.audio.load()
    return this
  }

  rate(): number
  rate(value: number): this
  rate(value?: number): number | this {
    if (typeof value !== 'number') return this.audio.playbackRate
    this.audio.playbackRate = value
    return this
  }

  once(event: string, fn: (id?: number, message?: unknown) => void): this {
    const handlers = this.onceHandlers.get(event) ?? []
    handlers.push(fn)
    this.onceHandlers.set(event, handlers)
    return this
  }

  load(): this {
    this.audio.load()
    return this
  }

  private emitOnce(event: string, message?: unknown) {
    const handlers = this.onceHandlers.get(event)
    if (!handlers?.length) return
    this.onceHandlers.delete(event)
    for (const handler of handlers) handler(this.soundId, message)
  }

  private handleLoaded = () => {
    if (this.destroyed || this.loaded) return
    this.loaded = true
    this.options.onload()
  }

  private handlePlay = () => {
    if (this.destroyed) return
    this.emitOnce('play')
    this.options.onplay()
  }

  private handlePause = () => {
    if (this.destroyed || this.audio.ended) return
    this.options.onpause()
  }

  private handleEnded = () => {
    if (this.destroyed) return
    this.options.onend()
  }

  private handleError = () => {
    if (this.destroyed) return
    this.options.onloaderror(this.soundId, this.audio.error?.code ?? 'native-audio-error')
  }
}

function resolveStreamUrl(url: string): string {
  return url.startsWith('/') ? `${SERVER_URL}${url}` : url
}

function inferAudioFormat(track: Track, resolvedUrl: string): string | undefined {
  if (track.streamQuality === 'netease_dolby') return 'dolby'

  try {
    const parsed = new URL(resolvedUrl, window.location.href)
    const proxiedUrl = parsed.searchParams.get('url')
    const target = proxiedUrl ? new URL(proxiedUrl) : parsed
    const ext = target.pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
    if (!ext) return undefined
    if (ext === 'mpeg') return 'mp3'
    if (ext === 'oga') return 'ogg'
    return ext
  } catch {
    return undefined
  }
}

function syncHowlerDolbyCodecSupport(audioFormat: string | undefined): void {
  if (audioFormat !== 'dolby' || typeof document === 'undefined') return

  const audio = document.createElement('audio')
  const probe = audio.canPlayType('audio/mp4; codecs="ec-3"') || audio.canPlayType('audio/mp4; codecs="ac-3"')
  if (!probe) return

  const howlerWithCodecs = Howler as unknown as { _codecs?: Record<string, boolean> }
  if (howlerWithCodecs._codecs) {
    howlerWithCodecs._codecs.dolby = true
  }
}

/**
 * Manages a Howl audio instance with two-phase loading strategy:
 * Phase 1: Create Howl with volume=0 (silent)
 * Phase 2: onload → seek to target → delay → fade-in unmute
 */
export function useHowl(onTrackEnd: () => void, onTrackLoadFailure?: (track: Track) => boolean) {
  const howlRef = useRef<AudioEngine | null>(null)
  const soundIdRef = useRef<number | undefined>(undefined)
  const animFrameRef = useRef<number>(0)
  const syncReadyRef = useRef(false)
  const unmuteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTimeUpdateRef = useRef(0)
  const stalledRef = useRef<{ lastSeek: number; since: number }>({ lastSeek: -1, since: 0 })
  const trackTitleRef = useRef<string>('')
  const retryRef = useRef(false)

  // Use selectors for the one reactive value we need (volume sync effect)
  const volume = usePlayerStore((s) => s.volume)

  // Throttled time update loop with stalled detection
  const startTimeUpdate = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    stalledRef.current = { lastSeek: -1, since: 0 }
    const update = () => {
      if (howlRef.current && howlRef.current.playing()) {
        const now = performance.now()
        if (now - lastTimeUpdateRef.current >= CURRENT_TIME_THROTTLE_MS) {
          lastTimeUpdateRef.current = now
          const seekVal = howlRef.current.seek() as number
          usePlayerStore.getState().setCurrentTime(seekVal)

          // Stalled detection: if currentTime hasn't moved for STALLED_TIMEOUT_MS
          // while playing() is true, the stream likely broke mid-playback.
          const st = stalledRef.current
          if (Math.abs(seekVal - st.lastSeek) < 0.05) {
            if (st.since > 0 && now - st.since > STALLED_TIMEOUT_MS) {
              console.warn('Playback stalled, skipping track')
              toast.error('播放中断，已跳到下一首')
              stalledRef.current = { lastSeek: -1, since: 0 }
              onTrackEnd()
              return
            }
            // still stalled but not timed out yet — keep since
          } else {
            // time moved — reset stalled tracker
            stalledRef.current = { lastSeek: seekVal, since: now }
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(update)
    }
    animFrameRef.current = requestAnimationFrame(update)
  }, [onTrackEnd])

  const stopTimeUpdate = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
  }, [])

  // Load and play a track
  const loadTrack = useCallback(
    (track: Track, seekTo?: number, autoPlay = true) => {
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current)
        unmuteTimerRef.current = null
      }
      // Clear any pending play-error timeout from the previous track so it
      // doesn't fire onTrackEnd() and skip the new track being loaded.
      if (playErrorTimerRef.current) {
        clearTimeout(playErrorTimerRef.current)
        playErrorTimerRef.current = null
      }

      if (howlRef.current) {
        try {
          howlRef.current.unload()
        } catch {
          /* ignore */
        }
        howlRef.current = null
        stopTimeUpdate()
      }

      syncReadyRef.current = false
      soundIdRef.current = undefined
      trackTitleRef.current = track.title
      retryRef.current = false

      if (!track.streamUrl) return

      const loadStartTime = Date.now()
      const currentVolume = usePlayerStore.getState().volume
      const resolvedUrl = resolveStreamUrl(track.streamUrl)
      const audioFormat = inferAudioFormat(track, resolvedUrl)
      syncHowlerDolbyCodecSupport(audioFormat)
      console.info('Loading audio stream', {
        source: track.streamSource ?? track.source,
        quality: track.streamQuality,
        format: audioFormat,
      })

      let howl: AudioEngine
      const commonOptions = {
        onload: () => {
          if (howlRef.current !== howl) return // Stale instance guard
          const d = howl.duration()
          if (Number.isFinite(d) && d > 0) {
            usePlayerStore.getState().setDuration(d)
          }
          if (autoPlay) {
            if (seekTo && seekTo > 0) {
              // Update store immediately so AMLL lyrics jump to correct position
              usePlayerStore.getState().setCurrentTime(seekTo)
            }
            soundIdRef.current = howl.play()
            howl.once('play', () => {
              if (howlRef.current !== howl) return
              const elapsed = (Date.now() - loadStartTime) / 1000
              const seekTarget = (seekTo ?? 0) + Math.min(elapsed, MAX_LOAD_COMPENSATION_S)
              // seekTo > 0: must seek to correct position (+ loading compensation)
              // seekTo === 0: only compensate if loading took significant time
              if ((seekTo && seekTo > 0) || elapsed > LOAD_COMPENSATION_THRESHOLD_S) {
                howl.seek(seekTarget)
              }
            })
            unmuteTimerRef.current = setTimeout(
              () => {
                if (howlRef.current === howl) {
                  const latestVolume = usePlayerStore.getState().volume
                  howl.fade(0, latestVolume, 200) // Smooth fade-in with latest volume
                  syncReadyRef.current = true
                }
              },
              seekTo && seekTo > 0 ? HOWL_UNMUTE_DELAY_SEEK_MS : HOWL_UNMUTE_DELAY_DEFAULT_MS,
            )
          } else {
            if (seekTo && seekTo > 0) howl.seek(seekTo)
            howl.volume(currentVolume)
            usePlayerStore.getState().setCurrentTime(seekTo ?? 0)
            syncReadyRef.current = true
          }
        },
        onplay: () => {
          if (howlRef.current !== howl) return
          usePlayerStore.getState().setIsPlaying(true)
          const dur = howl.duration()
          if (Number.isFinite(dur) && dur > 0) {
            usePlayerStore.getState().setDuration(dur)
          }
          startTimeUpdate()
        },
        onpause: () => {
          if (howlRef.current !== howl) return
          usePlayerStore.getState().setIsPlaying(false)
          stopTimeUpdate()
        },
        onend: () => {
          if (howlRef.current !== howl) return
          usePlayerStore.getState().setIsPlaying(false)
          stopTimeUpdate()
          onTrackEnd()
        },
        onloaderror: (_id: number | null, msg: unknown) => {
          // If a newer track has been loaded, this Howl is stale — ignore.
          if (howlRef.current !== howl) return
          if (!retryRef.current) {
            retryRef.current = true
            console.warn('Howl load error, retrying:', msg)
            howl.load()
            return
          }
          retryRef.current = false
          if (onTrackLoadFailure?.(track)) return
          console.error('Howl load error (after retry):', msg)
          toast.error(`「${trackTitleRef.current}」加载失败，已跳到下一首`)
          onTrackEnd()
        },
        onplayerror: function (soundId: number) {
          // Try to recover via Howler unlock; give up after timeout
          if (playErrorTimerRef.current) clearTimeout(playErrorTimerRef.current)
          playErrorTimerRef.current = setTimeout(() => {
            playErrorTimerRef.current = null
            if (onTrackLoadFailure?.(track)) return
            console.warn('Howl unlock timeout, skipping track')
            toast.error('播放失败，已跳到下一首')
            onTrackEnd()
          }, PLAY_ERROR_TIMEOUT_MS)
          howl.once('unlock', () => {
            if (howlRef.current !== howl) return // Already switched or unmounted
            if (playErrorTimerRef.current) {
              clearTimeout(playErrorTimerRef.current)
              playErrorTimerRef.current = null
            }
            howl.play(soundId)
          })
        },
      }

      if (audioFormat === 'dolby') {
        howl = new NativeAudioEngine({
          src: resolvedUrl,
          type: 'audio/mp4; codecs="ec-3"',
          volume: 0,
          ...commonOptions,
        })
      } else {
        howl = new Howl({
          src: [resolvedUrl],
          html5: true,
          ...(audioFormat ? { format: [audioFormat] } : {}),
          volume: 0,
          ...commonOptions,
        }) as unknown as AudioEngine
      }

      howlRef.current = howl
      usePlayerStore.getState().setCurrentTrack(track)
    },
    [onTrackEnd, onTrackLoadFailure, startTimeUpdate, stopTimeUpdate],
  )

  // Volume sync
  useEffect(() => {
    if (howlRef.current && syncReadyRef.current) {
      howlRef.current.volume(volume)
    }
  }, [volume])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unmuteTimerRef.current) {
        clearTimeout(unmuteTimerRef.current)
        unmuteTimerRef.current = null
      }
      if (playErrorTimerRef.current) {
        clearTimeout(playErrorTimerRef.current)
        playErrorTimerRef.current = null
      }
      if (howlRef.current) {
        try {
          howlRef.current.unload()
        } catch {
          /* ignore */
        }
        howlRef.current = null
      }
      stopTimeUpdate()
    }
  }, [stopTimeUpdate])

  const localSeek = useCallback((time: number) => {
    if (howlRef.current) {
      const duration = howlRef.current.duration()
      const next = Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : Infinity, time))
      howlRef.current.seek(next)
      usePlayerStore.getState().setCurrentTime(next)
    }
  }, [])

  useEffect(() => {
    usePlayerStore.getState().setLocalSeek(localSeek)
    return () => usePlayerStore.getState().setLocalSeek(null)
  }, [localSeek])

  return { howlRef, soundIdRef, loadTrack, localSeek }
}
