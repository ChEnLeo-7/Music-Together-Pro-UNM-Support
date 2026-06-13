import { EVENTS, ERROR_CODE, defineAbilityFor } from '@music-together/shared'
import type { Actions, Subjects } from '@music-together/shared'
import { userRepo } from '../repositories/userRepository.js'
import type { HandlerContext, TypedServer } from './types.js'
import { createWithRoom } from './withRoom.js'

export function createWithPermission(io: TypedServer) {
  const withRoom = createWithRoom(io)

  return function withPermission<T = void>(
    action: Actions,
    subject: Subjects,
    handler: (ctx: HandlerContext, data: T) => void | Promise<void>,
  ) {
    return withRoom<T>((ctx, data) => {
      const ability = defineAbilityFor(ctx.user.role)
      if (!ability.can(action, subject)) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '你没有权限执行此操作',
        })
        return
      }
      return handler(ctx, data)
    })
  }
}

export function isRoomManager(ctx: HandlerContext): boolean {
  return ctx.user.role === 'owner' || ctx.user.role === 'admin' || userRepo.isServerAdmin(ctx.socket.data.identityUserId)
}

export function createWithRoomManager(io: TypedServer) {
  const withRoom = createWithRoom(io)

  return function withRoomManager<T = void>(handler: (ctx: HandlerContext, data: T) => void | Promise<void>) {
    return withRoom<T>((ctx, data) => {
      if (!isRoomManager(ctx)) {
        ctx.socket.emit(EVENTS.ROOM_ERROR, {
          code: ERROR_CODE.NO_PERMISSION,
          message: '只有房主或服务器管理员可以操作',
        })
        return
      }
      return handler(ctx, data)
    })
  }
}

export const createWithOwnerOnly = createWithRoomManager
