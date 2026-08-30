import { useSocketContext } from '@/providers/SocketProvider'
import { usePlayerStore } from '@/stores/playerStore'
import { useRoomStore } from '@/stores/roomStore'
import { storage } from '@/lib/storage'
import { resetAllRoomState } from '@/lib/resetStores'
import { releaseNativePlayback } from '@/lib/nativePlayback'
import { ERROR_CODE, EVENTS } from '@music-together/shared'
import type {
  AudioQuality,
  RoomAutoFallbackEvent,
  RoomState,
  SourcePriority,
  User,
  UserRole,
} from '@music-together/shared'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getLocalizedError, useI18n } from '@/lib/i18n'

/**
 * Handles core room lifecycle events:
 * ROOM_STATE, ROOM_USER_JOINED/LEFT, ROOM_SETTINGS, ROOM_ROLE_CHANGED, ROOM_ERROR.
 *
 * Also auto-resends persisted auth cookies on ROOM_STATE (join/reconnect).
 *
 * NOTE: `currentUser` is auto-derived inside `roomStore` whenever `room`
 * changes (setRoom / addUser / removeUser / updateRoom).
 */
export function useRoomState() {
  const navigate = useNavigate()
  const t = useI18n((s) => s.t)
  const { socket } = useSocketContext()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // Guard against React Strict Mode double-mount sending cookies twice.
  // Persists across cleanup/re-setup so the second mount is a no-op.
  const authResendRoomIdRef = useRef<string | null>(null)

  useEffect(() => {
    const resendCookies = () => {
      const storedCookies = storage.getAuthCookies()
      const persist = storage.getServerAuthPersistence()
      for (const { platform, cookie } of storedCookies) {
        socket.emit(EVENTS.AUTH_SET_COOKIE, { platform, cookie, persist })
      }
    }

    const onRoomState = (roomState: RoomState) => {
      // setRoom automatically derives currentUser from room.users
      useRoomStore.getState().setRoom(roomState)
      if (!roomState.currentTrack) {
        usePlayerStore.getState().reset()
      }
      if ('queue' in roomState && authResendRoomIdRef.current !== roomState.id) {
        authResendRoomIdRef.current = roomState.id
        resendCookies()
      }
    }

    const onUserJoined = (user: User) => {
      useRoomStore.getState().addUser(user)
    }

    const onRejoinToken = (data: { roomId: string; token: string; expiresAt: number }) => {
      storage.setRejoinToken(data.roomId, data.token, data.expiresAt)
    }

    const onUserLeft = (user: User) => {
      useRoomStore.getState().markUserOffline(user.id)
    }

    const onSettings = (settings: {
      name: string
      hasPassword: boolean
      audioQuality: AudioQuality
      sourcePriority: SourcePriority
      hidden?: boolean
      permanent?: boolean
      chatHistoryForNewUsers?: boolean
    }) => {
      useRoomStore.getState().updateRoom(settings)
    }

    const onRoleChanged = (data: { userId: string; role: UserRole }) => {
      const store = useRoomStore.getState()
      const room = store.room
      if (!room) return
      const updatedUsers = room.users.map((u) => (u.id === data.userId ? { ...u, role: data.role } : u))
      // updateRoom with users automatically re-derives currentUser
      store.updateRoom({ users: updatedUsers })
    }

    const onRoomDissolved = (data: { roomId: string }) => {
      storage.clearRejoinToken(data.roomId)
      releaseNativePlayback()
      resetAllRoomState()
      toast.info(t('roomDissolvedNotice'))
      navigateRef.current('/', { replace: true })
    }

    const sourceLabel = (source: 'netease' | 'tencent') => t(source)

    const onAutoFallback = (data: RoomAutoFallbackEvent) => {
      const id = `auto-fallback:${data.attemptId}`
      const from = sourceLabel(data.fromSource)
      const to = sourceLabel(data.toSource)

      if (data.status === 'trying') {
        const reasonLabel =
          data.reasonType === 'VIP_REQUIRED'
            ? t('fallbackVip')
            : data.reasonType === 'COPYRIGHT_RESTRICTED'
              ? t('fallbackCopyright')
              : data.reasonType === 'NO_RESOURCE'
                ? t('fallbackNoResource')
                : data.reasonType === 'TIMEOUT'
                  ? t('fallbackTimeout')
                  : t('fallbackUnavailable')

        toast.loading(t('sourceFallbackTrying', { from, reason: reasonLabel, to }), { id })
        return
      }

      if (data.status === 'success') {
        toast.success(t('sourceFallbackSuccess', { to, track: data.trackTitle }), { id })
        return
      }

      // failed
      type ReasonType = NonNullable<RoomAutoFallbackEvent['reasonType']>
      const reasonMap: Partial<Record<ReasonType, string>> = {
        VIP_REQUIRED: t('fallbackVip'),
        COPYRIGHT_RESTRICTED: t('fallbackCopyright'),
        NO_RESOURCE: t('fallbackNoResource'),
        TIMEOUT: t('fallbackTimeout'),
      }
      const reasonText = data.reasonType ? (reasonMap[data.reasonType] ?? null) : null
      toast.error(
        t('sourceFallbackFailed', { track: data.trackTitle, reason: reasonText ? `（${reasonText}）` : '' }),
        { id },
      )
    }

    const onError = (error: { code: string; message: string }) => {
      // WRONG_PASSWORD is handled by RoomPage's own UI (gate password field),
      // so skip the generic toast to avoid duplicate feedback.
      if (
        error.code === ERROR_CODE.WRONG_PASSWORD ||
        error.code === ERROR_CODE.ROOM_PASSWORD_REQUIRED ||
        error.code === ERROR_CODE.ROOM_GRANT_INVALID
      ) {
        return
      }

      toast.error(getLocalizedError(error, t))
      if (error.code === ERROR_CODE.ROOM_NOT_FOUND) {
        navigateRef.current('/', { replace: true })
      }
    }

    socket.on(EVENTS.ROOM_STATE, onRoomState)
    socket.on(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
    socket.on(EVENTS.ROOM_USER_JOINED, onUserJoined)
    socket.on(EVENTS.ROOM_USER_LEFT, onUserLeft)
    socket.on(EVENTS.ROOM_SETTINGS, onSettings)
    socket.on(EVENTS.ROOM_ROLE_CHANGED, onRoleChanged)
    socket.on(EVENTS.ROOM_DISSOLVED, onRoomDissolved)
    socket.on(EVENTS.ROOM_AUTO_FALLBACK, onAutoFallback)
    socket.on(EVENTS.ROOM_ERROR, onError)

    const mountedRoom = useRoomStore.getState().room
    if (mountedRoom && authResendRoomIdRef.current !== mountedRoom.id) {
      authResendRoomIdRef.current = mountedRoom.id
      resendCookies()
    }

    return () => {
      socket.off(EVENTS.ROOM_STATE, onRoomState)
      socket.off(EVENTS.ROOM_REJOIN_TOKEN, onRejoinToken)
      socket.off(EVENTS.ROOM_USER_JOINED, onUserJoined)
      socket.off(EVENTS.ROOM_USER_LEFT, onUserLeft)
      socket.off(EVENTS.ROOM_SETTINGS, onSettings)
      socket.off(EVENTS.ROOM_ROLE_CHANGED, onRoleChanged)
      socket.off(EVENTS.ROOM_DISSOLVED, onRoomDissolved)
      socket.off(EVENTS.ROOM_AUTO_FALLBACK, onAutoFallback)
      socket.off(EVENTS.ROOM_ERROR, onError)
    }
  }, [socket, t])
}
