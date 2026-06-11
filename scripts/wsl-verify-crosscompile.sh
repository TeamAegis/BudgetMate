#!/usr/bin/env bash
# Phase 3: prove vendored OpenSSL + SQLCipher cross-compile for Android on Linux.
# Builds the Rust lib for aarch64-linux-android using the NDK toolchain.
set -euo pipefail

# shellcheck disable=SC1090
source "$HOME/.budgetmate-android.env"

TARGET="aarch64-linux-android"
API=24
TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
echo "NDK toolchain: $TOOLCHAIN"
ls "$TOOLCHAIN/${TARGET}${API}-clang" >/dev/null && echo "clang wrapper present"

export PATH="$TOOLCHAIN:$PATH"
# cc-rs (openssl-sys, libsqlite3-sys) + cargo linker for the Android target:
export CC_aarch64_linux_android="${TARGET}${API}-clang"
export CXX_aarch64_linux_android="${TARGET}${API}-clang++"
export AR_aarch64_linux_android="llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${TARGET}${API}-clang"
# openssl-src reads these to locate/configure the NDK build:
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"

cd /mnt/d/Projects/BudgetMate/V2/src-tauri
echo "### cargo build --lib --target $TARGET (compiles vendored OpenSSL + SQLCipher) ###"
cargo build --lib --target "$TARGET" 2>&1 | tail -40
echo "EXIT=${PIPESTATUS[0]}"
