import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

type LookupAddress = { address: string; family: number }
type AddressLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>

export interface PublicHttpUrlOptions {
  /**
   * Some deployments resolve trusted CDN hostnames to fake-ip addresses at
   * the gateway. Keep this opt-in and host-scoped so arbitrary remote URLs
   * still receive the normal SSRF protection.
   */
  allowFakeIpForHosts?: readonly string[]
  lookup?: AddressLookup
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]!
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  )
}

function isFakeIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const parts = address.split('.').map(Number)
    return (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part)) &&
      parts[0] === 198 &&
      parts[1]! >= 18 &&
      parts[1]! <= 19
    )
  }
  if (family !== 6) return false

  // Fake-IP gateways commonly use ULA space for IPv6, including the
  // fdfe:dcba:9876::/48 range used by the current deployment.
  const normalized = address.toLowerCase().split('%')[0]!
  return normalized.startsWith('fc') || normalized.startsWith('fd')
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : true
}

function hostnameMatches(hostname: string, allowedHost: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  const normalizedAllowedHost = allowedHost.toLowerCase().replace(/^\.+|\.+$/g, '')
  return normalizedHostname === normalizedAllowedHost || normalizedHostname.endsWith(`.${normalizedAllowedHost}`)
}

export async function assertPublicHttpUrl(rawUrl: string, options: PublicHttpUrlOptions = {}): Promise<URL> {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported stream URL')
  }

  const allowFakeIp = options.allowFakeIpForHosts?.some((host) => hostnameMatches(url.hostname, host)) ?? false
  const addresses = await (options.lookup ?? (lookup as AddressLookup))(url.hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address) && !(allowFakeIp && isFakeIpAddress(address)))
  ) {
    throw new Error('Stream URL resolves to a non-public address')
  }
  return url
}
