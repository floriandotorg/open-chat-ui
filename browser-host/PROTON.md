# Proton Pass on the browser host

The browser host can fill credentials directly from Proton Pass. The browser agent chooses the account, input, and field; the host retrieves the value and fills it without putting the value into a model-generated tool call or tool result. The agent continues navigating and submitting the login normally.

## Setup on your Mac

1. Install the official [Proton Pass CLI](https://protonpass.github.io/pass-cli/) if needed. `pass-cli` must be on the browser host's PATH. The integration's commands were checked against CLI 2.4.2.
2. Create a [personal access token](https://protonpass.github.io/pass-cli/commands/personal-access-token/) with read-only (`viewer`) access to only the items or vaults you want the agent to use. Choose a suitable expiration date.
3. In this repository, run:

   ```bash
   bash browser-host/proton-setup.sh
   ```

   Paste the token at the hidden terminal prompt, not into the chat. This saves the token with owner-only permissions (`0600`) at:

   ```text
   ~/Library/Application Support/open-chat-ui-browser/proton-pass-token
   ```

   If the host uses `BROWSER_HOST_DATA_DIR`, run setup with the same override. The token file is not encrypted; it is protected by macOS file permissions. Other processes running as your macOS user can read it.

4. Restart the browser host once to load the updated code. If it was installed as the supplied LaunchAgent, run this yourself:

   ```bash
   launchctl kickstart -k "gui/$(id -u)/de.open-chat-ui.browser-host"
   ```

   If you run the host manually, stop and restart it normally. Future token changes are read on the next credential operation and do not require a restart.

5. Start a new browser task. For example: "Log in to my shopping account using Proton Pass." Anthropic, OpenAI, and ChatGPT browser agents all expose the credential tools. No new application API key or database field is needed.

The authenticated `/health` endpoint includes `protonPassConfigured`. This is a local installation/file check, not an authenticated Proton test. A missing/expired token or CLI/network error is reported when a credential operation is attempted. The agent can fall back to asking you to log in manually.

## Shared CLI installation

The integration never calls `pass-cli login` or `logout` against your default session. Each credential operation:

1. Reads the host's token locally.
2. Creates a private, unique directory under `proton-sessions` in the browser host's data directory.
3. Sets `PROTON_PASS_SESSION_DIR` to that directory and `PROTON_PASS_KEY_PROVIDER=env` with a fresh random encryption key.
4. Passes `PROTON_PASS_PERSONAL_ACCESS_TOKEN` only to the login process, through its environment, not command-line arguments.
5. Lists login metadata or retrieves one field.
6. Attempts logout, then removes its operation directory even on error.

The CLI subprocess receives a small explicit environment rather than inheriting another service's Proton credentials or session settings. Each operation supplies `PROTON_PASS_AGENT_REASON`, so agent-session tokens can record the purpose of credential access in Proton's audit trail. Optional CLI telemetry and update checks are disabled for these short-lived sessions; required agent access auditing remains enabled. Its stdin is closed, execution time and output size are bounded, and its raw output is not logged or returned on errors. The browser host's LaunchAgent must inherit a PATH containing `pass-cli`; if it was installed before the CLI, update the LaunchAgent PATH yourself or reinstall the browser host service using the existing installer.

If the host or Mac is forcibly terminated, `finally` cannot run. An encrypted operation directory can remain on disk; its ephemeral encryption key is not persisted by this integration. Remote session revocation also cannot be guaranteed when logout fails or the host is terminated.

## Tools and API

- `credential_list`: list login titles and share names, with temporary IDs; optionally filter by title/share.
- `credential_fill`: fill `username`, `email`, `password`, or a current `totp` code into a field identified by an accessibility ref or viewport coordinates.

The token's permissions determine which logins are available. Listing never requests `--show-secrets`. The host forwards only selected metadata even if a CLI version includes additional fields. Filling retrieves a fresh value each time; secrets are not reused for later fills. Known values are retained in memory for best-effort text redaction until the browser session is released.

See [API.md](API.md#proton-pass-credentials) for HTTP examples usable by other trusted tools.

## Privacy and access limits

This is intentionally a flexible field-filling integration, not an autonomous login implementation or a hard secret sandbox:

- The model normally sees credential names, IDs, field targets, and success/failure messages, not the secret values.
- Known values are redacted from subsequent textual observations and state; filled inputs and password fields are masked in screenshot, zoom, and live-frame output.
- Credential filling does not send the Proton token or retrieved values to the chat server. The local CLI, browser, and destination website necessarily handle them.
- There is no enforced site allowlist. The agent is instructed to check the intended site, but this is not a security guarantee.
- A website or agent may still find ways to expose credentials, for example by copying values to other elements, transforming them, or removing markers. Do not depend on the redaction for high-risk accounts.
- One token belongs to the browser host, not to an individual chat user. Anyone with the host's browser API token can use the shared Proton access. Use separate hosts if you need separate user identities.
- Browser cookies and logins persist after the CLI logs out. Revoking the Proton token prevents future retrieval but does not log the browser out of websites. Sign out of those accounts separately when needed.

To rotate the token, rerun the setup script and revoke the old token in Proton. To disable access, revoke the token and remove the host's token file yourself. No setup or validation command needs you to reveal the token in chat.
