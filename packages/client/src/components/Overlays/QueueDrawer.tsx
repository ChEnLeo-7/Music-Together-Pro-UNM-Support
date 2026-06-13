import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSocketContext } from '@/providers/SocketProvider'
import type { MusicSource, Track } from '@music-together/shared'
import { EVENTS } from '@music-together/shared'
import { useHasHover } from '@/hooks/useHasHover'
import { useIsMobile } from '@/hooks/useIsMobile'
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { AbilityContext } from '@/providers/AbilityProvider'
import { ArrowUpToLine, ChevronDown, ChevronUp, ListX, Music, Play, Search, Trash2, User, X } from 'lucide-react'
import { toast } from 'sonner'

const EMPTY_QUEUE: Track[] = []
const DESKTOP_ROW_HEIGHT = 64
const QUEUE_BASE_OVERSCAN = 24
const QUEUE_FAST_SCROLL_OVERSCAN = 72
const QUEUE_FAST_SCROLL_THRESHOLD = 1.2
const QUEUE_ROW_STYLE = {
  height: `${DESKTOP_ROW_HEIGHT}px`,
  contentVisibility: 'auto',
  containIntrinsicSize: `${DESKTOP_ROW_HEIGHT}px`,
} as CSSProperties

const SOURCE_STYLE: Record<MusicSource, { label: string; className: string }> = {
  netease: { label: '网易', className: 'text-white bg-red-500 ring-red-600/50' },
  tencent: { label: 'QQ', className: 'text-white bg-green-500 ring-green-600/50' },
  kugou: { label: '酷狗', className: 'text-white bg-blue-500 ring-blue-600/50' },
}

interface QueueDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoveFromQueue: (trackId: string) => void
  onReorderQueue: (trackIds: string[]) => void
  onClearQueue: () => void
}

interface QueueItemProps {
  track: Track
  index: number
  isCurrent: boolean
  queueLength: number
  isMobile: boolean
  isTouch: boolean
  actionsVisible: boolean
  dismissedHover: boolean
  canPlay: boolean
  canVote: boolean
  canReorder: boolean
  canRemove: boolean
  onActivate: (trackId: string) => void
  onHoverReset: (trackId: string) => void
  onPlay: (track: Track) => void
  onRemove: (track: Track) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onInsertAfterCurrent: (track: Track, event: MouseEvent<HTMLButtonElement>) => void
}

const QueueItem = memo(function QueueItem({
  track,
  index,
  isCurrent,
  queueLength,
  isMobile,
  isTouch,
  actionsVisible,
  dismissedHover,
  canPlay,
  canVote,
  canReorder,
  canRemove,
  onActivate,
  onHoverReset,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  onInsertAfterCurrent,
}: QueueItemProps) {
  const renderActionButton = (
    label: string,
    icon: React.ReactNode,
    onClick: (event: MouseEvent<HTMLButtonElement>) => void,
    options: { disabled?: boolean; destructive?: boolean } = {},
  ) => {
    const button = (
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-6 w-6 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0',
          options.destructive && 'text-destructive hover:text-destructive',
        )}
        disabled={options.disabled}
        onClick={onClick}
        aria-label={label}
      >
        {icon}
      </Button>
    )

    if (isMobile) return button

    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div key={track.id} className="box-border py-1" style={QUEUE_ROW_STYLE}>
      <div
        className={cn(
          'group relative flex h-full items-center gap-2 rounded-lg px-2 transition-colors hover:bg-accent/50',
          isCurrent && 'bg-primary/10',
        )}
        onClick={() => {
          if (isTouch) onActivate(track.id)
        }}
        onMouseLeave={() => {
          if (!isTouch && dismissedHover) onHoverReset(track.id)
        }}
      >
        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>

        <div className="relative shrink-0">
          {track.cover ? (
            <img
              src={track.cover}
              alt={track.title}
              loading="lazy"
              decoding="async"
              className="h-9 w-9 rounded object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div className={cn('flex h-9 w-9 items-center justify-center rounded bg-muted', track.cover && 'hidden')}>
            <Music className="h-4 w-4 text-muted-foreground" />
          </div>
          {track.source && SOURCE_STYLE[track.source] && (
            <span
              className={cn(
                'absolute -bottom-1 -right-1 rounded px-0.5 text-[8px] font-bold leading-tight ring-1',
                SOURCE_STYLE[track.source].className,
              )}
            >
              {SOURCE_STYLE[track.source].label}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 pr-20">
          <div className={cn('truncate text-sm', isCurrent && 'font-medium text-primary')}>{track.title}</div>
          <div className="truncate text-xs text-muted-foreground">{track.artist.join(' / ')}</div>
        </div>

        {track.requestedBy && (
          <Badge
            variant="outline"
            className="absolute right-2 top-1.5 z-10 h-4 gap-0.5 border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-normal text-primary"
          >
            <User className="h-2.5 w-2.5" />
            {track.requestedBy}
          </Badge>
        )}

        <div
          className={cn(
            'absolute right-1 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-border/50 bg-popover px-1 py-0.5 shadow-md backdrop-blur-md',
            'opacity-0 pointer-events-none transition-opacity',
            !isMobile && 'group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
            actionsVisible && 'opacity-100 pointer-events-auto',
            !isTouch && dismissedHover && 'opacity-0 pointer-events-none',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {!isCurrent &&
            (canPlay || canVote) &&
            renderActionButton(canPlay ? '播放' : '投票播放', <Play className="h-3 w-3" />, () => onPlay(track))}

          {canReorder && (
            <>
              {renderActionButton('上移', <ChevronUp className="h-3 w-3" />, () => onMoveUp(index), {
                disabled: index === 0,
              })}
              {renderActionButton('下移', <ChevronDown className="h-3 w-3" />, () => onMoveDown(index), {
                disabled: index === queueLength - 1,
              })}
              {renderActionButton('置顶到当前播放下方', <ArrowUpToLine className="h-3 w-3" />, (event) =>
                onInsertAfterCurrent(track, event),
              )}
            </>
          )}

          {(canRemove || canVote) &&
            renderActionButton(canRemove ? '移除' : '投票移除', <Trash2 className="h-3 w-3" />, () => onRemove(track), {
              destructive: true,
            })}
        </div>
      </div>
    </div>
  )
})

export function QueueDrawer({ open, onOpenChange, onRemoveFromQueue, onReorderQueue, onClearQueue }: QueueDrawerProps) {
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const { socket } = useSocketContext()
  const isMobile = useIsMobile()
  const hasHover = useHasHover()
  const isTouch = !hasHover
  const ability = useContext(AbilityContext)
  const canRemove = ability.can('remove', 'Queue')
  const canReorder = ability.can('reorder', 'Queue')
  const canPlay = ability.can('play', 'Player')
  const canVote = ability.can('vote', 'Player')
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null)
  const [dismissedHoverTrackId, setDismissedHoverTrackId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const scrollMetricsRef = useRef({ top: 0, height: 0, velocity: 0, time: 0 })
  const [desktopScrollMetrics, setDesktopScrollMetrics] = useState({ top: 0, height: 0, velocity: 0 })
  const normalizedQuery = query.trim().toLowerCase()
  const visibleItems = useMemo(() => {
    const indexed = queue.map((track, index) => ({ track, index }))
    if (!normalizedQuery) return indexed

    return indexed.filter(({ track, index }) => {
      const haystack = [
        String(index + 1),
        track.title,
        track.artist.join(' '),
        track.album,
        track.source,
        track.sourceId,
        track.urlId,
        track.requestedBy,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery, queue])

  const updateDesktopScrollMetrics = useCallback(
    (element = scrollElement) => {
      if (!element) return
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const previous = scrollMetricsRef.current
      const deltaTime = previous.time > 0 ? Math.max(1, now - previous.time) : 16
      const velocity = Math.abs(element.scrollTop - previous.top) / deltaTime
      const next = { top: element.scrollTop, height: element.clientHeight, velocity }
      scrollMetricsRef.current = { ...next, time: now }
      setDesktopScrollMetrics((prev) =>
        prev.top === next.top && prev.height === next.height && Math.abs(prev.velocity - next.velocity) < 0.05 ? prev : next,
      )
    },
    [scrollElement],
  )

  const handleQueueScroll = useCallback(() => {
    if (!scrollElement || scrollFrameRef.current !== null) return
    const jumpDistance = Math.abs(scrollElement.scrollTop - scrollMetricsRef.current.top)
    if (jumpDistance > Math.max(scrollElement.clientHeight, DESKTOP_ROW_HEIGHT * 8) * QUEUE_FAST_SCROLL_THRESHOLD) {
      updateDesktopScrollMetrics(scrollElement)
      return
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateDesktopScrollMetrics()
    })
  }, [scrollElement, updateDesktopScrollMetrics])

  useEffect(() => {
    if (!open || !scrollElement) return
    scrollElement.scrollTop = 0
    setDesktopScrollMetrics({ top: 0, height: scrollElement.clientHeight, velocity: 0 })
    scrollMetricsRef.current = { top: 0, height: scrollElement.clientHeight, velocity: 0, time: 0 }
  }, [open, queue.length, scrollElement, normalizedQuery])

  useEffect(() => {
    if (!scrollElement) return
    updateDesktopScrollMetrics(scrollElement)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateDesktopScrollMetrics(scrollElement))
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [scrollElement, updateDesktopScrollMetrics])

  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => {
        confirmTimerRef.current = null
        setConfirmClear(false)
      }, 3000)
      return
    }

    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
    onClearQueue()
    setConfirmClear(false)
    toast.success('播放列表已清空')
  }, [confirmClear, onClearQueue])

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return
    const ids = queue.map((t) => t.id)
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
    onReorderQueue(ids)
  }, [onReorderQueue, queue])

  const handleMoveDown = useCallback((index: number) => {
    if (index >= queue.length - 1) return
    const ids = queue.map((t) => t.id)
    ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
    onReorderQueue(ids)
  }, [onReorderQueue, queue])

  const handlePlayTrack = useCallback((track: Track) => {
    if (canPlay) {
      socket.emit(EVENTS.PLAYER_PLAY, { track })
    } else if (canVote) {
      socket.emit(EVENTS.VOTE_START, {
        action: 'play-track',
        payload: { trackId: track.id, trackTitle: track.title },
      })
      toast.info(`已发起投票：播放《${track.title}》`)
    }
  }, [canPlay, canVote, socket])

  const handleRemoveTrack = useCallback((track: Track) => {
    if (canRemove) {
      onRemoveFromQueue(track.id)
      toast.success(`已移除《${track.title}》`)
    } else if (canVote) {
      socket.emit(EVENTS.VOTE_START, {
        action: 'remove-track',
        payload: { trackId: track.id, trackTitle: track.title },
      })
      toast.info(`已发起投票：移除《${track.title}》`)
    }
  }, [canRemove, canVote, onRemoveFromQueue, socket])

  const handleInsertAfterCurrent = useCallback((track: Track, e?: MouseEvent<HTMLButtonElement>) => {
    if (e) {
      e.stopPropagation()
      e.currentTarget.blur()
    }
    if (isTouch && activeTrackId === track.id) setActiveTrackId(null)
    if (!isTouch) setDismissedHoverTrackId(track.id)

    const current = currentTrack
    const currentIndex = current?.id ? queue.findIndex((t) => t.id === current.id) : -1
    if (current && track.id === current.id) return

    const ids = queue.map((t) => t.id)
    const from = ids.indexOf(track.id)
    if (from < 0) return

    ids.splice(from, 1)

    if (currentIndex >= 0) {
      const adjustedCurrentIndex = from < currentIndex ? currentIndex - 1 : currentIndex
      ids.splice(adjustedCurrentIndex + 1, 0, track.id)
    } else {
      ids.unshift(track.id)
    }

    onReorderQueue(ids)
    toast.success(`已置顶《${track.title}》`)
  }, [activeTrackId, currentTrack, isTouch, onReorderQueue, queue])

  const handleActivateTrack = useCallback((trackId: string) => {
    setActiveTrackId((prev) => (prev === trackId ? null : trackId))
  }, [])

  const handleHoverReset = useCallback((trackId: string) => {
    setDismissedHoverTrackId((prev) => (prev === trackId ? null : prev))
  }, [])

  const desktopViewportHeight = desktopScrollMetrics.height || DESKTOP_ROW_HEIGHT * 8
  const desktopOverscan =
    desktopScrollMetrics.velocity > QUEUE_FAST_SCROLL_THRESHOLD ? QUEUE_FAST_SCROLL_OVERSCAN : QUEUE_BASE_OVERSCAN
  const visibleStart = Math.max(0, Math.floor(desktopScrollMetrics.top / DESKTOP_ROW_HEIGHT) - desktopOverscan)
  const visibleEnd = Math.min(
    visibleItems.length,
    Math.ceil((desktopScrollMetrics.top + desktopViewportHeight) / DESKTOP_ROW_HEIGHT) + desktopOverscan,
  )
  const topSpacerHeight = visibleStart * DESKTOP_ROW_HEIGHT
  const bottomSpacerHeight = Math.max(0, (visibleItems.length - visibleEnd) * DESKTOP_ROW_HEIGHT)
  const renderedItems = visibleItems.slice(visibleStart, visibleEnd)
  const drawerDirection: 'bottom' | 'right' = isMobile ? 'bottom' : 'right'

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={drawerDirection}>
      <DrawerContent
        className={cn(
          'flex min-h-0 flex-col overflow-hidden p-0',
          isMobile
            ? 'h-[min(76dvh,calc(100dvh-3rem))] max-h-[calc(100dvh-3rem)] rounded-t-2xl'
            : '!w-[min(420px,calc(100dvw-0.75rem))] sm:!max-w-sm',
        )}
      >
        <DrawerHeader className="shrink-0 border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Music className="h-4 w-4" />
              播放列表 ({queue.length})
            </DrawerTitle>
            <div className="flex items-center gap-1">
              {canRemove && queue.length > 0 && (
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn('h-7 w-7', confirmClear && 'text-destructive hover:text-destructive')}
                      onClick={handleClear}
                      aria-label="清空播放列表"
                    >
                      <ListX className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{confirmClear ? '再次点击确认清空' : '清空播放列表'}</TooltipContent>
                </Tooltip>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)} aria-label="关闭播放列表">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {queue.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索列表内歌曲"
                  className="h-8 rounded-lg pl-8 pr-8 text-sm"
                  aria-label="搜索播放列表"
                />
                {query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setQuery('')}
                    aria-label="清空搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {normalizedQuery && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {visibleItems.length}/{queue.length}
                </span>
              )}
            </div>
          )}
        </DrawerHeader>

        <div
          ref={setScrollElement}
          onScroll={handleQueueScroll}
          className="min-h-0 flex-1 overscroll-contain overflow-x-hidden overflow-y-auto bg-background px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          style={{ WebkitOverflowScrolling: 'touch', contain: 'layout paint style' }}
        >
          {queue.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">播放列表为空</div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">没有匹配的歌曲</div>
          ) : (
            <div className="w-full">
              {topSpacerHeight > 0 && <div aria-hidden="true" style={{ height: `${topSpacerHeight}px` }} />}
              {renderedItems.map(({ track, index }) => {
                return (
                  <QueueItem
                    key={track.id}
                    track={track}
                    index={index}
                    isCurrent={currentTrack?.id === track.id}
                    queueLength={queue.length}
                    isMobile={isMobile}
                    isTouch={isTouch}
                    actionsVisible={isTouch && activeTrackId === track.id}
                    dismissedHover={dismissedHoverTrackId === track.id}
                    canPlay={canPlay}
                    canVote={canVote}
                    canReorder={canReorder}
                    canRemove={canRemove}
                    onActivate={handleActivateTrack}
                    onHoverReset={handleHoverReset}
                    onPlay={handlePlayTrack}
                    onRemove={handleRemoveTrack}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                    onInsertAfterCurrent={handleInsertAfterCurrent}
                  />
                )
              })}
              {bottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: `${bottomSpacerHeight}px` }} />}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
