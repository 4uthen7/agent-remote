#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/ios"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required: brew install xcodegen" >&2
  exit 1
fi

TARGET="${1:-AgentRemote}"
OUTPUT="${2:-${TARGET}.ipa}"

xcodegen generate

echo "==> Building unsigned device app: $TARGET"
xcodebuild \
  -project AgentRemote.xcodeproj \
  -target "$TARGET" \
  -configuration Release \
  -sdk iphoneos \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  build

APP="build/Release-iphoneos/$TARGET.app"
if [ ! -d "$APP" ]; then
  echo "Build did not produce $APP" >&2
  exit 1
fi

IPA_DIR="$ROOT/build/ipa"
mkdir -p "$IPA_DIR"
rm -rf "$IPA_DIR/Payload"
mkdir -p "$IPA_DIR/Payload"
cp -R "$APP" "$IPA_DIR/Payload/"

cd "$IPA_DIR"
rm -f "$OUTPUT"
zip -qry "$OUTPUT" Payload

echo
echo "IPA: $IPA_DIR/$OUTPUT"
echo "Install with Sideloadly / AltStore: select the IPA."
