import { rmSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

function resolveDatabasePath(databaseUrl: string): string {
  const rawPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
}

const confirmation = '--confirm=RESET-ALL-APPLICATION-DATA'
if (!process.argv.includes(confirmation)) {
  process.stderr.write(`Refusing to reset. Re-run with ${confirmation} after stopping the server and taking a backup.\n`)
  process.exitCode = 1
} else {
  const databasePath = resolveDatabasePath(config.database.url)
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
  rmSync(path.join(path.dirname(databasePath), 'avatars'), { recursive: true, force: true })
  process.stdout.write('Application database and avatars reset. Start the server to migrate, then run account:init-admin.\n')
}
