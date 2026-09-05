import { MarqueeText } from '@/components/ui/marquee-text'
import { cn } from '@/lib/utils'
import { isServerAssetUrl, resolveServerAssetUrl } from '@/lib/config'
import { useRoomStore } from '@/stores/roomStore'
import { Disc3 } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ARTIST_LAYOUT_TRANSITION, LAYOUT_TRANSITION, TITLE_LAYOUT_TRANSITION } from './constants'
import { useI18n } from '@/lib/i18n'

interface NowPlayingProps {
  /** Compact mode: small cover + song info in a single row (lyric view top bar) */
  compact?: boolean
  /** Called when the cover art is tapped (toggle lyric view) */
  onCoverClick?: () => void
  disableLayoutAnimation?: boolean
  sharedIdentity?: boolean
}

export function NowPlaying({
  compact = false,
  onCoverClick,
  disableLayoutAnimation = false,
  sharedIdentity = false,
}: NowPlayingProps) {
  const currentTrack = useRoomStore((s) => s.room?.currentTrack ?? null)
  const t = useI18n((s) => s.t)
  const [coverError, setCoverError] = useState(false)

  // Skip layoutId on first frame to prevent unwanted entry animation
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(true)
  }, [])
  const layoutId = ready && !disableLayoutAnimation ? 'cover-art' : undefined

  // Reset error state when track changes
  useEffect(() => {
    setCoverError(false)
  }, [currentTrack?.id])

  const showCover = currentTrack?.cover && !coverError

  const coverContent = showCover ? (
    <img
      src={resolveServerAssetUrl(currentTrack.cover)}
      crossOrigin={isServerAssetUrl(currentTrack.cover) ? 'use-credentials' : undefined}
      alt={currentTrack.title}
      className="h-full w-full object-cover"
      onError={() => setCoverError(true)}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-secondary">
      <Disc3 className={cn('text-white/20', compact ? 'h-6 w-6' : 'h-1/3 w-1/3')} />
    </div>
  )

  // ---------------------------------------------------------------------------
  // Compact mode: small cover + song info in a horizontal row (lyric view)
  // ---------------------------------------------------------------------------
  if (compact) {
    return (
      <div className="flex w-full items-center gap-3.5">
        <motion.button
          type="button"
          layoutId={layoutId}
          onClick={onCoverClick}
          whileTap={disableLayoutAnimation ? undefined : { scale: 0.92 }}
          transition={LAYOUT_TRANSITION}
          aria-label={t('showCover')}
          className="h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-md shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          {coverContent}
        </motion.button>
        <div className="min-w-0 flex-1">
          <motion.div
            layout={sharedIdentity ? 'position' : false}
            layoutId={sharedIdentity ? 'mobile-player-title' : undefined}
            transition={TITLE_LAYOUT_TRANSITION}
            className="text-[22px] font-semibold leading-tight text-white/90"
          >
            <MarqueeText>{currentTrack?.title ?? '暂无歌曲'}</MarqueeText>
          </motion.div>
          <motion.div
            layout={sharedIdentity ? 'position' : false}
            layoutId={sharedIdentity ? 'mobile-player-artist' : undefined}
            transition={ARTIST_LAYOUT_TRANSITION}
            className="text-base text-white/50"
          >
            <MarqueeText>{currentTrack ? currentTrack.artist.join(' / ') : '...'}</MarqueeText>
          </motion.div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Default mode: cover only (song info is handled by SongInfoBar)
  // ---------------------------------------------------------------------------
  const coverClassName = cn(
    'relative mx-auto aspect-square overflow-hidden rounded-3xl shadow-lg shadow-black/15',
    onCoverClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
  )
  const coverStyle = { width: 'min(100cqw, 100cqh)' }

  return onCoverClick ? (
    <motion.button
      type="button"
      layoutId={layoutId}
      onClick={onCoverClick}
      whileTap={disableLayoutAnimation ? undefined : { scale: 0.96 }}
      transition={LAYOUT_TRANSITION}
      style={coverStyle}
      className={coverClassName}
      aria-label={t('showLyrics')}
    >
      {coverContent}
    </motion.button>
  ) : (
    <motion.div transition={LAYOUT_TRANSITION} style={coverStyle} className={coverClassName}>
      {coverContent}
    </motion.div>
  )
}
