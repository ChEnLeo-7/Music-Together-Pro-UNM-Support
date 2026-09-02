import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export function requestForUrl(url: URL): typeof httpRequest {
  return url.protocol === 'https:' ? httpsRequest : httpRequest
}

export function portForUrl(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
}
