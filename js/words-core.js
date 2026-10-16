// ============================================================
//  Ядро разделов «Слова» и «Грамматика»: нормализация формы,
//  группировка слов главы и определение статуса изучения,
//  привязка заметок грамматики к главам курса.
//  Чистые функции без DOM — используются страницей (js/app.js)
//  и самопроверкой (selftest.html).
//  Загружается ПОСЛЕ data-*.js и ДО app.js.
// ============================================================

// Те же безопасные диакритики, что и в режимах огласовок app.js:
// U+064B–U+0653, U+0670, U+06D6–U+06ED. Хамза U+0654/U+0655 НЕ удаляется
// (меняет слово), поэтому в диапазон не входит.
const WORDS_HARAKAT_RE = /[\u064B-\u0653\u0670\u06D6-\u06ED]/g;
const WORDS_PUNCT_RE = /[\u061F\u060C\u061B\u066B\u066C.!?«»"'()\[\]…\-—–]/g;

const WORD_STATUS_LABEL = { learned: 'Выучено', learning: 'Учу', new: 'Не начато' };

/** Нормализованная форма слова для группировки (без огласовок и пунктуации). */
function wordsNorm(text) {
  return String(text || '').replace(WORDS_HARAKAT_RE, '').replace(WORDS_PUNCT_RE, '').trim();
}

// Обрамляющая пунктуация слова (арабская и обычная) — в тексте она нужна
// (запятая, вопросительный знак), но в тренажёре и списках слово показывается
// отдельно, и знак там лишний.
const WORDS_EDGE_PUNCT_RE = /^[\s\u061F\u060C\u061B\u066B\u066C.!?«»"'()\[\]…\-—–]+|[\s\u061F\u060C\u061B\u066B\u066C.!?«»"'()\[\]…\-—–]+$/g;

/**
 * Слово для показа ОТДЕЛЬНО от текста (варианты в тренажёре, карточка слова,
 * списки слов, карточка повторения): без обрамляющей пунктуации.
 * В самих текстах `w` остаётся точным — иначе ломается склейка words[].w = ar.
 */
function wordDisplay(text) {
  return String(text == null ? '' : text).replace(WORDS_EDGE_PUNCT_RE, '').trim();
}

/**
 * Статус слова по всем встреченным формам: 'learned' | 'learning' | 'new'.
 * learned — серия верных ответов достигла порога (lim) или SRS-карточка в review;
 * learning — по слову уже были ответы, но порог не достигнут.
 */
function wordStudyStatus(tokens, stats, cards, lim) {
  let learned = false, learning = false;
  tokens.forEach(t => {
    const e = stats[t];
    if (e) {
      if ((e.streak || 0) >= lim) learned = true;
      else if ((e.c || 0) + (e.w || 0) > 0) learning = true;
    }
    const c = cards[t];
    if (c) {
      if (c.state === 'review' && (c.repetitions || 0) >= 2) learned = true;
      else if ((c.totalAnswers || 0) > 0 || c.state === 'learning' || c.state === 'relearning' || c.state === 'review') learning = true;
    }
  });
  return learned ? 'learned' : (learning ? 'learning' : 'new');
}

/**
 * Основа слова (лемма) для группировки форм одного слова:
 * أُخْتِي / أُخْتُكُمْ / وَالْأُخْتِ → أُخْت (поле `base` из импортёра).
 * Если основы нет — форма остаётся сама собой.
 */
function wordBase(word) {
  if (!word) return '';
  if (typeof word === 'string') return word;
  return word.base || word.w || '';
}

/** Ключ группировки: нормализованная основа (или сама форма). */
function wordBaseKey(word) {
  return wordsNorm(wordBase(word));
}

/**
 * Слово-основа для показа и тренажёра: та же форма, но с основой вместо
 * аффиксной формы (أُخْتُكُمْ → أُخْت «сестра»). Без основы возвращается как есть.
 */
function baseWord(word) {
  if (!word || !word.w) return word;
  if (!word.base) return word;
  const out = { w: word.base };
  const tr = word.baseTr || word.tr;
  const ru = word.baseRu || word.ru;
  if (tr) out.tr = tr;
  if (ru) out.ru = ru;
  if (word.pos) out.pos = word.pos;
  const root = word.baseRoot || word.root;
  if (root) out.root = root;
  if (word.audio) out.audio = word.audio;
  return out;
}

/**
 * Карта «основа слова → id главы, где слово встречается ВПЕРВЫЕ».
 * Главы курса идут сквозной нумерацией (1…16 по обоим томам), поэтому слово
 * принадлежит ровно одной главе — в остальных оно уже не «новое».
 */
function wordOwnerMap(books) {
  const list = books || ((typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books : []);
  const chapters = [];
  list.forEach((b, bi) => (b.chapters || []).forEach(ch => chapters.push({ ch, bi })));
  chapters.sort((a, b) => ((a.ch.no ?? 0) - (b.ch.no ?? 0)) || (a.bi - b.bi));
  const map = new Map();
  const note = (w, chId) => {
    const k = wordBaseKey(w);
    if (k && !map.has(k)) map.set(k, chId);
  };
  chapters.forEach(({ ch }) => {
    (ch.dialogues || []).forEach(d => (d.sentences || []).forEach(s => (s.words || []).forEach(w => note(w, ch.id))));
    (ch.words || []).forEach(w => note(w, ch.id));
  });
  return map;
}

/**
 * Уникальные слова главы (из диалогов/текстов + словарь главы),
 * сгруппированные по ОСНОВЕ слова: аффиксные формы одной леммы
 * (أُخْتِي / أُخْتُكُمْ / وَالْأُخْتِ) дают одну запись «أخت — сестра».
 * Возвращает [{key, w, tr, ru, pos, tokens, status}].
 * Если передан ownerMap — остаются только слова, впервые встречающиеся в ЭТОЙ главе
 * (иначе одно и то же слово «училось» бы заново в каждой следующей главе).
 */
function chapterWordEntries(ch, stats, cards, lim, ownerMap) {
  const map = new Map();
  const add = (w) => {
    if (!w || !w.w) return;
    const key = wordBaseKey(w);
    if (!key) return;
    const base = wordBase(w);
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        w: base,
        tr: w.baseTr || w.tr || '',
        ru: w.baseRu || w.ru || '',
        pos: w.pos || w.gender || '',
        root: w.baseRoot || w.root || '',
        tokens: []
      };
      map.set(key, e);
    }
    if (e.tokens.indexOf(w.w) < 0) e.tokens.push(w.w);
    // в tokens входит и сама основа: тренажёр записывает результат по ней
    if (e.tokens.indexOf(base) < 0) e.tokens.push(base);
    if (!e.ru && (w.baseRu || w.ru)) e.ru = w.baseRu || w.ru;
    if (!e.tr && (w.baseTr || w.tr)) e.tr = w.baseTr || w.tr;
    if (!e.pos && (w.pos || w.gender)) e.pos = w.pos || w.gender;
    if (!e.root && (w.baseRoot || w.root)) e.root = w.baseRoot || w.root;
  };
  (ch.dialogues || []).forEach(d => (d.sentences || []).forEach(s => (s.words || []).forEach(add)));
  (ch.words || []).forEach(add);
  let list = [...map.values()];
  if (ownerMap) list = list.filter(e => ownerMap.get(e.key) === ch.id);
  list.forEach(e => { e.status = wordStudyStatus(e.tokens, stats, cards, lim); });
  list.sort((a, b) => a.w.localeCompare(b.w, 'ar'));
  return list;
}

/**
 * Заметки грамматики, сгруппированные по главам курса («что и когда проходили»).
 * Возвращает [{id, no, tom, titleRu, titleAr, notes}] — главы по возрастанию номера;
 * заметки без главы (tom/chapter = 0) идут последней группой «Общее».
 */
function grammarGroups() {
  const notes = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.grammar) ? HUNA_DATA.grammar : [];
  const byNo = new Map();
  const general = [];
  notes.forEach(g => {
    const no = g.chapter || 0;
    if (!no) { general.push(g); return; }
    if (!byNo.has(no)) byNo.set(no, []);
    byNo.get(no).push(g);
  });
  const chInfo = new Map(); // no -> { ch, tom }
  ((typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books : [])
    .forEach((b, i) => (b.chapters || []).forEach(c => {
      if (!chInfo.has(c.no)) chInfo.set(c.no, { ch: c, tom: i + 1 });
    }));
  const groups = [];
  [...byNo.keys()].sort((a, b) => a - b).forEach(no => {
    const info = chInfo.get(no);
    groups.push({
      id: 'gram-ch-' + no,
      no,
      tom: info ? info.tom : null,
      titleRu: info ? (info.ch.titleRu || '') : '',
      titleAr: info ? (info.ch.titleAr || '') : '',
      notes: byNo.get(no)
    });
  });
  if (general.length) {
    groups.push({ id: 'gram-ch-0', no: 0, tom: null, titleRu: 'Общее (без привязки к главе)', titleAr: '', notes: general });
  }
  return groups;
}

/** Источник тренировки по id: обычный текст или глава «Хуна Арабия» (chapter:<id>). */
function resolveStudySource(sourceId) {
  if (sourceId && sourceId.indexOf('chapter:') === 0) {
    const chId = sourceId.slice('chapter:'.length);
    const books = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books : [];
    for (const b of books) {
      const ch = (b.chapters || []).find(c => c.id === chId);
      if (ch) {
        const sentences = [];
        (ch.dialogues || []).forEach(d => (d.sentences || []).forEach(s => sentences.push(s)));
        return { id: sourceId, type: b.id, title: ch.titleAr || '', titleRu: `Глава ${ch.no}. ${ch.titleRu || ''}`.trim(), sentences, chapterId: ch.id };
      }
    }
    return null;
  }
  if (typeof STORIES_DATA === 'undefined') return null;
  return STORIES_DATA.stories.find(s => s.id === sourceId) || null;
}

/**
 * «Оживающая рукопись»: сколько сегментов-«слов» на листе главы подсвечено
 * золотом. Доля выученных слов → количество горящих штрихов (с округлением),
 * 0 при пустой главе, потолок — segments.
 */
function manuscriptDashes(learned, all, segments) {
  if (!segments || segments <= 0) return 0;
  if (!all || all <= 0 || learned <= 0) return 0;
  const n = Math.round((learned / all) * segments);
  return Math.max(0, Math.min(segments, n));
}
