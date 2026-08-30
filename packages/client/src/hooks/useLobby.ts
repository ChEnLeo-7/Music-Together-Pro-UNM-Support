import { storage } from '@/lib/storage'
import { getNativePlaybackBridge } from '@/lib/nativePlayback'
import { SERVER_URL } from '@/lib/config'
import { useSocketContext } from '@/providers/SocketProvider'
import { useLobbyStore } from '@/stores/lobbyStore'
import { EVENTS, type RoomListItem } from '@music-together/shared'
import { useCallback, useEffect } from 'react'
import { useAccountStore } from '@/stores/accountStore'
import { useSocketEvent } from './useSocketEvent'

export function useLobby() {
  const { socket } = useSocketContext()
  const rooms = useLobbyStore((s) => s.rooms)
  const isLoading = useLobbyStore((s) => s.isLoading)
  const account = useAccountStore((s) => s.me)

  // Request room list on mount and on reconnect
  useEffect(() => {
    let cancelled = false
    const requestPublicList = async () => {
      useLobbyStore.getState().setLoading(true)
      try {
        const response = await fetch(`${SERVER_URL}/api/rooms`, { credentials: 'include' })
        if (!response.ok) throw new Error('Failed to load public rooms')
        const data = (await response.json()) as { rooms: RoomListItem[] }
        if (!cancelled) useLobbyStore.getState().setRooms(data.rooms)
      } catch {
        if (!cancelled) useLobbyStore.getState().setLoading(false)
      }
    }

    const requestList = () => {
      useLobbyStore.getState().setLoading(true)
      socket.emit(EVENTS.ROOM_LIST)
    }

    if (socket.connected) requestList()
    else requestPublicList()
    socket.on('connect', requestList)
    return () => {
      cancelled = true
      socket.off('connect', requestList)
    }
  }, [account, socket])

  // Listen for real-time room list updates
  useSocketEvent(
    EVENTS.ROOM_LIST_UPDATE,
    useCallback((rooms: RoomListItem[]) => {
      useLobbyStore.getState().setRooms(rooms)
    }, []),
  )

  const createRoom = useCallback(
    (nickname: string, roomName?: string, password?: string) => {
      socket.emit(EVENTS.ROOM_CREATE, {
        nickname,
        roomName,
        password,
        playbackCapable: !getNativePlaybackBridge(),
      })
    },
    [socket],
  )

  const joinRoom = useCallback(
    (roomId: string, nickname: string, password?: string) => {
      const rejoinToken = password === undefined ? storage.getRejoinToken(roomId) : null
      socket.emit(EVENTS.ROOM_JOIN, {
        roomId,
        nickname,
        password,
        rejoinToken: rejoinToken ?? undefined,
        playbackCapable: !getNativePlaybackBridge(),
      })
    },
    [socket],
  )

  return { rooms, isLoading, createRoom, joinRoom }
}
