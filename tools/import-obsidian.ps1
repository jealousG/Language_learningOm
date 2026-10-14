# ============================================================
#  Импорт священных текстов из Obsidian-хранилища → js/data-vault.js
#  Источник: «07 Священные тексты» (личное хранилище Obsidian).
#  Берёт заметки вида «хадис» и «азкар»; аяты пропускаются.
#  Формат заметки: frontmatter (вид/тема/источник), цитаты [!quote],
#  **Чтение:** / **Перевод:**, таблица «Разбор слов» (| арабский | чтение | перевод |).
#  Слова таблицы распределяются по цитатам (по вхождению текста).
#  Выход: js/data-vault.js — АВТОГЕНЕРИРОВАН, руками не править.
# ============================================================

param(
  [string]$VaultDir = "C:\Users\OKurbanov\Desktop\не работа\Обсидиан\НеРабота\Арабский\07 Священные тексты",
  [string]$OutFile  = "$PSScriptRoot\..\js\data-vault.js"
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Убрать огласовки для сравнения вхождений
function Strip-Tashkeel([string]$s) {
  return ($s -replace '[\u064B-\u0653\u0670\u06D6-\u06ED]', '' -replace '\s+', ' ').Trim()
}

function Parse-Note([string]$path) {
  $raw = [System.IO.File]::ReadAllText($path)
  $lines = $raw -split "`r?`n"

  # --- frontmatter ---
  $fm = @{}
  if ($lines[0] -eq '---') {
    for ($i = 1; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -eq '---') { break }
      if ($lines[$i] -match '^([^:]+):\s*(.*)$') { $fm[$Matches[1].Trim()] = $Matches[2].Trim() }
    }
  }
  $kind = $fm['вид']
  if ($kind -ne 'хадис' -and $kind -ne 'азкар') { return $null }

  $name = [System.IO.Path]::GetFileNameWithoutExtension($path)
  $titleRu = $name; $titleAr = $name
  if ($name -match '^(Хадис|Азкар)\s*-\s*(.+?)\s*\((.+)\)$') { $titleRu = $Matches[2]; $titleAr = $Matches[3] }

  # --- цитаты: "> [!quote] Заголовок" + строки "> ..." ---
  $quotes = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^>\s*\[!quote\]\s*(.*)$') {
      $qTitle = $Matches[1].Trim()
      $body = New-Object System.Collections.ArrayList
      for ($j = $i + 1; $j -lt $lines.Count; $j++) {
        if ($lines[$j] -notmatch '^>') { break }
        [void]$body.Add(($lines[$j] -replace '^>\s?', ''))
        $i = $j
      }
      $text = (($body -join ' ') -replace '\s+', ' ').Trim()
      $text = $text.Trim([char]0x00AB, [char]0x00BB, ' ', "`t")
      if ($text) { [void]$quotes.Add([pscustomobject]@{ Title = $qTitle; Text = $text; Chtenie = $null; Perevod = $null; Start = 0 }) }
    }
  }
  if ($quotes.Count -eq 0) { Write-Warning "Нет цитат: $name"; return $null }

  # --- границы цитат по строкам (для поиска Чтения/Перевода между ними) ---
  $starts = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^>\s*\[!quote\]') { $starts += $i }
  }
  for ($q = 0; $q -lt $quotes.Count; $q++) {
    $from = $starts[$q] + 1
    $to = if ($q + 1 -lt $quotes.Count) { $starts[$q + 1] - 1 } else { $lines.Count - 1 }
    for ($i = $from; $i -le $to; $i++) {
      if     ($lines[$i] -match '^\*\*Чтение:\*\*\s*(.+)$')  { $quotes[$q].Chtenie  = $Matches[1].Trim() }
      elseif ($lines[$i] -match '^\*\*Перевод:\*\*\s*(.+)$') { $quotes[$q].Perevod = $Matches[1].Trim() }
    }
  }

  # --- таблица «Разбор слов» ---
  $words = New-Object System.Collections.ArrayList
  $inTable = $false
  foreach ($ln in $lines) {
    if ($ln -match '^##\s+Разбор слов') { $inTable = $true; continue }
    if ($inTable -and $ln -match '^##\s') { break }
    if ($inTable -and $ln -match '^\|(.*)\|(.*)\|(.*)\|$') {
      $c1 = $Matches[1].Trim(); $c2 = $Matches[2].Trim(); $c3 = $Matches[3].Trim()
      if ($c1 -eq 'Арабский' -or $c1 -match '^[-: ]+$') { continue }
      if ($c1 -and $c3) { [void]$words.Add(@{ w = $c1; tr = $c2; ru = $c3 }) }
    }
  }

  # --- распределение слов по цитатам (по вхождению текста без огласовок) ---
  $normQuotes = @($quotes | ForEach-Object { Strip-Tashkeel $_.Text })
  $assigned = @()
  for ($q = 0; $q -lt $quotes.Count; $q++) { $assigned += ,(New-Object System.Collections.ArrayList) }
  $fallback = New-Object System.Collections.ArrayList
  foreach ($w in $words) {
    $nw = Strip-Tashkeel $w['w']
    $hit = -1
    for ($q = 0; $q -lt $normQuotes.Count; $q++) {
      if ($nw -and $normQuotes[$q].Contains($nw)) { $hit = $q; break }
    }
    if ($hit -ge 0) { [void]$assigned[$hit].Add($w) } else { [void]$fallback.Add($w) }
  }
  if ($fallback.Count -and $quotes.Count -gt 0) {
    # несовпавшие слова — в первую цитату (в таблице они идут по порядку текста)
    for ($k = $fallback.Count - 1; $k -ge 0; $k--) { $assigned[0].Insert(0, $fallback[$k]) }
  }

  # --- предложения ---
  $sentences = New-Object System.Collections.ArrayList
  for ($q = 0; $q -lt $quotes.Count; $q++) {
    $s = @{ ar = $quotes[$q].Text; ru = $quotes[$q].Perevod }
    if ($quotes[$q].Chtenie)               { $s['tr'] = $quotes[$q].Chtenie }
    if ($quotes[$q].Title -and $quotes[$q].Title -ne 'Арабский') { $s['when'] = $quotes[$q].Title }
    if ($assigned[$q].Count)                { $s['words'] = @($assigned[$q]) }
    [void]$sentences.Add($s)
  }

  [pscustomobject]@{
    kind      = $kind
    titleAr   = $titleAr
    titleRu   = $titleRu
    tema      = $fm['тема']
    source    = $fm['источник']
    sentences = $sentences
  }
}

# --- Сборка --------------------------------------------------------------
$notes = New-Object System.Collections.ArrayList
Get-ChildItem -LiteralPath $VaultDir -Filter *.md |
  Where-Object { $_.Name -notlike '_*' } |
  Sort-Object Name |
  ForEach-Object {
    $n = Parse-Note $_.FullName
    if ($n) { [void]$notes.Add($n) }
  }

$hCount = @($notes | Where-Object { $_.kind -eq 'хадис' }).Count
$aCount = @($notes | Where-Object { $_.kind -eq 'азкар' }).Count
Write-Host "Разобрано: $hCount хадисов, $aCount азкаров"

function Esc([string]$s) {
  if ($null -eq $s) { return '' }
  return $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", ' ')
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('// ============================================================')
[void]$sb.AppendLine('//  АВТОГЕНЕРИРОВАН tools/import-obsidian.ps1 — НЕ ПРАВИТЬ РУКАМИ.')
[void]$sb.AppendLine("//  Источник: Obsidian-хранилище «07 Священные тексты» ($hCount хадисов + $aCount азкаров).")
[void]$sb.AppendLine('//  Слова: w/tr/ru (без корня/части речи/определения — их в заметках нет).')
[void]$sb.AppendLine('// ============================================================')
[void]$sb.AppendLine('(function(){')
[void]$sb.AppendLine('  const items = [')

$hi = 0; $ai = 0
foreach ($n in $notes) {
  if ($n.kind -eq 'хадис') { $hi++; $id = "vault-hadith-$hi"; $type = 'hadith' }
  else                     { $ai++; $id = "vault-azkar-$ai";  $type = 'adhkar' }
  $level = $n.tema
  if (-not $level) { $level = $n.kind }
  $intro = 'Источник: ' + $n.source + '. Из личной коллекции Obsidian.'

  [void]$sb.AppendLine('    {')
  [void]$sb.AppendLine('      "id": ' + ('"' + (Esc $id) + '"') + ',')
  [void]$sb.AppendLine('      "type": ' + ('"' + $type + '"') + ',')
  [void]$sb.AppendLine('      "title": ' + ('"' + (Esc $n.titleAr) + '"') + ',')
  [void]$sb.AppendLine('      "titleRu": ' + ('"' + (Esc $n.titleRu) + '"') + ',')
  [void]$sb.AppendLine('      "level": ' + ('"' + (Esc $level) + '"') + ',')
  [void]$sb.AppendLine('      "intro": ' + ('"' + (Esc $intro) + '"') + ',')
  [void]$sb.AppendLine('      "sentences": [')

  $sentParts = @()
  foreach ($s in $n.sentences) {
    $p = New-Object System.Text.StringBuilder
    [void]$p.Append('        {')
    [void]$p.Append('"ar": ' + ('"' + (Esc $s['ar']) + '"'))
    if ($s['tr'])   { [void]$p.Append(', "tr": ' + ('"' + (Esc $s['tr']) + '"')) }
    if ($s['when']) { [void]$p.Append(', "when": ' + ('"' + (Esc $s['when']) + '"')) }
    [void]$p.Append(', "ru": ' + ('"' + (Esc $s['ru']) + '"'))
    if ($s['words'] -and $s['words'].Count) {
      [void]$p.Append(', "words": [')
      $wordParts = @($s['words'] | ForEach-Object {
        '{ "w": ' + ('"' + (Esc $_[ 'w' ]) + '"') + ', "tr": ' + ('"' + (Esc $_[ 'tr' ]) + '"') + ', "ru": ' + ('"' + (Esc $_[ 'ru' ]) + '"') + ' }'
      })
      [void]$p.Append($wordParts -join ', ')
      [void]$p.Append(']')
    } else {
      [void]$p.Append(', "words": []')
    }
    [void]$p.Append(' }')
    $sentParts += $p.ToString()
  }
  [void]$sb.AppendLine(($sentParts -join ",`n"))
  [void]$sb.AppendLine('      ]')
  [void]$sb.AppendLine('    },')
}
[void]$sb.AppendLine('  ];')
[void]$sb.AppendLine('  items.forEach(function(s){ STORIES_DATA.stories.push(s); });')
[void]$sb.AppendLine('})();')

[System.IO.File]::WriteAllText($OutFile, $sb.ToString(), $utf8)
Write-Host ("Записан: {0} ({1} КБ)" -f $OutFile, [math]::Round((Get-Item $OutFile).Length / 1KB, 1))
