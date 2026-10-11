# Скачивает готовый движок llama.cpp (MIT) для Windows x64 в src-tauri\llama\
# Вулкан (ускорение на видеокартах Intel/AMD/NVIDIA) + процессорные варианты как запасной путь.
$ErrorActionPreference = "Stop"
$Tag = if ($env:LLAMA_TAG) { $env:LLAMA_TAG } else { "b11435" }
$Dest = "src-tauri\llama"
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Path $Dest | Out-Null
$Tmp = Join-Path $env:RUNNER_TEMP "llama"
if (-not $env:RUNNER_TEMP) { $Tmp = Join-Path $env:TEMP "llama" }
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
foreach ($kind in @("cpu", "vulkan")) {
  $url = "https://github.com/ggml-org/llama.cpp/releases/download/$Tag/llama-$Tag-bin-win-$kind-x64.zip"
  Write-Host "Скачиваю $url"
  Invoke-WebRequest -Uri $url -OutFile "$Tmp\$kind.zip"
  Expand-Archive "$Tmp\$kind.zip" -DestinationPath "$Tmp\$kind" -Force
  $server = Get-ChildItem "$Tmp\$kind" -Recurse -Filter "llama-server.exe" | Select-Object -First 1
  if (-not $server) { throw "llama-server.exe не найден в архиве $kind" }
  Copy-Item $server.FullName $Dest -Force
  Get-ChildItem $server.DirectoryName -Filter "*.dll" | Copy-Item -Destination $Dest -Force
}
# библиотеки других утилит llama.cpp серверу не нужны
Get-ChildItem $Dest -Filter "*-impl.dll" | Where-Object { $_.Name -ne "llama-server-impl.dll" } | Remove-Item -Force
Get-ChildItem $Dest | Format-Table Name, Length
& "$Dest\llama-server.exe" --version
if ($LASTEXITCODE -ne 0) { throw "llama-server не запускается после очистки" }
& "$Dest\llama-server.exe" --list-devices
