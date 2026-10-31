import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const resolveOrcaCli = () => {
  if (process.env.ORCA_CLI_COMMAND) {
    return process.env.ORCA_CLI_COMMAND
  }
  if (process.env.ORCA_DEV_REPO_ROOT) {
    return 'orca-dev'
  }
  if (process.platform === 'linux' && !process.env.ORCA_WORKTREE_PATH) {
    return 'orca-ide'
  }
  return 'orca'
}

const quote = value => `'${value.replaceAll("'", "'\\''")}'`

export const startDevPanes = ({ root, terminal = process.env.ORCA_TERMINAL_HANDLE, cli = resolveOrcaCli(), run = execFileSync }) => {
  if (!terminal) {
    throw new Error('Run development startup inside an Orca terminal with ORCA_TERMINAL_HANDLE set.')
  }
  const call = args => {
    const response = JSON.parse(run(cli, [...args, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
    if (response.ok !== true) {
      throw new Error(response.error?.message ?? 'Orca command failed')
    }
    return response.result
  }

  const split = (direction, command, title) => {
    const result = call(['terminal', 'split', '--terminal', terminal, '--direction', direction, '--command', command])
    const handle = result?.split?.handle
    if (typeof handle !== 'string' || handle.length === 0) {
      throw new Error('Orca did not return a terminal handle. Check existing development panes before restarting.')
    }
    call(['terminal', 'set-pane-title', '--terminal', handle, '--title', title])
  }

  call(['terminal', 'rename', '--terminal', terminal, '--title', 'Development'])
  call(['terminal', 'set-pane-title', '--terminal', terminal, '--title', 'Vite'])
  split('horizontal', 'mosh hello-email-space', 'mosh')
  split('vertical', `cd ${quote(root)} && bun run pb:serve`, 'PocketBase')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..')
  startDevPanes({ root })
  const result = spawnSync(process.execPath, ['--bun', 'run', 'start'], { cwd: root, stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  process.exitCode = result.status ?? 1
}
