declare global {
  namespace Express {
    interface Request {
      identityUserId?: string
      authPrincipal?: import('../services/sessionManager.js').AuthenticatedPrincipal
    }
  }
}

export {}
