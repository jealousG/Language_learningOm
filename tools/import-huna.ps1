# ============================================================
#  Импорт «Хуна Арабия» из Obsidian-хранилища -> js/data-huna.js
#  Источник: <vault>\00 MOC, \01 Диалоги, \02 Слова, \03 Корни.
#  Собирает: книги -> главы -> диалоги (строки: говорящий/арабский/транслит/перевод),
#  слова главы, грамматику главы; пословный разбор строк строится по словарю
#  заметок-слов (точное совпадение -> снятие артикля/приставок/суффиксов).
#  Нераспознанные слова помечаются (miss) и выгружаются в отчёт.
#  Выход: js/data-huna.js - АВТОГЕНЕРИРОВАН, руками не править.
#  ВАЖНО: скрипт с кириллицей требует BOM (сохранён с BOM).
# ============================================================

param(
  [string]$VaultDir = "C:\Users\OKurbanov\Desktop\не работа\Обсидиан\НеРабота\Арабский",
  [string]$OutFile = "$PSScriptRoot\..\js\data-huna.js",
  [string]$ReportFile = "$PSScriptRoot\huna-missing.txt"
)

$ErrorActionPreference = 'Stop'
$utf8bom = New-Object System.Text.UTF8Encoding($true)

$alef = [string][char]0x0627
$heh = [string][char]0x0647
$ya = [string][char]0x064A

# ------------------------- нормализация -------------------------
function Norm([string]$s) {
  if (-not $s) { return '' }
  $s = $s -replace '[\u064B-\u0653\u0670\u06D6-\u06ED\u0640]', ''
  $s = $s -replace '[\u060C\u061B\u061F\u0660-\u0669\u066A-\u066D\u06D4\u06F0-\u06F9]', ''
  $s = $s -replace '[\u0622\u0623\u0625\u0627\u0671]', $alef
  $s = $s -replace '\u0629', $heh
  $s = $s -replace '\u0649', $ya
  $s = $s -replace '[^\u0600-\u06FF]', ''
  return $s.Trim()
}
function HasArabic([string]$s) { return [bool]([regex]::IsMatch($s, '[\u0600-\u06FF]')) }
function HasCyr([string]$s) { return [bool]([regex]::IsMatch($s, '[\u0400-\u04FF]')) }
function HasLatin([string]$s) { return [bool]([regex]::IsMatch($s, '[A-Za-z]')) }

# Ключ «внутренних огласовок»: слово до последней буквы включительно (конечная
# огласовка/танвин/шадда отбрасывается). Различает омографы (قَبْلَ / قَبَّلَ),
# но не ломается на падежных окончаниях (قَبْلَ / قَبْل).
function KeyInternal([string]$s) {
  if (-not $s) { return '' }
  $s = $s.Trim()
  $last = -1
  for ($i = 0; $i -lt $s.Length; $i++) {
    $ch = $s[$i]
    if ($ch -match '[\u0600-\u06FF]' -and $ch -notmatch '[\u064B-\u0653\u0670\u06D6-\u06ED\u0640]') { $last = $i }
  }
  if ($last -lt 0) { return '' }
  return $s.Substring(0, $last + 1)
}

$GENDER_WORDS = @('мужской', 'женский', 'муж.', 'жен.', 'м.р.', 'ж.р.', 'средний', '-', '—')

# Из строки таблицы достаём перевод (ru) и чтение (tr).
# ВАЖНО: чтение часто записано КИРИЛЛИЦЕЙ (транслитерация), поэтому колонки
# определяем по заголовку таблицы, а не по алфавиту.
function ExtractTrRu($cells, $header) {
  $ru = ''; $tr = ''
  $ruCol = -1; $trCol = -1
  if ($header -and $header.Count -eq $cells.Count) {
    for ($k = 0; $k -lt $header.Count; $k++) {
      $h = $header[$k].ToLower()
      if ($h -match 'перевод|значени') { if ($ruCol -lt 0) { $ruCol = $k } }
      elseif ($h -match 'чтени|транскрип') { if ($trCol -lt 0) { $trCol = $k } }
    }
  }
  if ($ruCol -ge 0 -and $ruCol -lt $cells.Count -and (HasCyr $cells[$ruCol])) { $ru = $cells[$ruCol] }
  if ($trCol -ge 0 -and $trCol -lt $cells.Count -and $cells[$trCol]) { $tr = $cells[$trCol] }

  if (-not $ru) {
    for ($i = 1; $i -lt $cells.Count; $i++) {
      $c = $cells[$i]
      if (-not $c) { continue }
      if ((HasLatin $c) -and -not (HasCyr $c) -and -not $tr) { $tr = $c }
    }
    for ($i = $cells.Count - 1; $i -ge 1; $i--) {
      $c = $cells[$i]
      if (-not $c) { continue }
      if (-not (HasCyr $c)) { continue }
      if ($GENDER_WORDS -contains $c.ToLower()) { continue }
      if ($tr -and $c -eq $tr) { continue }
      $ru = $c; break
    }
  }
  if (-not $tr -and $cells.Count -ge 3 -and (HasCyr $cells[1]) -and $ru -ne $cells[1]) { $tr = $cells[1] }
  return @{ ru = $ru; tr = $tr }
}

function ReadAll([string]$path) { return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }

function Get-Frontmatter([string]$raw) {
  $fm = @{}
  $m = [regex]::Match($raw, '(?s)^---\r?\n(.*?)\r?\n---')
  if ($m.Success) {
    foreach ($line in ($m.Groups[1].Value -split "\r?\n")) {
      $i = $line.IndexOf(':')
      if ($i -gt 0) { $fm[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim() }
    }
  }
  return $fm
}

# Секции markdown по префиксу заголовка '## <name>' (собирает ВСЕ совпадения:
# '## Текст', '## Текст 1', '## Текст диалога' — это один и тот же тип контента).
function Get-Section([string[]]$lines, [string[]]$names) {
  $out = @()
  $inside = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($t -match '^##\s+(.+)$') {
      $head = $Matches[1].Trim()
      $inside = $false
      foreach ($n in $names) {
        if ($head -eq $n -or $head.StartsWith($n + ' ')) { $inside = $true; break }
      }
      continue
    }
    if ($inside) { $out += $lines[$i] }
  }
  return $out
}

# ------------------------- словарь слов -------------------------
# Собирается из НЕСКОЛЬКИХ источников (приоритет: заметка-слово > таблица):
#   1) 02 Слова — заметки-слова (слово/чтение/перевод/часть речи/корень);
#   2) 03 Корни, 00 MOC, 01 Диалоги, 04 Грамматика — таблицы и списки слов с переводом.
$dict = @{}
$dictPrio = @{}
$dictExact = @{}       # ключ — слово КАК ЕСТЬ (с огласовками): различает омографы (مِنْ / مَنْ)
$dictExactPrio = @{}
$dictInt = @{}         # ключ — слово до последней буквы (без конечной огласовки)
$dictIntPrio = @{}

function AddDict([string]$w, [string]$tr, [string]$ru, [string]$pos, [string]$root, [int]$prio) {
  if (-not $w) { return }
  $wt = $w.Trim()
  if ($wt) {
    if (-not $dictExact.ContainsKey($wt) -or $prio -gt $dictExactPrio[$wt]) {
      $dictExact[$wt] = [ordered]@{ w = $wt; tr = $tr; ru = $ru; pos = $pos; root = $root }
      $dictExactPrio[$wt] = $prio
    }
    $ik = KeyInternal $wt
    if ($ik) {
      if (-not $dictInt.ContainsKey($ik) -or $prio -gt $dictIntPrio[$ik]) {
        $dictInt[$ik] = [ordered]@{ w = $wt; tr = $tr; ru = $ru; pos = $pos; root = $root }
        $dictIntPrio[$ik] = $prio
      }
    }
  }
  $key = Norm $w
  if (-not $key) { return }
  if ($dict.ContainsKey($key)) {
    $p = $dictPrio[$key]
    if ($prio -lt $p) { return }
    if ($prio -eq $p -and $dict[$key].ru) { return }
  }
  $dict[$key] = [ordered]@{ w = $w; tr = $tr; ru = $ru; pos = $pos; root = $root }
  $dictPrio[$key] = $prio
}

# 1) заметки-слова
Get-ChildItem -LiteralPath (Join-Path $VaultDir '02 Слова') -Filter *.md | ForEach-Object {
  $raw = ReadAll $_.FullName
  $fm = Get-Frontmatter $raw
  $w = $fm['слово']; if (-not $w) { $w = $fm['арабский'] }
  AddDict $w $fm['чтение'] $fm['перевод'] $fm['часть_речи'] $fm['корень'] 3
}

# 2) таблицы/списки слов в прочих заметках
foreach ($pair in @(@('03 Корни', 'root'), @('00 MOC', 'moc'), @('01 Диалоги', 'dlg'), @('04 Грамматика', 'gram'))) {
  $dir = Join-Path $VaultDir $pair[0]
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  Get-ChildItem -LiteralPath $dir -Filter *.md | ForEach-Object {
    $raw = ReadAll $_.FullName
    $lines = $raw -split "\r?\n"
    $header = @()
    for ($li = 0; $li -lt $lines.Count; $li++) {
      $l = $lines[$li].Trim()
      if (-not $l.StartsWith('|')) {
        $header = @()
        # список «- [[слово]] - перевод»
        $lm = [regex]::Match($l, '^[-*]\s*\[\[(.+?)\]\](?:\s*[-–—:]\s*(.+))?$')
        if ($lm.Success) {
          $w = $lm.Groups[1].Value; $ru = $lm.Groups[2].Value
          if ((HasArabic $w) -and $ru -and (HasCyr $ru)) { AddDict $w '' $ru '' '' 2 }
        }
        continue
      }
      $cells = @(($l.Trim('|') -split '\|') | ForEach-Object { $_.Trim() })
      if ($cells.Count -lt 2) { continue }
      if (($cells -join '') -match '^-+$') { continue }   # разделитель — заголовок сохраняется
      # строка-заголовок: следующая строка — разделитель
      if ($li + 1 -lt $lines.Count) {
        $nx = $lines[$li + 1].Trim()
        if ($nx.StartsWith('|')) {
          $nc = @(($nx.Trim('|') -split '\|') | ForEach-Object { $_.Trim() })
          if (($nc -join '') -match '^-+$') { $header = $cells; continue }
        }
      }
      $wcell = $cells[0]
      if ($wcell -match '^-+$' -or $wcell -match '^(Слово|Арабский|Форма|Буквы)$') { continue }
      $wm = [regex]::Match($wcell, '\[\[(.+?)\]\]')
      $w = if ($wm.Success) { $wm.Groups[1].Value } else { $wcell }
      if (-not (HasArabic $w)) { continue }
      $ex = ExtractTrRu $cells $header
      if ($ex.ru) { AddDict $w $ex.tr $ex.ru '' '' 2 }
      elseif ($ex.tr) { AddDict $w $ex.tr '' '' '' 1 }
    }
  }
}

# 3) ручные дополнения (наивысший приоритет) — tools/huna-extra-words.json
$extraPath = Join-Path $PSScriptRoot 'huna-extra-words.json'
if (Test-Path -LiteralPath $extraPath) {
  $extra = [IO.File]::ReadAllText($extraPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $n = 0
  foreach ($e in $extra) {
    AddDict $e.w $e.tr $e.ru $e.pos '' 4
    $n++
  }
  Write-Output ("extra words loaded: " + $n)
}

# ------------------------- проверка словаря -------------------------
$susp = @($dict.GetEnumerator() | Where-Object {
  $e = $_.Value
  (-not $e.ru) -or (-not (HasCyr $e.ru))
})
Write-Output ("dict entries: " + $dict.Count + " (exact: " + $dictExact.Count + ", internal: " + $dictInt.Count + ")  без перевода: " + $susp.Count)

# ------------------------- значения корней -------------------------
$roots = @{}
Get-ChildItem -LiteralPath (Join-Path $VaultDir '03 Корни') -Filter *.md | ForEach-Object {
  $raw = ReadAll $_.FullName
  $fm = Get-Frontmatter $raw
  $r = $fm['корень']; if (-not $r) { return }
  $m = [regex]::Match($raw, '(?m)^\*\*Значение:\*\*\s*(.+)$')
  $val = if ($m.Success) { $m.Groups[1].Value.Trim() } else { '' }
  $k = Norm $r
  if ($k -and -not $roots.ContainsKey($k)) { $roots[$k] = $val }
}

# ------------------------- разбор слова -------------------------
$PREFIXES = @('وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل', 'ك')
$SUFFIXES = @('هما', 'هم', 'هن', 'كما', 'كم', 'كن', 'ها', 'نا', 'ه', 'ك', 'ي', 'وا', 'ات', 'ين', 'ون', 'ان', 'ا')
$PREFIX_RU = @{ 'ال' = 'артикль'; 'وال' = 'и + артикль'; 'فال' = 'и/же + артикль'; 'بال' = 'посредством + артикль'; 'كال' = 'как + артикль'; 'لل' = 'для'; 'و' = 'и'; 'ف' = 'и/же'; 'ب' = 'посредством'; 'ل' = 'для'; 'к' = 'как' }
$SUFFIX_RU = @{ 'ه' = 'его'; 'ها' = 'её'; 'هم' = 'их'; 'هن' = 'их'; 'ك' = 'твой'; 'كم' = 'ваш'; 'كن' = 'ваш'; 'ي' = 'мой'; 'نا' = 'наш'; 'هما' = 'их (дв.)'; 'كما' = 'ваш (дв.)' }

$missing = @{}
$missingCtx = @{}

function Lookup([string]$key, [string]$raw, [bool]$taM) {
  if ($dict.ContainsKey($key)) { return @{ hit = $dict[$key]; pre = ''; suf = '' } }
  # Собираем ВСЕ варианты разбора и выбираем самый длинный корень:
  # «وَالِدَنَا» = والد + نا («отец наш»), а не وال + دنا («приближаться»).
  # taM: слово оканчивается на ة (ta marbuta) — тогда «ه» это НЕ местоимение.
  $cands = @()
  foreach ($p in $PREFIXES) {
    if ($key.StartsWith($p) -and $key.Length -gt $p.Length) {
      $rest = $key.Substring($p.Length)
      $rawRest = CutLetters $raw (LetterCount $p)
      if ($rawRest -and $dictExact.ContainsKey($rawRest)) { $cands += @{ hit = $dictExact[$rawRest]; pre = $p; suf = ''; stem = $rest.Length } }
      if ($rawRest) {
        $ik = KeyInternal $rawRest
        if ($ik -and $dictInt.ContainsKey($ik)) { $cands += @{ hit = $dictInt[$ik]; pre = $p; suf = ''; stem = $rest.Length } }
      }
      if ($rest.Length -ge 2 -and $dict.ContainsKey($rest)) { $cands += @{ hit = $dict[$rest]; pre = $p; suf = ''; stem = $rest.Length } }
      foreach ($s in $SUFFIXES) {
        if ($rest.EndsWith($s) -and $rest.Length -gt $s.Length) {
          $stem = $rest.Substring(0, $rest.Length - $s.Length)
          # при ة в конце «ه» — это ta marbuta, а не местоимение: суффикс не помечаем
          $sfx = if ($s -eq 'ه' -and $taM) { '' } else { $s }
          if ($stem.Length -ge 2 -and $dict.ContainsKey($stem)) { $cands += @{ hit = $dict[$stem]; pre = $p; suf = $sfx; stem = $stem.Length } }
        }
      }
    }
  }
  foreach ($s in $SUFFIXES) {
    if ($key.EndsWith($s) -and $key.Length -gt $s.Length) {
      $stem = $key.Substring(0, $key.Length - $s.Length)
      $sfx = if ($s -eq 'ه' -and $taM) { '' } else { $s }
      if ($stem.Length -ge 2 -and $dict.ContainsKey($stem)) { $cands += @{ hit = $dict[$stem]; pre = ''; suf = $sfx; stem = $stem.Length } }
    }
  }
  if (-not $cands.Count) { return $null }
  return ($cands | Sort-Object -Property @{ Expression = { $_.stem } } -Descending | Select-Object -First 1)
}

# Сборка осмысленного перевода для форм с приставками/суффиксами
$CASE_GEN   = @{ 'ك' = 'тебя'; 'ه' = 'него'; 'ها' = 'неё'; 'نا' = 'нас'; 'كم' = 'вас'; 'كن' = 'вас'; 'كما' = 'вас'; 'هم' = 'них'; 'هن' = 'них'; 'هما' = 'них'; 'ي' = 'меня' }
$CASE_DAT   = @{ 'ك' = 'тебе'; 'ه' = 'нему'; 'ها' = 'ней'; 'نا' = 'нам'; 'كم' = 'вам'; 'كن' = 'вам'; 'كما' = 'вам'; 'هم' = 'ним'; 'هن' = 'ним'; 'هما' = 'ним'; 'ي' = 'мне' }
$CASE_PREP  = @{ 'ك' = 'тебе'; 'ه' = 'нём'; 'ها' = 'ней'; 'نا' = 'нас'; 'كم' = 'вас'; 'كن' = 'вас'; 'كما' = 'вас'; 'هم' = 'них'; 'هن' = 'них'; 'هما' = 'них'; 'ي' = 'мне' }
$CASE_INSTR = @{ 'ك' = 'тобой'; 'ه' = 'ним'; 'ها' = 'ней'; 'نا' = 'нами'; 'كم' = 'вами'; 'كن' = 'вами'; 'كما' = 'вами'; 'هم' = 'ними'; 'هن' = 'ними'; 'هما' = 'ними'; 'ي' = 'мной' }
$PREP_WORD = @{ 'علي' = 'на'; 'من' = 'от'; 'الي' = 'к'; 'عن' = 'о'; 'في' = 'в'; 'ب' = 'с'; 'ك' = 'как'; 'مع' = 'с'; 'عند' = 'у'; 'لدي' = 'у' }
$PREP_CASE = @{ 'علي' = 'GEN'; 'من' = 'GEN'; 'الي' = 'DAT'; 'عن' = 'PREP'; 'في' = 'PREP'; 'ب' = 'INSTR'; 'ك' = 'GEN'; 'مع' = 'INSTR'; 'عند' = 'GEN'; 'لدي' = 'GEN' }
$CASE_MAP = @{ 'GEN' = $CASE_GEN; 'DAT' = $CASE_DAT; 'PREP' = $CASE_PREP; 'INSTR' = $CASE_INSTR }

function ComposeRu($hit, [string]$pre, [string]$suf) {
  $lk = Norm $hit.w
  $base = ''
  if ($suf) {
    if ($lk -eq 'ل' -or $lk -eq 'لل' -or $pre -eq 'ل' -or $pre -eq 'لل') {
      if ($CASE_DAT.ContainsKey($suf)) { $base = $CASE_DAT[$suf] }
    } elseif ($PREP_CASE.ContainsKey($lk)) {
      $forms = $CASE_MAP[$PREP_CASE[$lk]]
      if ($forms -and $forms.ContainsKey($suf)) { $base = $PREP_WORD[$lk] + ' ' + $forms[$suf] }
    }
  }
  if (-not $base -and -not $suf -and ($pre -eq 'و' -or $pre -eq 'ف')) {
    $pref = if ($pre -eq 'و') { 'и ' } else { 'и/же ' }
    return ($pref + $hit.ru)
  }
  if (-not $base) { return '' }
  if ($pre -eq 'و') { $base = 'и ' + $base }
  elseif ($pre -eq 'ف') { $base = 'и/же ' + $base }
  return $base
}

# Число арабских БУКВ в строке (огласовки не считаются)
function LetterCount([string]$s) {
  $n = 0
  foreach ($ch in $s.ToCharArray()) {
    if ($ch -match '[\u0600-\u06FF]' -and $ch -notmatch '[\u064B-\u0653\u0670\u06D6-\u06ED\u0640]') { $n++ }
  }
  return $n
}

# Отрезать первые N арабских букв (сохраняя огласовки остатка)
function CutLetters([string]$s, [int]$n) {
  $count = 0; $i = 0
  while ($i -lt $s.Length) {
    $ch = $s[$i]
    $i++
    if ($ch -match '[\u0600-\u06FF]' -and $ch -notmatch '[\u064B-\u0653\u0670\u06D6-\u06ED\u0640]') {
      $count++
      if ($count -ge $n) { break }
    }
  }
  if ($i -ge $s.Length) { return '' }
  return $s.Substring($i)
}

# Слово строки: разбивает по пробелам, отделяет пунктуацию, находит словарную статью
function MakeWords([string]$text) {
  $words = @()
  foreach ($tok in ($text -split '\s+')) {
    if (-not $tok) { continue }
    $lead = ''
    $trail = ''
    $mm = [regex]::Match($tok, '^([^\u0600-\u06FF]*)(.*?)([^\u0600-\u06FF]*)$')
    if ($mm.Success) { $lead = $mm.Groups[1].Value; $core = $mm.Groups[2].Value; $trail = $mm.Groups[3].Value }
    else { $core = $tok }
    if (-not $core) { continue }
    $key = Norm $core
    if (-not $key) { continue }
    # 1) точная форма с огласовками, 2) без конечной огласовки, 3) нормализованный словарь с приставками
    $res = $null
    if ($dictExact.ContainsKey($core)) { $res = @{ hit = $dictExact[$core]; pre = ''; suf = '' } }
    if (-not $res) {
      $ik = KeyInternal $core
      if ($ik -and $dictInt.ContainsKey($ik)) { $res = @{ hit = $dictInt[$ik]; pre = ''; suf = '' } }
    }
    if (-not $res) { $res = Lookup $key $core ($core -match '\u0629[\u064B-\u0652\u0670]*$') }
    $obj = [ordered]@{ w = $core }
    if ($res) {
      $obj.tr = $res.hit.tr
      $obj.ru = $res.hit.ru
      if ($res.hit.pos) { $obj.pos = $res.hit.pos }
      if ($res.hit.root) { $obj.root = $res.hit.root }
      if ($res.pre -or $res.suf) {
        $composed = ComposeRu $res.hit $res.pre $res.suf
        if ($composed) { $obj.ru = $composed }
        $parts = @()
        if ($res.pre) { $parts += ($PREFIX_RU[$res.pre] + ' (' + $res.pre + ')') }
        $parts += ('«' + $res.hit.ru + '»')
        if ($res.suf) { $parts += ($SUFFIX_RU[$res.suf] + ' (' + $res.suf + ')') }
        $obj.def = ($parts -join ' + ')
      }
    } else {
      $obj.ru = ''
      $obj.miss = $true
      if ($missing.ContainsKey($key)) { $missing[$key]++ } else { $missing[$key] = 1 }
      if (-not $missingCtx.ContainsKey($key)) { $missingCtx[$key] = @() }
      if ($missingCtx[$key].Count -lt 2 -and $text) { $missingCtx[$key] += $text.Trim() }
    }
    if ($trail) { $obj.punct = $trail }
    $words += $obj
  }
  return $words
}

# ------------------------- разбор блока (реплики/абзаца) -------------------------
function ParseBlock([string[]]$blockLines, [hashtable]$names) {
  $lines = @($blockLines | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if (-not $lines.Count) { return $null }

  # вариант (c): цитаты '> Arabic' / '> Russian'
  if ($lines[0].StartsWith('>')) {
    $q = @($lines | ForEach-Object { ($_ -replace '^>\s?', '').Trim() } | Where-Object { $_ })
    if ($q.Count -ge 2) {
      $ar = $q[0]; $ru = $q[1]; $tr = ''
      if ($q.Count -ge 3 -and -not (HasArabic $q[1]) -and -not (HasArabic $q[2])) { $tr = $q[1]; $ru = $q[2] }
      # снять markdown-выделение и вынести говорящего: '**خديجة:** текст' / 'Хадиджа: перевод'
      $spAr = ''; $spRu = ''
      $hadBold = $ar.TrimStart().StartsWith('**')
      $ar = ($ar -replace '\*\*', '').Trim()
      if ($hadBold) {
        $mm = [regex]::Match($ar, '^([^:]{1,24}):\s*(.+)$')
        if ($mm.Success -and (HasArabic $mm.Groups[2].Value)) { $spAr = $mm.Groups[1].Value.Trim(); $ar = $mm.Groups[2].Value.Trim() }
      }
      $ru = ($ru -replace '\*\*', '').Trim()
      $mmr = [regex]::Match($ru, '^([^:]{1,24}):\s*(.+)$')
      if ($mmr.Success -and $names.ContainsKey($mmr.Groups[1].Value.Trim())) { $spRu = $mmr.Groups[1].Value.Trim(); $ru = $mmr.Groups[2].Value.Trim() }
      return [ordered]@{ ar = $ar; tr = $tr; ru = $ru; speakerAr = $spAr; speakerRu = $spRu; words = (MakeWords $ar) }
    }
    return $null
  }

  $speakerAr = ''; $ar = ''; $tr = ''; $ruLines = @()
  foreach ($l in $lines) {
    if ($l.StartsWith('#')) { continue }   # заголовки внутри блока не текст
    if ($l.StartsWith('**') -and -not $ar) {
      $c = $l.Trim('*').Trim()
      $mm = [regex]::Match($c, '^(.*?):\s*(.+)$')
      if ($mm.Success -and $mm.Groups[1].Value.Length -le 24) {
        $speakerAr = $mm.Groups[1].Value.Trim().Trim('*').Trim()
        $ar = $mm.Groups[2].Value.Trim().Trim('*').Trim()
      } else {
        $ar = $c
      }
      continue
    }
    if ($l.StartsWith('*') -and -not $l.StartsWith('**') -and -not $tr) { $tr = $l.Trim('*').Trim(); continue }
    if (HasArabic $l) { if (-not $ar) { $ar = $l.Trim() }; continue }   # арабская строка без «**»
    if ($l -match '^\d+\.\s*$') { continue }
    if ($l -match '^\[\[.*\]\]$') { continue }
    $ruLines += $l
  }
  if (-not $ar) { return $null }
  # текст должен начинаться с арабской буквы — иначе это метаданные/ссылки, а не реплика
  if (-not [regex]::IsMatch($ar, '^\s*[\u0600-\u06FF]')) { return $null }
  $ru = ($ruLines -join ' ').Trim()
  $speakerRu = ''
  if ($ru -match '^([^:]{1,24}):\s*(.+)$' -and $names.ContainsKey($Matches[1].Trim())) {
    $speakerRu = $Matches[1].Trim(); $ru = $Matches[2].Trim()
  }
  return [ordered]@{
    ar = $ar; tr = $tr; ru = $ru
    speakerAr = $speakerAr; speakerRu = $speakerRu
    words = (MakeWords $ar)
  }
}

# ------------------------- главы (MOC) -------------------------
$books = [ordered]@{
  'huna1' = [ordered]@{ id = 'huna1'; title = 'Хуна Арабия — Том 1'; titleAr = 'هنا العربية'; chapters = @() }
  'huna2' = [ordered]@{ id = 'huna2'; title = 'Хуна Арабия — Том 2'; titleAr = 'هنا العربية'; chapters = @() }
}

$mocDir = Join-Path $VaultDir '00 MOC'
$chapterIndex = @{}   # "1:3" -> chapter object
$chapterInfo = @{}    # "1:3" -> @{ no -> @{characters; topic} }
Get-ChildItem -LiteralPath $mocDir -Filter *.md | Where-Object { $_.Name -match '^Том (\d) - Глава (\d+)\.md$' } | ForEach-Object {
  $vol = [int]$Matches[1]; $chNo = [int]$Matches[2]
  $raw = ReadAll $_.FullName
  $lines = $raw -split "\r?\n"

  $titleRu = ''; $titleAr = ''
  $h = [regex]::Match($raw, '(?m)^#\s+Том\s+\d+\s+-\s+Глава\s+\d+:\s*(.+)$')
  if ($h.Success) {
    $t = $h.Groups[1].Value.Trim()
    $mm = [regex]::Match($t, '^(.*?)\s*\((.*)\)\s*$')
    if ($mm.Success) { $titleAr = $mm.Groups[1].Value.Trim(); $titleRu = $mm.Groups[2].Value.Trim() }
    else { $titleRu = $t }
  }
  $pages = ''
  $pm = [regex]::Match($raw, '(?m)^\*\*Страницы:\*\*\s*(.+)$'); if ($pm.Success) { $pages = $pm.Groups[1].Value.Trim() }
  $goal = ''
  $gm = [regex]::Match($raw, '(?m)^\*\*Цель главы:\*\*\s*(.+)$'); if ($gm.Success) { $goal = $gm.Groups[1].Value.Trim() }

  # слова главы: | Слово | Чтение | Перевод | Род |
  $words = @()
  $secW = Get-Section $lines @('Новые слова главы')
  foreach ($l in $secW) {
    $mm = [regex]::Match($l, '^\|\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$')
    if (-not $mm.Success) { continue }
    $wRaw = $mm.Groups[1].Value
    if ($wRaw -match '^Слово$|^-+$') { continue }
    $wm = [regex]::Match($wRaw, '\[\[(.+?)\]\]')
    $w = if ($wm.Success) { $wm.Groups[1].Value } else { $wRaw }
    $obj = [ordered]@{ w = $w; tr = $mm.Groups[2].Value; ru = $mm.Groups[3].Value }
    $g = $mm.Groups[4].Value; if ($g -and $g -ne '-') { $obj.gender = $g }
    $words += $obj
  }

  # грамматика главы
  $gram = @()
  $secG = Get-Section $lines @('Грамматика главы')
  foreach ($l in $secG) {
    $mm = [regex]::Match($l, '^-\s*\[\[(.+?)\]\]'); if ($mm.Success) { $gram += $mm.Groups[1].Value }
  }

  # темы и персонажи материалов (таблица «Диалоги (N)» или «Тексты главы»)
  $info = @{}
  $secInfo = Get-Section $lines @('Диалоги', 'Тексты главы')
  if ($secInfo.Count) {
    $hdr = @()
    foreach ($l in $secInfo) {
      $t = $l.Trim()
      if (-not $t.StartsWith('|')) { continue }
      $cells = @(($t.Trim('|') -split '\|') | ForEach-Object { $_.Trim() })
      if (($cells -join '') -match '^-+$') { continue }
      if (-not $hdr.Count) { $hdr = $cells; continue }
      $num = 0; $chars = ''; $topic = ''
      for ($k = 0; $k -lt $cells.Count -and $k -lt $hdr.Count; $k++) {
        $h = $hdr[$k].ToLower(); $c = $cells[$k]
        if ($h -match '^№|^#') { [void][int]::TryParse($c, [ref]$num) }
        elseif ($h -match 'персонаж|участник') { $chars = $c }
        elseif ($h -match 'тема|период') { $topic = $c }
      }
      if ($num -gt 0) { $info[$num] = @{ characters = $chars; topic = $topic } }
    }
  }
  $chapterInfo["$vol`:$chNo"] = $info

  # диалоги главы (порядок ссылок)
  $dlgs = @()
  foreach ($l in $lines) {
    $mm = [regex]::Match($l, '^-\s*\[\[Том\s+\d+\s+-\s+Глава\s+\d+\s+-\s+(.+?)\]\]')
    if ($mm.Success) { $dlgs += $mm.Groups[1].Value }
  }

  $chapter = [ordered]@{
    id = "huna$vol-g$chNo"; no = $chNo
    titleRu = $titleRu; titleAr = $titleAr
    pages = $pages; goal = $goal
    words = $words; grammar = $gram
    dialogues = @()
  }
  $chapterIndex["$vol`:$chNo"] = $chapter
  $books["huna$vol"].chapters += $chapter
}

# ------------------------- диалоги -------------------------
$dlgDir = Join-Path $VaultDir '01 Диалоги'
$skipped = @()
Get-ChildItem -LiteralPath $dlgDir -Filter *.md | ForEach-Object {
  $raw = ReadAll $_.FullName
  $fm = Get-Frontmatter $raw
  $vol = [int]$fm['том']; $chNo = [int]$fm['глава']
  if (-not $vol -or -not $chNo) { return }
  $key = "$vol`:$chNo"
  if (-not $chapterIndex.ContainsKey($key)) { $skipped += $_.Name; return }
  $chapter = $chapterIndex[$key]

  $lines = $raw -split "\r?\n"
  $kind = $fm['type']
  if ($kind -eq 'ДЗ') { return }   # домашние задания убраны с сайта

  # персонажи -> карта русских имён (для отделения говорящего от реплики)
  $names = @{}
  $pm = [regex]::Match($raw, '(?m)^\*\*Персонажи:\*\*\s*(.+)$')
  if ($pm.Success) {
    foreach ($m in [regex]::Matches($pm.Groups[1].Value, '\(([^)]+)\)')) {
      $n = $m.Groups[1].Value.Trim()
      if ($n) { $names[$n] = $true }
    }
  }
  # часть файлов вместо «**Персонажи:**» содержит участников во frontmatter («участники: Хадиджа, Марьям»)
  if ($fm['участники']) {
    foreach ($n in ([string]$fm['участники'] -split ',')) {
      $n = $n.Trim()
      if ($n) { $names[$n] = $true }
    }
  }

  # тело: '## Диалог' / '## Текст диалога' / '## Текст' / '## Вступление' + '## Текст'
  $body = Get-Section $lines @('Диалог', 'Текст диалога')
  $tableMode = $false
  if (-not $body.Count) { $body = Get-Section $lines @('Текст') }
  if (-not $body.Count) { $body = $lines; $tableMode = $true }   # нет заголовка «Текст» — только таблицы упражнений

  $blocks = @()
  $cur = @()
  foreach ($l in $body) {
    if ($l.Trim() -eq '---') { if ($cur.Count) { $blocks += , $cur }; $cur = @() }
    else { $cur += $l }
  }
  if ($cur.Count) { $blocks += , $cur }

  $sents = @()
  if (-not $tableMode) {
    # Формат «цитаты»: реплики идут парами
    #   > **Говорящий:** арабский текст
    #   > Говорящий: перевод
    # и разделены ПУСТОЙ строкой (а не '---'), поэтому весь раздел — один блок,
    # и обычный разбор взял бы лишь первую пару. Разбираем пары явно.
    # '---' внутри секции — тоже разделитель реплик, поэтому в проверке формата его не учитываем
    $nonEmpty = @($body | Where-Object { $_.Trim() -and $_.Trim() -ne '---' })
    $allQuotes = $nonEmpty.Count -gt 0 -and @($nonEmpty | Where-Object { -not $_.StartsWith('>') }).Count -eq 0
    if ($allQuotes) {
      $q = @($nonEmpty | ForEach-Object { ($_ -replace '^>\s?', '').Trim() } | Where-Object { $_ })
      $qi = 0
      while ($qi -lt $q.Count) {
        $aLine = $q[$qi]
        if (-not (HasArabic $aLine)) { $qi++; continue }
        # говорящий выделен жирным: '**خديجة:** текст' (маркер надёжнее, чем «короткий префикс до :»)
        $hadBold = $aLine.TrimStart().StartsWith('**')
        $aText = ($aLine -replace '\*\*', '').Trim()
        $spAr = ''
        if ($hadBold) {
          $mm = [regex]::Match($aText, '^([^:]{1,24}):\s*(.+)$')
          if ($mm.Success -and (HasArabic $mm.Groups[2].Value)) {
            $spAr = $mm.Groups[1].Value.Trim(); $aText = $mm.Groups[2].Value.Trim()
          }
        }
        # перевод — следующая непустая строка без арабского
        $ru = ''; $spRu = ''
        if (($qi + 1) -lt $q.Count -and -not (HasArabic $q[$qi + 1])) {
          $ruText = ($q[$qi + 1] -replace '\*\*', '').Trim()
          $mmr = [regex]::Match($ruText, '^([^:]{1,24}):\s*(.+)$')
          if ($mmr.Success -and $names.ContainsKey($mmr.Groups[1].Value.Trim())) {
            $spRu = $mmr.Groups[1].Value.Trim(); $ru = $mmr.Groups[2].Value.Trim()
          } else { $ru = $ruText }
          $qi++
        }
        $sents += [ordered]@{ ar = $aText; tr = ''; ru = $ru; speakerAr = $spAr; speakerRu = $spRu; words = (MakeWords $aText) }
        $qi++
      }
    } else {
      foreach ($b in $blocks) {
        $s = ParseBlock $b $names
        if ($s) { $sents += $s }
      }
    }
  }
  # вариант: таблица упражнений ДЗ — «| Арабский | Перевод |» или «| Арабский | Чтение | Перевод |»
  if (-not $sents.Count) {
    foreach ($r in $body) {
      $line = $r.Trim()
      if (-not $line.StartsWith('|')) { continue }
      $cells = @(($line.Trim('|') -split '\|') | ForEach-Object { $_.Trim() })
      if ($cells.Count -lt 2) { continue }
      $a = $cells[0]
      if ($a -match '^-+$' -or -not (HasArabic $a)) { continue }
      # таблицы упражнений: «| арабский | перевод |» или «| арабский | чтение | перевод |»
      $tr = ''; $ru = ''
      if ($cells.Count -ge 3) { $tr = $cells[1]; $ru = $cells[2] }
      elseif ($cells.Count -eq 2) { $ru = $cells[1] }
      if (-not $ru -or -not (HasCyr $ru)) { continue }
      if ($tr -eq $ru) { $tr = '' }
      $sents += [ordered]@{ ar = $a; tr = $tr; ru = $ru; speakerAr = ''; speakerRu = ''; words = (MakeWords $a) }
    }
  }
  # запасной путь: блоки без заголовков (прозаические ДЗ без таблиц)
  if (-not $sents.Count) {
    foreach ($b in $blocks) {
      $s = ParseBlock $b $names
      if ($s) { $sents += $s }
    }
  }
  if (-not $sents.Count) { $skipped += $_.Name; return }

  # номер и заголовок
  $no = [int]$fm['номер']
  $h1 = [regex]::Match($raw, '(?m)^#\s+(.+)$')
  $h1t = if ($h1.Success) { $h1.Groups[1].Value.Trim() } else { $_.BaseName }
  $theme = ''
  $tm = [regex]::Match($h1t, '^.*?-\s*[^:]+:\s*(.+)$')
  if ($tm.Success) { $theme = $tm.Groups[1].Value.Trim() }
  $src = ''
  $sm = [regex]::Match($raw, '(?m)^\*\*Источник:\*\*\s*(.+)$'); if ($sm.Success) { $src = $sm.Groups[1].Value.Trim() }

  $label = if ($kind -eq 'ДЗ') { 'Домашнее задание' } elseif ($kind -eq 'текст') { "Текст $no" } elseif ($kind -eq 'чтение') { 'Чтение' } else { "Диалог $no" }
  # тема и персонажи из таблицы главы (MOC); иначе — из заголовка/заметки
  $info = $null
  if ($chapterInfo.ContainsKey($key) -and $chapterInfo[$key].ContainsKey($no)) { $info = $chapterInfo[$key][$no] }
  $topic = if ($info -and $info.topic) { $info.topic } else { $theme }
  $chars = if ($info -and $info.characters) { $info.characters } elseif ($pm.Success) { $pm.Groups[1].Value.Trim() } else { '' }
  # порядок в главе: диалоги -> тексты -> чтение -> ДЗ
  $order = if ($kind -eq 'текст') { 1 } elseif ($kind -eq 'чтение') { 2 } elseif ($kind -eq 'ДЗ') { 3 } else { 0 }
  # суффикс id зависит от вида: диалог -> dN, текст -> tN, чтение -> read, ДЗ -> dz (без коллизий)
  $suffix = if ($kind -eq 'текст') { "t$no" } elseif ($kind -eq 'чтение') { 'read' } elseif ($kind -eq 'ДЗ') { 'dz' } else { "d$no" }
  $dialog = [ordered]@{
    id = "huna$vol-g$chNo-$suffix"
    no = $no
    order = $order
    kind = $(if ($kind) { $kind } else { 'диалог' })
    titleRu = $label
    titleAr = ''
    topic = $topic
    source = $src
    characters = $chars
    sentences = $sents
  }
  $chapter.dialogues += $dialog
}

# ------------------------- грамматика (04 Грамматика) -------------------------
function InlineMd([string]$s) {
  $s = $s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
  $s = [regex]::Replace($s, '\*\*(.+?)\*\*', '<strong>$1</strong>')
  $s = [regex]::Replace($s, '\[\[(.+?)\]\]', '$1')
  $s = [regex]::Replace($s, '`(.+?)`', '<code>$1</code>')
  return $s
}

function MdToHtml([string[]]$lines) {
  $out = @()
  $inList = $false; $inTable = $false; $inOl = $false
  foreach ($line in $lines) {
    $t = $line.Trim()
    if ($t -eq '---' -or $t -eq '') {
      if ($inList) { $out += '</ul>'; $inList = $false }
      if ($inOl) { $out += '</ol>'; $inOl = $false }
      if ($inTable) { $out += '</tbody></table>'; $inTable = $false }
      continue
    }
    if ($t.StartsWith('|')) {
      $cells = @(($t.Trim('|') -split '\|') | ForEach-Object { $_.Trim() })
      if (($cells -join '') -match '^-+$') { continue }
      if (-not $inTable) { $out += '<table class="g-table"><tbody>'; $inTable = $true }
      $out += '<tr>' + (($cells | ForEach-Object { '<td>' + (InlineMd $_) + '</td>' }) -join '') + '</tr>'
      continue
    }
    if ($inTable) { $out += '</tbody></table>'; $inTable = $false }
    if ($t -match '^(#{2,4})\s+(.+)$') {
      if ($inList) { $out += '</ul>'; $inList = $false }
      if ($inOl) { $out += '</ol>'; $inOl = $false }
      $lvl = $Matches[1].Length + 2
      $out += "<h$lvl class=""g-h"">" + (InlineMd $Matches[2]) + "</h$lvl>"
      continue
    }
    if ($t -match '^[-*]\s+(.+)$') {
      if (-not $inList) { $out += '<ul class="g-list">'; $inList = $true }
      $out += '<li>' + (InlineMd $Matches[1]) + '</li>'
      continue
    }
    if ($t -match '^\d+\.\s+(.+)$') {
      if (-not $inOl) { $out += '<ol class="g-list">'; $inOl = $true }
      $out += '<li>' + (InlineMd $Matches[1]) + '</li>'
      continue
    }
    if ($inList) { $out += '</ul>'; $inList = $false }
    if ($inOl) { $out += '</ol>'; $inOl = $false }
    $out += '<p>' + (InlineMd $t) + '</p>'
  }
  if ($inList) { $out += '</ul>' }
  if ($inOl) { $out += '</ol>' }
  if ($inTable) { $out += '</tbody></table>' }
  return ($out -join "`n")
}

$grammar = @()
$gi = 0
Get-ChildItem -LiteralPath (Join-Path $VaultDir '04 Грамматика') -Filter *.md | ForEach-Object {
  $gi++
  $raw = ReadAll $_.FullName
  $fm = Get-Frontmatter $raw
  $h = [regex]::Match($raw, '(?m)^#\s+(.+)$')
  $title = if ($h.Success) { $h.Groups[1].Value.Trim() } else { $_.BaseName }

  $lines = $raw -split "\r?\n"
  $fmEnd = -1
  if ($lines.Count -and $lines[0].Trim() -eq '---') {
    for ($i = 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq '---') { $fmEnd = $i; break } }
  }
  $h1 = -1
  for ($i = $fmEnd + 1; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^#\s') { $h1 = $i; break } }
  $from = if ($h1 -ge 0) { $h1 + 1 } else { $fmEnd + 1 }
  $body = @()
  for ($i = $from; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($t -match '^\*\*Источник:\*\*') { continue }
    if ($t -match '^\*\*Связанные диалоги:\*\*') { continue }
    $body += $lines[$i]
  }

  $grammar += [ordered]@{
    id = "gram-$gi"
    title = $title
    tom = $(if ($fm['том']) { [int]$fm['том'] } else { 0 })
    chapter = $(if ($fm['глава']) { [int]$fm['глава'] } else { 0 })
    html = (MdToHtml $body)
  }
}
$grammar = @($grammar | Sort-Object -Property @{ Expression = { [int]$_.tom } }, @{ Expression = { [int]$_.chapter } }, @{ Expression = { $_.title } })

# ------------------------- порядок материалов в главах -------------------------
foreach ($bid in @('huna1', 'huna2')) {
  foreach ($ch in $books[$bid].chapters) {
    $ch.dialogues = @($ch.dialogues | Sort-Object -Property @{ Expression = { [int]$_.order } }, @{ Expression = { [int]$_.no } })
  }
}

# ------------------------- отчёт -------------------------
$rep = @()
$rep += "Нераспознанные слова (нет статьи в словаре): " + $missing.Count
$rep += ""
foreach ($e in ($missing.GetEnumerator() | Sort-Object -Property Value -Descending)) {
  $rep += ("### {0}  (x{1})" -f $e.Key, $e.Value)
  if ($missingCtx.ContainsKey($e.Key)) {
    foreach ($x in $missingCtx[$e.Key]) { $rep += ("    " + $x) }
  }
}
if ($skipped.Count) {
  $rep += ""
  $rep += "Пропущенные заметки:"
  $skipped | ForEach-Object { $rep += ("  " + $_) }
}
[IO.File]::WriteAllText($ReportFile, ($rep -join "`r`n"), $utf8bom)

# ------------------------- сборка сторис -------------------------
$stories = @()
foreach ($bid in @('huna1', 'huna2')) {
  foreach ($ch in $books[$bid].chapters) {
    foreach ($d in $ch.dialogues) {
      $stories += [ordered]@{
        id = $d.id
        type = $bid
        title = $d.titleAr
        titleRu = $d.titleRu
        level = $(if ($ch.titleRu) { "Том " + $bid.Substring(4) + ", глава " + $ch.no + " · " + $ch.titleRu } else { "Том " + $bid.Substring(4) + ", глава " + $ch.no })
        intro = $(if ($d.source) { "Источник: " + $d.source + $(if ($d.characters) { " · " + $d.characters } else { '' }) } else { '' })
        bookId = $bid
        chapterId = $ch.id
        chapterNo = $ch.no
        dialogueNo = $d.no
        sentences = $d.sentences
      }
    }
  }
}

$payload = [ordered]@{ books = @($books['huna1'], $books['huna2']); grammar = @($grammar) }
$json = $payload | ConvertTo-Json -Depth 40

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("// ============================================================")
[void]$sb.AppendLine("//  Хуна Арабия (Том 1-2) — АВТОГЕНЕРИРОВАНО tools/import-huna.ps1")
[void]$sb.AppendLine("//  Источник: Obsidian-хранилище «Арабский» (диалоги + слова + корни).")
[void]$sb.AppendLine("//  НЕ ПРАВИТЬ РУКАМИ — только пересборка импортёром.")
[void]$sb.AppendLine("//  Формат сторис совместим со STORIES_DATA (type: huna1 | huna2).")
[void]$sb.AppendLine("// ============================================================")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("const HUNA_DATA = $json;")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("(function () {")
[void]$sb.AppendLine("  // ConvertTo-Json превращает массивы из 1 элемента в объект — нормализуем на загрузке.")
[void]$sb.AppendLine("  const arr = x => Array.isArray(x) ? x : (x == null ? [] : [x]);")
[void]$sb.AppendLine("  HUNA_DATA.books = arr(HUNA_DATA.books);")
[void]$sb.AppendLine("  HUNA_DATA.grammar = arr(HUNA_DATA.grammar);")
[void]$sb.AppendLine("  HUNA_DATA.books.forEach(function (b) {")
[void]$sb.AppendLine("    b.chapters = arr(b.chapters);")
[void]$sb.AppendLine("    b.chapters.forEach(function (ch) {")
[void]$sb.AppendLine("      ch.words = arr(ch.words); ch.grammar = arr(ch.grammar); ch.dialogues = arr(ch.dialogues);")
[void]$sb.AppendLine("      ch.dialogues.forEach(function (d) {")
[void]$sb.AppendLine("        d.sentences = arr(d.sentences);")
[void]$sb.AppendLine("        d.sentences.forEach(function (sn) { sn.words = arr(sn.words); });")
[void]$sb.AppendLine("      });")
[void]$sb.AppendLine("    });")
[void]$sb.AppendLine("  });")
[void]$sb.AppendLine("  const items = [];")
[void]$sb.AppendLine("  HUNA_DATA.books.forEach(function (b) {")
[void]$sb.AppendLine("    (b.chapters || []).forEach(function (ch) {")
[void]$sb.AppendLine("      (ch.dialogues || []).forEach(function (d) {")
[void]$sb.AppendLine("        items.push({")
[void]$sb.AppendLine("          id: d.id, type: b.id, kind: d.kind, order: d.order,")
[void]$sb.AppendLine("          title: d.titleAr || d.titleRu, titleRu: d.titleRu, topic: d.topic || '', characters: d.characters || '',")
[void]$sb.AppendLine("          level: 'Том ' + b.id.replace('huna', '') + ', глава ' + ch.no + (ch.titleRu ? ' · ' + ch.titleRu : ''),")
[void]$sb.AppendLine("          intro: (d.source ? 'Источник: ' + d.source : '') + (d.characters ? (d.source ? ' · ' : '') + d.characters : ''),")
[void]$sb.AppendLine("          bookId: b.id, chapterId: ch.id, chapterNo: ch.no, dialogueNo: d.no,")
[void]$sb.AppendLine("          sentences: d.sentences")
[void]$sb.AppendLine("        });")
[void]$sb.AppendLine("      });")
[void]$sb.AppendLine("    });")
[void]$sb.AppendLine("  });")
[void]$sb.AppendLine("  items.forEach(function (s) { STORIES_DATA.stories.push(s); });")
[void]$sb.AppendLine("})();")

[IO.File]::WriteAllText($OutFile, $sb.ToString(), $utf8bom)

$totalSents = 0; $missSents = 0; $totalWords = 0; $missWords = 0
foreach ($s in $stories) {
  foreach ($sn in $s.sentences) {
    $totalSents++
    $hasMiss = $false
    foreach ($w in $sn.words) { $totalWords++; if ($w.miss) { $missWords++; $hasMiss = $true } }
    if ($hasMiss) { $missSents++ }
  }
}
Write-Output ("books: huna1 chapters=" + $books['huna1'].chapters.Count + " huna2 chapters=" + $books['huna2'].chapters.Count)
Write-Output ("stories: " + $stories.Count + "  sentences: " + $totalSents + "  words: " + $totalWords)
Write-Output ("grammar notes: " + $grammar.Count)
Write-Output ("word coverage: " + [math]::Round(100.0 * ($totalWords - $missWords) / [math]::Max(1, $totalWords), 1) + "%  (missing tokens: " + $missWords + ", unique: " + $missing.Count + ")")
Write-Output ("sentences with gaps: " + $missSents + " of " + $totalSents)
Write-Output ("out: " + $OutFile)
Write-Output ("report: " + $ReportFile)
