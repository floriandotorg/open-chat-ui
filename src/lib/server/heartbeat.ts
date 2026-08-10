import { now } from '$lib/server/db/records'
import { pb } from '$lib/server/pb'

const HEARTBEAT_ID = 'globalheartbeat'
const HEARTBEAT_INTERVAL_MS = 15_000

// PocketBase realtime sends no protocol-level pings, so a singleton row is
// touched on an interval: every client's heartbeat subscription receives an
// event, which doubles as the liveness signal for the realtime watchdog.
export const startServerHeartbeat = () => {
  const g = globalThis as { __serverHeartbeatStarted?: boolean }
  if (g.__serverHeartbeatStarted) return
  g.__serverHeartbeatStarted = true

  const beat = async () => {
    try {
      await pb.collection('heartbeat').update(HEARTBEAT_ID, { updated: now() })
    } catch {
      try {
        await pb.collection('heartbeat').create({ id: HEARTBEAT_ID, updated: now() })
      } catch {}
    }
  }

  void beat()
  setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS)
}
