import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeBootstrapCredentials, changePassword } from '@/lib/identityAuth'
import { getLocalizedError, useI18n } from '@/lib/i18n'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore } from '@/stores/accountStore'
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export function PasswordChangeGate() {
  const me = useAccountStore((state) => state.me)
  const { socket } = useSocketContext()
  const t = useI18n((state) => state.t)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  if (!me?.mustChangePassword && !me?.mustChangeUsername) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!currentPassword || newPassword.length < 10 || (me.mustChangeUsername && !/^[A-Za-z0-9_-]{3,32}$/.test(newUsername))) return
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      if (me.mustChangeUsername) {
        await changeBootstrapCredentials(socket, currentPassword, newUsername, newPassword)
        toast.success(t('credentialsUpdated'))
      } else {
        await changePassword(socket, currentPassword, newPassword)
        toast.success(t('passwordChanged'))
      }
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      toast.error(code === 'INVALID_CREDENTIALS' ? t('currentPasswordIncorrect') : getLocalizedError(error, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-primary/10 p-2 text-primary"><KeyRound className="h-5 w-5" /></span>
          <div><h2 className="font-semibold">{me.mustChangeUsername ? t('bootstrapCredentialsTitle') : t('passwordChangeRequired')}</h2><p className="mt-1 text-sm text-muted-foreground">{me.mustChangeUsername ? t('bootstrapCredentialsDesc') : t('passwordChangeRequiredDesc')}</p></div>
        </div>
        {me.mustChangeUsername && <div className="space-y-2"><Label htmlFor="bootstrap-username">{t('newAdminUsername')}</Label><Input id="bootstrap-username" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder={t('newAdminUsernameHint')} minLength={3} maxLength={32} autoComplete="username" autoFocus /></div>}
        <div className="space-y-2"><Label htmlFor="bootstrap-current-password">{me.mustChangeUsername ? t('bootstrapCurrentPassword') : t('currentPassword')}</Label><Input id="bootstrap-current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={me.mustChangeUsername ? t('bootstrapCurrentPassword') : t('currentPassword')} autoComplete="current-password" autoFocus={!me.mustChangeUsername} /></div>
        <div className="space-y-2"><Label htmlFor="bootstrap-new-password">{t('newAccountPassword')}</Label><Input id="bootstrap-new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t('newAccountPassword')} minLength={10} maxLength={128} autoComplete="new-password" /></div>
        <div className="space-y-2"><Label htmlFor="bootstrap-confirm-password">{t('confirmNewPassword')}</Label><Input id="bootstrap-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t('confirmNewPassword')} minLength={10} maxLength={128} autoComplete="new-password" /></div>
        <Button className="w-full" disabled={loading || !currentPassword || newPassword.length < 10 || newPassword !== confirmPassword || (me.mustChangeUsername && !/^[A-Za-z0-9_-]{3,32}$/.test(newUsername))}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{me.mustChangeUsername ? t('saveNewCredentials') : t('changePassword')}</Button>
      </form>
    </div>
  )
}
