#!/usr/bin/env bash
# Phase 1: system build deps + rustup + Android Rust targets in WSL Debian.
# Idempotent-ish: safe to re-run.
set -euo pipefail

# Transient askpass: supplies the sudo password for this run only (not persisted).
# SUDO_PW is passed in via the environment by the caller.
ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT
printf '#!/bin/sh\nprintf "%%s" "$SUDO_PW"\n' > "$ASKPASS"
chmod 700 "$ASKPASS"
export SUDO_ASKPASS="$ASKPASS"
sudo() { command sudo -A "$@"; }

echo "### apt packages ###"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential cmake pkg-config perl unzip curl ca-certificates clang

echo "### rustup ###"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi
# shellcheck disable=SC1090
source "$HOME/.cargo/env"

echo "### android rust targets ###"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

echo "### versions ###"
rustc --version
cargo --version
cmake --version | head -1
clang --version | head -1
echo "PHASE1_OK"
