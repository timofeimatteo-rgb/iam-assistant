#!/usr/bin/env bash
# Проверка собранного приложения на настоящей macOS (GitHub Actions, Apple Silicon).
set -uo pipefail
OUT="ci-out/macos"; mkdir -p "$OUT"
APP="$(ls -d src-tauri/target/release/bundle/macos/*.app | head -n1)"
BIN="$APP/Contents/MacOS/$(ls "$APP/Contents/MacOS" | head -n1)"
DATA="$HOME/Library/Application Support/studio.iam.assistant"
mkdir -p "$DATA/models"
{
  echo "app: $(du -sk "$APP" | cut -f1) KB (весь пакет .app)"
  echo "engine: $(du -sk "$APP/Contents/Resources/llama" | cut -f1) KB (llama.cpp)"
  echo "app_without_engine: $(( $(du -sk "$APP" | cut -f1) - $(du -sk "$APP/Contents/Resources/llama" | cut -f1) )) KB"
  echo "binary: $(stat -f%z "$BIN") bytes"
  echo "dmg: $(stat -f%z src-tauri/target/release/bundle/dmg/*.dmg) bytes"
  echo "mascot_assets: $(du -sk src/assets/mascot | cut -f1) KB"
  sysctl -n machdep.cpu.brand_string; echo "ram: $(sysctl -n hw.memsize)"; sw_vers
} > "$OUT/sizes.txt" 2>&1
ls -la "$APP/Contents/Resources/llama" >> "$OUT/sizes.txt"
cat "$OUT/sizes.txt"

for f in ${MODELS_TO_TEST:-Qwen3.5-2B-Q4_K_M.gguf}; do
  case "$f" in
    Qwen*) repo="unsloth/Qwen3.5-2B-GGUF";;
    gemma-4-E2B*) repo="unsloth/gemma-4-E2B-it-GGUF";;
  esac
  echo "Скачиваю $f"; curl -fsSL --retry 3 -o "$DATA/models/$f" "https://huggingface.co/$repo/resolve/main/$f"
done
ls -la "$DATA/models"

run_phase() {
  local n=$1 report="$DATA/data/selftest$2.json"
  rm -f "$report"
  "$BIN" --selftest=$n > "$OUT/app-phase$n.log" 2>&1 &
  local pid=$!
  # память приложения в ожидании (через 20 с после старта, модель ещё не загружена)
  sleep 20
  ps -o rss= -p $pid | awk '{print "app_main_process_rss_kb: "$1}' >> "$OUT/rss-phase$n.txt"
  ps -axo rss=,comm= | grep -i -E "WebContent|iam-assistant|I AM" | awk '{s+=$1} END {print "app_plus_webkit_rss_kb: "s}' >> "$OUT/rss-phase$n.txt"
  screencapture -x "$OUT/screen-phase$n-start.png" || true
  for i in $(seq 1 300); do [ -f "$report" ] && break; sleep 5; done
  sleep 4; screencapture -x "$OUT/screen-phase$n-end.png" || true
  for i in $(seq 1 30); do kill -0 $pid 2>/dev/null || break; sleep 2; done
  kill $pid 2>/dev/null || true
  cp "$report" "$OUT/" 2>/dev/null || echo "нет отчёта фазы $n" > "$OUT/selftest$2-missing.txt"
  cp "$DATA/data/selftestp$2.json" "$OUT/" 2>/dev/null || true
}
run_phase 1 a
run_phase 2 b
# фаза 3: обычный запуск, только маскот (рабочее окно закрыто) — память в ожидании
"$BIN" > /dev/null 2>&1 &
PID3=$!; sleep 30
ps -o rss= -p $PID3 | awk '{print "idle_mascot_only_main_rss_kb: "$1}' >> "$OUT/rss-idle.txt"
# процессы WebKit, запущенные для этого приложения (WebContent/Networking/GPU) — по времени старта после запуска
ps -axo pid=,rss=,lstart=,comm= | grep -E "com.apple.WebKit" | awk '{print}' >> "$OUT/rss-idle-webkit.txt"
screencapture -x "$OUT/screen-idle.png" || true
kill $PID3 2>/dev/null || true
cp "$HOME/Library/Application Support/studio.iam.assistant/llama.log" "$OUT/llama.log" 2>/dev/null || true
ls -la "$OUT"
