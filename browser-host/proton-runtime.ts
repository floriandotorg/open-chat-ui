import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createProtonPass, type ProtonCommand } from './proton-pass'

const COMMAND_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

export const createLocalProtonPass = (dataDir: string) => {
  const tokenPath = join(dataDir, 'proton-pass-token')
  const sessionRoot = join(dataDir, 'proton-sessions')
  const executable = () => Bun.which('pass-cli')

  const readToken = async (): Promise<string | null> => {
    const file = await open(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
      if (error?.code === 'ENOENT') {
        return null
      }
      throw new Error('Cannot open Proton token file')
    })
    if (!file) {
      return null
    }
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 8192 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
        throw new Error('Proton token file must be private and owned by the host user')
      }
      return (await file.readFile('utf8')).trim() || null
    } finally {
      await file.close()
    }
  }

  const run = ({ args, env }: ProtonCommand): Promise<string> =>
    new Promise((resolve, reject) => {
      const cli = executable()
      if (!cli) {
        reject(new Error('Proton Pass CLI is not installed'))
        return
      }
      const child = execFile(
        cli,
        args,
        {
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ...env },
          timeout: COMMAND_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: 'utf8',
        },
        (error, stdout) => {
          if (error) {
            reject(new Error('Proton Pass CLI command failed'))
          } else {
            resolve(stdout)
          }
        },
      )
      child.stdin?.end()
    })

  const provider = createProtonPass({
    readToken,
    run,
    createDirectory: async () => {
      await mkdir(sessionRoot, { recursive: true, mode: 0o700 })
      await chmod(sessionRoot, 0o700)
      return mkdtemp(join(sessionRoot, 'operation-'))
    },
    removeDirectory: path => rm(path, { recursive: true, force: true }),
  })

  const configured = async () => {
    const info = await stat(tokenPath).catch(() => null)
    return !!executable() && !!info?.isFile() && info.size > 0 && (info.mode & 0o077) === 0
  }

  return { ...provider, configured }
}
