# Проверка на настоящей Windows (GitHub Actions): установщик, запуск, самопроверка,
# чат при ЗАПРЕЩЁННОМ брандмауэром исходящем трафике для движка и приложения.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
$Out = "ci-out\windows"; New-Item -ItemType Directory -Force -Path $Out | Out-Null
$setup = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | Select-Object -First 1
"installer: $($setup.Length) bytes" | Out-File "$Out\sizes.txt"
Start-Process -Wait -FilePath $setup.FullName -ArgumentList "/S"
$exe = Get-ChildItem "$env:LOCALAPPDATA" -Recurse -Filter "iam-assistant.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { "установленное приложение не найдено" | Out-File "$Out\error.txt"; exit 1 }
$dir = $exe.DirectoryName
"installed_to: $dir" | Out-File -Append "$Out\sizes.txt"
"exe: $($exe.Length) bytes" | Out-File -Append "$Out\sizes.txt"
$eng = (Get-ChildItem "$dir\llama" -Recurse | Measure-Object Length -Sum).Sum
$all = (Get-ChildItem "$dir" -Recurse | Measure-Object Length -Sum).Sum
"engine: $eng bytes`ninstalled_total: $all bytes" | Out-File -Append "$Out\sizes.txt"
"cpu: $((Get-CimInstance Win32_Processor).Name)`nram: $((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory)`nos: $((Get-CimInstance Win32_OperatingSystem).Caption)" | Out-File -Append "$Out\sizes.txt"
Get-ChildItem "$dir\llama" | ForEach-Object { "$($_.Name) $($_.Length)" } | Out-File -Append "$Out\sizes.txt"
Get-Content "$Out\sizes.txt"

$data = "$env:APPDATA\studio.iam.assistant"
New-Item -ItemType Directory -Force -Path "$data\models" | Out-Null
curl.exe -fsSL --retry 3 -o "$data\models\Qwen3.5-2B-Q4_K_M.gguf" "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"

# запрет исходящих соединений для движка ИИ и самого приложения — чат должен работать без сети
# блокируем всё, кроме 127.0.0.0/8 (локальная связь приложения с движком)
$remote = @("0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255")
New-NetFirewallRule -DisplayName "IAM block llama" -Direction Outbound -Program "$dir\llama\llama-server.exe" -RemoteAddress $remote -Action Block | Out-Null
New-NetFirewallRule -DisplayName "IAM block app" -Direction Outbound -Program $exe.FullName -RemoteAddress $remote -Action Block | Out-Null
"firewall: outbound (кроме 127.0.0.0/8) заблокирован для llama-server.exe и iam-assistant.exe" | Out-File -Append "$Out\sizes.txt"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot($path) {
  try {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
  } catch { "screenshot failed: $_" | Out-File -Append "$Out\errors.txt" }
}
function TreeRss($rootId) {
  $all = Get-CimInstance Win32_Process
  $ids = @($rootId); $changed = $true
  while ($changed) { $changed = $false; foreach ($p in $all) { if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId) -and $p.Name -ne "llama-server.exe") { $ids += $p.ProcessId; $changed = $true } } }
  ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object WorkingSetSize -Sum).Sum
}
foreach ($ph in @(@(1, "a"), @(2, "b"))) {
  $n = $ph[0]; $report = "$data\data\selftest$($ph[1]).json"
  Remove-Item $report -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $exe.FullName -ArgumentList "--selftest=$n" -PassThru
  Start-Sleep 20
  "idle_tree_working_set_bytes: $(TreeRss $p.Id)" | Out-File -Append "$Out\rss-phase$n.txt"
  Shot "$Out\screen-phase$n-start.png"
  for ($i = 0; $i -lt 300 -and -not (Test-Path $report); $i++) { Start-Sleep 5 }
  Start-Sleep 4; Shot "$Out\screen-phase$n-end.png"
  $p.WaitForExit(60000) | Out-Null
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  if (Test-Path $report) { Copy-Item $report $Out } else { "нет отчёта фазы $n" | Out-File "$Out\selftest$($ph[1])-missing.txt" }
  Copy-Item "$data\data\selftestp$($ph[1]).json" $Out -ErrorAction SilentlyContinue
}
Copy-Item "$data\llama.log" "$Out\llama.log" -ErrorAction SilentlyContinue
Get-ChildItem $Out
