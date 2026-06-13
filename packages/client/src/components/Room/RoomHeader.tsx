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
import { PLATFORM_ACTIVE, PLATFORM_TEXT } from '@/lib/platform'
import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useAccountStore } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { EVENTS, type AudioQuality, type StreamSource } from '@music-together/shared'
import { Check, Copy, Ellipsis, LogOut, Search, Settings, Users, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface RoomHeaderProps {
  onOpenSearch: () => void
  onOpenSettings: () => void
  onOpenMembers: () => void
  onLeaveRoom: () => void
}

function getSourceLabel(source?: StreamSource): string {
  if (source === 'unm') return 'UNM'
  if (source === 'netease') return '网易云'
  if (source === 'tencent') return 'QQ'
  if (source === 'kugou') return '酷狗'
  return ''
}

export function RoomHeader({ onOpenSearch, onOpenSettings, onOpenMembers, onLeaveRoom }: RoomHeaderProps) {
  const roomName = useRoomStore((s) => s.room?.name)
  const roomId = useRoomStore((s) => s.room?.id)
  const room = useRoomStore((s) => s.room)
  const currentUser = useRoomStore((s) => s.currentUser)
  const userCount = useRoomStore((s) => s.room?.users.filter((user) => user.online !== false).length ?? 0)
  const audioQuality = useRoomStore((s) => s.room?.currentTrack?.streamQuality ?? s.room?.audioQuality)
  const availableStreamQualities = useRoomStore((s) => s.room?.currentTrack?.availableStreamQualities)
  const streamSource = usePlayerStore((s) => (s.currentTrack?.streamSource ?? s.currentTrack?.source) as StreamSource | undefined)
  const hideSourcePill = useSettingsStore((s) => s.hidePlayerQualityButton)
  const auth = useAuth()
  const { socket, isConnected } = useSocketContext()
  const isRoomAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'
  const isServerAdmin = useAccountStore((s) => s.me?.role === 'admin')
  const canManageRoom = isRoomAdmin || isServerAdmin
  const [rtt, setRtt] = useState(0)

  useEffect(() => {
    if (!isConnected) {
      setRtt(0)
      return
    }
    setRtt(getMedianRTT())
    const timer = setInterval(() => setRtt(getMedianRTT()), 3000)
    return () => clearInterval(timer)
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
    toast.success('房间链接已复制')
  }

  const sourceLabel = getSourceLabel(streamSource)
  const sourceClass =
    streamSource === 'unm'
      ? 'bg-muted/70 text-muted-foreground'
      : streamSource
        ? `${PLATFORM_ACTIVE[streamSource]} ${PLATFORM_TEXT[streamSource]}`
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
                <Button variant="outline" size="sm" className="hidden h-7 gap-1 rounded-md border-border/50 px-2 font-mono text-xs sm:flex" onClick={copyRoomLink} aria-label="复制房间链接">
                  {roomId}
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>复制房间链接</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-sm text-muted-foreground" onClick={onOpenMembers} aria-label="查看成员">
                  <Users className="h-3.5 w-3.5" />
                  {userCount}
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看成员</TooltipContent>
            </Tooltip>
          </>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1" role="status" aria-live="polite" aria-label={isConnected ? `已连接，延迟 ${Math.round(rtt)}ms` : '连接断开，正在重连'}>
              {isConnected ? <Wifi className={`h-4 w-4 ${rttColor}`} /> : <WifiOff className="h-4 w-4 animate-pulse text-destructive" />}
              {isConnected && <span className={`font-mono text-xs tabular-nums ${rttColor}`}>{Math.round(rtt)}ms</span>}
            </span>
          </TooltipTrigger>
          <TooltipContent>{isConnected ? `已连接，延迟 ${Math.round(rtt)}ms` : '连接断开，正在重连...'}</TooltipContent>
        </Tooltip>

        {sourceLabel && !hideSourcePill && (
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
                      <span className="min-w-0 truncate">{option.label}</span>
                      {isSelectedQuality(option) && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </span>
                    {option.platform && (
                      <span className={option.platform === 'unm' ? 'shrink-0 text-[10px] text-muted-foreground' : `shrink-0 text-[10px] ${PLATFORM_TEXT[option.platform]}`}>
                        {platformLabel(option.platform)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" onClick={onOpenSearch} aria-label="搜索点歌">
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>搜索点歌</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0" onClick={onOpenSettings} aria-label="设置">
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden h-8 w-8 min-h-11 min-w-11 sm:flex sm:min-h-0 sm:min-w-0" onClick={onLeaveRoom} aria-label="离开房间">
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>离开房间</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 min-h-11 min-w-11 sm:hidden sm:min-h-0 sm:min-w-0" aria-label="更多操作">
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings className="mr-2 h-4 w-4" />
              设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={copyRoomLink}>
              <Copy className="mr-2 h-4 w-4" />
              复制房间链接
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onLeaveRoom}>
              <LogOut className="mr-2 h-4 w-4" />
              离开房间
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
