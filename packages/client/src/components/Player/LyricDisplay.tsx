import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSocketContext } from '@/providers/SocketProvider'
import { AbilityContext } from '@/providers/AbilityProvider'
import { cn } from '@/lib/utils'
import { getLyricTime, subscribeLyricTime } from '@/lib/lyricClock'
import type { LyricLine as AMLLLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import { EVENTS } from '@music-together/shared'
import '@applemusic-like-lyrics/core/style.css'
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  getActiveLineIndices,
  mergeLrcTextByTime,
  parseLrcTimeline,
  toAmllTimeline,
  type LrcTimelineEntry,
} from '@/lib/lyricTimeline'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const
const SEEK_HIGHLIGHT_EPSILON_MS = 8
const DUPLICATE_SEEK_SUPPRESS_MS = 600

interface LyricPlayerViewProps {
  amllLines: AMLLLyricLine[]
  alignAnchor: 'top' | 'center' | 'bottom'
  alignPosition: number
  enableSpring: boolean
  enableBlur: boolean
  enableScale: boolean
  hidePassedLines: boolean
  isPlaying: boolean
  lyricMotionSuspended: boolean
  lyricFrameSuspended: boolean
  lyricPlayerRef: React.RefObject<LyricPlayerRef | null>
  onLyricLineClick?: (event: LyricLineMouseEvent) => void
}

function mergeLyrics(original: string, translated: string): LrcTimelineEntry[] {
  const origLines = parseLrcTimeline(original)
  if (origLines.length === 0) return []

  const result: LrcTimelineEntry[] = origLines.map((line) => ({ ...line }))

  if (!translated) return result

  const transLines = parseLrcTimeline(translated)
  if (transLines.length === 0) return result

  mergeLrcTextByTime(
    result,
    (line) => line.timeMs,
    translated,
    (line, text) => {
      line.translation = text
    },
  )

  return result
}

function LyricPlayerView({
  amllLines,
  alignAnchor,
  alignPosition,
  enableSpring,
  enableBlur,
  enableScale,
  hidePassedLines,
  isPlaying,
  lyricMotionSuspended,
  lyricFrameSuspended,
  lyricPlayerRef,
  onLyricLineClick,
}: LyricPlayerViewProps) {
  const shouldFreezeTime = lyricMotionSuspended || lyricFrameSuspended

  useEffect(() => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    player.setCurrentTime(getLyricTime().timeMs, true)
    void player.calcLayout(true)
  }, [amllLines, alignAnchor, alignPosition, hidePassedLines, lyricPlayerRef])

  useEffect(() => {
    if (shouldFreezeTime) return

    let attachFrame: number | null = null
    let unsubscribe: (() => void) | null = null
    let disposed = false

    const attachClock = () => {
      if (disposed) return
      const player = lyricPlayerRef.current?.lyricPlayer
      if (!player) {
        attachFrame = requestAnimationFrame(attachClock)
        return
      }

      const latest = getLyricTime()
      player.setCurrentTime(latest.timeMs, true)
      unsubscribe = subscribeLyricTime(({ timeMs, isSeek }) => {
        player.setCurrentTime(timeMs, isSeek)
      })
    }

    attachClock()
    return () => {
      disposed = true
      if (attachFrame !== null) cancelAnimationFrame(attachFrame)
      unsubscribe?.()
    }
  }, [lyricPlayerRef, shouldFreezeTime])

  return (
    <LyricPlayer
      ref={lyricPlayerRef}
      lyricLines={amllLines}
      playing={isPlaying && !shouldFreezeTime}
      alignAnchor={alignAnchor}
      alignPosition={hidePassedLines ? Math.max(0, alignPosition - 0.16) : alignPosition}
      enableSpring={enableSpring}
      enableBlur={enableBlur}
      enableScale={enableScale}
      hidePassedLines={hidePassedLines}
      onLyricLineClick={onLyricLineClick}
      disabled={lyricFrameSuspended}
      style={FULL_SIZE_STYLE}
    />
  )
}

export function LyricDisplay() {
  const { socket } = useSocketContext()
  const ability = useContext(AbilityContext)
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)
  const lyricLoading = usePlayerStore((s) => s.lyricLoading)
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)

  const alignAnchor = useSettingsStore((s) => s.lyricAlignAnchor)
  const alignPosition = useSettingsStore((s) => s.lyricAlignPosition)
  const enableSpring = useSettingsStore((s) => s.lyricEnableSpring)
  const enableBlur = useSettingsStore((s) => s.lyricEnableBlur)
  const enableScale = useSettingsStore((s) => s.lyricEnableScale)
  const hidePassedLines = useSettingsStore((s) => s.lyricHidePassedLines)
  const clickSeekEnabled = useSettingsStore((s) => s.lyricClickSeekEnabled)
  const clickSeekActive = clickSeekEnabled && ability.can('seek', 'Player')
  const clickSeekActiveRef = useRef(clickSeekActive)
  useEffect(() => {
    clickSeekActiveRef.current = clickSeekActive
  }, [clickSeekActive])
  const fontWeight = useSettingsStore((s) => s.lyricFontWeight)
  const fontSize = useSettingsStore((s) => s.lyricFontSize)
  const translationFontSize = useSettingsStore((s) => s.lyricTranslationFontSize)
  const romanFontSize = useSettingsStore((s) => s.lyricRomanFontSize)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const lyricMotionSuspended = usePlayerStore((s) => s.lyricMotionSuspended)
  const lyricFrameSuspended = usePlayerStore((s) => s.lyricFrameSuspended)

  // LRC 解析（仅在没有 TTML 时使用）
  const lrcLines = useMemo(() => mergeLyrics(lyric, tlyric), [lyric, tlyric])
  const lrcAmllLines = useMemo(() => toAmllTimeline(lrcLines), [lrcLines])

  // TTML 优先，LRC 回退
  const amllLines = ttmlLines ?? lrcAmllLines
  const hasLyrics = ttmlLines ? ttmlLines.length > 0 : lrcLines.length > 0
  const lyricPlayerRef = useRef<LyricPlayerRef | null>(null)
  const lastSeekRef = useRef<{ lineIndex: number; at: number } | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const keyboardLineIndexRef = useRef(-1)

  useEffect(() => {
    keyboardLineIndexRef.current = -1
  }, [amllLines])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const effectiveEnableSpring = enableSpring && !prefersReducedMotion

  const alignPlayerToLine = useCallback((timeMs: number) => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    player.setCurrentTime(timeMs, true)
    player.resetScroll()
    void player.calcLayout(true)
  }, [])

  const seekToLineIndex = useCallback(
    (lineIndex: number) => {
      if (!clickSeekActiveRef.current) return
      if (amllLines.length === 0) return
      const targetIndex = Math.min(amllLines.length - 1, Math.max(0, lineIndex))
      const now = Date.now()
      if (lastSeekRef.current?.lineIndex === targetIndex && now - lastSeekRef.current.at < DUPLICATE_SEEK_SUPPRESS_MS)
        return
      lastSeekRef.current = { lineIndex: targetIndex, at: now }

      const lyricTargetMs = Math.max(0, amllLines[targetIndex].startTime)
      const displayTargetMs = lyricTargetMs + SEEK_HIGHLIGHT_EPSILON_MS
      const displayTargetTime = displayTargetMs / 1000

      const playerState = usePlayerStore.getState()
      playerState.suppressNextRemoteSeek(1000, displayTargetTime)
      if (playerState.localSeek) {
        playerState.localSeek(displayTargetTime)
      } else {
        playerState.setCurrentTime(displayTargetTime)
      }
      socket.emit(EVENTS.PLAYER_SEEK, { currentTime: displayTargetTime })
    },
    [amllLines, socket],
  )

  const handleLyricClick = useCallback(
    (event: LyricLineMouseEvent) => {
      if (clickSeekActive) seekToLineIndex(event.lineIndex)
    },
    [clickSeekActive, seekToLineIndex],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!clickSeekActive || amllLines.length === 0) return
      const active = getActiveLineIndices(amllLines, usePlayerStore.getState().lyricDisplayTimeMs)[0] ?? 0
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const base = keyboardLineIndexRef.current >= 0 ? keyboardLineIndexRef.current : active
        keyboardLineIndexRef.current = Math.max(
          0,
          Math.min(amllLines.length - 1, base + (event.key === 'ArrowUp' ? -1 : 1)),
        )
        alignPlayerToLine(amllLines[keyboardLineIndexRef.current].startTime)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        seekToLineIndex(keyboardLineIndexRef.current >= 0 ? keyboardLineIndexRef.current : active)
      }
    },
    [alignPlayerToLine, amllLines, clickSeekActive, seekToLineIndex],
  )

  if (!hasLyrics) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xl text-white/50">{lyricLoading ? '歌词加载中...' : '暂无歌词'}</p>
      </div>
    )
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={clickSeekActive ? 0 : undefined}
      role={clickSeekActive ? 'application' : undefined}
      aria-label={clickSeekActive ? '歌词，使用上下方向键选择，回车跳转' : undefined}
      className={cn(
        'amll-container h-full w-full',
        clickSeekActive && 'cursor-pointer',
        !effectiveEnableSpring && 'amll-spring-off',
      )}
      style={
        {
          fontWeight,
          '--amll-lp-font-size': `clamp(16px, calc(min(5vh, 7vw) * ${fontSize / 100}), 80px)`,
          '--amll-translated-font-size': `${translationFontSize / 100}em`,
          '--amll-roman-font-size': `${romanFontSize / 100}em`,
        } as React.CSSProperties
      }
    >
      <LyricPlayerView
        amllLines={amllLines}
        alignAnchor={alignAnchor}
        alignPosition={alignPosition}
        enableSpring={effectiveEnableSpring}
        enableBlur={enableBlur && !prefersReducedMotion}
        enableScale={enableScale && !prefersReducedMotion}
        hidePassedLines={hidePassedLines}
        isPlaying={isPlaying}
        lyricMotionSuspended={lyricMotionSuspended}
        lyricFrameSuspended={lyricFrameSuspended}
        lyricPlayerRef={lyricPlayerRef}
        onLyricLineClick={clickSeekActive ? handleLyricClick : undefined}
      />
    </div>
  )
}
