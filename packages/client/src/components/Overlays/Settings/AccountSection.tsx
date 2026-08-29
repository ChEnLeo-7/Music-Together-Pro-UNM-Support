import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SERVER_URL } from '@/lib/config'
import { changePassword, createGuestIdentity, loginIdentity, logoutIdentity, registerIdentity, requestJson, updateProfile } from '@/lib/identityAuth'
import { useI18n } from '@/lib/i18n'
import { getLocalizedError } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useSocketContext } from '@/providers/SocketProvider'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export type { AccountMe }

export function AccountSection({
  initialMe,
  initialLoading = false,
}: {
  initialMe?: AccountMe | null
  initialLoading?: boolean
}) {
  const { socket } = useSocketContext()
  const globalMe = useAccountStore((state) => state.me)
  const setGlobalMe = useAccountStore((state) => state.setMe)
  const [me, setMe] = useState<AccountMe | null>(initialMe ?? globalMe)
  const [loading, setLoading] = useState(initialLoading)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState(initialMe?.nickname ?? globalMe?.nickname ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarVersion, setAvatarVersion] = useState(0)
  const updateUserProfile = useRoomStore((state) => state.updateUserProfile)
  const t = useI18n((state) => state.t)

  useEffect(() => {
    const next = initialMe ?? globalMe
    setMe(next)
    setNickname(next?.nickname ?? '')
    setLoading(initialLoading)
  }, [initialMe, initialLoading, globalMe])

  const apply = (account: AccountMe) => {
    setMe(account)
    setGlobalMe(account)
    setNickname(account.nickname)
    updateUserProfile(account.userId, { nickname: account.nickname, avatarUrl: account.avatarUrl })
  }

  const run = async (action: () => Promise<AccountMe>, message: string) => {
    setLoading(true)
    try {
      apply(await action())
      setPassword('')
       toast.success(message)
    } catch (error) {
       toast.error(getLocalizedError(error, t))
    } finally {
      setLoading(false)
    }
  }

  const saveNickname = () => {
    if (!nickname.trim()) return void toast.error(t('nicknameRequired'))
    void run(() => updateProfile(nickname), t('profileUpdated'))
  }

  const submitRegistration = () => {
    if (!username.trim() || password.length < 10 || !nickname.trim()) return void toast.error(t('registrationRequirements'))
    void run(() => registerIdentity(socket, { username, password, nickname }), t('accountRegistered'))
  }

  const submitLogin = () => {
    if (!username.trim() || !password) return void toast.error(t('enterUsernameAndPassword'))
    void run(() => loginIdentity(socket, username, password), t('accountRecovered'))
  }

  const submitPasswordChange = () => {
    if (!currentPassword || newPassword.length < 10) return void toast.error(t('passwordTooShort'))
    void run(async () => {
      const account = await changePassword(socket, currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      return account
    }, t('passwordChanged'))
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file || !me) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return void toast.error(t('avatarTypeInvalid'))
    if (file.size > 5 * 1024 * 1024) return void toast.error(t('avatarTooLarge'))
    setUploadingAvatar(true)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(t('imageReadFailed')))
        reader.readAsDataURL(file)
      })
      const result = await requestJson<{ avatarUrl: string }>('/api/auth/me/avatar', { method: 'POST', body: JSON.stringify({ image }) })
      const updated = { ...me, avatarUrl: result.avatarUrl }
      apply(updated)
      setAvatarVersion(Date.now())
      toast.success(t('avatarUpdated'))
    } catch (error) {
       toast.error(getLocalizedError(error, t))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      await logoutIdentity(socket)
      setMe(null)
      toast.success(t('accountLoggedOut'))
    } catch (error) {
       toast.error(getLocalizedError(error, t))
    } finally {
      setLoading(false)
    }
  }

  const rawAvatarUrl = me?.avatarUrl?.startsWith('/uploads/') ? `${SERVER_URL}${me.avatarUrl}` : me?.avatarUrl
  const avatarUrl = rawAvatarUrl && avatarVersion ? `${rawAvatarUrl}${rawAvatarUrl.includes('?') ? '&' : '?'}v=${avatarVersion}` : rawAvatarUrl

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">{t('account')}</h3>
        <Separator className="mt-2 mb-4" />
        {me ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <label className="group cursor-pointer">
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0])} />
                <span className={cn('flex h-28 w-28 items-center justify-center overflow-hidden rounded-full text-3xl font-semibold text-white ring-1 ring-border group-hover:opacity-85', !avatarUrl && 'bg-gradient-to-br from-emerald-500 via-sky-500 to-fuchsia-500')}>
                  {uploadingAvatar ? t('uploading') : avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : (me.nickname || me.username || '?').slice(0, 1).toUpperCase()}
                </span>
              </label>
              <div>
                <p className="font-semibold">{me.nickname}</p>
                <p className="text-sm text-muted-foreground">{me.kind === 'account' ? `@${me.username}` : t('guestAccount')}</p>
                <p className="text-xs text-muted-foreground">{me.role === 'admin' ? t('serverAdmin') : t('standardUser')}</p>
              </div>
            </div>
            <div className="flex gap-2"><Input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t('nickname')} /><Button variant="outline" onClick={saveNickname} disabled={loading}>{t('save')}</Button></div>
            <Button variant="destructive" onClick={() => void signOut()} disabled={loading}>{t('logoutAccount')}</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('unauthenticatedDescription')}</p>
        )}
      </div>

      {me?.kind !== 'account' && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">{me ? t('upgradeGuest') : t('loginOrRegister')}</h3>
          <Separator />
          <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t('username')} autoComplete="username" />
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('password')} minLength={10} maxLength={128} />
          {!me && <Input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder={t('nickname')} />}
          <div className="flex flex-wrap gap-2">
            <Button onClick={submitLogin} disabled={loading}>{t('login')}</Button>
            <Button variant="outline" onClick={submitRegistration} disabled={loading}>{me ? t('upgradeGuest') : t('register')}</Button>
            {!me && <Button variant="ghost" onClick={() => void run(() => createGuestIdentity(socket, nickname), t('guestCreated'))} disabled={loading || !nickname.trim()}>{t('continueAsGuest')}</Button>}
          </div>
        </div>
      )}

      {me?.kind === 'account' && (
        <div className="space-y-3">
          <div><h3 className="text-base font-semibold">{me.mustChangePassword ? t('passwordChangeRequired') : t('changePassword')}</h3>{me.mustChangePassword && <p className="mt-1 text-sm text-destructive">{t('passwordChangeRequiredDesc')}</p>}</div>
          <Separator />
          <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t('currentPassword')} autoComplete="current-password" />
          <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t('newAccountPassword')} minLength={10} maxLength={128} autoComplete="new-password" />
          <Button onClick={submitPasswordChange} disabled={loading}>{t('changePassword')}</Button>
        </div>
      )}
    </div>
  )
}
