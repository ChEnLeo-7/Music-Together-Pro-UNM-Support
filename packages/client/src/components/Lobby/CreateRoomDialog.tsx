import { useEffect, useState } from 'react'
import { Lock, Music, Loader2, UserRound } from 'lucide-react'
import { LIMITS, roomPasswordSchema } from '@music-together/shared'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/lib/i18n'

interface CreateRoomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateRoom: (nickname: string, roomName?: string, password?: string) => void
  defaultNickname: string
  isLoading: boolean
}

export function CreateRoomDialog({
  open,
  onOpenChange,
  onCreateRoom,
  defaultNickname,
  isLoading,
}: CreateRoomDialogProps) {
  const t = useI18n((s) => s.t)
  const [nickname, setNickname] = useState(defaultNickname)
  const [roomName, setRoomName] = useState('')
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setNickname(defaultNickname))
      return () => cancelAnimationFrame(frame)
    }
  }, [open, defaultNickname])

  const passwordResult = passwordEnabled ? roomPasswordSchema.safeParse(password) : null
  const canSubmit = Boolean(nickname.trim()) && (!passwordEnabled || passwordResult?.success === true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onCreateRoom(
      nickname.trim(),
      roomName.trim() || undefined,
      passwordEnabled && passwordResult?.success ? passwordResult.data : undefined,
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <Music className="h-5 w-5 text-primary" />
            {t('createRoom')}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                <UserRound className="h-3.5 w-3.5" />
                {t('enterIdentity')}
              </Label>
              <Input
                placeholder={t('nicknamePlaceholder')}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                autoFocus={!defaultNickname}
              />
              <p className="text-xs text-muted-foreground">{t('loggedInNicknameHint')}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground/80">{t('roomNameOptional')}</Label>
              <Input
                placeholder={t('roomNamePlaceholder')}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={LIMITS.ROOM_NAME_MAX_LENGTH}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch id="password-toggle" checked={passwordEnabled} onCheckedChange={setPasswordEnabled} />
                <Label
                  htmlFor="password-toggle"
                  className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <Lock className="h-3.5 w-3.5" />
                  {t('setRoomPassword')}
                </Label>
              </div>

              {passwordEnabled && (
                <Input
                  type="password"
                  placeholder={t('setRoomPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={LIMITS.ROOM_PASSWORD_MAX_LENGTH}
                  autoFocus
                />
              )}
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={isLoading || !canSubmit}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('createRoom')}
            </Button>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
