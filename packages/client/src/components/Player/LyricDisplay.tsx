import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSocketContext } from '@/providers/SocketProvider'
import { cn } from '@/lib/utils'
import type { LyricLine as AMLLLyricLine, LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import { EVENTS } from '@music-together/shared'
import '@applemusic-like-lyrics/core/style.css'
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react'
import { useCallback, useEffect, useMemo, useRef, type PointerEvent, type TouchEvent } from 'react'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const
const SEEK_HIGHLIGHT_EPSILON_MS = 8
const HIDDEN_LINE_OPACITY = 0.01
const TAP_MOVE_TOLERANCE_PX = 10
const DUPLICATE_SEEK_SUPPRESS_MS = 600
const SPRING_OFF_CURRENT_CLASS = 'mt-lyric-current'
const SPRING_OFF_INACTIVE_CLASS = 'mt-lyric-inactive'

interface LyricLine {
  time: number
  text: string
  translation?: string
}

interface AmllInternalPlayer {
  bufferedLines?: Set<number>
  scrollToIndex?: number
  currentLyricLineObjects?: Array<{ getElement: () => HTMLElement }>
}

function getActiveLineIndex(lines: AMLLLyricLine[], timeMs: number) {
  let activeIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startTime > timeMs) break
    activeIndex = i
  }
  return activeIndex
}

function parseLRC(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = []
  // Supports [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx]
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g
  let match

  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10)
    const seconds = parseInt(match[2], 10)
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0
    const time = minutes * 60 + seconds + ms / 1000
    const text = match[4].trim()
    if (text) {
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

function mergeLyrics(original: string, translated: string): LyricLine[] {
  const origLines = parseLRC(original)
  if (origLines.length === 0) return []

  const result: LyricLine[] = origLines.map((l) => ({ ...l }))

  if (!translated) return result

  const transLines = parseLRC(translated)
  if (transLines.length === 0) return result

  const transMap = new Map<number, string>()
  for (const tl of transLines) {
    transMap.set(Math.round(tl.time * 10) / 10, tl.text)
  }

  for (const line of result) {
    const key = Math.round(line.time * 10) / 10
    const exact = transMap.get(key)
    if (exact) {
      line.translation = exact
      continue
    }
    for (let offset = 1; offset <= 5; offset++) {
      const near =
        transMap.get(Math.round((line.time + offset * 0.1) * 10) / 10) ??
        transMap.get(Math.round((line.time - offset * 0.1) * 10) / 10)
      if (near) {
        line.translation = near
        break
      }
    }
  }

  return result
}

/** 将自有 LRC 解析结果转为 AMLL LyricLine 格式 */
function toAMLLLines(lines: LyricLine[]): AMLLLyricLine[] {
  return lines.map((line, i, arr) => {
    const startMs = Math.round(line.time * 1000)
    const endMs = Math.round((arr[i + 1]?.time ?? line.time + 5) * 1000)
    return {
      words: [
        {
          word: line.text,
          startTime: startMs,
          endTime: endMs,
          romanWord: '',
          obscene: false,
        },
      ],
      translatedLyric: line.translation ?? '',
      romanLyric: '',
      startTime: startMs,
      endTime: endMs,
      isBG: false,
      isDuet: false,
    }
  })
}

export function LyricDisplay() {
  const { socket } = useSocketContext()
  const lyric = usePlayerStore((s) => s.lyric)
  const tlyric = usePlayerStore((s) => s.tlyric)
  const lyricLoading = usePlayerStore((s) => s.lyricLoading)
  const ttmlLines = usePlayerStore((s) => s.ttmlLines)
  const lyricDisplayTimeMs = usePlayerStore((s) => s.lyricDisplayTimeMs)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  const alignAnchor = useSettingsStore((s) => s.lyricAlignAnchor)
  const alignPosition = useSettingsStore((s) => s.lyricAlignPosition)
  const enableSpring = useSettingsStore((s) => s.lyricEnableSpring)
  const enableBlur = useSettingsStore((s) => s.lyricEnableBlur)
  const enableScale = useSettingsStore((s) => s.lyricEnableScale)
  const hidePassedLines = useSettingsStore((s) => s.lyricHidePassedLines)
  const clickSeekEnabled = useSettingsStore((s) => s.lyricClickSeekEnabled)
  const fontWeight = useSettingsStore((s) => s.lyricFontWeight)
  const fontSize = useSettingsStore((s) => s.lyricFontSize)
  const translationFontSize = useSettingsStore((s) => s.lyricTranslationFontSize)
  const romanFontSize = useSettingsStore((s) => s.lyricRomanFontSize)
  const lyricMotionSuspended = usePlayerStore((s) => s.lyricMotionSuspended)
  const lyricFrameSuspended = usePlayerStore((s) => s.lyricFrameSuspended)
  const frozenLyricDisplayTimeMsRef = useRef(lyricDisplayTimeMs)
  const shouldFreezeLyricTime = lyricMotionSuspended || lyricFrameSuspended
  if (!shouldFreezeLyricTime) {
    frozenLyricDisplayTimeMsRef.current = lyricDisplayTimeMs
  }
  const displayedLyricTimeMs = shouldFreezeLyricTime ? frozenLyricDisplayTimeMsRef.current : lyricDisplayTimeMs

  // LRC 解析（仅在没有 TTML 时使用）
  const lrcLines = useMemo(() => mergeLyrics(lyric, tlyric), [lyric, tlyric])
  const lrcAmllLines = useMemo(() => toAMLLLines(lrcLines), [lrcLines])

  // TTML 优先，LRC 回退
  const amllLines = ttmlLines ?? lrcAmllLines
  const hasLyrics = ttmlLines ? ttmlLines.length > 0 : lrcLines.length > 0
  const springOffActiveLineIndex = useMemo(
    () => (!enableSpring && hasLyrics ? getActiveLineIndex(amllLines, displayedLyricTimeMs) : -1),
    [amllLines, displayedLyricTimeMs, enableSpring, hasLyrics],
  )
  const lyricPlayerRef = useRef<LyricPlayerRef | null>(null)
  const amllContainerRef = useRef<HTMLDivElement | null>(null)
  const touchStartRef = useRef<{ x: number; y: number; lineIndex: number } | null>(null)
  const pendingTouchSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAlignFrameRef = useRef<number | null>(null)
  const lastPointerEventAtRef = useRef(0)
  const lastSeekRef = useRef<{ lineIndex: number; at: number } | null>(null)

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
            const element = node as HTMLElement
            element.classList.remove('mt-lyric-subline-hidden')
          })
      })
    }

    if (!hidePassedLines) {
      clearSubLineVisibility()
      return
    }

    let pendingFrame: number | null = null

    const syncSubLineVisibility = () => {
      pendingFrame = null
      const player = container.querySelector('.amll-lyric-player')
      if (!player) return

      Array.from(player.children).forEach((line) => {
        const lineEl = line as HTMLElement
        const mainLineEl = line.children.item(0) as HTMLElement | null
        const opacity = Number.parseFloat(mainLineEl?.style.opacity ?? '')
        const lineHidden = Number.isFinite(opacity) && opacity <= HIDDEN_LINE_OPACITY

        lineEl.classList.toggle('mt-lyric-line-hidden', lineHidden)
        for (const subLine of Array.from(line.children).slice(1)) {
          const subLineEl = subLine as HTMLElement
          subLineEl.classList.toggle('mt-lyric-subline-hidden', lineHidden)
        }
      })
    }

    const scheduleSync = () => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(syncSubLineVisibility)
    }

    scheduleSync()
    const observer = new MutationObserver(scheduleSync)
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      clearSubLineVisibility()
    }
  }, [amllLines, hidePassedLines])

  useEffect(() => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    player.setCurrentTime(displayedLyricTimeMs, true)
    void player.calcLayout(true)
  }, [amllLines, alignAnchor, alignPosition, hidePassedLines])

  useEffect(() => {
    const container = amllContainerRef.current
    if (!container) return

    const clearSpringOffClasses = () => {
      container.querySelectorAll(`.${SPRING_OFF_CURRENT_CLASS}, .${SPRING_OFF_INACTIVE_CLASS}`).forEach((node) => {
        node.classList.remove(SPRING_OFF_CURRENT_CLASS, SPRING_OFF_INACTIVE_CLASS)
      })
    }

    if (enableSpring) {
      clearSpringOffClasses()
      return
    }

    let pendingFrame: number | null = null

    const getLyricLineElements = () => {
      const objects = (lyricPlayerRef.current?.lyricPlayer as unknown as AmllInternalPlayer | undefined)
        ?.currentLyricLineObjects
      const objectElements =
        objects
          ?.map((line) => line.getElement())
          .filter((element): element is HTMLElement => element instanceof HTMLElement) ?? []
      if (objectElements.length > 0) return objectElements
      return Array.from(container.querySelectorAll<HTMLElement>(".amll-lyric-player > [class*='lyricLine']"))
    }

    const applySpringOffClasses = () => {
      pendingFrame = null
      const elements = getLyricLineElements()
      if (elements.length === 0) return

      elements.forEach((lineElement, index) => {
        const isCurrent = index === springOffActiveLineIndex
        lineElement.classList.toggle(SPRING_OFF_CURRENT_CLASS, isCurrent)
        lineElement.classList.toggle(SPRING_OFF_INACTIVE_CLASS, !isCurrent)
      })
    }

    const scheduleApply = () => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(applySpringOffClasses)
    }

    scheduleApply()
    const observer = new MutationObserver(scheduleApply)
    observer.observe(container, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      clearSpringOffClasses()
    }
  }, [amllLines, enableSpring, springOffActiveLineIndex])

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

  const alignPlayerToLine = useCallback((lineIndex: number, timeMs: number) => {
    const player = lyricPlayerRef.current?.lyricPlayer
    if (!player) return
    const internal = player as unknown as AmllInternalPlayer
    internal.scrollToIndex = lineIndex
    internal.bufferedLines?.clear()
    internal.bufferedLines?.add(lineIndex)
    player.setCurrentTime(timeMs, true)
    internal.scrollToIndex = lineIndex
    internal.bufferedLines?.clear()
    internal.bufferedLines?.add(lineIndex)
    player.resetScroll()
    void player.calcLayout(true)
  }, [])

  const seekToLineIndex = useCallback(
    (lineIndex: number) => {
      if (!clickSeekEnabled) return
      if (amllLines.length === 0) return
      const targetIndex = Math.min(amllLines.length - 1, Math.max(0, lineIndex))
      const now = Date.now()
      if (lastSeekRef.current?.lineIndex === targetIndex && now - lastSeekRef.current.at < DUPLICATE_SEEK_SUPPRESS_MS) return
      lastSeekRef.current = { lineIndex: targetIndex, at: now }

      const lyricTargetMs = Math.max(0, amllLines[targetIndex].startTime)
      const displayTargetMs = lyricTargetMs + SEEK_HIGHLIGHT_EPSILON_MS
      const displayTargetTime = displayTargetMs / 1000

      const playerState = usePlayerStore.getState()
      playerState.suppressNextRemoteSeek(1000, displayTargetTime)
      alignPlayerToLine(targetIndex, displayTargetMs)
      if (playerState.localSeek) {
        playerState.localSeek(displayTargetTime)
      } else {
        playerState.setCurrentTime(displayTargetTime)
      }
      if (pendingAlignFrameRef.current !== null) cancelAnimationFrame(pendingAlignFrameRef.current)
      pendingAlignFrameRef.current = requestAnimationFrame(() => {
        pendingAlignFrameRef.current = null
        alignPlayerToLine(targetIndex, displayTargetMs)
      })

      socket.emit(EVENTS.PLAYER_SEEK, { currentTime: displayTargetTime })
    },
    [alignPlayerToLine, amllLines, clickSeekEnabled, socket],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!clickSeekEnabled || event.pointerType === 'mouse') return
      lastPointerEventAtRef.current = Date.now()
      touchStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        lineIndex: getLineIndexAtPoint(event.clientX, event.clientY),
      }
    },
    [clickSeekEnabled, getLineIndexAtPoint],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!clickSeekEnabled || event.pointerType === 'mouse') return
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
    [clearPendingTouchSeek, clickSeekEnabled, getLineIndexAtPoint, seekToLineIndex],
  )

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!clickSeekEnabled || Date.now() - lastPointerEventAtRef.current < 500) return
      const touch = event.touches.item(0)
      if (!touch) return
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        lineIndex: getLineIndexAtPoint(touch.clientX, touch.clientY),
      }
    },
    [clickSeekEnabled, getLineIndexAtPoint],
  )

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!clickSeekEnabled || Date.now() - lastPointerEventAtRef.current < 500) return
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
    [clearPendingTouchSeek, clickSeekEnabled, getLineIndexAtPoint, seekToLineIndex],
  )

  const handleLyricClick = useCallback(
    (event: LyricLineMouseEvent) => {
      clearPendingTouchSeek()
      if (clickSeekEnabled) seekToLineIndex(event.lineIndex)
    },
    [clearPendingTouchSeek, clickSeekEnabled, seekToLineIndex],
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
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={cn('amll-container h-full w-full cursor-pointer', !enableSpring && 'amll-spring-off')}
      style={
        {
          fontWeight,
          '--amll-lp-font-size': `clamp(16px, calc(min(5vh, 7vw) * ${fontSize / 100}), 80px)`,
          '--amll-translated-font-size': `${translationFontSize / 100}em`,
          '--amll-roman-font-size': `${romanFontSize / 100}em`,
        } as React.CSSProperties
      }
    >
      <LyricPlayer
        ref={lyricPlayerRef}
        lyricLines={amllLines}
        currentTime={displayedLyricTimeMs}
        isSeeking={!isPlaying || lyricMotionSuspended}
        playing={isPlaying && !shouldFreezeLyricTime}
        alignAnchor={alignAnchor}
        alignPosition={hidePassedLines ? Math.max(0, alignPosition - 0.16) : alignPosition}
        enableSpring={enableSpring}
        enableBlur={enableBlur}
        enableScale={enableScale}
        hidePassedLines={hidePassedLines}
        onLyricLineClick={clickSeekEnabled ? handleLyricClick : undefined}
        disabled={lyricFrameSuspended}
        style={FULL_SIZE_STYLE}
      />
    </div>
  )
}
