import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Playlist } from '@music-together/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMusic, Loader2, Music2 } from 'lucide-react'
import { useEffect, useState } from 'react'

const LOAD_MORE_THRESHOLD = 5

interface VirtualPlaylistListProps {
  playlists: Playlist[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onSelect: (playlist: Playlist) => void
  emptyMessage?: string
  className?: string
}

export function VirtualPlaylistList({
  playlists,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  emptyMessage = '暂无结果，换个关键词试试',
  className,
}: VirtualPlaylistListProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const rowCount = playlists.length + (hasMore ? 1 : 0)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => 68,
    overscan: 5,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastItem = virtualItems.at(-1)

  useEffect(() => {
    if (!lastItem) return
    if (lastItem.index >= playlists.length - LOAD_MORE_THRESHOLD && hasMore && !loadingMore) {
      onLoadMore()
    }
  }, [lastItem?.index, playlists.length, hasMore, loadingMore, onLoadMore])

  if (loading && playlists.length === 0) {
    return (
      <div className={cn('min-h-0 flex-1 overflow-y-auto rounded-md border', className)}>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (playlists.length === 0) {
    return (
      <div className={cn('min-h-0 flex-1 overflow-y-auto rounded-md border', className)}>
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Music2 className="h-8 w-8" />
          <span className="text-sm">{emptyMessage}</span>
        </div>
      </div>
    )
  }

  return (
    <div ref={setScrollElement} className={cn('min-h-0 flex-1 overflow-y-auto rounded-md border p-2', className)}>
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= playlists.length
          const rowStyle = {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            width: '100%',
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          }

          if (isLoaderRow) {
            return (
              <div key="loader" style={rowStyle} className="flex items-center justify-center">
                <Button variant="ghost" size="sm" className="w-full" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loadingMore ? '加载中...' : '加载更多'}
                </Button>
              </div>
            )
          }

          const playlist = playlists[virtualRow.index]
          if (!playlist) return null

          return (
            <button
              key={`${playlist.id}-${virtualRow.index}`}
              style={rowStyle}
              className="hover:bg-accent flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg p-2 text-left transition-colors"
              onClick={() => onSelect(playlist)}
            >
              {playlist.cover ? (
                <img src={playlist.cover} alt={playlist.name} className="h-12 w-12 shrink-0 rounded-md object-cover" loading="lazy" />
              ) : (
                <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-md">
                  <ListMusic className="text-muted-foreground h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{playlist.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {playlist.trackCount} 首{playlist.creator ? ` · ${playlist.creator}` : ''}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
