import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsResponsiveMobile } from '@/components/ui/responsive-dialog'
import { useAuth } from '@/hooks/useAuth'
import { usePlaylist } from '@/hooks/usePlaylist'
import { getAudioQualityOptions, platformLabel } from '@/lib/audioQuality'
import { SERVER_URL } from '@/lib/config'
import { useI18n } from '@/lib/i18n'
import { PLATFORM_COLORS, PLATFORM_SHORT_LABELS, PLATFORM_TEXT, getMyPlatformStatus, getPlatformStatus } from '@/lib/platform'
import { storage } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { EVENTS } from '@music-together/shared'
import type { AudioQuality, MusicSource, Playlist, SourcePriority } from '@music-together/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LoginSection } from './LoginSection'
import { ManualCookieDialog } from './ManualCookieDialog'
import { PlaylistDetail } from './PlaylistDetail'
import { PlaylistSection } from './PlaylistSection'
import { QrLoginDialog } from './QrLoginDialog'

type ViewState = { type: 'list' } | { type: 'detail'; playlist: Playlist; source: MusicSource }

const PLATFORMS: MusicSource[] = ['netease', 'tencent', 'kugou']
const SOURCE_PRIORITY_OPTIONS: Array<{ value: SourcePriority; label: string; description: string }> = [
  { value: 'smart', label: '智能模式', description: '平台优先，失败或无权限时 UNM 兜底' },
  { value: 'platform-first', label: '平台优先', description: '先用平台音源，失败后尝试 UNM' },
  { value: 'unm-first', label: 'UNM 优先', description: '先用 UNM，失败后尝试平台' },
  { value: 'platform-only', label: '仅平台', description: '只从平台获取，不使用 UNM' },
  { value: 'unm-only', label: '仅 UNM', description: '只从 UNM 获取，不使用平台音源' },
]

function qualityOptionKey(option: { value: AudioQuality; platform?: string }): string {
  return `${option.platform ?? 'base'}:${option.value}`
}

export function PlatformHub() {
  const auth = useAuth()
  const playlist = usePlaylist()
  const { socket } = useSocketContext()
  const t = useI18n((s) => s.t)
  const isMobileDialog = useIsResponsiveMobile()
  const roomId = useRoomStore((s) => s.room?.id)
  const roomUnmServerUrl = useRoomStore((s) => s.room?.unmServerUrl ?? '')
  const audioQuality = useRoomStore((s) => s.room?.audioQuality ?? 320)
  const sourcePriority = useRoomStore((s) => s.room?.sourcePriority ?? 'smart')
  const currentUser = useRoomStore((s) => s.currentUser)
  const isRoomAdmin = currentUser?.role === 'owner' || currentUser?.role === 'admin'
  const isServerAdmin = useAccountStore((s) => s.me?.role === 'admin')
  const canManageRoom = isRoomAdmin || isServerAdmin

  const [activePlatform, setActivePlatform] = useState<MusicSource>('netease')
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false)
  const [cookieDialogPlatform, setCookieDialogPlatform] = useState<MusicSource>('netease')
  const [viewState, setViewState] = useState<ViewState>({ type: 'list' })
  const [serverAuthPersistence, setServerAuthPersistence] = useState(() => storage.getServerAuthPersistence())
  const [unmServerUrl, setUnmServerUrl] = useState('')
  const [savingUnm, setSavingUnm] = useState(false)

  const qualityOptions = useMemo(
    () => getAudioQualityOptions(auth.platformStatus, Boolean(roomUnmServerUrl), sourcePriority),
    [auth.platformStatus, roomUnmServerUrl, sourcePriority],
  )
  const selectedQualityOption =
    (sourcePriority === 'unm-first' || sourcePriority === 'unm-only'
      ? qualityOptions.find((option) => option.value === audioQuality && option.platform === 'unm')
      : undefined) ??
    qualityOptions.find((option) => option.value === audioQuality && option.platform !== 'unm') ??
    qualityOptions.find((option) => option.value === audioQuality) ??
    qualityOptions.find((option) => option.value === 320)
  const visibleAudioQualityKey = selectedQualityOption ? qualityOptionKey(selectedQualityOption) : 'base:320'

  const updateRoomSetting = useCallback(
    (settings: { audioQuality?: AudioQuality; sourcePriority?: SourcePriority }) => {
      socket.emit(EVENTS.ROOM_SETTINGS, settings)
    },
    [socket],
  )

  const handleAudioQualityChange = useCallback(
    (key: string) => {
      const selected = qualityOptions.find((option) => qualityOptionKey(option) === key)
      if (!selected) return
      updateRoomSetting({
        audioQuality: selected.value,
      })
    },
    [qualityOptions, updateRoomSetting],
  )

  useEffect(() => {
    let cancelled = false
    if (!roomId) return
    fetch(`${SERVER_URL}/api/settings?roomId=${encodeURIComponent(roomId)}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { roomUnmServerUrl?: string } | null) => {
        if (!cancelled) setUnmServerUrl(data?.roomUnmServerUrl ?? '')
      })
      .catch(() => {
        if (!cancelled) setUnmServerUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  useEffect(() => {
    setUnmServerUrl(roomUnmServerUrl)
  }, [roomUnmServerUrl])

  const verifyingPlatforms = useMemo(() => {
    if (auth.statusLoaded) return {}
    const result: Partial<Record<MusicSource, boolean>> = {}
    for (const platform of PLATFORMS) {
      result[platform] = storage.hasAuthCookie(platform)
    }
    return result
  }, [auth.statusLoaded, auth.myStatus])

  const handleQrLogin = useCallback(() => {
    auth.requestQrCode(activePlatform)
    setQrDialogOpen(true)
  }, [auth, activePlatform])

  const handleCookieLogin = useCallback((platform: MusicSource) => {
    setCookieDialogPlatform(platform)
    setCookieDialogOpen(true)
  }, [])

  const handleCookieSubmit = useCallback(
    (cookie: string) => {
      auth.setCookie(cookieDialogPlatform, cookie, serverAuthPersistence)
      setCookieDialogOpen(false)
    },
    [auth, cookieDialogPlatform, serverAuthPersistence],
  )

  const handleServerAuthPersistenceChange = useCallback(
    (checked: boolean) => {
      setServerAuthPersistence(checked)
      storage.setServerAuthPersistence(checked)
      if (!checked) storage.setAuthCookies([])
      socket.emit(EVENTS.AUTH_SET_PERSISTENCE, { persist: checked })
    },
    [socket],
  )

  const handleSaveUnmServer = useCallback(async () => {
    setSavingUnm(true)
    try {
      if (!roomId) return
      const res = await fetch(`${SERVER_URL}/api/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, unmServerUrl }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Request failed: ${res.status}`)
      }
      const data = (await res.json()) as { roomUnmServerUrl?: string }
      setUnmServerUrl(data.roomUnmServerUrl ?? '')
      useRoomStore.getState().updateRoom({ unmServerUrl: data.roomUnmServerUrl ?? '' })
      toast.success(t('unmServerSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('adminLoadFailed'))
    } finally {
      setSavingUnm(false)
    }
  }, [roomId, t, unmServerUrl])

  const handleSelectPlaylist = useCallback(
    (pl: Playlist) => {
      setViewState({ type: 'detail', playlist: pl, source: activePlatform })
      playlist.fetchPlaylistTracks(activePlatform, pl.id, pl.trackCount)
    },
    [activePlatform, playlist],
  )

  if (viewState.type === 'detail') {
    return (
      <div className="min-h-0 min-w-0 max-w-full overflow-x-hidden">
        <PlaylistDetail
          playlist={viewState.playlist}
          tracks={playlist.playlistTracks}
          loading={playlist.tracksLoading}
          loadingMore={playlist.loadingMore}
          hasMore={playlist.hasMoreTracks}
          total={playlist.playlistTotal}
          onBack={() => setViewState({ type: 'list' })}
          onAddTrack={playlist.addTrackToQueue}
          onInsertAfterCurrent={playlist.insertTrackAfterCurrent}
          onAddAll={playlist.addBatchToQueue}
          onLoadMore={playlist.loadMoreTracks}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden pr-0 sm:pr-1">
      <div className="min-w-0 max-w-full">
        <h3 className="pr-8 text-base font-semibold">{t('platformAccounts')}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{t('platformAccountsDesc')}</p>

        {canManageRoom && (
          <>
            <div className="mb-3 flex min-w-0 max-w-full items-center justify-between gap-3 overflow-hidden rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('keepCookiesOnServer')}</p>
                <p className="text-xs text-muted-foreground">{t('keepCookiesOnServerDesc')}</p>
              </div>
              <Switch checked={serverAuthPersistence} onCheckedChange={handleServerAuthPersistenceChange} />
            </div>

            <div className="mb-3 min-w-0 max-w-full overflow-hidden rounded-md border px-3 py-2">
              <div className="mb-2 min-w-0">
                <p className="text-sm font-medium">{t('unmServer')}</p>
                <p className="text-xs text-muted-foreground">{t('unmServerDesc')}</p>
              </div>
              <div className={cn('grid min-w-0 grid-cols-1 gap-2', !isMobileDialog && 'sm:grid-cols-[minmax(0,1fr)_auto]')}>
                <Input value={unmServerUrl} onChange={(e) => setUnmServerUrl(e.target.value)} placeholder={t('unmServerPlaceholder')} className="min-w-0 max-w-full" />
                <Button variant="outline" onClick={handleSaveUnmServer} disabled={savingUnm} className={cn('w-full', !isMobileDialog && 'sm:w-auto')}>
                  {t('save')}
                </Button>
              </div>
            </div>

            <div className="mb-3 min-w-0 max-w-full overflow-hidden rounded-md border px-3 py-2">
              <div className="mb-2 min-w-0">
                <p className="text-sm font-medium">音源优先级</p>
                <p className="text-xs text-muted-foreground">控制平台音源与 UNM 的兜底顺序</p>
              </div>
              <div className={cn('grid min-w-0 gap-2', isMobileDialog ? 'grid-cols-1' : 'grid-cols-2')}>
                {SOURCE_PRIORITY_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={sourcePriority === option.value ? 'default' : 'outline'}
                    size="sm"
                    className={cn('h-auto min-w-0 flex-col items-start overflow-hidden whitespace-normal px-2 py-2 text-left text-xs', !isMobileDialog && 'sm:px-3 sm:text-sm')}
                    onClick={() => updateRoomSetting({ sourcePriority: option.value as SourcePriority })}
                  >
                    <span className="w-full truncate font-medium">{option.label}</span>
                    <span className="w-full truncate text-[10px] opacity-70">{option.description}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div
              className={cn(
                'mb-3 flex min-w-0 max-w-full flex-col items-stretch gap-3 overflow-hidden rounded-md border px-3 py-2',
                !isMobileDialog && 'sm:flex-row sm:items-center sm:justify-between',
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('audioQuality')}</p>
                <p className="text-xs text-muted-foreground">{t('appliesNextTrack')}</p>
              </div>
              <Select
                value={visibleAudioQualityKey}
                onValueChange={handleAudioQualityChange}
              >
                <SelectTrigger className={cn('h-8 w-full min-w-0 text-sm [&>span]:truncate', !isMobileDialog && 'sm:w-[170px]')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={6} className="z-[80] max-h-[min(18rem,var(--radix-select-content-available-height))] overscroll-contain">
                  {qualityOptions.map((option) => (
                    <SelectItem key={qualityOptionKey(option)} value={qualityOptionKey(option)}>
                      <span className="inline-flex items-center gap-2">
                        <span>{option.label}</span>
                        {option.platform && (
                          <span className={option.platform === 'unm' ? 'text-[10px] text-muted-foreground' : `text-[10px] ${PLATFORM_TEXT[option.platform]}`}>
                            {platformLabel(option.platform)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
        <Tabs value={activePlatform} onValueChange={(v) => setActivePlatform(v as MusicSource)} className="min-w-0 max-w-full overflow-x-hidden">
          <TabsList className="grid w-full min-w-0 grid-cols-3">
            {PLATFORMS.map((platform) => (
              <TabsTrigger key={platform} value={platform} className={`${PLATFORM_COLORS[platform]} min-w-0 px-2 text-xs sm:text-sm`}>
                {PLATFORM_SHORT_LABELS[platform]}
              </TabsTrigger>
            ))}
          </TabsList>

          {PLATFORMS.map((platform) => (
            <TabsContent key={platform} value={platform} className="mt-4 min-w-0 max-w-full space-y-4 overflow-x-hidden">
              <LoginSection
                platform={platform}
                status={getPlatformStatus(platform, auth.platformStatus)}
                myStatus={getMyPlatformStatus(platform, auth.myStatus)}
                isVerifying={verifyingPlatforms[platform]}
                onQrLogin={handleQrLogin}
                onCookieLogin={() => handleCookieLogin(platform)}
                onLogout={() => auth.logout(platform)}
              />

              <Separator />

              <PlaylistSection
                platform={platform}
                myStatus={getMyPlatformStatus(platform, auth.myStatus)}
                playlists={playlist.myPlaylists[platform]}
                loading={playlist.playlistsLoading[platform]}
                onFetchMyPlaylists={() => playlist.fetchMyPlaylists(platform)}
                onSelectPlaylist={handleSelectPlaylist}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <QrLoginDialog
        open={qrDialogOpen}
        onOpenChange={(open: boolean) => {
          setQrDialogOpen(open)
          if (!open) auth.resetQr()
        }}
        platform={auth.qrPlatform}
        qrData={auth.qrData}
        qrStatus={auth.qrStatus}
        isLoading={auth.isQrLoading}
        onRefresh={() => auth.requestQrCode(auth.qrPlatform)}
        onCheckStatus={(key: string) => auth.checkQrStatus(key)}
      />

      <ManualCookieDialog open={cookieDialogOpen} onOpenChange={setCookieDialogOpen} platform={cookieDialogPlatform} onSubmit={handleCookieSubmit} />
    </div>
  )
}
