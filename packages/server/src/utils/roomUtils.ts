import type { RoomState } from '@music-together/shared'
import type { RoomData } from '../repositories/types.js'

interface PublicRoomStateOptions {
  includeQueue?: boolean
}

/** 将内部 RoomData 转为客户端可见的 RoomState（不含密码明文） */
export function toPublicRoomState(data: RoomData, options: PublicRoomStateOptions = {}): RoomState {
  const state: RoomState = {
    id: data.id,
    name: data.name,
    creatorId: data.creatorId,
    hostId: data.hostId,
    hasPassword: data.credential !== null,
    audioQuality: data.audioQuality,
    sourcePriority: data.sourcePriority,
    hidden: data.hidden,
    permanent: data.permanent,
    chatHistoryForNewUsers: data.chatHistoryForNewUsers,
    users: data.users,
    currentTrack: data.currentTrack,
    playState: data.playState,
    playMode: data.playMode,
    unmServerUrl: data.unmServerUrl,
  }

  if (options.includeQueue) {
    state.queue = data.queue
  }

  return state
}

/** @deprecated 房间密码只能通过 owner 专用 HTTP 接口读取。 */
export function toPublicRoomStateForOwner(data: RoomData, options: PublicRoomStateOptions = {}): RoomState {
  return toPublicRoomState(data, options)
}
