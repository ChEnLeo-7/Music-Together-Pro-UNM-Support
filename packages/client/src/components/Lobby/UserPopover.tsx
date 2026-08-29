import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { createGuestIdentity, loginIdentity, logoutIdentity, registerIdentity, updateProfile } from '@/lib/identityAuth'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { CircleUser, Loader2, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getLocalizedError, useI18n } from '@/lib/i18n'

type Mode = 'login' | 'register' | 'guest' | null

export function UserPopover() {
  const { socket } = useSocketContext()
  const me = useAccountStore((state) => state.me)
  const accountLoading = useAccountStore((state) => state.loading)
  const [mode, setMode] = useState<Mode>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const t = useI18n((s) => s.t)

  useEffect(() => {
    setNickname(me?.nickname ?? '')
  }, [me?.userId])

  const run = async (action: () => Promise<unknown>, message: string) => {
    setLoading(true)
    try {
      await action()
      setMode(null)
      setPassword('')
      toast.success(message)
    } catch (error) {
       toast.error(getLocalizedError(error, t))
    } finally {
      setLoading(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
     if (mode === 'login') void run(() => loginIdentity(socket, username, password), t('loginSuccess'))
     if (mode === 'register') void run(() => registerIdentity(socket, { username, password, nickname }), t('registrationSuccess'))
     if (mode === 'guest') void run(() => createGuestIdentity(socket, nickname), t('guestSessionCreated'))
  }

  const displayName = me?.nickname || me?.username || ''
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full border border-border/60">
          {displayName ? <span className="text-sm font-semibold">{displayName.charAt(0).toUpperCase()}</span> : <CircleUser className="h-5 w-5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
             <p className="text-sm font-medium">{accountLoading ? t('checkingSession') : me?.kind === 'account' ? me.username : me ? me.nickname : t('unauthenticated')}</p>
             <p className="text-xs text-muted-foreground">{me?.kind === 'account' ? t('accountIdentity', { nickname: me.nickname }) : me ? t('guestIdentity') : t('chooseIdentity')}</p>
          </div>
          <Separator />
          {mode ? (
            <form onSubmit={submit} className="space-y-2">
               {mode !== 'guest' && <Input placeholder={t('username')} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />}
               {mode !== 'guest' && <Input type="password" placeholder={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 10 : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
               {mode !== 'login' && <Input placeholder={t('nickname')} value={nickname} onChange={(event) => setNickname(event.target.value)} autoFocus={mode === 'guest'} />}
              <div className="flex gap-2">
                 <Button className="flex-1" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('confirmAction')}</Button>
                 <Button type="button" variant="outline" onClick={() => setMode(null)} disabled={loading}>{t('cancelAction')}</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
               {me && <div className="flex gap-2"><Input value={nickname} onChange={(event) => setNickname(event.target.value)} aria-label={t('nickname')} /><Button variant="outline" onClick={() => void run(() => updateProfile(nickname || me.nickname), t('nicknameSaved'))}>{t('save')}</Button></div>}
              <div className="flex flex-wrap gap-2">
                 {me?.kind !== 'account' && <Button size="sm" variant="outline" onClick={() => { setNickname(me?.nickname ?? ''); setMode('register') }}>{me ? t('upgradeAccount') : t('register')}</Button>}
                 {me?.kind !== 'account' && <Button size="sm" onClick={() => setMode('login')}>{t('login')}</Button>}
                 {!me && <Button size="sm" variant="ghost" onClick={() => setMode('guest')}>{t('continueAsGuest')}</Button>}
                 {me && <Button size="sm" variant="ghost" className="text-destructive" disabled={loading} onClick={() => void run(() => logoutIdentity(socket), t('logout'))}><LogOut className="mr-2 h-4 w-4" />{t('logout')}</Button>}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
