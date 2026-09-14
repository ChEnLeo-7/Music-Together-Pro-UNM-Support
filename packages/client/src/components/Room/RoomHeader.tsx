import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/useAuth'
import { getAudioQualityOptionsForSource, platformLabel, sourceToPriority } from '@/lib/audioQuality'
import { getMedianRTT } from '@/lib/clockSync'
import { TRACK_SOURCE_ACTIVE, TRACK_SOURCE_TEXT } from '@/lib/platform'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { EVENTS, type AudioQuality, type StreamSource } from '@music-together/shared'
import { Check, Copy, Ellipsis, LogOut, Search, Settings, Users, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

interface RoomHeaderProps {
  onOpenSearch: (source?: 'custom') => void
  onOpenSettings: () => void
  onOpenMembers: () => void
  onLeaveRoom: () => void
}

export function RoomHeader({ onOpenSearch, onOpenSettings, onOpenMembers, onLeaveRoom }: RoomHeaderProps) {
  const t = useI18n((s) => s.t)
  const roomName = useRoomStore((s) => s.room?.name)
  const roomId = useRoomStore((s) => s.room?.id)
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const userCount = useRoomStore((s) => s.room?.users.filter((user) => user.online !== false).length ?? 0)
  const audioQuality = useRoomStore((s) => s.room?.currentTrack?.streamQuality ?? s.room?.audioQuality)
  const availableStreamQualities = useRoomStore((s) => s.room?.currentTrack?.availableStreamQualities)
  const streamSource = useRoomStore(
    (s) => (s.room?.currentTrack?.streamSource ?? s.room?.currentTrack?.source) as StreamSource | undefined,
  )
  const hideSourcePill = useSettingsStore((s) => s.hidePlayerQualityButton)
  const auth = useAuth()
  const { socket, isConnected } = useSocketContext()
  const isRoomAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'
  const isServerAdmin = useAccountStore((s) => s.me?.role === 'admin')
  const canManageRoom = isRoomAdmin || isServerAdmin
  const [rtt, setRtt] = useState(0)

  useEffect(() => {
    if (!isConnected) {
      const frame = requestAnimationFrame(() => setRtt(0))
      return () => cancelAnimationFrame(frame)
    }
    const frame = requestAnimationFrame(() => setRtt(getMedianRTT()))
    const timer = setInterval(() => setRtt(getMedianRTT()), 3000)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
    }
  }, [isConnected])

  useEffect(() => {
    if (!isConnected || !roomId) return
    socket.emit(EVENTS.AUTH_GET_STATUS)
  }, [isConnected, roomId, socket])

  const rttColor = !isConnected
    ? 'text-destructive'
    : rtt < 100
      ? 'text-emerald-500/60'
      : rtt < 300
        ? 'text-yellow-500/60'
        : 'text-destructive/60'

  const copyRoomLink = () => {
    if (!roomId) return
    navigator.clipboard.writeText(window.location.href)
    toast.success(t('roomLinkCopied'))
  }

  const sourceLabel = streamSource ? platformLabel(streamSource, t) : ''
  const sourceClass =
    streamSource === 'unm'
      ? 'bg-muted/70 text-muted-foreground'
      : streamSource
        ? `${TRACK_SOURCE_ACTIVE[streamSource]} ${TRACK_SOURCE_TEXT[streamSource]}`
        : 'bg-muted/50 text-muted-foreground'
  const qualityOptions = getAudioQualityOptionsForSource(streamSource, auth.platformStatus, availableStreamQualities)
  const isSelectedQuality = (option: (typeof qualityOptions)[number]) => {
    if (option.value !== audioQuality) return false
    if (streamSource === 'unm') return option.platform === 'unm' || !option.platform
    return option.platform !== 'unm'
  }

  const selectQuality = (value: AudioQuality) => {
    if (!canManageRoom || !room?.currentTrack || !streamSource) return
    socket.emit(EVENTS.PLAYER_PLAY, {
      track: room.currentTrack,
      audioQuality: value,
      sourcePriority: sourceToPriority(streamSource),
      forceRefreshStream: true,
    })
  }

  return (
    <header className="flex items-center justify-between border-b border-border/50 bg-background/95 px-4 py-2 backdrop-blur-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-1.5 pl-2 sm:gap-3">
        {roomId && (
          <>
            <span
              className="max-w-[120px] cursor-pointer truncate text-sm font-semibold text-foreground active:opacity-70 sm:max-w-[200px] sm:cursor-default"
              onClick={copyRoomLink}
            >
              {roomName}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden h-7 gap-1 rounded-md border-border/50 px-2 font-mono text-xs sm:flex"
                  onClick={copyRoomLink}
                  aria-label={t('copyRoomLinkAria')}
                >
                  {roomId}
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('copyRoomLink')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-1.5 text-sm text-muted-foreground"
                  onClick={onOpenMembers}
                  aria-label={t('viewMembers')}
                >
                  <Users className="h-3.5 w-3.5" />
                  {userCount}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('viewMembers')}</TooltipContent>
            </Tooltip>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex items-center gap-1"
              role="status"
              aria-live="polite"
              aria-label={
                isConnected ? t('connectedLatency', { latency: Math.round(rtt) }) : t('disconnectedReconnecting')
              }
            >
              {isConnected ? (
                <Wifi className={`h-4 w-4 ${rttColor}`} />
              ) : (
                <WifiOff className="h-4 w-4 animate-pulse text-destructive" />
              )}
              {isConnected && <span className={`font-mono text-xs tabular-nums ${rttColor}`}>{Math.round(rtt)}ms</span>}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isConnected ? t('connectedLatency', { latency: Math.round(rtt) }) : t('disconnectedReconnectingEllipsis')}
          </TooltipContent>
        </Tooltip>

        {sourceLabel &&
          !hideSourcePill &&
          (streamSource === 'custom' ? (
            <span
              className={`inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium leading-none ${sourceClass}`}
            >
              <button
                type="button"
                className="cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
                onClick={() => onOpenSearch('custom')}
                aria-label={t('openCustomMedia')}
              >
                {sourceLabel}
              </button>
            </span>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!canManageRoom}
                  className={`inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium leading-none transition-colors disabled:pointer-events-none ${sourceClass}`}
                >
                  {sourceLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-60 rounded-xl p-1">
                <div className="max-h-72 overflow-y-auto">
                  {qualityOptions.map((option) => (
                    <button
                      key={`${option.platform ?? 'base'}:${option.value}`}
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                        isSelectedQuality(option) ? 'bg-accent text-accent-foreground' : ''
                      }`}
                      disabled={!canManageRoom}
                      onClick={() => selectQuality(option.value)}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate">{t(option.labelKey)}</span>
                        {isSelectedQuality(option) && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </span>
                      {option.platform && (
                        <span
                          className={
                            option.platform === 'unm'
                              ? 'shrink-0 text-[10px] text-muted-foreground'
                              : option.platform === 'custom'
                                ? 'shrink-0 text-[10px] text-violet-500'
                                : `shrink-0 text-[10px] ${TRACK_SOURCE_TEXT[option.platform]}`
                          }
                        >
                          {platformLabel(option.platform, t)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ))}
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              onClick={() => onOpenSearch()}
              aria-label={t('searchMusicAria')}
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('searchMusic')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0"
              onClick={onOpenSettings}
              aria-label={t('settingsAction')}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('settingsAction')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0"
              onClick={onLeaveRoom}
              aria-label={t('leaveRoom')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('leaveRoom')}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 min-h-11 min-w-11 sm:hidden sm:min-h-0 sm:min-w-0"
              aria-label={t('moreActions')}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings className="mr-2 h-4 w-4" />
              {t('settingsAction')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyRoomLink}>
              <Copy className="mr-2 h-4 w-4" />
              {t('copyRoomLink')}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLeaveRoom}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('leaveRoom')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
