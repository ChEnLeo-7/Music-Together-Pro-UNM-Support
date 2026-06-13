import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SERVER_URL } from '@/lib/config'
import { useI18n } from '@/lib/i18n'
import { storage } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'
import { useRoomStore } from '@/stores/roomStore'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSocketContext } from '@/providers/SocketProvider'
import { logoutIdentity as logoutIdentityRequest } from '@/lib/identityAuth'

export type { AccountMe }

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed: ${res.status}`)
  }

  return (await res.json()) as T
}

export function AccountSection({
  initialMe,
  initialLoading = false,
}: {
  initialMe?: AccountMe | null
  initialLoading?: boolean
}) {
  const { socket } = useSocketContext()
  const [me, setMe] = useState<AccountMe | null>(initialMe ?? null)
  const [loading, setLoading] = useState(initialLoading)
  const [password, setPassword] = useState('')
  const [accountId, setAccountId] = useState('')
  const [nickname, setNickname] = useState('')
  const [editingNickname, setEditingNickname] = useState(false)
  const [recoverPassword, setRecoverPassword] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarVersion, setAvatarVersion] = useState(0)
  const updateUserProfile = useRoomStore((s) => s.updateUserProfile)
  const setGlobalAccountMe = useAccountStore((s) => s.setMe)
  const setGlobalAccountLoading = useAccountStore((s) => s.setLoading)
  const t = useI18n((s) => s.t)

  const loadMe = async (cancelled?: () => boolean) => {
    setLoading(true)
    await requestJson<AccountMe>('/api/auth/me')
      .then((data) => {
        if (!cancelled?.()) {
          setMe(data)
          setGlobalAccountMe(data)
          setAccountId(data.id)
          setNickname(data.nickname)
        }
      })
      .catch((err) => {
        if (!cancelled?.()) toast.error(err instanceof Error ? err.message : t('accountLoadFailed'))
      })
      .finally(() => {
        if (!cancelled?.()) {
          setLoading(false)
          setGlobalAccountLoading(false)
        }
      })
  }

  useEffect(() => {
    if (initialLoading) {
      setLoading(true)
      return
    }
    if (initialMe) {
      setMe(initialMe)
      setGlobalAccountMe(initialMe)
      setAccountId(initialMe.id)
      setNickname(initialMe.nickname)
      setLoading(false)
      return
    }
    let cancelled = false
    void loadMe(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [initialMe, initialLoading])

  const copyAccountId = async () => {
    if (!me?.id) return
    await navigator.clipboard.writeText(me.id)
    toast.success(t('accountIdCopied'))
  }

  const setInitialPassword = async () => {
    if (password.length < 8) {
      toast.error(t('passwordTooShort'))
      return
    }

    const result = await requestJson<{ accountId: string }>('/api/auth/me/password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    setPassword('')
    setMe((current) => (current ? { ...current, hasPassword: true } : current))
    setGlobalAccountMe(me ? { ...me, hasPassword: true } : me)
    toast.success(`${t('passwordSetWithId')}${result.accountId}`)
  }

  const saveNickname = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      toast.error(t('nicknameRequired'))
      return
    }

    const result = await requestJson<AccountMe>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: trimmed }),
    })
    storage.setNickname(result.nickname)
    setMe(result)
    setGlobalAccountMe(result)
    setEditingNickname(false)
    updateUserProfile(result.id, { nickname: result.nickname, avatarUrl: result.avatarUrl })
    toast.success(t('profileUpdated'))
  }

  const recoverIdentity = async () => {
    if (!accountId.trim() || !recoverPassword) {
      toast.error(t('enterAccountAndPassword'))
      return
    }

    const result = await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/recover', {
      method: 'POST',
      body: JSON.stringify({ accountId: accountId.trim(), password: recoverPassword }),
    })
    storage.setUserId(result.userId)
    const recovered = await requestJson<AccountMe>('/api/auth/me')
    storage.setNickname(recovered.nickname)
    setMe(recovered)
    setGlobalAccountMe(recovered)
    setAccountId(recovered.id)
    setNickname(recovered.nickname)
    updateUserProfile(recovered.id, { nickname: recovered.nickname, avatarUrl: recovered.avatarUrl })
    toast.success(t('accountRecovered'))
    setRecoverPassword('')
    window.location.reload()
  }

  const logoutIdentity = async () => {
    await logoutIdentityRequest(socket)
    if (me) updateUserProfile(me.id, { nickname: '', avatarUrl: null })
    setGlobalAccountMe(null)
    toast.success(t('accountLoggedOut'))
    setPassword('')
    setRecoverPassword('')
    window.location.reload()
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('avatarTypeInvalid'))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('avatarTooLarge'))
      return
    }

    setUploadingAvatar(true)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(t('imageReadFailed')))
        reader.readAsDataURL(file)
      })

      const result = await requestJson<{ avatarUrl: string }>('/api/auth/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ image }),
      })
      const nextAvatarVersion = Date.now()
      setAvatarVersion(nextAvatarVersion)
      setMe((current) => {
        const updated = current ? { ...current, avatarUrl: result.avatarUrl } : current
        setGlobalAccountMe(updated)
        if (updated) updateUserProfile(updated.id, { nickname: nickname.trim() || updated.nickname, avatarUrl: result.avatarUrl })
        return updated
      })
      toast.success(t('avatarUpdated'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('avatarUploadFailed'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const rawAvatarUrl = me?.avatarUrl?.startsWith('/uploads/') ? `${SERVER_URL}${me.avatarUrl}` : me?.avatarUrl
  const avatarUrl = rawAvatarUrl && avatarVersion > 0 ? `${rawAvatarUrl}${rawAvatarUrl.includes('?') ? '&' : '?'}v=${avatarVersion}` : rawAvatarUrl

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{t('account')}</h3>
        <Separator className="mt-2 mb-4" />

        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <label className="group cursor-pointer">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => void uploadAvatar(e.currentTarget.files?.[0])}
            />
            <span
              className={cn(
                'relative flex h-36 w-36 items-center justify-center overflow-hidden rounded-full text-4xl font-semibold text-white ring-1 ring-border transition-opacity group-hover:opacity-85',
                !avatarUrl && 'bg-gradient-to-br from-emerald-500 via-sky-500 to-fuchsia-500',
              )}
            >
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : (me?.nickname || me?.id || '?').slice(0, 1).toUpperCase()}
              {uploadingAvatar && <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">{t('uploading')}</span>}
            </span>
          </label>

          <div className="relative flex h-10 w-full max-w-xs items-center justify-center">
            <AnimatePresence mode="wait" initial={false}>
              {editingNickname ? (
              <motion.div
                key="nickname-input"
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="relative flex w-full justify-center"
              >
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="h-8 w-48 text-center"
                  onBlur={() => {
                    setNickname(me?.nickname ?? '')
                    setEditingNickname(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveNickname()
                    if (e.key === 'Escape') {
                      setNickname(me?.nickname ?? '')
                      setEditingNickname(false)
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="absolute left-[calc(50%+104px)] top-1/2 h-8 -translate-y-1/2"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={saveNickname}
                  disabled={!me}
                >
                  {t('save')}
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="nickname-display"
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="min-w-0 max-w-full"
              >
              <button
                type="button"
                className="max-w-full truncate text-lg font-semibold hover:underline"
                onClick={() => setEditingNickname(true)}
                disabled={!me}
              >
                {loading ? '...' : nickname || me?.nickname || '-'}
              </button>
              </motion.div>
            )}
            </AnimatePresence>
          </div>

          <button type="button" className="mx-auto block max-w-full truncate text-center font-mono text-xs text-muted-foreground hover:underline" onClick={copyAccountId} disabled={!me}>
            {loading ? 'ID: ...' : `ID:${me?.id ?? '-'}`}
          </button>
          <span className="block text-center text-sm text-muted-foreground">身份:{me?.role ?? 'user'}</span>

          {me?.hasPassword && (
            <Button variant="destructive" onClick={logoutIdentity} className="mt-1">
              {t('logoutAccount')}
            </Button>
          )}
        </div>
      </div>

      {!loading && !me?.hasPassword && (
        <div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('setFirstPassword')}
              minLength={8}
            />
            <Button onClick={setInitialPassword}>{t('set')}</Button>
          </div>
        </div>
      )}

      {!me?.hasPassword && (
      <div>
        <h3 className="text-base font-semibold">{me?.hasPassword ? t('loggedInAccount') : t('recoverIdentity')}</h3>
        <Separator className="mt-2 mb-4" />
        {loading ? (
          <p className="text-sm text-muted-foreground">...</p>
        ) : me?.hasPassword ? (
          <div className="flex items-center justify-between gap-3">
            <code className="min-w-0 truncate rounded bg-muted px-2 py-1 text-xs">{me.id}</code>
            <Button variant="outline" onClick={logoutIdentity}>
              {t('logoutAccount')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={t('accountId')} />
            <Input
              type="password"
              value={recoverPassword}
              onChange={(e) => setRecoverPassword(e.target.value)}
              placeholder={t('password')}
            />
            <div className="flex justify-center">
              <Button onClick={recoverIdentity}>{t('recoverThisAccount')}</Button>
            </div>
          </div>
        )}
      </div>
      )}

      {me?.hasPassword && <p className="text-center text-xs text-muted-foreground">{t('contactAdminToChangePassword')}</p>}
    </div>
  )
}

