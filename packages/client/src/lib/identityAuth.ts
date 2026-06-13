import { SERVER_URL } from '@/lib/config'
import { storage } from '@/lib/storage'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'
import type { TypedSocket } from '@/lib/socket'

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

function reconnectSocket(socket: TypedSocket): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      socket.off('connect', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, 3000)
    socket.once('connect', finish)
    if (socket.connected) socket.disconnect()
    socket.connect()
  })
}

export async function fetchCurrentAccount(): Promise<AccountMe> {
  const me = await requestJson<AccountMe>('/api/auth/me')
  useAccountStore.getState().setMe(me)
  storage.setUserId(me.id)
  if (me.nickname) storage.setNickname(me.nickname)
  else storage.clearNickname()
  return me
}

export async function loginIdentity(socket: TypedSocket, accountId: string, password: string): Promise<AccountMe> {
  const result = await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/recover', {
    method: 'POST',
    body: JSON.stringify({ accountId: accountId.trim(), password }),
  })
  storage.setUserId(result.userId)
  const me = await fetchCurrentAccount()
  await reconnectSocket(socket)
  return me
}

export async function useGuestIdentity(socket: TypedSocket, nickname: string): Promise<AccountMe | null> {
  const trimmed = nickname.trim()
  if (!trimmed) return null

  const current = useAccountStore.getState().me
  if (current?.hasPassword) {
    const result = await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/logout', { method: 'POST' })
    storage.setUserId(result.userId)
    await reconnectSocket(socket)
  }

  const me = await requestJson<AccountMe>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({ nickname: trimmed }),
  })
  storage.setNickname(me.nickname)
  storage.setUserId(me.id)
  useAccountStore.getState().setMe(me)
  return me
}

export const logoutIdentity = async (socket: TypedSocket): Promise<void> => {
  const result = await requestJson<{ userId: string; expiresAt: number }>('/api/auth/identity/logout', { method: 'POST' })
  storage.setUserId(result.userId)
  storage.clearNickname()
  useAccountStore.getState().setMe(null)
  await reconnectSocket(socket)
}
