#!/usr/bin/env bash
# Скачивает готовый движок llama.cpp (MIT) для macOS Apple Silicon (Metal) в src-tauri/llama/
set -euo pipefail
TAG="${LLAMA_TAG:-b11435}"
DEST="src-tauri/llama"
rm -rf "$DEST" && mkdir -p "$DEST"
TMP="$(mktemp -d)"
URL="https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/llama-${TAG}-bin-macos-arm64.tar.gz"
echo "Скачиваю $URL"
curl -fL --retry 3 -o "$TMP/llama.tar.gz" "$URL"
tar -xzf "$TMP/llama.tar.gz" -C "$TMP"
# в архиве бинарники лежат в подпапке (build/bin или llama-<tag>) — находим llama-server
SERVER="$(find "$TMP" -type f -name llama-server | head -n1)"
[ -n "$SERVER" ] || { echo "llama-server не найден в архиве"; exit 1; }
BIN_DIR="$(dirname "$SERVER")"
cp "$SERVER" "$DEST/"
# библиотеки, которые нужны серверу (ggml, llama, mtmd …)
find "$BIN_DIR" -maxdepth 1 -name '*.dylib' -exec cp -a {} "$DEST/" \;
cp "$BIN_DIR"/*.metal "$DEST/" 2>/dev/null || true
chmod +x "$DEST/llama-server"
# снимаем карантин и подписываем ad-hoc (нужно на Apple Silicon для неподписанных бинарников)
xattr -cr "$DEST" || true
for f in "$DEST"/*; do codesign --force --sign - "$f" 2>/dev/null || true; done
echo "Движок готов:"; ls -la "$DEST"; du -sh "$DEST"
"$DEST/llama-server" --version || true
