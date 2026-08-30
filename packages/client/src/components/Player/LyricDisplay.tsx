import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSocketContext } from '@/providers/SocketProvider'
import { AbilityContext } from '@/providers/AbilityProvider'
import { cn } from '@/lib/utils'
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
  type PointerEvent,
  type TouchEvent,
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
const HIDDEN_LINE_OPACITY = 0.01
const TAP_MOVE_TOLERANCE_PX = 10
const DUPLICATE_SEEK_SUPPRESS_MS = 600
const SPRING_OFF_CURRENT_CLASS = 'mt-lyric-current'
const SPRING_OFF_INACTIVE_CLASS = 'mt-lyric-inactive'

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

interface AmllInternalPlayer {
  currentLyricLineObjects?: Array<{ getElement: () => HTMLElement }>
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
  const lyricDisplayTimeMs = usePlayerStore((s) => s.lyricDisplayTimeMs)
  const shouldFreezeTime = lyricMotionSuspended || lyricFrameSuspended
  const displayedTimeMs = lyricDisplayTimeMs
  const springOffActiveLineKey = useMemo(
    () => (!enableSpring ? getActiveLineIndices(amllLines, displayedTimeMs).join(',') : ''),
    [amllLines, displayedTimeMs, enableSpring],
  )

  useEffect(() => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    void player.calcLayout(true)
  }, [amllLines, alignAnchor, alignPosition, hidePassedLines, lyricPlayerRef])

  useEffect(() => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    const clearClasses = () => {
      const objects = (player as unknown as AmllInternalPlayer).currentLyricLineObjects
      objects?.forEach((line) => {
        line.getElement().classList.remove(SPRING_OFF_CURRENT_CLASS, SPRING_OFF_INACTIVE_CLASS)
      })
    }
    if (enableSpring) {
      clearClasses()
      return
    }
    let pendingFrame: number | null = null
    const applyClasses = () => {
      pendingFrame = null
      const objects = (player as unknown as AmllInternalPlayer).currentLyricLineObjects
      const elements =
        objects?.map((line) => line.getElement()).filter((el): el is HTMLElement => el instanceof HTMLElement) ?? []
      const activeIndices = new Set(
        springOffActiveLineKey
          .split(',')
          .filter(Boolean)
          .map((index) => Number.parseInt(index, 10)),
      )
      elements.forEach((element, index) => {
        element.classList.toggle(SPRING_OFF_CURRENT_CLASS, activeIndices.has(index))
        element.classList.toggle(SPRING_OFF_INACTIVE_CLASS, !activeIndices.has(index))
      })
    }
    const scheduleApply = () => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(applyClasses)
    }
    applyClasses()
    const observer = new MutationObserver(scheduleApply)
    observer.observe(player as unknown as Node, { childList: true })
    return () => {
      observer.disconnect()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      clearClasses()
    }
  }, [amllLines, enableSpring, lyricPlayerRef, springOffActiveLineKey])

  return (
    <LyricPlayer
      ref={lyricPlayerRef}
      lyricLines={amllLines}
      currentTime={displayedTimeMs}
      isSeeking={!isPlaying || lyricMotionSuspended}
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
  const amllContainerRef = useRef<HTMLDivElement | null>(null)
  const touchStartRef = useRef<{ x: number; y: number; lineIndex: number } | null>(null)
  const pendingTouchSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAlignFrameRef = useRef<number | null>(null)
  const lastPointerEventAtRef = useRef(0)
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

  useEffect(() => {
    const container = amllContainerRef.current
    if (!container) return

    const clearSubLineVisibility = () => {
      container.querySelectorAll('.amll-lyric-player > *').forEach((line) => {
        const lineEl = line as HTMLElement
        lineEl.classList.remove('mt-lyric-line-hidden')
        Array.from(line.children)
          .slice(1)
          .forEach((node) => {
            ;(node as HTMLElement).classList.remove('mt-lyric-subline-hidden')
          })
      })
    }

    if (!hidePassedLines) {
      clearSubLineVisibility()
      return
    }

    let pendingFrame: number | null = null
    let lineObserver: MutationObserver | null = null

    const syncLineVisibility = (line: Element) => {
      const lineEl = line as HTMLElement
      const mainLineEl = line.children.item(0) as HTMLElement | null
      const opacity = Number.parseFloat(mainLineEl?.style.opacity ?? '')
      const lineHidden = Number.isFinite(opacity) && opacity <= HIDDEN_LINE_OPACITY
      lineEl.classList.toggle('mt-lyric-line-hidden', lineHidden)
      Array.from(line.children)
        .slice(1)
        .forEach((node) => {
          ;(node as HTMLElement).classList.toggle('mt-lyric-subline-hidden', lineHidden)
        })
    }

    const syncSubLineVisibility = () => {
      pendingFrame = null
      const player = container.querySelector('.amll-lyric-player')
      if (!player) return
      Array.from(player.children).forEach(syncLineVisibility)
      lineObserver?.disconnect()
      lineObserver = new MutationObserver((records) => {
        records.forEach((record) => {
          const line = record.target.parentElement
          if (line) syncLineVisibility(line)
        })
      })
      Array.from(player.children).forEach((line) => {
        const mainLine = line.children.item(0)
        if (mainLine) lineObserver?.observe(mainLine, { attributes: true, attributeFilter: ['style'] })
      })
    }

    const scheduleSync = () => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(syncSubLineVisibility)
    }

    scheduleSync()
    const observer = new MutationObserver(scheduleSync)
    observer.observe(container.querySelector('.amll-lyric-player') ?? container, { childList: true })
    return () => {
      observer.disconnect()
      lineObserver?.disconnect()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      clearSubLineVisibility()
    }
  }, [amllLines, hidePassedLines])

  useEffect(() => {
    return () => {
      if (pendingTouchSeekTimerRef.current) clearTimeout(pendingTouchSeekTimerRef.current)
      if (pendingAlignFrameRef.current !== null) cancelAnimationFrame(pendingAlignFrameRef.current)
    }
  }, [])

  const clearPendingTouchSeek = useCallback(() => {
    if (!pendingTouchSeekTimerRef.current) return
    clearTimeout(pendingTouchSeekTimerRef.current)
    pendingTouchSeekTimerRef.current = null
  }, [])

  useEffect(() => {
    if (clickSeekActive) return
    touchStartRef.current = null
    clearPendingTouchSeek()
  }, [clearPendingTouchSeek, clickSeekActive])

  const getLineIndexFromTarget = useCallback((target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null
    const objects = (lyricPlayerRef.current?.lyricPlayer as unknown as AmllInternalPlayer | undefined)
      ?.currentLyricLineObjects
    if (!element || !objects?.length) return -1
    return objects.findIndex((line) => {
      const lineElement = line.getElement()
      return lineElement === element || lineElement.contains(element)
    })
  }, [])

  const getLineIndexAtPoint = useCallback(
    (x: number, y: number) => getLineIndexFromTarget(document.elementFromPoint(x, y)),
    [getLineIndexFromTarget],
  )

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
      alignPlayerToLine(displayTargetMs)
      if (playerState.localSeek) {
        playerState.localSeek(displayTargetTime)
      } else {
        playerState.setCurrentTime(displayTargetTime)
      }
      if (pendingAlignFrameRef.current !== null) cancelAnimationFrame(pendingAlignFrameRef.current)
      pendingAlignFrameRef.current = requestAnimationFrame(() => {
        pendingAlignFrameRef.current = null
        alignPlayerToLine(displayTargetMs)
      })

      socket.emit(EVENTS.PLAYER_SEEK, { currentTime: displayTargetTime })
    },
    [alignPlayerToLine, amllLines, socket],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!clickSeekActive || event.pointerType === 'mouse') return
      lastPointerEventAtRef.current = Date.now()
      touchStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        lineIndex: getLineIndexAtPoint(event.clientX, event.clientY),
      }
    },
    [clickSeekActive, getLineIndexAtPoint],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!clickSeekActive || event.pointerType === 'mouse') return
      lastPointerEventAtRef.current = Date.now()
      const start = touchStartRef.current
      touchStartRef.current = null
      if (!start || start.lineIndex < 0) return
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (moved > TAP_MOVE_TOLERANCE_PX) return
      if (getLineIndexAtPoint(event.clientX, event.clientY) !== start.lineIndex) return

      clearPendingTouchSeek()
      pendingTouchSeekTimerRef.current = setTimeout(() => {
        pendingTouchSeekTimerRef.current = null
        seekToLineIndex(start.lineIndex)
      }, 80)
    },
    [clearPendingTouchSeek, clickSeekActive, getLineIndexAtPoint, seekToLineIndex],
  )

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!clickSeekActive || Date.now() - lastPointerEventAtRef.current < 500) return
      const touch = event.touches.item(0)
      if (!touch) return
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        lineIndex: getLineIndexAtPoint(touch.clientX, touch.clientY),
      }
    },
    [clickSeekActive, getLineIndexAtPoint],
  )

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!clickSeekActive || Date.now() - lastPointerEventAtRef.current < 500) return
      const start = touchStartRef.current
      touchStartRef.current = null
      const touch = event.changedTouches.item(0)
      if (!start || start.lineIndex < 0 || !touch) return
      const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y)
      if (moved > TAP_MOVE_TOLERANCE_PX) return
      if (getLineIndexAtPoint(touch.clientX, touch.clientY) !== start.lineIndex) return

      clearPendingTouchSeek()
      pendingTouchSeekTimerRef.current = setTimeout(() => {
        pendingTouchSeekTimerRef.current = null
        seekToLineIndex(start.lineIndex)
      }, 80)
    },
    [clearPendingTouchSeek, clickSeekActive, getLineIndexAtPoint, seekToLineIndex],
  )

  const handleLyricClick = useCallback(
    (event: LyricLineMouseEvent) => {
      clearPendingTouchSeek()
      if (clickSeekActive) seekToLineIndex(event.lineIndex)
    },
    [clearPendingTouchSeek, clickSeekActive, seekToLineIndex],
  )

  const cancelTap = useCallback(() => {
    touchStartRef.current = null
    clearPendingTouchSeek()
  }, [clearPendingTouchSeek])

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
      ref={amllContainerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelTap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={cancelTap}
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
