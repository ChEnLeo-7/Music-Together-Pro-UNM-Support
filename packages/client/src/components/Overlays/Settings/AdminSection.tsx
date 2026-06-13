import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SERVER_URL } from '@/lib/config'
import { useI18n } from '@/lib/i18n'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface AdminUser {
  id: string
  nickname: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  hasPassword: boolean
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

interface AdminRoom {
  id: string
  name: string
  creatorId: string
  hidden: boolean
  permanent: boolean
  userCount: number
  hasPassword: boolean
  currentTrackTitle: string | null
}

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

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function formatTime(value: number): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export function AdminSection() {
  const t = useI18n((s) => s.t)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [passwords, setPasswords] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    setForbidden(false)
    try {
      const [userData, roomData] = await Promise.all([
        requestJson<{ users: AdminUser[] }>('/api/admin/users'),
        requestJson<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
      ])
      setUsers(userData.users)
      setRooms(roomData.rooms)
    } catch (err) {
      if (err instanceof Error && err.message.includes('Forbidden')) {
        setForbidden(true)
      } else {
        toast.error(err instanceof Error ? err.message : t('adminLoadFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(`${t('deleteAccountConfirm')} ${user.id}?`)) return
    await requestJson<void>(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
    toast.success(t('userDeleted'))
    await load()
  }

  const resetPassword = async (user: AdminUser) => {
    const password = passwords[user.id]
    if (!password || password.length < 8) {
      toast.error(t('passwordTooShort'))
      return
    }

    await requestJson<void>(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    setPasswords((current) => ({ ...current, [user.id]: '' }))
    toast.success(t('passwordReset'))
  }

  const dissolveRoom = async (room: AdminRoom) => {
    if (!window.confirm(`${t('dissolveRoomConfirm')} ${room.id}?`)) return
    await requestJson<void>(`/api/admin/rooms/${encodeURIComponent(room.id)}/dissolve`, { method: 'POST' })
    toast.success(t('roomDissolved'))
    await load()
  }

  if (forbidden) {
    return <p className="text-sm text-muted-foreground">{t('notServerAdmin')}</p>
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t('serverAdmin')}</h3>
          <p className="text-xs text-muted-foreground">{t('serverAdminDesc')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {t('refresh')}
        </Button>
      </div>

      <div>
        <h4 className="text-sm font-semibold">{t('users')}</h4>
        <Separator className="mt-2 mb-3" />
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.nickname || user.id}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{user.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {user.role} / {user.hasPassword ? t('passwordSet') : t('noPassword')} / {t('lastSeen')}{' '}
                    {formatTime(user.lastSeenAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteUser(user)}>
                  {t('delete')}
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  type="password"
                  placeholder={t('newPassword')}
                  value={passwords[user.id] ?? ''}
                  onChange={(e) => setPasswords((current) => ({ ...current, [user.id]: e.target.value }))}
                />
                <Button variant="outline" onClick={() => resetPassword(user)}>
                  {t('reset')}
                </Button>
              </div>
            </div>
          ))}
          {!loading && users.length === 0 && <p className="text-sm text-muted-foreground">{t('noUsers')}</p>}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold">{t('rooms')}</h4>
        <Separator className="mt-2 mb-3" />
        <div className="space-y-2">
          {rooms.map((room) => (
            <div key={room.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {room.name} <span className="font-mono text-xs text-muted-foreground">({room.id})</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {room.userCount} {t('online')} / {room.hidden ? t('hidden') : t('publicRoom')} /{' '}
                  {room.permanent ? t('permanent') : t('temporary')}
                  {room.currentTrackTitle ? ` / ${room.currentTrackTitle}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => dissolveRoom(room)}>
                {t('dissolve')}
              </Button>
            </div>
          ))}
          {!loading && rooms.length === 0 && <p className="text-sm text-muted-foreground">{t('noRooms')}</p>}
        </div>
      </div>
    </div>
  )
}
