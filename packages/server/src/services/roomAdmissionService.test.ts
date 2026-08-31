import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoomData } from '../repositories/types.js'
import { roomCreateSchema, roomJoinSchema, roomSettingsSchema } from '@music-together/shared'
import { isRoomOwner } from '../middleware/withControl.js'
import { authorizeRoomJoin, revokeRoomAdmissionGrants } from './roomAdmissionService.js'
import { encryptRoomPassword, revealRoomPassword, verifyRoomPassword } from './roomCredentialService.js'

let sequence = 0

function protectedRoom(): RoomData {
  sequence += 1
  return {
    id: `ROOM-${sequence}`,
    name: 'Protected room',
    credential: encryptRoomPassword('secret1'),
    passwordVersion: 1,
    creatorId: 'owner',
    hostId: 'owner',
    conductorSocketId: 'socket-owner',
    adminUserIds: new Set(['admin']),
    hiddenMemberUserIds: new Set(),
    temporaryAdminUserId: null,
    audioQuality: 320,
    sourcePriority: 'smart',
    hidden: false,
    permanent: false,
    chatHistoryForNewUsers: true,
    users: [
      { id: 'owner', nickname: 'Owner', role: 'owner', online: true },
      { id: 'admin', nickname: 'Admin', role: 'admin', online: false },
      { id: 'member', nickname: 'Member', role: 'member', online: false },
    ],
    queue: [],
    currentTrack: null,
    playState: { isPlaying: false, currentTime: 0, serverTimestamp: Date.now(), playbackRevision: 0 },
    playMode: 'loop-all',
    unmServerUrl: '',
  }
}

function authorize(
  room: RoomData,
  userId: string,
  input: { password?: string; grantToken?: string; sessionId?: string } = {},
) {
  return authorizeRoomJoin({
    room,
    userId,
    sessionId: input.sessionId ?? `session-${userId}`,
    password: input.password,
    grantToken: input.grantToken,
    sourceIp: `127.0.0.${sequence}`,
    socketId: `socket-${sequence}-${userId}-${Math.random()}`,
  })
}

test('AES-GCM credential reveals and verifies only the exact password', () => {
  const credential = encryptRoomPassword('  six chars  ')
  assert.equal(revealRoomPassword(credential), '  six chars  ')
  assert.equal(verifyRoomPassword(credential, '  six chars  '), true)
  assert.equal(verifyRoomPassword(credential, 'six chars'), false)
  assert.equal('password' in credential, false)
})

test('room password schemas enforce 6-64 exact characters and null removal', () => {
  assert.equal(roomCreateSchema.safeParse({ nickname: 'n', password: '12345' }).success, false)
  assert.equal(roomCreateSchema.safeParse({ nickname: 'n', password: '      ' }).success, false)
  assert.equal(roomCreateSchema.safeParse({ nickname: 'n', password: ' 1234 ' }).success, true)
  assert.equal(roomJoinSchema.safeParse({ roomId: 'R', nickname: 'n', password: 'x'.repeat(65) }).success, false)
  assert.equal(roomSettingsSchema.safeParse({ password: null }).success, true)
})

test('only creator bypasses a protected room password', () => {
  const room = protectedRoom()
  assert.equal(authorize(room, 'owner').authorized, true)
  assert.deepEqual(authorize(room, 'admin'), { authorized: false, errorCode: 'ROOM_PASSWORD_REQUIRED' })
  assert.deepEqual(authorize(room, 'member'), { authorized: false, errorCode: 'ROOM_PASSWORD_REQUIRED' })
  assert.deepEqual(authorize(room, 'server-admin'), { authorized: false, errorCode: 'ROOM_PASSWORD_REQUIRED' })
})

test('owner permission is identity equality, not an administrative role', () => {
  assert.equal(isRoomOwner('owner', 'owner'), true)
  assert.equal(isRoomOwner('owner', 'room-admin'), false)
  assert.equal(isRoomOwner('owner', 'server-admin'), false)
})

test('grant is bound and reusable by sibling sockets in the same session', () => {
  const room = protectedRoom()
  const admitted = authorize(room, 'member', { password: 'secret1' })
  assert.ok(admitted.authorized && admitted.grant)
  const token = admitted.authorized ? admitted.grant?.token : undefined
  assert.ok(token)

  assert.deepEqual(authorize(room, 'other', { grantToken: token }), {
    authorized: false,
    errorCode: 'ROOM_PASSWORD_REQUIRED',
  })
  assert.deepEqual(authorize(room, 'member', { grantToken: token, sessionId: 'wrong-session' }), {
    authorized: false,
    errorCode: 'ROOM_PASSWORD_REQUIRED',
  })

  const reused = authorize(room, 'member', { grantToken: token })
  assert.ok(reused.authorized && reused.grant?.token === token)
  assert.ok(authorize(room, 'member', { grantToken: token }).authorized)
})

test('version change and room revocation invalidate grants', () => {
  const room = protectedRoom()
  const admitted = authorize(room, 'member', { password: 'secret1' })
  assert.ok(admitted.authorized && admitted.grant)
  const token = admitted.authorized ? admitted.grant?.token : undefined

  room.passwordVersion += 1
  assert.deepEqual(authorize(room, 'member', { grantToken: token }), {
    authorized: false,
    errorCode: 'ROOM_PASSWORD_REQUIRED',
  })

  const current = authorize(room, 'member', { password: 'secret1' })
  assert.ok(current.authorized && current.grant)
  revokeRoomAdmissionGrants(room.id)
  assert.deepEqual(authorize(room, 'member', { grantToken: current.authorized ? current.grant?.token : undefined }), {
    authorized: false,
    errorCode: 'ROOM_PASSWORD_REQUIRED',
  })
})
