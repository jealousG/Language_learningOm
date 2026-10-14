# download-audio.ps1 - download ayah audio (3 reciters) for all site surahs into audio/.
# Uses ayahAudio links from data files (exactly the ayahs used by the site).
# Re-run to resume: skips already downloaded files.
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads it as ANSI without BOM).

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

# 1) collect ayah ids from data files
$ids = @()
foreach ($f in @('js\data.js', 'js\data-fatiha.js', 'js\data-juz30.js')) {
  $c = Get-Content -Raw -Encoding UTF8 (Join-Path $root $f)
  # literal urls: .../ar.alafasy/<number>.mp3
  [regex]::Matches($c, 'quran/audio/128/ar\.alafasy/(\d+)\.mp3') | ForEach-Object { $ids += $_.Groups[1].Value }
  # helper form used by data-fatiha.js: A(ayah, number)
  [regex]::Matches($c, '\bA\(\s*\d+\s*,\s*(\d+)\s*\)') | ForEach-Object { $ids += $_.Groups[1].Value }
}
$ids = $ids | Select-Object -Unique
Write-Output ("ayah ids to download: " + $ids.Count)

# 2) download for 3 reciters (parallel, 8 at a time)
$reciters = @(
  @{ id = 'ar.alafasy';      dir = 'alafasy' },
  @{ id = 'ar.husary';       dir = 'husary' },
  @{ id = 'ar.mahermuaiqly'; dir = 'mahermuaiqly' }
)

foreach ($r in $reciters) {
  $dir = Join-Path $root ("audio\" + $r.dir)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $todo = @($ids | Where-Object { -not (Test-Path (Join-Path $dir ("$_.mp3"))) })
  Write-Output ("=== {0}: {1} files to get ({2} already present)" -f $r.id, $todo.Count, ($ids.Count - $todo.Count))
  $batch = @()
  $i = 0
  foreach ($id in $todo) {
    $batch += "--url"; $batch += "https://cdn.islamic.network/quran/audio/128/$($r.id)/$id.mp3"
    $batch += "--output"; $batch += (Join-Path $dir ("$id.mp3"))
    $i++
    if ($batch.Count -ge 160 -or $i -eq $todo.Count) { # 40 files per call
      & curl.exe -s --parallel --parallel-max 8 @batch
      $batch = @()
    }
  }
  # re-fetch empty/broken files
  Get-ChildItem $dir -Filter *.mp3 | Where-Object { $_.Length -lt 1000 } | ForEach-Object {
    & curl.exe -s -o $_.FullName "https://cdn.islamic.network/quran/audio/128/$($r.id)/$($_.BaseName).mp3"
  }
  Write-Output ("{0}: done, files in folder: {1}" -f $r.id, (Get-ChildItem $dir -Filter *.mp3).Count)
}
Write-Output "ALL DONE"
