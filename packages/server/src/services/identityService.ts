import type { Request, Response } from 'express'
import { config } from '../config.js'

export const SESSION_COOKIE_NAME = 'mt_session'

export function getSessionTokenFromCookieHeader(cookieHeader?: string): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 1 || pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

function requestUsesHttps(req: Request): boolean {
  if (req.secure) return true
  const forwarded = Array.isArray(req.headers['x-forwarded-proto']) ? req.headers['x-forwarded-proto'][0] : req.headers['x-forwarded-proto']
  return typeof forwarded === 'string' && forwarded.split(',')[0]?.trim().toLowerCase() === 'https'
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = config.session.cookieSecure ?? (config.isProd || requestUsesHttps(req))
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(config.session.ttlMs / 1000)}`,
  ]
  if (secure) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = config.session.cookieSecure ?? (config.isProd || requestUsesHttps(req))
  const attributes = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}
