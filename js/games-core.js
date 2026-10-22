/**
 * Ядро игр — чистые функции без DOM (как words-core.js), покрыты тестами selftest.
 * Подключается ПОСЛЕ words-core.js и ДО games.js.
 *
 * Первая игра — «Мемори+»: пары «слово ↔ перевод» (или «пропуск ↔ слово»),
 * затем закрепление — собрать слово из букв по переводу.
 */

/** Допустимые размеры доски «Мемори» (пар). */
const GAME_MEMORY_SIZES = [6, 8];

/** Перемешать копию массива (Fisher–Yates; rng подменяется в тестах). */
function gameShuffle(arr, rng) {
  const a = (arr || []).slice();
  const r = typeof rng === 'function' ? rng : Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * Пул пар для «Мемори» из элементов [{word, sentence, gapIndex}].
 * Отбрасываем: имена собственные и цифры (isStudyableWord), слова без перевода
 * и повторы по переводу — иначе пара на доске неоднозначна.
 */
function gamePairPool(items) {
  const out = [];
  const seenRu = new Set();
  (items || []).forEach(it => {
    const w = it && it.word;
    if (!w || !w.w) return;
    if (typeof isStudyableWord === 'function' && !isStudyableWord(w)) return;
    const ru = String(w.ru || '').trim();
    if (!ru) return;
    const key = ru.toLowerCase();
    if (seenRu.has(key)) return;
    seenRu.add(key);
    out.push({ word: w, sentence: it.sentence || null, gapIndex: it.gapIndex, ru: ru });
  });
  return out;
}

/** Предложение с пропуском вместо слова gapIndex (режим «пропуск ↔ слово»). */
function gameGapSentence(sentence, gapIndex) {
  const words = (sentence && sentence.words) || [];
  const i = (gapIndex == null) ? -1 : gapIndex;
  if (i < 0 || i >= words.length) return (sentence && (sentence.ru || '')) || '';
  return words.map((w, k) => (k === i ? '_____' : (w && w.w) || '')).join(' ');
}

/**
 * Доска «Мемори»: массив карточек
 *   { pairId, kind: 'ar'|'ru', text, rtl }
 * kind 'ar' — арабское слово; 'ru' — перевод или предложение с пропуском.
 */
function gameBuildBoard(pairs, size, mode, rng) {
  const n = Math.max(2, Math.min(size || 6, (pairs || []).length));
  const chosen = gameShuffle(pairs, rng).slice(0, n);
  const cards = [];
  chosen.forEach((p, i) => {
    const disp = (typeof wordDisplay === 'function') ? wordDisplay(p.word.w) : p.word.w;
    cards.push({ pairId: i, kind: 'ar', text: disp, rtl: true });
    const useGap = mode === 'gap' && p.sentence;
    cards.push({
      pairId: i,
      kind: 'ru',
      text: useGap ? gameGapSentence(p.sentence, p.gapIndex) : p.ru,
      rtl: !!useGap
    });
  });
  return gameShuffle(cards, rng);
}

/** Буквы слова без огласовок и пунктуации (для сборки слова). */
function gameWordLetters(text) {
  return String(text || '')
    .replace(/[\u064B-\u0653\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[\u060C\u061B\u061F\u06D4\u066B\u066C،؛؟.,!?«»"'()]/g, '')
    .replace(/\s+/g, '')
    .split('');
}

/** Перемешанные буквы для сборки (по возможности не в исходном порядке). */
function gameScramble(text, rng) {
  const letters = gameWordLetters(text);
  if (letters.length < 2) return letters;
  let out = gameShuffle(letters, rng);
  const target = letters.join('');
  for (let k = 0; k < 6 && out.join('') === target; k++) out = gameShuffle(out, rng);
  return out;
}

/** Правильно ли собрано слово (сравнение без огласовок). */
function gameAssemblyCorrect(letters, answer) {
  const got = gameWordLetters(Array.isArray(letters) ? letters.join('') : letters).join('');
  return got.length > 0 && got === gameWordLetters(answer).join('');
}

/** Что спросить на закреплении: сначала слова с бо́льшим числом ошибок. */
function gameRecallWords(pairs, mistakes, count) {
  const m = mistakes || {};
  return (pairs || [])
    .slice()
    .sort((a, b) => (m[b.word.w] || 0) - (m[a.word.w] || 0))
    .slice(0, count == null ? 3 : count);
}

/** Рекорд лучше? Меньше время, при равенстве — меньше ходов. */
function gameRecordBetter(prev, next) {
  if (!prev) return true;
  if (!next) return false;
  const ps = +prev.seconds || 0, ns = +next.seconds || 0;
  if (ns !== ps) return ns < ps;
  return (+next.moves || 0) < (+prev.moves || 0);
}

/** Ключ рекорда: отдельно для источника (том/глава/невыученные), режима и размера. */
function gameRecordKey(sourceId, mode, size) {
  return String(sourceId || '*') + '|' + mode + ':' + size;
}
