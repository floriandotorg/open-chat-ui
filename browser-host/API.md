# Browser host HTTP API

This API controls the persistent Chromium browser on the host machine. Any trusted HTTP client can use it independently of Open Chat UI. It does not run an LLM or accept natural-language tasks: the caller implements the observation/action loop.

Implementation: `browser-host/main.ts`. Shared TypeScript types: `src/lib/browser-protocol.ts`. Existing client: `src/lib/server/browser/host-client.ts`.

## Connection and authentication

- Base URL: `http://<host-tailscale-ip>:9330` by default. The bind address and configured port can differ.
- Every request requires `Authorization: Bearer <browser-host-token>`, including health checks and frames.
- JSON request bodies require `Content-Type: application/json`.
- Obtain the host URL and token from the operator through a secure configuration channel. Do not put tokens in prompts, source control, or tool results.
- The default HTTP connection relies on Tailscale's encrypted private network. Do not expose it to the public internet. Use HTTPS if accessing it outside that protected transport.

The host currently has one shared bearer token, not per-client permissions. Possession grants control of the browser, including its saved authenticated sessions. There is no per-client session ownership check. Only connect trusted clients.

## Session lifecycle

1. `POST /sessions` to acquire a session.
2. Send actions to `POST /sessions/{sessionId}/actions`.
3. Observe returned text, images, and state, then choose the next actions.
4. Always release the session with `DELETE /sessions/{sessionId}` when done.

Only one session can be active at a time. A second acquisition returns HTTP 409. Sessions expire after 20 minutes without session requests; expiry is checked approximately every 30 seconds. Health checks do not keep a session alive.

The browser profile persists across sessions, including cookies and logins. Releasing a session closes its tabs and removes its staged uploads, but does not clear the profile. Different clients are not isolated browser identities.

Serialize requests within a session. The host does not provide a per-session action request queue, so concurrent batches can interfere with one another. Avoid blindly retrying actions with side effects after a timeout: the action may already have happened.

## Endpoints

| Method | Path                                                   | Request               | Response                                                           |
| ------ | ------------------------------------------------------ | --------------------- | ------------------------------------------------------------------ |
| GET    | `/health`                                              | None                  | `{ version, browserRunning, busySessionId, protonPassConfigured }` |
| POST   | `/sessions`                                            | None                  | `{ sessionId, state }`                                             |
| POST   | `/sessions/{id}/actions`                               | `{ actions, tabId? }` | `{ results }`                                                      |
| DELETE | `/sessions/{id}`                                       | None                  | `{ "ok": true }`                                                   |
| POST   | `/sessions/{id}/show`                                  | None                  | Show browser window; `{ "ok": true }`                              |
| POST   | `/sessions/{id}/hide`                                  | None                  | Minimize browser window; `{ "ok": true }`                          |
| GET    | `/sessions/{id}/frame`                                 | None                  | Binary JPEG of the active tab                                      |
| POST   | `/sessions/{id}/input`                                 | Live input object     | `{ "ok": true }`                                                   |
| PUT    | `/sessions/{id}/files/{fileId}?name={encodedFilename}` | Raw file bytes        | `{ id, name, size }`                                               |

`version` in health is the Chromium version, not an API protocol version. `busySessionId` is a string or null. `browserRunning` is a boolean. `protonPassConfigured` indicates that the CLI is on PATH and a private token file exists; it does not validate the token with Proton. Older hosts omit this field.

## Quick start

These examples assume the operator has securely supplied `BROWSER_HOST_URL` and `BROWSER_HOST_TOKEN` to the caller's environment. The token must remain outside the model context.

```bash
curl --fail-with-body "$BROWSER_HOST_URL/health" \
  -H "Authorization: Bearer $BROWSER_HOST_TOKEN"

curl --fail-with-body -X POST "$BROWSER_HOST_URL/sessions" \
  -H "Authorization: Bearer $BROWSER_HOST_TOKEN"
```

Save the returned `sessionId` as `SESSION_ID`, then navigate and inspect:

```bash
curl --fail-with-body --max-time 180 \
  "$BROWSER_HOST_URL/sessions/$SESSION_ID/actions" \
  -H "Authorization: Bearer $BROWSER_HOST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"actions":[{"type":"navigate","url":"https://example.com"},{"type":"read_page","filter":"interactive"}]}'
```

An interactive element may be described as `- button "Continue" [ref_3]`. Use the actual ref returned by the host:

```json
{
  "actions": [{ "type": "click", "target": { "ref": "ref_3" } }, { "type": "screenshot" }]
}
```

Release when finished:

```bash
curl --fail-with-body -X DELETE \
  "$BROWSER_HOST_URL/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $BROWSER_HOST_TOKEN"
```

## Local network approvals

Local/private addresses, local hostnames, and public names resolving to private addresses are blocked by default. Blocked requests appear as exact origins in `state.localNetworkRequests`, for example `https://192.168.50.1:8443`. Batches stop when an approval is pending, including when a subresource rather than the navigation was blocked.

After obtaining explicit user approval, a trusted caller can send `POST /sessions/{id}/network-access` with `{ "origin": "https://192.168.50.1:8443", "allow": true }`. Send `allow: false` on decline or timeout. The host only accepts decisions for pending origins, returning HTTP 400 otherwise. This is a control-plane endpoint, not a browser action or agent tool. Possession of the host bearer token can grant access, so never expose it to the model or pages.

Approvals apply only to that origin (scheme, hostname and port) in the current session's tabs and are revoked on release or expiry. Other origins require separate approval. WebSocket origins (`ws://` or `wss://`) require their own approval. Declined origins stay blocked without prompting again for that session. Requests are aborted while awaiting approval, not queued or automatically replayed; inspect the page before navigating or reloading, and never blindly repeat submissions.

Open Chat UI displays an Allow for this task / Decline prompt and checks the owner and approval ID before sending the decision. Each task creates a new host session, so later tasks must ask again. An approval permits both the agent and pages in that task to contact the origin; it does not authorize administrative changes. TLS certificate validation is unchanged.

## Actions

`POST /sessions/{id}/actions` takes an array of action objects, optionally with a top-level `tabId` to select before execution. Actions run sequentially and stop on the first failed action or pending local network approval. Earlier successful actions are not rolled back.

Targets are either `{ "ref": "ref_3" }` or `{ "x": 120, "y": 240 }`. Coordinates for ordinary pointer actions are viewport CSS pixels. Refs are tab-local, reset on main-frame navigation, and can become stale when the page changes. Read the page again after navigation or a stale-ref error; never reuse a ref across tabs or navigation.

| Type              | Fields besides `type`                                                                                                             | Behavior                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `navigate`        | `url: string`                                                                                                                     | Navigate to an HTTP or HTTPS URL                                          |
| `history`         | `direction: "back" \| "forward" \| "reload"`                                                                                      | Browser history operation                                                 |
| `read_page`       | `filter?: "interactive" \| "all"`, `depth?: number`, `ref?: string`                                                               | Accessibility text with element refs; default filter is `interactive`     |
| `find`            | `query: string`                                                                                                                   | Find elements by text and return refs                                     |
| `page_text`       | None                                                                                                                              | Read page text                                                            |
| `screenshot`      | None                                                                                                                              | Return base64 JPEG                                                        |
| `zoom`            | `region: [x0, y0, x1, y1]`                                                                                                        | Capture a region at device scale                                          |
| `click`           | `target`, `button?: "left" \| "right" \| "middle"`, `count?: 1 \| 2 \| 3`, `modifiers?: ("shift" \| "ctrl" \| "alt" \| "meta")[]` | Click; defaults to one left click                                         |
| `hover`           | `target`                                                                                                                          | Move pointer over target                                                  |
| `drag`            | `path: { x: number, y: number }[]`                                                                                                | Drag along at least two points                                            |
| `mouse`           | `event: "down" \| "up" \| "move"`, `x`, `y`                                                                                       | Low-level pointer action                                                  |
| `scroll`          | `x`, `y`, `deltaX?: number`, `deltaY?: number`                                                                                    | Wheel at the given position; deltas default to zero                       |
| `scroll_to`       | `ref: string`                                                                                                                     | Bring element into view                                                   |
| `type`            | `text: string`                                                                                                                    | Type into the currently focused element                                   |
| `key`             | `keys: string[]`, `repeat?: number`, `holdMs?: number`                                                                            | Key sequence/chords, for example `["ENTER"]` or `["CTRL+A"]`              |
| `form_input`      | `ref: string`, `value: string \| number \| boolean`                                                                               | Set an input, select, checkbox, or editable value                         |
| `wait`            | `ms: number`                                                                                                                      | Wait, capped at 30,000 ms                                                 |
| `file_upload`     | `target`, `fileIds: string[]`                                                                                                     | Assign previously staged files to a file input/chooser                    |
| `credential_list` | `query?: string`                                                                                                                  | List Proton Pass login names and session-local IDs; filter by title/share |
| `credential_fill` | `credentialId: string`, `field: "username" \| "email" \| "password" \| "totp"`, `target`                                          | Resolve and fill one credential field privately on the host               |
| `tab_new`         | `url?: string`                                                                                                                    | Create and activate a tab                                                 |
| `tab_switch`      | `tabId: string`                                                                                                                   | Activate a session tab                                                    |
| `tab_close`       | `tabId: string`                                                                                                                   | Close a session tab                                                       |
| `tab_list`        | None                                                                                                                              | List session tabs                                                         |

`key.repeat` is clamped to 1 through 100. `key.holdMs` is clamped to 0 through 30,000. Accessibility/page text output is bounded; use `depth` or `ref` to reduce an accessibility read.

## Responses

Each attempted action returns one result with a state snapshot. A successful HTTP response does not mean every action succeeded: inspect each result's `ok` field.

```typescript
type BrowserState = {
  tabs: { id: string; title: string; url: string }[]
  activeTabId: string
  url: string
  viewport: { width: number; height: number }
}

type BrowserActionResult = (
  | {
      ok: true
      text?: string
      image?: { base64: string; mediaType: 'image/jpeg' | 'image/png' }
      status?: number
    }
  | { ok: false; error: string }
) & { state: BrowserState }

type BrowserActionsResponse = { results: BrowserActionResult[] }
```

The optional `status` inside a successful action is the destination page's HTTP status, not the host API status. The default viewport is 1280 by 800; use the returned dimensions rather than assuming them.

The host returns request errors as `{ "error": "message" }` with an HTTP error status:

- `400`: invalid JSON or request shape.
- `401`: missing or incorrect bearer token.
- `404`: unknown route or expired/unknown session.
- `409`: another session is active.
- `413`: upload too large.
- `500`: host failure.

A rejected action, such as a stale element ref, normally appears as `ok: false` inside an HTTP 200 actions response.

## Uploads

Stage files before selecting them on a page. Each file is limited to 50 MiB. `fileId` must match `[A-Za-z0-9_-]{1,64}` and is chosen by the caller. URL-encode the filename. The host sanitizes filenames and scopes staged files to the session.

```bash
curl --fail-with-body -X PUT \
  "$BROWSER_HOST_URL/sessions/$SESSION_ID/files/attachment_1?name=document.pdf" \
  -H "Authorization: Bearer $BROWSER_HOST_TOKEN" \
  --data-binary @document.pdf
```

Then send an action using a file input ref from the current page:

```json
{
  "actions": [
    {
      "type": "file_upload",
      "target": { "ref": "ref_7" },
      "fileIds": ["attachment_1"]
    }
  ]
}
```

## Live input

`POST /sessions/{id}/input` is intended for interactive human control. It returns only `{ "ok": true }`, not an observation. Supported bodies:

```typescript
type LiveInput = { type: 'pointer'; event: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'right' | 'middle' } | { type: 'tap'; x: number; y: number } | { type: 'wheel'; x: number; y: number; deltaX?: number; deltaY?: number } | { type: 'key'; key: string } | { type: 'text'; text: string }
```

## Integrating another agent

Give the integration this document and `src/lib/browser-protocol.ts`. Keep the bearer token in its trusted HTTP adapter, not in tool arguments generated by the model. A minimal tool wrapper can expose session acquisition, actions, and release. Image results should be forwarded as image content when the model supports it.

An MCP adapter or an OpenAPI schema can be layered over this protocol, but neither is currently implemented by the host. The chat app's natural-language `browser_task` tool runs its own agent loop; it is not a standalone task endpoint on this host.

## Proton Pass credentials

See [PROTON.md](PROTON.md) for local setup and security limitations. One token is configured on the browser-host Mac, not in Open Chat UI's database. Every trusted client of this host shares that token's access.

List available login metadata:

```json
{ "actions": [{ "type": "credential_list", "query": "shopping" }] }
```

The successful result's `text` contains JSON, for example:

```json
{
  "credentials": [{ "id": "credential_1", "title": "Shopping account", "share": "Automation" }],
  "total": 1
}
```

Only names and session-local IDs are returned. No usernames, emails, passwords, notes, TOTP seeds, or raw Proton item records are returned. Results are limited to 50 matching logins. Narrow the title/share query if `total` exceeds 50. IDs remain stable within the browser session, but must not be saved for use in another session.

Fill a field using an ID from that session's listing:

```json
{
  "actions": [{ "type": "credential_fill", "credentialId": "credential_1", "field": "email", "target": { "ref": "ref_3" } }, { "type": "credential_fill", "credentialId": "credential_1", "field": "password", "target": { "ref": "ref_4" } }]
}
```

Coordinate targets such as `{ "x": 300, "y": 240 }` are also supported. The action replaces the target input's value, emits input events, and returns only a status message. It does not submit the form. Use `email` if the Proton item's `username` is empty. `totp` retrieves a current one-time code, not its seed; fill it shortly before submission.

Each listing/fill operation logs into Proton in a fresh, isolated CLI session directory with an ephemeral encryption key. It attempts logout in a `finally` block and removes the directory afterward, including on failure. It does not use or log out the CLI's default session or another service's session. Failed remote logout cannot be guaranteed to revoke the server session immediately.

The token and credential values never travel through the chat server as part of credential filling. Known filled values are retained in host memory for the browser session to redact exact matches in later text results, errors, page titles, URLs, and dialog notes. Filled inputs and password inputs are masked in screenshots, zooms, and live frames. CLI output and fill errors are not echoed to the caller.

These are best-effort protections, not a security boundary against a malicious agent or page. There is no enforced origin allowlist or locked login flow. A site could copy or transform values, remove input markers, or draw them elsewhere. Other agents with local shell/file access can read the token as the same macOS user. Only share low-risk accounts appropriate for this trust model. Browser logins persist independently of the Proton token.
