#!/usr/bin/env bash
# Phase 4: full Tauri Android debug APK build in an isolated WSL-native copy.
# Does NOT touch the Windows node_modules on /mnt/d.
set -euo pipefail

ASKPASS="$(mktemp)"; trap 'rm -f "$ASKPASS"' EXIT
printf '#!/bin/sh\nprintf "%%s" "$SUDO_PW"\n' > "$ASKPASS"; chmod 700 "$ASKPASS"
export SUDO_ASKPASS="$ASKPASS"; sudo() { command sudo -A "$@"; }

# shellcheck disable=SC1090
source "$HOME/.budgetmate-android.env"

# NDK r23+ removed GNU-prefixed binutils (aarch64-linux-android-ar/ranlib); vendored
# OpenSSL's `make install_dev` invokes them by name. Point the cross toolchain at the
# llvm-* equivalents so openssl-sys/libsqlite3-sys link for the Android target.
NDK_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
export PATH="$NDK_BIN:$PATH"
export CC_aarch64_linux_android="aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="llvm-ar"
export RANLIB_aarch64_linux_android="llvm-ranlib"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="aarch64-linux-android24-clang"
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"

SRC="/mnt/d/Projects/BudgetMate/V2"
DST="$HOME/budgetmate-build"

echo "### rsync ###"
command -v rsync >/dev/null 2>&1 || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y rsync

echo "### node via nvm ###"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"
nvm install 22 >/dev/null
nvm use 22 >/dev/null
echo "node $(node -v), npm $(npm -v)"

echo "### copy working tree (excluding heavy/host-specific dirs) ###"
mkdir -p "$DST"
rsync -a --delete \
  --exclude 'node_modules' --exclude 'target' --exclude 'dist' \
  --exclude '.git' --exclude '.angular' \
  "$SRC/" "$DST/"

cd "$DST"
echo "### npm ci (Linux deps) ###"
if [ ! -d "$DST/node_modules/@angular" ]; then
  npm ci
else
  echo "node_modules present — skipping npm ci"
fi

echo "### tauri android build (debug APK, aarch64) ###"
npm run tauri android build -- --debug --target aarch64 --apk

echo "### locate APK ###"
find "$DST/src-tauri/gen/android" -name '*.apk' -newermt '-30 minutes' 2>/dev/null || \
  find "$DST/src-tauri/gen/android" -name '*.apk'
echo "PHASE4_OK"
