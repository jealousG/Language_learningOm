# build-juz30.ps1
# Builds js/data-juz30.js for the full Juz 30 (surahs 78-114, except 112, already present).
# Phase A (no content-ru.json): fetches API data, writes tools/tokens-report.txt
# Phase B (with content-ru.json): merges glossary and emits js/data-juz30.js
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads it as ANSI without BOM).

$ErrorActionPreference = 'Stop'

$root  = $PSScriptRoot
$proj  = Split-Path $root -Parent
$cache = Join-Path $root 'web-cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

$nums = (78..111) + 113 + 114

# ---------- fetch & cache ----------
foreach ($n in $nums) {
    $f = Join-Path $cache ("q$n.json")
    if (!(Test-Path $f)) {
        $url = "https://api.quran.com/api/v4/verses/by_chapter/$n`?words=true&word_fields=text_uthmani,transliteration,audio_url&per_page=50"
        curl.exe -s $url -o $f
    }
    $fe = Join-Path $cache ("q$n-en.json")
    if (!(Test-Path $fe)) {
        # Sahih International (resource 20), verse order 1..N
        curl.exe -s "https://api.quran.com/api/v4/quran/translations/20?chapter_number=$n" -o $fe
    }
}

# ---------- normalize Arabic word for glossary lookup ----------
function Norm([string]$s) {
    $s = $s -replace '[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u08F0-\u08FF]', ''
    $s = $s -replace '\u0671', [string][char]0x0627
    return $s.Trim()
}

# ---------- load authored content (if exists) ----------
$content = $null
$cfile = Join-Path $root 'content-ru.json'
if (Test-Path $cfile) {
    $content = Get-Content -Raw -Encoding UTF8 $cfile | ConvertFrom-Json
}

# ---------- parse surahs ----------
$tokenOrder = New-Object System.Collections.ArrayList
$tokenInfo  = @{}
$stories    = New-Object System.Collections.ArrayList

foreach ($n in $nums) {
    $j = Get-Content -Raw -Encoding UTF8 (Join-Path $cache "q$n.json") | ConvertFrom-Json
    $sentences = New-Object System.Collections.ArrayList
    foreach ($v in $j.verses) {
        $words = New-Object System.Collections.ArrayList
        $arParts = New-Object System.Collections.ArrayList
        foreach ($w in $v.words) {
            if ($w.char_type_name -ne 'word') { continue }
            $k = Norm $w.text_uthmani
            if (!$tokenInfo.ContainsKey($k)) {
                $tr = $w.transliteration
                if ($tr -and $tr -isnot [string]) { $tr = $tr.text }
                $tokenInfo[$k] = @{ ar = $w.text_uthmani; tr = [string]$tr; count = 0 }
                [void]$tokenOrder.Add($k)
            }
            $tokenInfo[$k].count++
            $tr2 = $w.transliteration
            if ($tr2 -and $tr2 -isnot [string]) { $tr2 = $tr2.text }
            [void]$words.Add(@{
                w     = $w.text_uthmani
                tr    = [string]$tr2
                key   = $k
                audio = ("https://audio.qurancdn.com/" + $w.audio_url)
            })
            [void]$arParts.Add($w.text_uthmani)
        }
        [void]$sentences.Add(@{
            ayah      = [int]$v.verse_number
            ayahNumber= [int]$v.id
            ayahAudio = ("https://cdn.islamic.network/quran/audio/128/ar.alafasy/" + $v.id + ".mp3")
            ar        = ($arParts -join ' ')
            ru        = ''
            words     = $words
        })
    }
    # English (Sahih International): merge by verse order, strip HTML markup
    $fe = Join-Path $cache ("q$n-en.json")
    if (Test-Path $fe) {
        $en = (Get-Content -Raw -Encoding UTF8 $fe | ConvertFrom-Json).translations
        if ($en -and $en.Count -eq $sentences.Count) {
            for ($i = 0; $i -lt $sentences.Count; $i++) {
                $t = [string]$en[$i].text
                $t = $t -replace '<sup[^>]*>.*?</sup>', ''
                $t = $t -replace '<[^>]+>', ''
                $t = $t -replace '&nbsp;', ' '
                $t = $t -replace '&amp;', '&'
                $t = $t -replace '&lt;', '<'
                $t = $t -replace '&gt;', '>'
                $t = $t -replace '&quot;', '"'
                $t = $t -replace '&#39;', "'"
                $sentences[$i].en = $t.Trim()
            }
        }
    }
    [void]$stories.Add(@{ n = $n; sentences = $sentences })
}

# ---------- phase A: token report ----------
$report = New-Object System.Collections.ArrayList
foreach ($k in $tokenOrder) {
    $i = $tokenInfo[$k]
    [void]$report.Add(("{0}`t{1}`t{2}`t{3}" -f $k, $i.ar, $i.tr, $i.count))
}
[System.IO.File]::WriteAllText((Join-Path $root 'tokens-report.txt'), (($report -join "`n") + "`n"), [System.Text.Encoding]::UTF8)

$ayahCount = ($stories | ForEach-Object { $_.sentences.Count } | Measure-Object -Sum).Sum
$wordCount = 0; foreach ($k in $tokenOrder) { $wordCount += $tokenInfo[$k].count }
Write-Output ("OK: {0} surahs, {1} ayat, {2} word tokens, {3} unique words" -f $stories.Count, $ayahCount, $wordCount, $tokenOrder.Count)

# ---------- phase B: emit data ----------
if ($null -eq $content) {
    Write-Output "PHASE A done. Author tools/content-ru.json, then re-run."
    exit 0
}

$missingTokens = New-Object System.Collections.ArrayList
$missingAyat   = New-Object System.Collections.ArrayList
$skippedSurahs = New-Object System.Collections.ArrayList

foreach ($st in $stories) {
    $st.missing = 0
    foreach ($s in $st.sentences) {
        $akey = ("{0}:{1}" -f $st.n, $s.ayah)
        $ap = $content.ayatRu.PSObject.Properties[$akey]
        $ru = $null
        if ($ap) { $ru = $ap.Value }
        if (-not $ru) { [void]$missingAyat.Add($akey); $st.missing++ }
        $s.ru = [string]$ru
        for ($i = 0; $i -lt $s.words.Count; $i++) {
            $k = $s.words[$i].key
            $gp = $content.gloss.PSObject.Properties[$k]
            $g = $null
            if ($gp) { $g = $gp.Value }
            $w = $s.words[$i]
            if ($null -eq $g -or -not $g[0]) {
                [void]$missingTokens.Add($k)
                $st.missing++
                $w.ru = '(?)'
            } else {
                $w.ru = [string]$g[0]
            }
            if ($null -ne $g -and $g.Count -ge 2 -and $g[1]) { $w.root = [string]$g[1] }
            if ($null -ne $g -and $g.Count -ge 3 -and $g[2]) { $w.pos = [string]$g[2] }
            if ($null -ne $g -and $g.Count -ge 4 -and $g[3]) { $w.def = [string]$g[3] }
        }
    }
}

$final = New-Object System.Collections.ArrayList
foreach ($st in $stories) {
    $n = $st.n
    $tp = $content.titlesAr.PSObject.Properties["$n"]
    $tr = $content.titlesRu.PSObject.Properties["$n"]
    $titleAr = ''
    $titleRu = ''
    if ($tp) { $titleAr = [string]$tp.Value }
    if ($tr) { $titleRu = [string]$tr.Value }
    # Skip surahs with incomplete content (gradual authoring support)
    if ($st.missing -gt 0 -or -not $titleAr -or -not $titleRu) {
        [void]$skippedSurahs.Add($n)
        continue
    }
    $ac = $st.sentences.Count
    [void]$final.Add([ordered]@{
        id          = "q$n"
        surahNo     = $n
        title       = $titleAr
        titleRu     = $titleRu
        level       = ''
        intro       = [string]$content.intro
        surahAudio  = ("https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/$n.mp3")
        basmala     = [string]$content.basmala
        basmalaRu   = [string]$content.basmalaRu
        sentences   = $st.sentences
    })
}

# level: Russian prefix + ayah count with correct plural form
for ($i = 0; $i -lt $final.Count; $i++) {
    $ac = $final[$i].sentences.Count
    $ayatWord = [string]$content.ayatWord5
    if ($ac -ge 2 -and $ac -le 4) { $ayatWord = [string]$content.ayatWord2 }
    $final[$i].level = ([string]$content.levelPrefix + " · " + $ac + " " + $ayatWord)
}

$payload = ConvertTo-Json $final -Depth 10
$outJs = "// AUTO-GENERATED by tools/build-juz30.ps1 - do not edit by hand." + "`r`n" +
         "// Sources: quran.com API (text, transliteration, word audio), tools/content-ru.json (Russian)." + "`r`n" +
         "(function(){ var S = " + $payload + "; S.forEach(function(s){ STORIES_DATA.stories.push(s); }); })();"
[System.IO.File]::WriteAllText((Join-Path $proj 'js\data-juz30.js'), $outJs, (New-Object System.Text.UTF8Encoding($false)))

if ($skippedSurahs.Count -gt 0) {
    Write-Output ("SKIPPED surahs (incomplete content, not emitted): {0}" -f ($skippedSurahs -join ', '))
}
if ($missingTokens.Count -eq 0 -and $missingAyat.Count -eq 0) {
    Write-Output ("PHASE B done: js/data-juz30.js emitted ({0} surahs), no missing entries." -f $final.Count)
} else {
    Write-Output ("MISSING tokens: {0}; MISSING ayat: {1}" -f ($missingTokens | Select-Object -Unique).Count, $missingAyat.Count)
    $m = New-Object System.Collections.ArrayList
    foreach ($k in ($missingTokens | Select-Object -Unique)) { [void]$m.Add($k) }
    foreach ($a in $missingAyat) { [void]$m.Add("AYAT $a") }
    [System.IO.File]::WriteAllText((Join-Path $root 'missing-report.txt'), (($m -join "`n") + "`n"), [System.Text.Encoding]::UTF8)
}
