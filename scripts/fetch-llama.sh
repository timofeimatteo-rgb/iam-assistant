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
xattr -cr "$DEST" || true
# оставляем только библиотеки, которые сервер действительно загружает (в архиве есть
# библиотеки других утилит и дубликаты-ссылки — пакет приложения копирует их как файлы)
LOADED="$(DYLD_PRINT_LIBRARIES=1 "$DEST/llama-server" --list-devices 2>&1 | grep -o "$DEST/[^ ]*" | xargs -n1 basename | sort -u || true)"
echo "Загружаемые библиотеки:"; echo "$LOADED"
if [ -n "$LOADED" ]; then
  for f in "$DEST"/*.dylib; do
    b="$(basename "$f")"
    if echo "$LOADED" | grep -qx "$b"; then
      [ -L "$f" ] && { cp -L "$f" "$f.tmp" && rm "$f" && mv "$f.tmp" "$f"; }   # ссылку — в настоящий файл
    else
      rm -f "$f"
    fi
  done
fi
for f in "$DEST"/*; do codesign --force --sign - "$f" 2>/dev/null || true; done
echo "Движок готов:"; ls -la "$DEST"; du -sh "$DEST"
"$DEST/llama-server" --version
"$DEST/llama-server" --list-devices
