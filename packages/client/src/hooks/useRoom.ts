import { useSocketContext } from '@/providers/SocketProvider'
import { resetAllRoomState } from '@/lib/resetStores'
import { storage } from '@/lib/storage'
import { EVENTS } from '@music-together/shared'
import { useCallback } from 'react'

import { useRoomState } from './room/useRoomState'
import { useChatSync } from './room/useChatSync'
import { useQueueSync } from './room/useQueueSync'
import { useAuthSync } from './room/useAuthSync'
import { useConnectionGuard } from './room/useConnectionGuard'

/**
 * Composition hook that wires up all room-related socket event listeners.
 * Sub-hooks are split by responsibility for maintainability.
 * The public API (leaveRoom, updateSettings, setUserRole) remains unchanged.
 */
export function useRoom() {
  const { socket } = useSocketContext()

  // Sub-hooks handle their own event listeners
  useRoomState()
  useChatSync()
  useQueueSync()
  useAuthSync()
  useConnectionGuard()

  const leaveRoom = useCallback(() => {
    storage.clearRejoinToken()
    socket.emit(EVENTS.ROOM_LEAVE)
    resetAllRoomState()
  }, [socket])

  const dissolveRoom = useCallback(() => {
    storage.clearRejoinToken()
    socket.emit(EVENTS.ROOM_DISSOLVE)
  }, [socket])

  const updateSettings = useCallback(
    (settings: {
      name?: string
      password?: string | null
      audioQuality?: import('@music-together/shared').AudioQuality
      sourcePriority?: import('@music-together/shared').SourcePriority
      hidden?: boolean
      permanent?: boolean
      chatHistoryForNewUsers?: boolean
    }) => {
      socket.emit(EVENTS.ROOM_SETTINGS, settings)
    },
    [socket],
  )

  const setUserRole = useCallback(
    (userId: string, role: 'admin' | 'member') => {
      socket.emit(EVENTS.ROOM_SET_ROLE, { userId, role })
    },
    [socket],
  )

  return { leaveRoom, dissolveRoom, updateSettings, setUserRole }
}
