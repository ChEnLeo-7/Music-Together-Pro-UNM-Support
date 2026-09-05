import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n'
import { SERVER_URL } from '@/lib/config'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { useAccountStore } from '@/stores/accountStore'
import type { AudioQuality } from '@music-together/shared'
import { EVENTS, LIMITS, roomPasswordSchema } from '@music-together/shared'
import { Check, Copy, Loader2, Lock, LockOpen, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { SettingRow } from './SettingRow'

interface RoomSettingsSectionProps {
  onUpdateSettings: (settings: {
    name?: string
    password?: string | null
    audioQuality?: AudioQuality
    hidden?: boolean
    permanent?: boolean
    chatHistoryForNewUsers?: boolean
    pauseAtQueueEnd?: boolean
  }) => void
  onDissolveRoom?: () => void
}

export function RoomSettingsSection({ onUpdateSettings, onDissolveRoom }: RoomSettingsSectionProps) {
  const { socket } = useSocketContext()
  const room = useRoomStore((s) => s.room)
  const roomId = room?.id
  const currentUser = useRoomStore((s) => s.currentUser)
  const syncDrift = usePlayerStore((s) => s.syncDrift)
  const isOwner = currentUser?.role === 'owner'
  const isRoomAdmin = currentUser?.role === 'admin'
  const isServerAdmin = useAccountStore((s) => s.me?.role === 'admin')
  const canManageRoom = isOwner || isRoomAdmin || isServerAdmin
  const canEditOwnerSettings = isOwner || isServerAdmin
  const t = useI18n((s) => s.t)

  const [passwordInput, setPasswordInput] = useState('')
  const [passwordEnabled, setPasswordEnabled] = useState(room?.hasPassword ?? false)
  const [roomPassword, setRoomPassword] = useState<string | null>(null)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const dissolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passwordRequestRef = useRef(0)

  const driftDisplay = useMemo(() => {
    const ms = Math.round(syncDrift * 1000)
    return {
      label: ms > 0 ? `+${ms}ms` : `${ms}ms`,
      isHigh: Math.abs(ms) > 500,
    }
  }, [syncDrift])

  const loadRoomPassword = useCallback(async () => {
    const requestId = ++passwordRequestRef.current
    if (!isOwner || !roomId) {
      setRoomPassword(null)
      setPasswordInput('')
      return
    }

    setPasswordLoading(true)
    try {
      const response = await fetch(`${SERVER_URL}/api/rooms/${encodeURIComponent(roomId)}/password`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('room password request failed')
      const data = (await response.json()) as { password: string | null }
      if (requestId !== passwordRequestRef.current) return
      setRoomPassword(data.password)
      setPasswordInput(data.password ?? '')
      setPasswordEnabled(data.password !== null)
    } catch (error) {
      if (requestId !== passwordRequestRef.current) return
      setRoomPassword(null)
      setPasswordInput('')
      toast.error(t('roomPasswordLoadFailed'))
    } finally {
      if (requestId === passwordRequestRef.current) setPasswordLoading(false)
    }
  }, [isOwner, roomId])

  useEffect(() => {
    void loadRoomPassword()
  }, [loadRoomPassword])

  useEffect(() => {
    if (!isOwner) return
    const onSettings = () => void loadRoomPassword()
    socket.on(EVENTS.ROOM_SETTINGS, onSettings)
    return () => {
      socket.off(EVENTS.ROOM_SETTINGS, onSettings)
    }
  }, [isOwner, loadRoomPassword, socket])

  useEffect(
    () => () => {
      if (dissolveTimerRef.current) clearTimeout(dissolveTimerRef.current)
    },
    [],
  )

  const copyRoomLink = () => {
    if (!room) return
    navigator.clipboard.writeText(`${window.location.origin}/room/${room.id}`)
    toast.success(t('roomLinkCopied'))
  }

  const handleManualSync = () => {
    if (!room) return
    if (room.hostId === storage.getUserId()) {
      toast.info(t('syncSourceNotice'))
      return
    }
    socket.emit(EVENTS.PLAYER_SYNC_REQUEST)
    toast.success(t('syncRequested'))
  }

  const handlePasswordToggle = (checked: boolean) => {
    if (!checked) {
      setPasswordEnabled(false)
      setPasswordInput('')
      setRoomPassword(null)
      onUpdateSettings({ password: null })
      toast.success(t('passwordRemoved'))
      return
    }
    setPasswordEnabled(true)
  }

  const handleSetPassword = () => {
    const result = roomPasswordSchema.safeParse(passwordInput)
    if (!result.success) {
      toast.error(t('enterPassword'))
      return
    }
    onUpdateSettings({ password: result.data })
    toast.success(t('passwordUpdated'))
  }

  const handleStartEditName = () => {
    setNameInput(room?.name ?? '')
    setEditingName(true)
  }

  const handleSaveName = () => {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      toast.error(t('roomNameRequired'))
      return
    }
    if (trimmed !== room?.name) {
      onUpdateSettings({ name: trimmed })
      toast.success(t('roomNameUpdated'))
    }
    setEditingName(false)
  }

  const handleCancelEditName = () => {
    setEditingName(false)
    setNameInput('')
  }

  const handleDissolveRoom = () => {
    if (!onDissolveRoom || !room) return
    if (!confirmDissolve) {
      setConfirmDissolve(true)
      if (dissolveTimerRef.current) clearTimeout(dissolveTimerRef.current)
      dissolveTimerRef.current = setTimeout(() => {
        dissolveTimerRef.current = null
        setConfirmDissolve(false)
      }, 3000)
      return
    }

    if (dissolveTimerRef.current) {
      clearTimeout(dissolveTimerRef.current)
      dissolveTimerRef.current = null
    }
    setConfirmDissolve(false)
    onDissolveRoom()
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('roomInfo')}</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label={t('roomName')}>
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={LIMITS.ROOM_NAME_MAX_LENGTH}
                className="h-7 w-40 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName()
                  if (e.key === 'Escape') handleCancelEditName()
                }}
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleSaveName}
                aria-label={t('saveRoomName')}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCancelEditName}
                aria-label={t('cancelEdit')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{room?.name}</span>
              {canEditOwnerSettings && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleStartEditName}
                  aria-label={t('editRoomName')}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </SettingRow>

        <SettingRow label={t('roomId')}>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-sm">{room?.id}</code>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={copyRoomLink}
                  aria-label={t('copyRoomLink')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('copy')}</TooltipContent>
            </Tooltip>
          </div>
        </SettingRow>

        <SettingRow label={t('syncDrift')}>
          <span className={`font-mono text-sm ${driftDisplay.isHigh ? 'text-yellow-500' : 'text-muted-foreground'}`}>
            {driftDisplay.label}
          </span>
        </SettingRow>

        <SettingRow label={t('manualSync')} description={t('manualSyncDesc')}>
          <Button type="button" variant="outline" size="sm" onClick={handleManualSync}>
            {t('syncNow')}
          </Button>
        </SettingRow>

        {isOwner && (
          <SettingRow label={t('passwordProtection')}>
            {room?.hasPassword ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" />
                  {t('enabled')}
                </Badge>
                {passwordLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : roomPassword ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <code
                        className="cursor-pointer rounded bg-muted px-2 py-0.5 text-xs transition-colors hover:bg-muted/80"
                        onClick={() => {
                          navigator.clipboard.writeText(roomPassword)
                          toast.success(t('passwordCopied'))
                        }}
                      >
                        {roomPassword}
                      </code>
                    </TooltipTrigger>
                    <TooltipContent>{t('copy')}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            ) : (
              <Badge variant="outline" className="gap-1">
                <LockOpen className="h-3 w-3" />
                {t('disabled')}
              </Badge>
            )}
          </SettingRow>
        )}
      </div>

      {canManageRoom && (
        <div>
          <h3 className="text-base font-semibold">{t('ownerSettings')}</h3>
          <Separator className="mt-2 mb-4" />

          {canEditOwnerSettings && (
            <div className="space-y-2">
              <SettingRow label={t('roomPassword')} description={t('roomPasswordDesc')}>
                <Switch checked={passwordEnabled} onCheckedChange={handlePasswordToggle} />
              </SettingRow>

              {passwordEnabled && (
                <div className="flex gap-2 pb-2">
                  <Input
                    type="password"
                    placeholder={t('newPassword')}
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    maxLength={LIMITS.ROOM_PASSWORD_MAX_LENGTH}
                    className="flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                  />
                  <Button size="sm" onClick={handleSetPassword}>
                    {t('confirm')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {canEditOwnerSettings && (
            <>
              <SettingRow label={t('hiddenRoom')} description={t('hiddenRoomDesc')}>
                <Switch
                  checked={room?.hidden ?? false}
                  onCheckedChange={(checked) => onUpdateSettings({ hidden: checked })}
                />
              </SettingRow>

              <SettingRow label={t('permanentRoom')} description={t('permanentRoomDesc')}>
                <Switch
                  checked={room?.permanent ?? false}
                  onCheckedChange={(checked) => onUpdateSettings({ permanent: checked })}
                />
              </SettingRow>

              <SettingRow label={t('chatHistoryForNewUsers')} description={t('chatHistoryForNewUsersDesc')}>
                <Switch
                  checked={room?.chatHistoryForNewUsers ?? true}
                  onCheckedChange={(checked) => onUpdateSettings({ chatHistoryForNewUsers: checked })}
                />
              </SettingRow>
            </>
          )}

          <SettingRow label={t('pauseAtQueueEnd')} description={t('pauseAtQueueEndDesc')}>
            <Switch
              checked={room?.pauseAtQueueEnd ?? false}
              onCheckedChange={(checked) => onUpdateSettings({ pauseAtQueueEnd: checked })}
            />
          </SettingRow>

          {canEditOwnerSettings && (
            <>
              <Separator className="my-4" />

              <SettingRow label={t('dissolveRoomConfirm')} description={t('dissolveRoomDesc')}>
                <Button
                  type="button"
                  variant={confirmDissolve ? 'destructive' : 'outline'}
                  size="sm"
                  className={confirmDissolve ? '' : 'border-destructive/40 text-destructive hover:text-destructive'}
                  onClick={handleDissolveRoom}
                >
                  {confirmDissolve ? t('confirmAgain') : t('dissolve')}
                </Button>
              </SettingRow>
            </>
          )}
        </div>
      )}
    </div>
  )
}
