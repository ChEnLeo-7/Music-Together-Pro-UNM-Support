import type { TypedSocket } from '../middleware/types.js'

const socketsBySession = new Map<string, Set<TypedSocket>>()
const socketsByUser = new Map<string, Set<TypedSocket>>()

function add(index: Map<string, Set<TypedSocket>>, key: string, socket: TypedSocket): void {
  const sockets = index.get(key) ?? new Set<TypedSocket>()
  sockets.add(socket)
  index.set(key, sockets)
}

function remove(index: Map<string, Set<TypedSocket>>, key: string, socket: TypedSocket): void {
  const sockets = index.get(key)
  if (!sockets) return
  sockets.delete(socket)
  if (sockets.size === 0) index.delete(key)
}

export function registerSessionSocket(socket: TypedSocket): void {
  add(socketsBySession, socket.data.sessionId, socket)
  add(socketsByUser, socket.data.identityUserId, socket)
  socket.once('disconnect', () => {
    remove(socketsBySession, socket.data.sessionId, socket)
    remove(socketsByUser, socket.data.identityUserId, socket)
  })
}

function disconnectSockets(sockets: Set<TypedSocket> | undefined): void {
  if (!sockets) return
  for (const socket of [...sockets]) socket.disconnect(true)
}

export function disconnectSessionSockets(sessionId: string): void {
  disconnectSockets(socketsBySession.get(sessionId))
}

export function disconnectUserSockets(userId: string): void {
  disconnectSockets(socketsByUser.get(userId))
}
