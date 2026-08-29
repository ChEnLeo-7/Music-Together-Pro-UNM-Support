import bcrypt from 'bcryptjs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { randomUUID } from 'node:crypto'
import { userRepo } from '../repositories/userRepository.js'
import { normalizeUsername, validateAccountPassword } from '../services/accountAuth.js'

async function readPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Administrator initialization requires an interactive terminal')
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
    }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('Cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  if (userRepo.countAdmins() > 0) throw new Error('An administrator already exists')
  const terminal = createInterface({ input: stdin, output: stdout })
  const usernameInput = await terminal.question('Username: ')
  const nickname = (await terminal.question('Nickname: ')).trim()
  terminal.close()
  const password = await readPassword('Password: ')
  const confirmation = await readPassword('Confirm password: ')
  if (password !== confirmation) throw new Error('Passwords do not match')
  const username = normalizeUsername(usernameInput)
  validateAccountPassword(password)
  const passwordHash = await bcrypt.hash(password, 12)
  userRepo.transaction(() => {
    if (userRepo.countAdmins() > 0) throw new Error('An administrator already exists')
    userRepo.create({ id: randomUUID(), kind: 'account', username, nickname, passwordHash, role: 'admin' })
  })
  stdout.write(`Administrator ${username} created.\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Failed to initialize administrator: ${message}\n`)
  process.exitCode = 1
})
