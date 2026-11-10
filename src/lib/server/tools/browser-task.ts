import { readFile } from 'node:fs/promises'
import { runAnthropicBrowserAgent } from '#lib/server/browser/agent-anthropic.ts'
import { runOpenAiBrowserAgent } from '#lib/server/browser/agent-openai.ts'
import { loadBrowserAgentConfig } from '#lib/server/browser/config.ts'
import { runBrowserTask } from '#lib/server/browser/run-task.ts'
import { getPricing } from '#lib/server/pricing.ts'
import { getUploadPath, hasUpload } from '#lib/server/uploads.ts'
import { resolveMessageCost } from '#lib/server/usage-cost.ts'
import type { ToolDefinition } from './types'

export const BROWSER_TASK_TOOL_NAME = 'browser_task'

export const browserTask: ToolDefinition = {
  name: BROWSER_TASK_TOOL_NAME,
  description: `Hand a task to a browser agent that operates a real Chromium browser on the user's MacBook, with the user's saved logins, cookies and residential IP.
Use it for anything that needs a real browser: sites that need a login, multi-step forms, shopping carts, listings (e.g. eBay, Kleinanzeigen), bookings, dashboards, or pages that block simple fetching. Prefer fetch_url or search tools for reading public pages.
The agent asks the user to log in or to approve consequential actions (buying, posting, sending) and waits for them, so do not ask for passwords.
Images and files the user attached in this conversation are available to the agent for uploads; refer to them by file name or describe them.
The agent sees only the task, not this conversation. Write a complete, self-contained task: the goal, every detail it needs (titles, descriptions, prices, choices), and what to report back. Tasks take one to several minutes.`,
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Complete, self-contained instructions for the browser agent, including what to report back.' },
      start_url: { type: 'string', description: 'Optional http(s) URL to open first.' },
    },
    required: ['task'],
  },
  execute: async (args, context) => {
    const task = typeof args.task === 'string' ? args.task.trim() : ''
    if (!task) {
      return 'Error: task is required.'
    }
    const startUrl = typeof args.start_url === 'string' && /^https?:\/\//i.test(args.start_url) ? args.start_url : undefined
    return runBrowserTask({ task, ...(startUrl ? { startUrl } : {}) }, context, {
      loadConfig: loadBrowserAgentConfig,
      agents: { anthropic: runAnthropicBrowserAgent, openai: runOpenAiBrowserAgent },
      readAttachment: async attachment => (hasUpload(attachment.id) ? new Uint8Array(await readFile(getUploadPath(attachment.id))) : null),
      priceUsage: async (modelRef, usage) => resolveMessageCost(usage, await getPricing(modelRef).catch(() => null)).cost,
    })
  },
}
