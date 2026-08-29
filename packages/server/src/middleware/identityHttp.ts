import type { NextFunction, Request, Response } from 'express'
import { getSessionTokenFromCookieHeader } from '../services/identityService.js'
import { sessionManager } from '../services/sessionManager.js'

export function identityHttpMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = getSessionTokenFromCookieHeader(req.headers.cookie)
  const principal = token ? sessionManager.authenticate(token) : null
  if (principal) {
    const isAuthenticationPath = req.path === '/auth' || req.path.startsWith('/auth/')
    if ((principal.user.mustChangePassword || principal.user.mustChangeUsername) && !isAuthenticationPath) {
      res.status(403).json({ code: 'CREDENTIAL_CHANGE_REQUIRED', error: 'Username and password change required' })
      return
    }
    req.identityUserId = principal.userId
    req.authPrincipal = principal
  }
  next()
}
