import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { VirtualTrackList } from '@/components/VirtualTrackList'
import { trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import type { Playlist, Track } from '@music-together/shared'
import { LIMITS } from '@music-together/shared'
import { ArrowLeft, ListPlus, Music } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

const EMPTY_QUEUE: Track[] = []

interface PlaylistDetailProps {
  playlist: Playlist | null
  tracks: Track[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  onBack: () => void
  onAddTrack: (track: Track) => void
  onInsertAfterCurrent?: (track: Track) => void
  onAddAll: (tracks: Track[], playlistName?: string) => void
  onLoadMore: () => void
}

export function PlaylistDetail({
  playlist,
  tracks,
  loading,
  loadingMore,
  hasMore,
  total,
  onBack,
  onAddTrack,
  onInsertAfterCurrent,
  onAddAll,
  onLoadMore,
}: PlaylistDetailProps) {
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const t = useI18n((s) => s.t)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])

  const isTrackAdded = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      return addedIds.has(key) || queueKeys.has(key)
    },
    [addedIds, queueKeys],
  )

  const handleAddTrack = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
         toast.info(t('queueDuplicate', { track: track.title }))
        return
      }
      onAddTrack(track)
      setAddedIds((prev) => new Set(prev).add(key))
    },
    [onAddTrack, queueKeys, addedIds],
  )

  const handleInsertAfterCurrent = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
         toast.info(t('queueDuplicate', { track: track.title }))
        return
      }
      onInsertAfterCurrent?.(track)
      setAddedIds((prev) => new Set(prev).add(key))
    },
    [onInsertAfterCurrent, queueKeys, addedIds],
  )

  // Dynamic "add all" logic — filter duplicates
  const availableSlots = LIMITS.QUEUE_MAX_SIZE - queue.length
  const uniqueTracks = useMemo(() => tracks.filter((t) => !isTrackAdded(t)), [tracks, isTrackAdded])
  const addCount = Math.min(availableSlots, uniqueTracks.length)
  const isQueueFull = availableSlots <= 0

  const handleAddAll = useCallback(() => {
    if (addCount <= 0) return
    const toAdd = uniqueTracks.slice(0, addCount)
    onAddAll(toAdd, playlist?.name)
    setAddedIds((prev) => {
      const next = new Set(prev)
      for (const t of toAdd) next.add(trackKey(t))
      return next
    })
    if (addCount < uniqueTracks.length) {
       toast.success(t('queueAddedPartial', { added: addCount, remaining: uniqueTracks.length - addCount }))
    } else {
       toast.success(t('queueAddedAll', { count: addCount }))
    }
  }, [addCount, uniqueTracks, onAddAll, playlist?.name])

  // Button label
  let addAllLabel: string
  if (loading) {
    addAllLabel = t('loading')
  } else if (tracks.length === 0) {
    addAllLabel = t('addAll')
  } else if (isQueueFull) {
    addAllLabel = t('queueFull')
  } else if (uniqueTracks.length === 0) {
    addAllLabel = t('allAdded')
  } else if (addCount === uniqueTracks.length) {
    addAllLabel = `${t('addAll')} ${addCount}`
  } else {
    addAllLabel = t('addTracks', { count: addCount })
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      {/* Row 1: Back + Title — pr-8 reserves space for dialog close button */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden pr-8">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{playlist?.name ?? t('playlistDetail')}</h4>
      </div>

      {/* Row 2: Info + Action */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 overflow-hidden py-1">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {loading
            ? t('loading')
            : `${tracks.length < total ? t('tracksLoadedWithProgress', { total, count: tracks.length }) : t('tracksLoaded', { total })}${playlist?.creator ? ` · ${playlist.creator}` : ''}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddAll}
          disabled={loading || isQueueFull || uniqueTracks.length === 0}
          className="min-w-0 shrink-0 gap-1 px-2"
        >
          <ListPlus className="h-3.5 w-3.5" />
          <span className="max-w-[9rem] truncate">{addAllLabel}</span>
        </Button>
      </div>

      <Separator className="shrink-0" />

      {/* Track list with shared virtual scrolling component */}
      <VirtualTrackList
        tracks={tracks}
        loading={loading}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        isTrackAdded={isTrackAdded}
        onAddTrack={handleAddTrack}
        onInsertAfterCurrent={onInsertAfterCurrent ? handleInsertAfterCurrent : undefined}
        emptyIcon={<Music className="h-8 w-8" />}
        emptyMessage={t('playlistEmpty')}
        className="border-0 rounded-none"
      />
    </div>
  )
}
