import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dataDir, ensureConfig, findBindAddress } from './config'

const RELEASES_URL = 'https://api.github.com/repos/ungoogled-software/ungoogled-chromium-macos/releases/latest'
const LAUNCH_AGENT_LABEL = 'de.open-chat-ui.browser-host'
const BOOTOUT_POLLS = 20
const BOOTSTRAP_ATTEMPTS = 5
const BOOTSTRAP_RETRY_MS = 500

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString()
}

const latestRelease = async (): Promise<{ version: string; url: string }> => {
  const response = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`)
  }
  const release: unknown = await response.json()
  if (typeof release !== 'object' || release === null || !('tag_name' in release) || typeof release.tag_name !== 'string' || !('assets' in release) || !Array.isArray(release.assets)) {
    throw new Error('Unexpected GitHub release format')
  }
  const suffix = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-macos.dmg`
  for (const asset of release.assets) {
    if (typeof asset === 'object' && asset !== null && 'name' in asset && 'browser_download_url' in asset && typeof asset.name === 'string' && typeof asset.browser_download_url === 'string' && asset.name.endsWith(suffix)) {
      return { version: release.tag_name, url: asset.browser_download_url }
    }
  }
  throw new Error(`No ${suffix} asset in release ${release.tag_name}`)
}

const installChromium = async () => {
  const { version, url } = await latestRelease()
  const chromiumRoot = join(dataDir, 'chromium')
  const target = join(chromiumRoot, version)
  if (existsSync(join(target, 'Chromium.app'))) {
    console.log(`ungoogled-chromium ${version} is already installed.`)
  } else {
    console.log(`Downloading ungoogled-chromium ${version}...`)
    const temp = await mkdtemp(join(tmpdir(), 'open-chat-ui-chromium-'))
    const mountPoint = join(temp, 'mount')
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed with ${response.status}`)
      }
      const dmg = join(temp, 'chromium.dmg')
      await Bun.write(dmg, response)
      await mkdir(mountPoint)
      run(['hdiutil', 'attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])
      try {
        await mkdir(target, { recursive: true })
        run(['ditto', join(mountPoint, 'Chromium.app'), join(target, 'Chromium.app')])
      } finally {
        run(['hdiutil', 'detach', mountPoint])
      }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
  for (const entry of readdirSync(chromiumRoot)) {
    if (entry !== version) {
      await rm(join(chromiumRoot, entry), { recursive: true, force: true })
    }
  }
}

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const launchAgentPlist = (repoDir: string, logPath: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(Bun.which('bun') ?? process.execPath)}</string>
    <string>${escapeXml(join(repoDir, 'browser-host', 'main.ts'))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin')}</string>
  </dict>
</dict>
</plist>
`

const installLaunchAgent = async () => {
  const repoDir = resolve(import.meta.dir, '..')
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
  const logPath = join(homedir(), 'Library', 'Logs', 'open-chat-ui-browser-host.log')
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  await Bun.write(plistPath, launchAgentPlist(repoDir, logPath))
  const domain = `gui/${process.getuid?.() ?? 501}`
  const service = `${domain}/${LAUNCH_AGENT_LABEL}`
  const isLoaded = () => Bun.spawnSync(['launchctl', 'print', service], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
  Bun.spawnSync(['launchctl', 'bootout', service], { stdout: 'ignore', stderr: 'ignore' })
  for (let n = 0; n < BOOTOUT_POLLS && isLoaded(); ++n) {
    await Bun.sleep(BOOTSTRAP_RETRY_MS)
  }
  for (let n = 1; ; ++n) {
    try {
      run(['launchctl', 'bootstrap', domain, plistPath])
      break
    } catch (err) {
      if (n >= BOOTSTRAP_ATTEMPTS) {
        throw err
      }
      await Bun.sleep(BOOTSTRAP_RETRY_MS)
    }
  }
  console.log(`LaunchAgent installed: ${plistPath}`)
  console.log(`Logs: ${logPath}`)
}

await installChromium()
const config = await ensureConfig()
if (!process.argv.includes('--no-launchd')) {
  await installLaunchAgent()
}
const address = findBindAddress() ?? '<tailscale-ip>'
console.log('\nAdd these in Settings > Tools > Browser Agent:')
console.log(`  Host URL: http://${address}:${config.port}`)
console.log(`  Token:    ${config.token}`)
