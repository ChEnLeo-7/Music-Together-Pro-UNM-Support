import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTime } from '@/lib/format'
import { AbilityContext } from '@/providers/AbilityProvider'
import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import type { PlayMode, VoteAction } from '@music-together/shared'
import { EVENTS, TIMING } from '@music-together/shared'
import { ArrowRightToLine, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n, type I18nKey } from '@/lib/i18n'

/** Must match SongInfoBar so both modules scale identically with the cover. */
const DESIGN_WIDTH = 300

const PLAY_MODE_CYCLE: PlayMode[] = ['sequential', 'loop-all', 'loop-one', 'shuffle']

const PLAY_MODE_CONFIG: Record<PlayMode, { icon: typeof Repeat; labelKey: I18nKey }> = {
  sequential: { icon: ArrowRightToLine, labelKey: 'modeSequential' },
  'loop-all': { icon: Repeat, labelKey: 'modeLoopAll' },
  'loop-one': { icon: Repeat1, labelKey: 'modeLoopOne' },
  shuffle: { icon: Shuffle, labelKey: 'modeShuffle' },
}

interface PlayerControlsProps {
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrev: () => void
  onOpenQueue: () => void
  onStartVote: (action: VoteAction, payload?: Record<string, unknown>) => void
}

export const PlayerControls = memo(function PlayerControls({
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onOpenQueue,
  onStartVote,
}: PlayerControlsProps) {
  const { socket } = useSocketContext()
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const currentTrack = useRoomStore((s) => s.room?.currentTrack ?? null)
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0)
  const playMode = useRoomStore((s) => s.room?.playMode ?? 'sequential')
  const ability = useContext(AbilityContext)
  const canSeek = ability.can('seek', 'Player')
  const canPlay = ability.can('play', 'Player')
  const canSetMode = ability.can('set-mode', 'Player')
  const canVote = ability.can('vote', 'Player')
  const [skipCooldown, setSkipCooldown] = useState(false)
  const [playCooldown, setPlayCooldown] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(0)
  const seekDurationRef = useRef(0)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const playCooldownTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const disabled = !currentTrack
  const t = useI18n((s) => s.t)

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner) return
    const update = () => {
      inner.style.setProperty('zoom', String(wrapper.clientWidth / DESIGN_WIDTH))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  // Clean up cooldown timers on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
      if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    }
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsSeeking(false))
    seekDurationRef.current = 0
    return () => cancelAnimationFrame(frame)
  }, [currentTrack?.id])

  const handleSkip = (action: () => void, voteAction: 'next' | 'prev') => {
    if (skipCooldown) return
    if (ability.can(voteAction, 'Player')) {
      action()
    } else if (canVote) {
      onStartVote(voteAction)
    }
    setSkipCooldown(true)
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    cooldownTimer.current = setTimeout(() => setSkipCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayPause = () => {
    if (playCooldown) return
    if (canPlay) {
      if (isPlaying) onPause()
      else onPlay()
    } else if (canVote) {
      onStartVote(isPlaying ? 'pause' : 'resume')
    }
    setPlayCooldown(true)
    if (playCooldownTimer.current) clearTimeout(playCooldownTimer.current)
    playCooldownTimer.current = setTimeout(() => setPlayCooldown(false), TIMING.PLAYER_NEXT_DEBOUNCE_MS)
  }

  const handlePlayModeToggle = () => {
    const currentIdx = PLAY_MODE_CYCLE.indexOf(playMode)
    const nextMode = PLAY_MODE_CYCLE[(currentIdx + 1) % PLAY_MODE_CYCLE.length]
    if (canSetMode) {
      socket.emit(EVENTS.PLAYER_SET_MODE, { mode: nextMode })
    } else if (canVote) {
      onStartVote('set-mode', { mode: nextMode })
    }
  }

  const modeConfig = PLAY_MODE_CONFIG[playMode]
  const ModeIcon = modeConfig.icon
  const modeLabel = t(modeConfig.labelKey)

  return (
    <div ref={wrapperRef} className="w-full">
      <div ref={innerRef} className="flex flex-col gap-6" style={{ width: DESIGN_WIDTH }}>
        {/* 1. Progress bar */}
        <div className="flex w-full flex-col gap-1">
          <Slider
            value={[
              duration > 0 ? Math.max(0, Math.min(100, ((isSeeking ? seekTime : currentTime) / duration) * 100)) : 0,
            ]}
            max={100}
            step={0.1}
            disabled={disabled || !canSeek || duration <= 0}
            onValueChange={(val) => {
              if (duration > 0) {
                if (!isSeeking) seekDurationRef.current = duration
                setIsSeeking(true)
                setSeekTime((val[0] / 100) * seekDurationRef.current)
              }
            }}
            onValueCommit={(val) => {
              const seekDuration = seekDurationRef.current || duration
              if (seekDuration > 0) {
                onSeek((val[0] / 100) * seekDuration)
              }
              setIsSeeking(false)
              seekDurationRef.current = 0
            }}
            className="min-h-8 w-full py-2"
          />
          <div className="flex w-full justify-between">
            <span className="text-xs text-white/50 tabular-nums">{formatTime(isSeeking ? seekTime : currentTime)}</span>
            <span className="text-xs text-white/50 tabular-nums">{formatTime(duration)}</span>
          </div>
        </div>

        {/* 2. Controls row — left/right flex-1 keeps center truly centered */}
        <div className="flex w-full items-center">
          {/* Left: play mode */}
          <div className="flex flex-1 items-center justify-start">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-white/70 hover:bg-white/10"
                    onClick={handlePlayModeToggle}
                    disabled={!canSetMode && !canVote}
                    aria-label={modeLabel}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={playMode}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <ModeIcon className="size-5" />
                      </motion.div>
                    </AnimatePresence>
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{modeLabel}</TooltipContent>
            </Tooltip>
          </div>

          {/* Center: prev + play/pause + next */}
          <div className="flex items-center gap-2">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-white/70 hover:bg-white/10"
                    disabled={disabled || skipCooldown}
                    onClick={() => handleSkip(onPrev, 'prev')}
                    aria-label={t('previousTrack')}
                  >
                    <SkipBack className="size-5" fill="currentColor" />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{t('previousTrack')}</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-14 w-14 rounded-full bg-white/20 text-white/90 hover:bg-white/30 hover:text-white"
                    disabled={disabled || playCooldown || (!canPlay && !canVote)}
                    onClick={handlePlayPause}
                    aria-label={isPlaying ? t('pause') : t('play')}
                  >
                    {isPlaying ? (
                      <Pause className="size-7" fill="currentColor" />
                    ) : (
                      <Play className="ml-0.5 size-7" fill="currentColor" />
                    )}
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{isPlaying ? t('pause') : t('play')}</TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-white/70 hover:bg-white/10"
                    disabled={disabled || skipCooldown}
                    onClick={() => handleSkip(onNext, 'next')}
                    aria-label={t('nextTrack')}
                  >
                    <SkipForward className="size-5" fill="currentColor" />
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{t('nextTrack')}</TooltipContent>
            </Tooltip>
          </div>

          {/* Right: queue */}
          <div className="flex flex-1 items-center justify-end">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <motion.div whileTap={{ scale: 0.9 }}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-9 w-9 text-white/70 hover:bg-white/10"
                    onClick={onOpenQueue}
                    aria-label={t('playlist')}
                  >
                    <ListMusic className="size-5" />
                    {queueLength > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-semibold leading-none text-black">
                        {queueLength > 99 ? '99+' : queueLength}
                      </span>
                    )}
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>{t('playlist')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
})
