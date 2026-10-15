// ============================================================
//  «Золотые чернила» — игровая валюта усердия.
//  Уровень «пути писца» — ОДИН на Основу (режим): «Ислам» и
//  «Арабский язык». Чернила при этом копятся по разделам
//  (Коран, Хадисы, Хифз, Хуна Арабия 1/2 …) — это разбивка
//  внизу окна «Уровни», без отдельных уровней у разделов.
//  Хранилище (глобальное): arabic-reader-ink-v1
//  { by: { <раздел>: число }, legacyBy: { <основа>: число },
//    legacy: 0, bootstrapped: bool }
//  legacyBy — «ранее накопленное»: заслуги до разделения по
//  разделам (пересчитаны из журналов активности при первом
//  запуске и разнесены по Основам по следу в этих журналах).
// ============================================================

const INK = (() => {
  const KEY = 'arabic-reader-ink-v1';
  const ACT_BASE = 'arabic-reader-activity-v1';

  // Путь писца: порог ступени в чернилах (один для всех Основ)
  const LEVELS = [
    { min: 0,    name: 'Новичок' },
    { min: 150,  name: 'Ученик' },
    { min: 450,  name: 'Читающий' },
    { min: 1000, name: 'Знающий' },
    { min: 2000, name: 'Умелый' },
    { min: 3500, name: 'Опытный' },
    { min: 6000, name: 'Мастер' }
  ];

  // Начисления
  const P = {
    correct: 2,     // верный ответ (тренажёр / повторение)
    comboEvery: 5,  // серия верных ответов подряд в сессии…
    comboBonus: 5,  // …даёт бонус на каждом кратном
    learned: 10,    // слово выучено (достигнут порог learnStreak)
    build: 8,       // сборка аята/фразы без ошибок
    session: 15,    // завершённая сессия/тренировка
    ayah: 3         // аят хифза оценён не «Не помню»
  };

  // Разделы, в которых копятся чернила (по Основам)
  const SECTIONS = {
    islam: [
      { id: 'quran',   label: 'Коран' },
      { id: 'hadith',  label: 'Хадисы' },
      { id: 'stories', label: 'Истории' },
      { id: 'adhkar',  label: 'Азкары' },
      { id: 'routes',  label: 'Намаз' },
      { id: 'hifz',    label: 'Хифз' }
    ],
    arabic: [
      { id: 'huna1', label: 'Хуна Арабия 1 Том' },
      { id: 'huna2', label: 'Хуна Арабия 2 Том' }
    ]
  };
  const OTHER = { id: 'other', label: 'Прочее' };
  const MODE_FALLBACK = { islam: 'Ислам', arabic: 'Арабский язык' };

  // тип текста → id раздела
  const TYPE_SECTION = {
    quran: 'quran', hadith: 'hadith', story: 'stories',
    adhkar: 'adhkar', namaz: 'routes', huna1: 'huna1', huna2: 'huna2'
  };

  let cache = null;      // { by, legacyBy, legacy, bootstrapped }
  let lastMark = null;   // чернила на момент метки начала сессии
  let levelUpPending = null;

  /** Основа по id раздела (null — раздел не привязан к Основе). */
  function modeOfSection(sid) {
    for (const m of Object.keys(SECTIONS)) {
      if (SECTIONS[m].some(s => s.id === sid)) return m;
    }
    return null;
  }

  function modeIds() {
    return (typeof MODES !== 'undefined') ? Object.keys(MODES) : Object.keys(SECTIONS);
  }

  function modeLabel(mid) {
    if (typeof MODES !== 'undefined' && MODES[mid] && MODES[mid].title) return MODES[mid].title;
    return MODE_FALLBACK[mid] || mid;
  }

  /** Чернила, выведенные из журнала активности Основы (для разноски «ранее накопленного»). */
  function journalMerit(mid) {
    const k = mid === 'islam' ? ACT_BASE : ACT_BASE + '__' + mid;
    let m = 0;
    try {
      const a = JSON.parse(localStorage.getItem(k));
      if (a && a.days) {
        Object.values(a.days).forEach(d => {
          if (!d) return;
          m += ((d.correct || 0) * P.correct) + ((d.trainings || 0) * P.session);
        });
      }
    } catch (e) { /* повреждён — пропускаем */ }
    return m;
  }

  /** Разнести «ранее накопленное» по Основам, сохранив общую сумму. */
  function splitLegacy(L) {
    const ids = modeIds();
    const out = {};
    L = Math.max(0, Math.round(L || 0));
    if (!L) { ids.forEach(id => { out[id] = 0; }); return out; }
    const merits = {};
    let sum = 0;
    ids.forEach(id => { merits[id] = journalMerit(id); sum += merits[id]; });
    if (!sum) {
      ids.forEach((id, i) => { out[id] = i === 0 ? L : 0; });
      return out;
    }
    let left = L;
    ids.forEach((id, i) => {
      const share = (i === ids.length - 1) ? left : Math.round(L * merits[id] / sum);
      out[id] = Math.max(0, Math.min(left, share));
      left -= out[id];
    });
    return out;
  }

  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) { cache = {}; }
    if (!cache.by || typeof cache.by !== 'object') cache.by = {};
    // миграция старого формата { ink } → «ранее накопленное»
    if (typeof cache.ink === 'number' && isFinite(cache.ink)) {
      cache.legacy = (cache.legacy || 0) + Math.max(0, Math.round(cache.ink));
      delete cache.ink;
    }
    if (typeof cache.legacy !== 'number' || !isFinite(cache.legacy) || cache.legacy < 0) cache.legacy = 0;
    if (!cache.bootstrapped) {
      // одноразовый старт: прошлые заслуги из журналов активности всех Основ
      let past = 0;
      modeIds().forEach(id => { past += journalMerit(id); });
      cache.legacy += Math.max(0, Math.round(past));
      cache.bootstrapped = true;
      save();
    }
    // миграция: уровень теперь один на Основу — «ранее накопленное» разносим по Основам
    if (!cache.legacyBy || typeof cache.legacyBy !== 'object') {
      cache.legacyBy = splitLegacy(cache.legacy);
      cache.legacy = 0;
      save();
    }
    modeIds().forEach(id => {
      if (typeof cache.legacyBy[id] !== 'number' || !isFinite(cache.legacyBy[id])) cache.legacyBy[id] = 0;
    });
    return cache;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* не критично */ }
  }

  /** Раздел по типу текста ('quran'|'hadith'|'story'|'adhkar'|'namaz'|'huna1'|'huna2'). */
  function sectionForType(type) {
    return TYPE_SECTION[type] || OTHER.id;
  }

  /** Раздел по объекту текста (story). */
  function sectionForStory(story) {
    return story ? sectionForType(story.type || 'quran') : OTHER.id;
  }

  /** Самый частый раздел в списке (для бонуса за завершённую сессию). */
  function dominantSection(ids) {
    const counts = {};
    (ids || []).forEach(s => { if (s) counts[s] = (counts[s] || 0) + 1; });
    let best = null, n = 0;
    Object.entries(counts).forEach(([s, c]) => { if (c > n) { n = c; best = s; } });
    return best;
  }

  /** Человекочитаемое имя раздела. */
  function sectionLabel(id) {
    for (const m of Object.keys(SECTIONS)) {
      const found = SECTIONS[m].find(s => s.id === id);
      if (found) return found.label;
    }
    return OTHER.label;
  }

  /** Добавить чернила в раздел (section — id раздела; без него — «Прочее»). */
  function add(n, section) {
    n = Math.round(n);
    if (!n || n <= 0) return total();
    const c = load();
    const sid = section || OTHER.id;
    const mid = modeOfSection(sid);
    const before = levelIndex(mid ? modeInk(mid) : inkOf(sid));
    c.by[sid] = (c.by[sid] || 0) + n;
    save();
    if (mid) {
      const after = levelIndex(modeInk(mid));
      if (after > before) {
        levelUpPending = { mode: mid, name: LEVELS[after].name };
        toast();
      }
    }
    return c.by[sid];
  }

  /** Чернила одного раздела. */
  function inkOf(section) { return load().by[section] || 0; }

  /** «Ранее накопленное» по Основам: { <основа>: число }. */
  function legacyBy() {
    const c = load();
    const out = {};
    Object.keys(c.legacyBy).forEach(k => { out[k] = c.legacyBy[k] || 0; });
    return out;
  }

  /** «Ранее накопленное» в одной Основе. */
  function legacyOf(mode) {
    const m = mode || currentMode();
    return load().legacyBy[m] || 0;
  }

  /** «Ранее накопленное» всего (по всем Основам). */
  function legacyTotal() {
    let sum = 0;
    Object.values(load().legacyBy).forEach(v => { sum += (v || 0); });
    return sum;
  }

  function currentMode() {
    return (typeof getMode === 'function') ? getMode() : 'islam';
  }

  /**
   * Чернила Основы: сумма её разделов + «ранее накопленное» этой Основы.
   * По этому числу считается единственный уровень «пути писца».
   */
  function modeInk(mode) {
    const m = mode || currentMode();
    const list = SECTIONS[m] || SECTIONS.islam;
    let sum = load().legacyBy[m] || 0;
    list.forEach(s => { sum += inkOf(s.id); });
    return sum;
  }

  /** Уровень Основы (чистая функция от её чернил). */
  function modeLevel(mode) {
    return levelInfo(modeInk(mode));
  }

  /** Всего чернил (все разделы + «ранее накопленное»). */
  function total() {
    const c = load();
    let sum = 0;
    Object.values(c.by).forEach(v => { sum += (v || 0); });
    Object.values(c.legacyBy).forEach(v => { sum += (v || 0); });
    return sum;
  }

  /** Индекс уровня для произвольного числа чернил (чистая функция). */
  function levelIndex(ink) {
    let i = 0;
    for (let j = 0; j < LEVELS.length; j++) if (ink >= LEVELS[j].min) i = j;
    return i;
  }

  /** Уровень и прогресс по числу чернил (чистая функция). */
  function levelInfo(ink) {
    ink = Math.max(0, Math.round(ink || 0));
    const i = levelIndex(ink);
    const cur = LEVELS[i];
    const next = LEVELS[i + 1] || null;
    const pct = next
      ? Math.min(100, Math.round((ink - cur.min) / (next.min - cur.min) * 100))
      : 100;
    return {
      name: cur.name,
      index: i,
      pct,
      nextName: next ? next.name : null,
      nextMin: next ? next.min : null,
      toNext: next ? (next.min - ink) : 0
    };
  }

  /** Обе Основы с их чернилами и уровнем: [{id, title, ink, level}]. */
  function modes() {
    return modeIds().map(mid => {
      const ink = modeInk(mid);
      return { id: mid, title: modeLabel(mid), ink, level: levelInfo(ink) };
    });
  }

  /** Разделы Основы с их чернилами: [{id, label, ink}] — без уровней. */
  function sectionInkList(mode) {
    const m = mode || currentMode();
    const list = SECTIONS[m] || SECTIONS.islam;
    return list.map(s => ({ id: s.id, label: s.label, ink: inkOf(s.id) }));
  }

  /** Разбивка по разделам для окна «Уровни»: [{mode, title, ink, sections}]. */
  function breakdown() {
    return modeIds().map(mid => ({
      mode: mid,
      title: modeLabel(mid),
      ink: modeInk(mid),
      sections: sectionInkList(mid)
    }));
  }

  /** Метка начала сессии: прирост показывается в конце. */
  function mark() { lastMark = total(); }

  /** Чернила, начисленные с последней метки. */
  function sinceMark() {
    return lastMark === null ? 0 : Math.max(0, total() - lastMark);
  }

  /** Ненавязчивое уведомление о новом уровне (самоустраняется). */
  function toast() {
    if (!levelUpPending || typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'ink-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = 'Новый уровень: <b></b><span class="ink-toast-sec"></span>';
    el.querySelector('b').textContent = levelUpPending.name;
    el.querySelector('.ink-toast-sec').textContent = ' · ' + modeLabel(levelUpPending.mode);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4600);
  }

  return {
    P, LEVELS, SECTIONS, OTHER,
    add, total, inkOf, legacyBy, legacyOf, legacyTotal,
    levelInfo, levelIndex, modeInk, modeLevel, modes, sectionInkList,
    modeOfSection, modeLabel, currentMode,
    breakdown, sectionForType, sectionForStory, sectionLabel, dominantSection,
    mark, sinceMark
  };
})();
