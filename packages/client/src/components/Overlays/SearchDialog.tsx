import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VirtualTrackList, type VirtualTrackListRef } from '@/components/VirtualTrackList'
import { VirtualPlaylistList } from '@/components/VirtualPlaylistList'
import { PLATFORM_ACTIVE, PLATFORM_TEXT } from '@/lib/platform'
import { cn, trackKey } from '@/lib/utils'
import { useRoomStore } from '@/stores/roomStore'
import { useSearch } from '@/hooks/useSearch'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSocketContext } from '@/providers/SocketProvider'
import { EVENTS } from '@music-together/shared'
import type { MusicSource, Track, Playlist } from '@music-together/shared'
import { Loader2, Music2, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { PlaylistDetail } from './Settings/PlaylistDetail'

const EMPTY_QUEUE: Track[] = []

const SOURCES: { id: MusicSource; labelKey: 'netease' | 'tencent' | 'kugou' }[] = [
  { id: 'netease', labelKey: 'netease' },
  { id: 'tencent', labelKey: 'tencent' },
  { id: 'kugou', labelKey: 'kugou' },
]

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddToQueue: (track: Track) => void
  onInsertAfterCurrent: (track: Track) => void
  focusSignal?: number
}

export function SearchDialog({ open, onOpenChange, onAddToQueue, onInsertAfterCurrent, focusSignal = 0 }: SearchDialogProps) {
  const t = useI18n((s) => s.t)
  const isMobile = useIsMobile()
  const [mobileViewport, setMobileViewport] = useState({ height: 0, bottom: 0 })
  const mobileViewportMaxHeightRef = useRef(0)
  const [source, setSource] = useState<MusicSource>('netease')
  const [searchType, setSearchType] = useState<'song' | 'album' | 'playlist'>('song')
  const [keyword, setKeyword] = useState('')
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const listRef = useRef<VirtualTrackListRef>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const sourceContainerRef = useRef<HTMLDivElement>(null)
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 })
  const queue = useRoomStore((s) => s.room?.queue ?? EMPTY_QUEUE)
  const queueKeys = useMemo(() => new Set(queue.map(trackKey)), [queue])
  const { socket } = useSocketContext()

  useEffect(() => {
    const viewport = window.visualViewport
    const updateDrawerHeight = () => {
      const height = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      mobileViewportMaxHeightRef.current = Math.max(mobileViewportMaxHeightRef.current, height)
      setMobileViewport({ height, bottom: Math.max(0, window.innerHeight - offsetTop - height) })
    }

    updateDrawerHeight()
    window.addEventListener('resize', updateDrawerHeight)
    viewport?.addEventListener('resize', updateDrawerHeight)
    viewport?.addEventListener('scroll', updateDrawerHeight)
    return () => {
      window.removeEventListener('resize', updateDrawerHeight)
      viewport?.removeEventListener('resize', updateDrawerHeight)
      viewport?.removeEventListener('scroll', updateDrawerHeight)
    }
  }, [])

  const keyboardOpen = mobileViewport.height < mobileViewportMaxHeightRef.current - 80
  const mobileDrawerHeight =
    mobileViewport.height > 0 ? Math.round(mobileViewport.height * (keyboardOpen ? 0.5 : 2 / 3)) : undefined
  const mobileDrawerBottom = mobileViewport.height > 0 ? mobileViewport.bottom : undefined

  // Album Detail view state
  const [selectedAlbum, setSelectedAlbum] = useState<Playlist | null>(null)
  const {
    playlistTracks,
    playlistTotal,
    tracksLoading,
    loadingMore: albumLoadingMore,
    hasMoreTracks,
    fetchPlaylistTracks,
    loadMoreTracks,
  } = usePlaylist()

  const { results, loading, loadingMore, hasMore, hasSearched, search, loadMore, resetState } = useSearch(source, searchType)

  // Auto re-search when source or type changes
  const prevSourceRef = useRef(source)
  const prevTypeRef = useRef(searchType)
  useEffect(() => {
    const sourceChanged = prevSourceRef.current !== source
    const typeChanged = prevTypeRef.current !== searchType
    prevSourceRef.current = source
    prevTypeRef.current = searchType
    if ((sourceChanged || typeChanged) && keyword.trim()) {
      setAddedIds(new Set())
      search(keyword.trim())
      if (searchType === 'song') listRef.current?.scrollToTop()
    }
  }, [source, searchType, keyword, search])

  // Measure active source button position for sliding pill
  const measurePill = useCallback(() => {
    const container = sourceContainerRef.current
    if (!container) return
    const activeBtn = container.querySelector<HTMLButtonElement>(`[data-source="${source}"]`)
    if (!activeBtn) return
    setPillStyle({ left: activeBtn.offsetLeft, width: activeBtn.offsetWidth })
  }, [source])

  useLayoutEffect(() => {
    measurePill()
  }, [measurePill])

  // Re-measure after dialog opens (DOM may not be ready on first render)
  useEffect(() => {
    if (open) requestAnimationFrame(measurePill)
  }, [open, measurePill])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, focusSignal])

  // Reset album detail when dialog closes
  useEffect(() => {
    if (!open) setSelectedAlbum(null)
  }, [open])

  const handleSearch = (overrideKeyword?: string) => {
    const searchKeyword = (overrideKeyword ?? keyword).trim()
    if (!searchKeyword) return
    if (isMobile) searchInputRef.current?.blur()
    if (overrideKeyword !== undefined) setKeyword(overrideKeyword)
    setAddedIds(new Set())
    search(searchKeyword)
    if (searchType === 'song') {
      listRef.current?.scrollToTop()
    }
  }

  const handleAdd = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
         toast.info(t('queueDuplicate', { track: track.title }))
        return
      }
      onAddToQueue(track)
      setAddedIds((prev) => new Set(prev).add(key))
      // Removed duplicate toast.success since onAddToQueue (from useQueue) usually already handles it 
      // or the UI handles feedback.
    },
    [onAddToQueue, queueKeys, addedIds],
  )

  const handleInsertAfterCurrent = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      if (queueKeys.has(key) || addedIds.has(key)) {
         toast.info(t('queueDuplicate', { track: track.title }))
        return
      }
      onInsertAfterCurrent(track)
      setAddedIds((prev) => new Set(prev).add(key))
      // Removed duplicate toast.success
    },
    [onInsertAfterCurrent, queueKeys, addedIds],
  )

  const handleAddBatch = useCallback(
    (tracks: Track[], playlistName?: string) => {
      if (tracks.length === 0) return
      socket.emit(EVENTS.QUEUE_ADD_BATCH, { tracks, playlistName })
      setAddedIds((prev) => {
        const next = new Set(prev)
        for (const t of tracks) next.add(trackKey(t))
        return next
      })
       toast.success(t('songsAdded', { count: tracks.length }))
    },
    [socket]
  )

  const isTrackAdded = useCallback(
    (track: Track) => {
      const key = trackKey(track)
      return addedIds.has(key) || queueKeys.has(key)
    },
    [addedIds, queueKeys],
  )

  const handleSelectAlbum = (album: Playlist) => {
    setSelectedAlbum(album)
    fetchPlaylistTracks(source, album.id, album.trackCount, searchType as 'album' | 'playlist')
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <ResponsiveDialogContent
        className="flex h-[50dvh] max-h-none flex-col overflow-hidden sm:h-auto sm:max-h-[80vh] sm:max-w-2xl"
        mobileStyle={
          mobileDrawerHeight
            ? {
                height: `${mobileDrawerHeight}px`,
                maxHeight: `${mobileDrawerHeight}px`,
                bottom: `${mobileDrawerBottom}px`,
              }
            : undefined
        }
      >
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3">
            <ResponsiveDialogTitle className="shrink-0">
              {selectedAlbum ? selectedAlbum.name : t('searchMusic')}
            </ResponsiveDialogTitle>
            {!selectedAlbum && (
              <div ref={sourceContainerRef} className="bg-muted/50 relative flex items-center rounded-lg p-0.5">
                <motion.div
                  className={cn('absolute inset-y-0.5 rounded-md', PLATFORM_ACTIVE[source])}
                  animate={{ left: pillStyle.left, width: pillStyle.width }}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }}
                />
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    data-source={s.id}
                    className={cn(
                      'relative z-10 rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors',
                      source === s.id ? PLATFORM_TEXT[s.id] : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => {
                      setSource(s.id)
                      resetState()
                      setAddedIds(new Set())
                    }}
                  >
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {selectedAlbum ? (
            <PlaylistDetail
              playlist={selectedAlbum}
              tracks={playlistTracks}
              loading={tracksLoading}
              loadingMore={albumLoadingMore}
              hasMore={hasMoreTracks}
              total={playlistTotal}
              onBack={() => setSelectedAlbum(null)}
              onAddTrack={handleAdd}
              onInsertAfterCurrent={handleInsertAfterCurrent}
              onAddAll={handleAddBatch}
              onLoadMore={loadMoreTracks}
            />
          ) : (
            <>
              {/* Type tabs */}
              <Tabs
                value={searchType}
                onValueChange={(v) => {
                  setSearchType(v as 'song' | 'album' | 'playlist')
                  resetState()
                  setAddedIds(new Set())
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="song" className="flex-1 text-xs sm:text-sm">{t('songs')}</TabsTrigger>
                  <TabsTrigger value="album" className="flex-1 text-xs sm:text-sm">{t('albums')}</TabsTrigger>
                  <TabsTrigger value="playlist" className="flex-1 text-xs sm:text-sm">{t('playlists')}</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Search input */}
              <div className="flex gap-2">
                <Input
                  ref={searchInputRef}
                  placeholder={t(searchType === 'song' ? 'songSearchPlaceholder' : searchType === 'album' ? 'albumSearchPlaceholder' : 'playlistSearchPlaceholder')}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  className="flex-1"
                  autoFocus
                  aria-label={t('searchKeyword')}
                />
                <Button onClick={() => handleSearch()} disabled={loading} aria-label={t('search')}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>

              {/* Results area — virtual scrolling with auto-load */}
              {hasSearched ? (
                searchType === 'song' ? (
                  <VirtualTrackList
                    ref={listRef}
                    tracks={results as Track[]}
                    loading={loading}
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={loadMore}
                    isTrackAdded={isTrackAdded}
                    onAddTrack={handleAdd}
                    onInsertAfterCurrent={handleInsertAfterCurrent}
                    onArtistClick={(artist) => {
                      setSearchType('song')
                      handleSearch(artist)
                    }}
                    emptyIcon={<Music2 className="h-8 w-8" />}
                    emptyMessage={t('noSearchResults')}
                  />
                ) : (
                  <VirtualPlaylistList
                    playlists={results as Playlist[]}
                    loading={loading}
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={loadMore}
                    onSelect={handleSelectAlbum}
                  />
                )
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                  <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Music2 className="h-8 w-8" />
                    <span className="text-sm">{t('startSearch')}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
