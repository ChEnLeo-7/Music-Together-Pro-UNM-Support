import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { createGuestIdentity, loginIdentity, registerIdentity } from '@/lib/identityAuth'
import { storage } from '@/lib/storage'
import { useSocketContext } from '@/providers/SocketProvider'
import { LIMITS } from '@music-together/shared'
import { KeyRound, Loader2, UserPlus, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getLocalizedError, useI18n } from '@/lib/i18n'

interface IdentityJoinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (nickname: string) => void
}

type Mode = 'login' | 'register' | 'guest'

export function IdentityJoinDialog({ open, onOpenChange, onConfirm }: IdentityJoinDialogProps) {
  const { socket } = useSocketContext()
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState(storage.getNickname())
  const [loading, setLoading] = useState(false)
  const t = useI18n((s) => s.t)

  useEffect(() => {
    if (!open) return
    setMode('login')
    setPassword('')
    setNickname(storage.getNickname())
  }, [open])

  const complete = (value: string) => {
    onOpenChange(false)
    onConfirm(value)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        const me = await loginIdentity(socket, username, password)
        toast.success(t('loginSuccess'))
        complete(me.nickname)
      } else if (mode === 'register') {
        const me = await registerIdentity(socket, { username, password, nickname })
        toast.success(t('registrationSuccess'))
        complete(me.nickname)
      } else {
        const me = await createGuestIdentity(socket, nickname)
        complete(me.nickname)
      }
    } catch (error) {
      toast.error(getLocalizedError(error, t))
    } finally {
      setLoading(false)
    }
  }

  const valid =
    mode === 'guest'
      ? Boolean(nickname.trim())
      : Boolean(username.trim() && password && (mode === 'login' || nickname.trim()))

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            {mode === 'login' ? (
              <KeyRound className="h-5 w-5 text-primary" />
            ) : mode === 'register' ? (
              <UserPlus className="h-5 w-5 text-primary" />
            ) : (
              <UserRound className="h-5 w-5 text-primary" />
            )}
            {mode === 'login' ? t('accountLogin') : mode === 'register' ? t('registerAccount') : t('guestAccess')}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {mode === 'login'
              ? t('accountLoginDescription')
              : mode === 'register'
                ? t('registerDescription')
                : t('guestAccessDescription')}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'guest' && (
              <div className="space-y-2">
                <Label htmlFor="identity-username">{t('username')}</Label>
                <Input
                  id="identity-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoFocus
                />
                {mode === 'register' && <p className="text-xs text-muted-foreground">{t('usernameRules')}</p>}
              </div>
            )}
            {mode !== 'guest' && (
              <div className="space-y-2">
                <Label htmlFor="identity-password">{t('password')}</Label>
                <Input
                  id="identity-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={mode === 'register' ? 10 : undefined}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
            )}
            {mode !== 'login' && (
              <div className="space-y-2">
                <Label htmlFor="identity-nickname">{t('nickname')}</Label>
                <Input
                  id="identity-nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  maxLength={LIMITS.NICKNAME_MAX_LENGTH}
                  autoFocus={mode === 'guest'}
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading || !valid}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'login' ? t('loginAndJoin') : mode === 'register' ? t('registerAndJoin') : t('joinAsGuest')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {mode !== 'login' && (
                <Button type="button" variant="ghost" disabled={loading} onClick={() => setMode('login')}>
                  {t('login')}
                </Button>
              )}
              {mode !== 'register' && (
                <Button type="button" variant="ghost" disabled={loading} onClick={() => setMode('register')}>
                  {t('register')}
                </Button>
              )}
              {mode !== 'guest' && (
                <Button type="button" variant="ghost" disabled={loading} onClick={() => setMode('guest')}>
                  {t('guestAccess')}
                </Button>
              )}
            </div>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
