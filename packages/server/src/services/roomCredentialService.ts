import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface EncryptedRoomCredential {
  ciphertext: string
  nonce: string
  tag: string
  keyVersion: number
}

const configuredKey = process.env.ROOM_PASSWORD_KEY
const keyVersion = Number.parseInt(process.env.ROOM_PASSWORD_KEY_VERSION ?? '1', 10)

function loadKey(): Buffer {
  if (!configuredKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ROOM_PASSWORD_KEY is required in production')
    }
    return createHash('sha256').update('music-together-development-room-password-key').digest()
  }

  const key = Buffer.from(configuredKey, 'base64')
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== configuredKey.replace(/=+$/, '')) {
    throw new Error('ROOM_PASSWORD_KEY must be a Base64-encoded 32-byte key')
  }
  if (process.env.NODE_ENV === 'production' && configuredKey === Buffer.alloc(32).toString('base64')) {
    throw new Error('ROOM_PASSWORD_KEY must not use the example key in production')
  }
  return key
}

if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
  throw new Error('ROOM_PASSWORD_KEY_VERSION must be a positive integer')
}

const keys = new Map<number, Buffer>([[keyVersion, loadKey()]])

function decrypt(credential: EncryptedRoomCredential): Buffer {
  const key = keys.get(credential.keyVersion)
  if (!key) throw new Error(`Unsupported room password key version: ${credential.keyVersion}`)

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(credential.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(credential.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(credential.ciphertext, 'base64')), decipher.final()])
}

export function encryptRoomPassword(password: string): EncryptedRoomCredential {
  const key = keys.get(keyVersion)!
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  }
}

export function verifyRoomPassword(credential: EncryptedRoomCredential, candidate: string): boolean {
  try {
    const expected = decrypt(credential)
    const actual = Buffer.from(candidate, 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function revealRoomPassword(credential: EncryptedRoomCredential): string {
  return decrypt(credential).toString('utf8')
}
