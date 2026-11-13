#!/usr/bin/env bash
set -euo pipefail
umask 077

if ! command -v pass-cli >/dev/null 2>&1; then
  printf 'Install the official Proton Pass CLI and put pass-cli on PATH first.\n' >&2
  exit 1
fi

if [[ ! -t 0 ]]; then
  printf 'Run this command in an interactive terminal on the browser-host Mac.\n' >&2
  exit 1
fi

data_dir="${BROWSER_HOST_DATA_DIR:-$HOME/Library/Application Support/open-chat-ui-browser}"
printf 'This token will be available to every trusted client of this browser host.\n'
printf 'Use a read-only Proton personal access token limited to the items you want to share.\n'
IFS= read -r -s -p 'Proton Pass personal access token (hidden): ' token
printf '\n'

if [[ -z "$token" ]]; then
  printf 'No token entered; nothing changed.\n' >&2
  exit 1
fi

mkdir -p "$data_dir"
token_file="$(mktemp "$data_dir/proton-pass-token.XXXXXX")"
printf '%s\n' "$token" > "$token_file"
unset token
chmod 600 "$token_file"
mv -f "$token_file" "$data_dir/proton-pass-token"
printf 'Token saved privately on this Mac. No Proton login was performed.\n'
printf 'The running browser host reads the token for each credential operation.\n'
