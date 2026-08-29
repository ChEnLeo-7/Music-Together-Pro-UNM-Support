import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

interface EncryptedValue {
  ciphertext: string
  nonce: string
  tag: string
  version: 1
}

function loadKey(): Buffer {
  const configured = process.env.PLATFORM_AUTH_KEY
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw new Error('PLATFORM_AUTH_KEY is required in production')
    return createHash('sha256').update('music-together-development-platform-auth-key').digest()
  }
  const key = Buffer.from(configured, 'base64')
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== configured.replace(/=+$/, '')) {
    throw new Error('PLATFORM_AUTH_KEY must be a Base64-encoded 32-byte key')
  }
  return key
}

const key = loadKey()

export function encryptPlatformCredential(value: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return JSON.stringify({
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  } satisfies EncryptedValue)
}

export function decryptPlatformCredential(serialized: string): string {
  const encrypted = JSON.parse(serialized) as EncryptedValue
  if (encrypted.version !== 1) throw new Error('Unsupported platform credential version')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
