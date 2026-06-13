import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useContainerPortrait } from '@/hooks/useContainerPortrait'
import { useCoverWidth } from '@/hooks/useCoverWidth'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useVote } from '@/hooks/useVote'
import { SERVER_URL } from '@/lib/config'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/stores/playerStore'
import { useSettingsStore } from '@/stores/settingsStore'

import { BackgroundRender } from '@applemusic-like-lyrics/react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VoteBanner } from '../Vote/VoteBanner'
import { LyricDisplay } from './LyricDisplay'
import { NowPlaying } from './NowPlaying'
import { PlayerControls } from './PlayerControls'
import { SongInfoBar } from './SongInfoBar'

const FULL_SIZE_STYLE = { width: '100%', height: '100%' } as const
const DEFAULT_COVER_URL = '/logo.svg'

const LYRIC_MASK_STYLE = {
  maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
} as const

/**
 * 需要通过服务端代理的封面域名列表
 * 这些 CDN 不允许跨域请求，AMLL 的 WebGL 纹理加载会被 CORS 拦截
 */
const PROXY_COVER_HOSTS = [
  'y.gtimg.cn',        // QQ 音乐
  'imgessl.kugou.com', // 酷狗
]

/**
 * 如果封面 URL 属于需要代理的域名，则返回服务端代理 URL；否则原样返回
 */
function getProxiedCoverUrl(coverUrl: string): string {
  try {
    const { hostname } = new URL(coverUrl)
    if (PROXY_COVER_HOSTS.includes(hostname)) {
      return `${SERVER_URL}/api/music/cover-proxy?url=${encodeURIComponent(coverUrl)}`
    }
  } catch {
    // URL 解析失败，原样返回
  }
  return coverUrl
}

interface AudioPlayerProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenChat: () => void
  onOpenQueue: () => void
  chatUnreadCount: number
  onFullscreenChange?: (fullscreen: boolean) => void
  fullscreenSignal?: number
}

export function AudioPlayer({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenChat,
  onOpenQueue,
  chatUnreadCount,
  onFullscreenChange,
  fullscreenSignal,
}: AudioPlayerProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack)
  const setLyricFrameSuspended = usePlayerStore((s) => s.setLyricFrameSuspended)
  const { activeVote, castVote, startVote } = useVote()
  const bgFps = useSettingsStore((s) => s.bgFps)
  const bgFlowSpeed = useSettingsStore((s) => s.bgFlowSpeed)
  const bgRenderScale = useSettingsStore((s) => s.bgRenderScale)
  const performanceOptimization = useSettingsStore((s) => s.performanceOptimization)
  const t = useI18n((s) => s.t)
  const { ref: playerRef, isPortrait } = useContainerPortrait()
  const isMobile = useIsMobile()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fullscreenButtonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lyricTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lyricFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backgroundResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false)
  const [showMobileFullscreenButton, setShowMobileFullscreenButton] = useState(true)
  const [mobileTransitioning, setMobileTransitioning] = useState(false)
  const [backgroundTransitioning, setBackgroundTransitioning] = useState(false)


  // 封面 URL 代理：解决 QQ 音乐 / 酷狗等 CDN 的 CORS 限制
  const proxiedCover = useMemo(
    () => (currentTrack?.cover ? getProxiedCoverUrl(currentTrack.cover) : DEFAULT_COVER_URL),
    [currentTrack?.cover],
  )

  const revealFullscreenButton = useCallback(() => {
    if (!isMobile) return
    setShowMobileFullscreenButton(true)
    if (fullscreenButtonTimerRef.current) clearTimeout(fullscreenButtonTimerRef.current)
    fullscreenButtonTimerRef.current = setTimeout(() => {
      setShowMobileFullscreenButton(false)
    }, 5000)
  }, [isMobile])

  useEffect(() => {
    onFullscreenChange?.(isPlayerFullscreen)
  }, [isPlayerFullscreen, onFullscreenChange])

  useEffect(() => {
    if (isMobile) {
      revealFullscreenButton()
      return
    }
    setShowMobileFullscreenButton(true)
    if (fullscreenButtonTimerRef.current) clearTimeout(fullscreenButtonTimerRef.current)
  }, [isMobile, revealFullscreenButton])

  useEffect(() => {
    return () => {
      if (fullscreenButtonTimerRef.current) clearTimeout(fullscreenButtonTimerRef.current)
    }
  }, [])

  const runWithInteraction = useCallback(
    <Args extends unknown[]>(action: (...args: Args) => void) =>
      (...args: Args) => {
        revealFullscreenButton()
        action(...args)
      },
    [revealFullscreenButton],
  )

  const togglePlayerFullscreen = useCallback(() => {
    revealFullscreenButton()
    setIsPlayerFullscreen((current) => !current)
  }, [revealFullscreenButton])

  useEffect(() => {
    if (!fullscreenSignal) return
    togglePlayerFullscreen()
  }, [fullscreenSignal, togglePlayerFullscreen])

  // Mobile: toggle between cover view and lyric view
  const [lyricExpanded, setLyricExpanded] = useState(false)

  // Measure cover area to constrain info/controls width (paused during lyric mode)
  const { ref: coverAreaRef, coverWidth } = useCoverWidth(lyricExpanded)
  const toggleLyricView = useCallback(() => {
    if (performanceOptimization) {
      setMobileTransitioning(true)
      setBackgroundTransitioning(true)
      setLyricFrameSuspended(true)
      if (lyricTransitionTimerRef.current) clearTimeout(lyricTransitionTimerRef.current)
      if (lyricFrameTimerRef.current) clearTimeout(lyricFrameTimerRef.current)
      if (backgroundResumeTimerRef.current) clearTimeout(backgroundResumeTimerRef.current)
      lyricTransitionTimerRef.current = window.setTimeout(() => {
        lyricTransitionTimerRef.current = null
        setMobileTransitioning(false)
      }, 360)
      lyricFrameTimerRef.current = window.setTimeout(() => {
        lyricFrameTimerRef.current = null
        setLyricFrameSuspended(false)
      }, 420)
      backgroundResumeTimerRef.current = window.setTimeout(() => {
        backgroundResumeTimerRef.current = null
        setBackgroundTransitioning(false)
      }, 520)
    }
    setLyricExpanded((v) => !v)
  }, [performanceOptimization, setLyricFrameSuspended])

  useEffect(() => {
    if (!performanceOptimization) setLyricFrameSuspended(false)
    return () => {
      if (lyricTransitionTimerRef.current) clearTimeout(lyricTransitionTimerRef.current)
      if (lyricFrameTimerRef.current) clearTimeout(lyricFrameTimerRef.current)
      if (backgroundResumeTimerRef.current) clearTimeout(backgroundResumeTimerRef.current)
      setLyricFrameSuspended(false)
    }
  }, [performanceOptimization, setLyricFrameSuspended])

  // Derived styles to constrain info/controls to cover width
  const coverMaxStyle = coverWidth ? { maxWidth: coverWidth } : undefined
  const coverMaxStyleUnlessExpanded = lyricExpanded ? undefined : coverMaxStyle

  const playerControlsProps = {
    onPlay: runWithInteraction(onPlay),
    onPause: runWithInteraction(onPause),
    onSeek: runWithInteraction(onSeek),
    onNext: runWithInteraction(onNext),
    onPrev: runWithInteraction(onPrev),
    onOpenQueue: runWithInteraction(onOpenQueue),
    onStartVote: startVote,
  } as const

  const songInfoProps = {
    onOpenChat: runWithInteraction(onOpenChat),
    chatUnreadCount,
    disableLayoutAnimation: false,
  } as const
  const disableMobileLayoutAnimation = false

  return (
    <div
      ref={rootRef}
      onPointerDownCapture={revealFullscreenButton}
      onKeyDownCapture={revealFullscreenButton}
      className={cn(
        'relative flex h-full flex-col overflow-hidden bg-background',
        isPlayerFullscreen && 'fixed inset-0 z-40 rounded-none',
      )}
    >
      {proxiedCover && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-80 saturate-[1.3]">
          <BackgroundRender
            album={proxiedCover}
            playing={!(performanceOptimization && (mobileTransitioning || backgroundTransitioning))}
            fps={bgFps}
            flowSpeed={bgFlowSpeed}
            renderScale={bgRenderScale}
            style={FULL_SIZE_STYLE}
          />
        </div>
      )}

      <div className="group/fullscreen absolute top-0 right-0 z-30 flex h-20 w-20 items-start justify-end p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-full bg-black/20 text-white/80 backdrop-blur-md transition-opacity duration-150 hover:bg-white/15 hover:text-white focus-visible:opacity-100',
                isMobile ? (showMobileFullscreenButton ? 'opacity-100' : 'opacity-0') : 'opacity-0 group-hover/fullscreen:opacity-100',
              )}
              onClick={togglePlayerFullscreen}
              aria-label={isPlayerFullscreen ? t('exitFullscreen') : t('fullscreen')}
            >
              {isPlayerFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPlayerFullscreen ? t('exitFullscreen') : t('fullscreen')}</TooltipContent>
        </Tooltip>
      </div>

      {/* Content with padding */}
      <div className="relative z-10 h-full p-5 md:p-[5%] lg:p-[5%]">
        <div
          ref={playerRef}
          className={cn('flex h-full', isPortrait ? 'flex-col' : 'flex-row gap-[clamp(24px,3vw,48px)]')}
        >
          {/* ----------------------------------------------------------------- */}
          {/* Mobile layout: dual-mode (cover view / lyric view)                */}
          {/* ----------------------------------------------------------------- */}
          {isPortrait ? (
            <LayoutGroup id={disableMobileLayoutAnimation ? 'mobile-static' : 'mobile-shared'}>
              <div className="relative mx-auto flex h-full w-full max-w-md flex-col items-center gap-[clamp(12px,3vh,32px)]">
                {/* 1. Cover — fills remaining space in cover mode, centered within */}
                <div
                  ref={coverAreaRef}
                  className={cn('w-full min-h-0', lyricExpanded ? 'shrink-0' : 'flex-1 flex items-center justify-center')}
                  style={!lyricExpanded ? ({ containerType: 'size' } as React.CSSProperties) : undefined}
                >
                  <NowPlaying compact={lyricExpanded} onCoverClick={toggleLyricView} disableLayoutAnimation={disableMobileLayoutAnimation} />
                </div>

                {/* Lyrics — popLayout so exiting lyrics don't occupy flex space */}
                {disableMobileLayoutAnimation ? (
                  <div
                    className={cn(
                      'min-h-0 w-full flex-1 overflow-hidden will-change-transform transition-[opacity,transform] duration-350 ease-out',
                      lyricExpanded ? 'translate-y-0 opacity-100' : 'pointer-events-none max-h-0 translate-y-8 opacity-0',
                    )}
                    style={LYRIC_MASK_STYLE}
                  >
                    <LyricDisplay />
                  </div>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {lyricExpanded && (
                      <motion.div
                        key="lyrics"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="relative z-20 h-full min-h-0 w-full flex-1 overflow-hidden"
                        style={LYRIC_MASK_STYLE}
                      >
                        <LyricDisplay />
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}

                {/* 2. Song info + action buttons (independent zoom module) */}
                {!lyricExpanded && (
                  <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                    <SongInfoBar {...songInfoProps} />
                  </div>
                )}

                {/* 3. Controls (independent zoom module) */}
                <div className="relative z-10 w-full shrink-0 mx-auto" style={coverMaxStyleUnlessExpanded}>
                  <PlayerControls {...playerControlsProps} />
                </div>

                {/* Vote banner: absolute overlay at the bottom */}
                {activeVote && (
                  <div className="absolute bottom-0 left-1/2 z-20 w-full -translate-x-1/2 px-2 pb-2">
                    <VoteBanner vote={activeVote} onCastVote={castVote} />
                  </div>
                )}
              </div>
            </LayoutGroup>
          ) : (
            // ---------------------------------------------------------------
            // Desktop layout: left panel (cover + info + controls) + right lyrics
            // ---------------------------------------------------------------
            <>
              <div
                className="relative flex w-[40%] flex-col items-center gap-[clamp(12px,3vh,32px)] transition-all duration-300"
              >
                {/* 1. Cover — flex-1 fills remaining space, centered */}
                <div ref={coverAreaRef} className="min-h-0 w-full flex-1 flex items-center justify-center" style={{ containerType: 'size' }}>
                  <NowPlaying />
                </div>
                {/* 2. Song info + action buttons */}
                <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                  <SongInfoBar {...songInfoProps} />
                </div>
                {/* 3. Controls */}
                <div className="w-full shrink-0 mx-auto" style={coverMaxStyle}>
                  <PlayerControls {...playerControlsProps} />
                </div>
                {activeVote && (
                  <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-2 pb-2">
                    <div className="w-full">
                      <VoteBanner vote={activeVote} onCastVote={castVote} />
                    </div>
                  </div>
                )}
              </div>
              <div className="min-h-0 w-[60%] overflow-hidden" style={LYRIC_MASK_STYLE}>
                <LyricDisplay />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
