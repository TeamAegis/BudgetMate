#!/usr/bin/env bash
# Full Tauri Android build in an isolated WSL-native copy of the working tree.
# Does NOT touch the Windows node_modules on /mnt/d.
#
# Usage:
#   scripts/wsl-build-apk.sh                 # debug APK (default, sideload/emulator)
#   scripts/wsl-build-apk.sh release         # release APK (signed if a keystore is configured)
#   scripts/wsl-build-apk.sh release aab     # release AAB (Play Store bundle)
#
# Release signing is read by src-tauri/gen/android/app/build.gradle.kts from
# src-tauri/gen/android/app/keystore.properties (gitignored) or the ANDROID_KEYSTORE_PATH /
# ANDROID_STORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD environment variables. The
# keystore itself lives OUTSIDE the repo and is never committed (.claude/rules/android.md).
# Paths in keystore.properties must be WSL-resolvable (for example /mnt/c/Users/...), because the
# Gradle build runs inside WSL.
set -euo pipefail

MODE="${1:-debug}"
FORMAT="${2:-apk}"

case "$MODE" in
  debug|release) ;;
  *) echo "[x] unknown mode '$MODE' (expected: debug | release)" >&2; exit 2 ;;
esac
case "$FORMAT" in
  apk|aab) ;;
  *) echo "[x] unknown format '$FORMAT' (expected: apk | aab)" >&2; exit 2 ;;
esac
if [ "$MODE" = "debug" ] && [ "$FORMAT" = "aab" ]; then
  echo "[x] a debug AAB is not a useful artifact - use 'release aab'" >&2; exit 2
fi

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
  echo "node_modules present - skipping npm ci"
fi

BUILD_ARGS=(--target aarch64 "--$FORMAT")
if [ "$MODE" = "debug" ]; then
  BUILD_ARGS+=(--debug)
fi

echo "### tauri android build ($MODE $FORMAT, aarch64) ###"
npm run tauri android build -- "${BUILD_ARGS[@]}"

echo "### locate artifact ###"
OUT_DIR="$DST/src-tauri/gen/android/app/build/outputs"
ARTIFACTS="$(find "$OUT_DIR" -name "*.$FORMAT" -path "*/$MODE/*" 2>/dev/null || true)"
if [ -z "$ARTIFACTS" ]; then
  echo "[x] no .$FORMAT produced under $OUT_DIR" >&2
  exit 1
fi
echo "$ARTIFACTS" | while read -r f; do
  printf '%s  %s\n' "$(du -h "$f" | cut -f1)" "$f"
done

if [ "$MODE" = "release" ]; then
  # An unsigned release artifact will not install. Verify rather than assume: apksigner ships in
  # the SDK build-tools. Missing tool is a warning, not a hard failure.
  APKSIGNER="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f 2>/dev/null | sort | tail -1)"
  if [ "$FORMAT" = "apk" ] && [ -n "$APKSIGNER" ]; then
    echo "### verify signature ###"
    echo "$ARTIFACTS" | while read -r f; do
      "$APKSIGNER" verify --print-certs "$f" >/dev/null 2>&1 \
        && echo "[ok] signed: $f" \
        || echo "[warn] UNSIGNED (will not install): $f"
    done
  elif [ "$FORMAT" = "apk" ]; then
    echo "[warn] apksigner not found - signature not verified"
  fi
fi

echo "BUILD_OK"
