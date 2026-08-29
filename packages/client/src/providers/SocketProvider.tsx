import { SERVER_URL } from '@/lib/config'
import { getSocket, type TypedSocket } from '@/lib/socket'
import { storage } from '@/lib/storage'
import { useAccountStore, type AccountMe } from '@/stores/accountStore'
import { getAuthGeneration } from '@/lib/identityAuth'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

interface SocketContextValue {
  socket: TypedSocket
  isConnected: boolean
}

const SocketContext = createContext<SocketContextValue | null>(null)
const DISCONNECT_TOAST_ID = 'socket-disconnect'

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<TypedSocket>(getSocket())
  const hadConnectionRef = useRef(false)
  const authenticatedRef = useRef(false)
  const [isConnected, setIsConnected] = useState(socketRef.current.connected)
  const t = useI18n((s) => s.t)

  useEffect(() => {
    const socket = socketRef.current
    let cancelled = false

    const onConnect = () => {
      hadConnectionRef.current = true
      setIsConnected(true)
      toast.dismiss(DISCONNECT_TOAST_ID)
    }

    const onDisconnect = () => {
      setIsConnected(false)
      if (authenticatedRef.current && hadConnectionRef.current) {
         toast.warning(t('connectionReconnecting'), { id: DISCONNECT_TOAST_ID, duration: Infinity })
      } else {
        toast.dismiss(DISCONNECT_TOAST_ID)
      }
    }

    const becomeUnauthenticated = () => {
      authenticatedRef.current = false
      useAccountStore.getState().setMe(null)
      storage.clearUserId()
      storage.clearNickname()
      if (socket.connected || socket.active) socket.disconnect()
    }

    const loadSession = async () => {
      const generation = getAuthGeneration()
      useAccountStore.getState().setLoading(true)
      try {
        const res = await fetch(`${SERVER_URL}/api/auth/me`, { credentials: 'include' })
        if (cancelled || generation !== getAuthGeneration()) return
        if (res.status === 401) {
          becomeUnauthenticated()
          return
        }
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        const me = (await res.json()) as AccountMe
        authenticatedRef.current = true
        useAccountStore.getState().setMe(me)
        storage.setUserId(me.userId)
        if (me.nickname) storage.setNickname(me.nickname)
        else storage.clearNickname()
        if (!me.mustChangePassword && !me.mustChangeUsername && !socket.connected) socket.connect()
      } catch {
        if (!cancelled && generation === getAuthGeneration()) {
          becomeUnauthenticated()
           toast.error(t('requestFailed'))
        }
      } finally {
        if (!cancelled && generation === getAuthGeneration()) useAccountStore.getState().setLoading(false)
      }
    }

    const onConnectError = (error: Error) => {
      if (error.message === 'UNAUTHENTICATED') becomeUnauthenticated()
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    const unsubscribeAccount = useAccountStore.subscribe((state) => {
      authenticatedRef.current = Boolean(state.me)
      if (!state.me) toast.dismiss(DISCONNECT_TOAST_ID)
    })
    void loadSession()

    return () => {
      cancelled = true
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      unsubscribeAccount()
    }
  }, [t])

  const value = useMemo<SocketContextValue>(() => ({ socket: socketRef.current, isConnected }), [isConnected])
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

// Provider and hook intentionally share this module so all consumers use one context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useSocketContext(): SocketContextValue {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocketContext must be used within SocketProvider')
  return ctx
}
