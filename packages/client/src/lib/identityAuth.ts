import { SERVER_URL } from '@/lib/config'
import type { TypedSocket } from '@/lib/socket'
import { storage } from '@/lib/storage'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'

let authGeneration = 0
let authMutationQueue = Promise.resolve()

export function getAuthGeneration(): number {
  return authGeneration
}

function beginAuthMutation(): void {
  authGeneration += 1
  useAccountStore.getState().setLoading(false)
}

function serializeAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = authMutationQueue.then(operation, operation)
  authMutationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null
    throw new AuthRequestError(body?.error ?? `Request failed: ${res.status}`, body?.code, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function applyAccount(me: AccountMe): AccountMe {
  useAccountStore.getState().setMe(me)
  storage.setUserId(me.userId)
  if (me.nickname) storage.setNickname(me.nickname)
  else storage.clearNickname()
  return me
}

function clearAccount(): void {
  useAccountStore.getState().setMe(null)
  storage.clearUserId()
  storage.clearNickname()
}

function reconnectSocket(socket: TypedSocket): void {
  if (socket.connected || socket.active) socket.disconnect()
  socket.connect()
}

export async function fetchCurrentAccount(): Promise<AccountMe> {
  return applyAccount(await requestJson<AccountMe>('/api/auth/me'))
}

export async function loginIdentity(socket: TypedSocket, username: string, password: string): Promise<AccountMe> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    const previousUserId = useAccountStore.getState().me?.userId
    const me = await requestJson<AccountMe>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.trim(), password }),
    })
    if (previousUserId !== me.userId) storage.clearAuthCookies()
    applyAccount(me)
    reconnectSocket(socket)
    return me
  })
}

export async function registerIdentity(
  socket: TypedSocket,
  input: { username: string; password: string; nickname: string },
): Promise<AccountMe> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    const previousUserId = useAccountStore.getState().me?.userId
    const me = await requestJson<AccountMe>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...input, username: input.username.trim(), nickname: input.nickname.trim() }),
    })
    if (previousUserId !== me.userId) storage.clearAuthCookies()
    applyAccount(me)
    reconnectSocket(socket)
    return me
  })
}

export async function createGuestIdentity(socket: TypedSocket, nickname: string): Promise<AccountMe> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    const previousUserId = useAccountStore.getState().me?.userId
    const me = await requestJson<AccountMe>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ nickname: nickname.trim() }),
    })
    if (previousUserId !== me.userId) storage.clearAuthCookies()
    applyAccount(me)
    reconnectSocket(socket)
    return me
  })
}

export async function updateProfile(nickname: string): Promise<AccountMe> {
  return applyAccount(
    await requestJson<AccountMe>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: nickname.trim() }),
    }),
  )
}

export async function changePassword(
  socket: TypedSocket,
  currentPassword: string,
  newPassword: string,
): Promise<AccountMe> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    const me = await requestJson<AccountMe>('/api/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    applyAccount(me)
    reconnectSocket(socket)
    return me
  })
}

export async function changeBootstrapCredentials(
  socket: TypedSocket,
  newUsername: string,
  newPassword: string,
): Promise<AccountMe> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    const me = await requestJson<AccountMe>('/api/auth/credentials/bootstrap-change', {
      method: 'POST',
      body: JSON.stringify({ newUsername: newUsername.trim(), newPassword }),
    })
    applyAccount(me)
    reconnectSocket(socket)
    return me
  })
}

export async function logoutIdentity(socket: TypedSocket): Promise<void> {
  return serializeAuthMutation(async () => {
    beginAuthMutation()
    await requestJson<void>('/api/auth/logout', { method: 'POST' })
    socket.disconnect()
    storage.clearAuthCookies()
    clearAccount()
  })
}
