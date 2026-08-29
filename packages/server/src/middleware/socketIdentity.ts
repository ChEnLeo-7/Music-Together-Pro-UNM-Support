import type { TypedServer, TypedSocket } from './types.js'
import { getSessionTokenFromCookieHeader } from '../services/identityService.js'
import { sessionManager } from '../services/sessionManager.js'
import { logger } from '../utils/logger.js'
import { registerSessionSocket } from '../services/sessionSocketRegistry.js'

export function attachSocketIdentity(io: TypedServer): void {
  io.use((socket: TypedSocket, next: (err?: Error) => void) => {
    const token = getSessionTokenFromCookieHeader(socket.handshake.headers.cookie)
    const principal = token ? sessionManager.authenticate(token) : null
    if (!principal) {
      logger.warn('Socket session verification failed', { socketId: socket.id })
      next(new Error('UNAUTHENTICATED'))
      return
    }
    if (principal.user.mustChangePassword || principal.user.mustChangeUsername) {
      next(new Error('CREDENTIAL_CHANGE_REQUIRED'))
      return
    }
    socket.data.identityUserId = principal.userId
    socket.data.sessionId = principal.session.id
    registerSessionSocket(socket)
    socket.use((_event, packetNext) => {
      const current = sessionManager.authenticate(token!)
      if (!current) {
        packetNext(new Error('UNAUTHENTICATED'))
        return
      }
      if (current.user.mustChangePassword || current.user.mustChangeUsername) {
        packetNext(new Error('CREDENTIAL_CHANGE_REQUIRED'))
        return
      }
      packetNext()
    })
    next()
  })
}
