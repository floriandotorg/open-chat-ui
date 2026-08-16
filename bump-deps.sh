#! /bin/bash

set -e

fnm use

# Update the PocketBase server binary to the latest GitHub release.
# The npm `pocketbase` SDK below is a separate client package; this is the
# actual server binary that pb:serve runs (gitignored, so always refresh).
update-pocketbase() {
	local dir="pocketbase"
	local bin="$dir/pocketbase"
	local os arch
	os=$(uname -s | tr '[:upper:]' '[:lower:]')
	arch=$(uname -m)
	case "$arch" in
		arm64 | aarch64) arch=arm64 ;;
		x86_64 | amd64) arch=amd64 ;;
	esac

	local current="none"
	[ -x "$bin" ] && current=$("$bin" --version 2>/dev/null | awk '{print $3}')

	local tag
	tag=$(curl -sL https://api.github.com/repos/pocketbase/pocketbase/releases/latest | grep tag_name | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
	if [ "$current" = "${tag#v}" ]; then return; fi

	local url="https://github.com/pocketbase/pocketbase/releases/download/${tag}/pocketbase_${tag#v}_${os}_${arch}.zip"
	echo "Updating PocketBase ${bin} ${current} -> ${tag}"
	mkdir -p "$dir"
	curl -sL "$url" -o "$dir/pb.zip"
	(cd "$dir" && unzip -o pb.zip pocketbase >/dev/null && chmod +x pocketbase && rm -f pb.zip)
	"$bin" --version
}

update-pocketbase

ncu() {
	bunx npm-check-updates -u --cooldown 1d "$@"
}

# Reject packages with known incompatibilities:
# - typescript: svelte-check incompatible with TS 7 (sveltejs/language-tools#3063)
ncu --reject typescript

# Drop every lockfile so bun resolves fresh from package.json.
# pnpm-lock.yaml is stray (this repo is bun-based); leaving it makes bun
# migrate from it instead of resolving anew.
rm -f bun.lock pnpm-lock.yaml
rm -rf node_modules

bun install

bun audit

bun update
