import { findBindAddress, rotateToken } from './config'

const { config, token } = await rotateToken()
const address = findBindAddress() ?? '<tailscale-ip>'
console.log(`Host URL: http://${address}:${config.port}`)
console.log(`Token (shown only once): ${token}`)
console.log('Save this token securely and update every client in Settings > Tools > Browser Agent.')
console.log('Restart the browser host to activate the new token and invalidate the old one.')
console.log('For the installed LaunchAgent, run:')
console.log('  launchctl kickstart -k "gui/$(id -u)/de.open-chat-ui.browser-host"')
