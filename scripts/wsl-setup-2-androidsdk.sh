#!/usr/bin/env bash
# Phase 2: JDK + Android SDK cmdline-tools + platform/build-tools + NDK in WSL.
# Versions match the generated project: compileSdk/targetSdk 36, NDK 29.0.13846066.
set -euo pipefail

ASKPASS="$(mktemp)"; trap 'rm -f "$ASKPASS"' EXIT
printf '#!/bin/sh\nprintf "%%s" "$SUDO_PW"\n' > "$ASKPASS"; chmod 700 "$ASKPASS"
export SUDO_ASKPASS="$ASKPASS"; sudo() { command sudo -A "$@"; }

NDK_VER="29.0.13846066"
SDK="$HOME/Android/Sdk"
CLT_ZIP="commandlinetools-linux-11076708_latest.zip"
CLT_URL="https://dl.google.com/android/repository/$CLT_ZIP"

echo "### JDK (21 on trixie) ###"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-21-jdk-headless
export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
echo "JAVA_HOME=$JAVA_HOME"

echo "### cmdline-tools ###"
mkdir -p "$SDK/cmdline-tools"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  tmp="$(mktemp -d)"
  curl -fL "$CLT_URL" -o "$tmp/clt.zip"
  unzip -q "$tmp/clt.zip" -d "$tmp"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$tmp"
fi

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"

echo "### accept licenses ###"
yes | "$SDKM" --licenses >/dev/null 2>&1 || true

echo "### install packages (this downloads the NDK ~1GB) ###"
"$SDKM" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;$NDK_VER"

echo "### persist env for later phases ###"
ENVF="$HOME/.budgetmate-android.env"
cat > "$ENVF" <<EOF
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export NDK_HOME="$SDK/ndk/$NDK_VER"
export ANDROID_NDK_HOME="$SDK/ndk/$NDK_VER"
export JAVA_HOME="$JAVA_HOME"
export PATH="\$HOME/.cargo/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
EOF
echo "wrote $ENVF"

echo "### verify ###"
ls -d "$SDK/ndk/$NDK_VER" && echo "NDK_OK"
"$SDK/platform-tools/adb" --version | head -1
echo "PHASE2_OK"
