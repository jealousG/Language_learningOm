// ============================================================
//  «Золотые чернила» — игровая валюта усердия, отдельно по разделам.
//  В каждом разделе (Коран, Хадисы, Хифз, Хуна Арабия 1/2 …) свои
//  чернила и свой уровень «пути писца»; начисления не тратятся.
//  Хранилище (глобальное): arabic-reader-ink-v1
//  { by: { <раздел>: число }, legacy: число, bootstrapped: bool }
//  legacy — чернила, накопленные до разделения по разделам (и
//  пересчитанные из журналов активности при первом запуске).
// ============================================================

const INK = (() => {
  const KEY = 'arabic-reader-ink-v1';
  const ACT_BASE = 'arabic-reader-activity-v1';

  // Путь писца: порог уровня в чернилах (один для всех разделов)
  const LEVELS = [
    { min: 0,    name: 'Ученик' },
    { min: 150,  name: 'Переписчик' },
    { min: 450,  name: 'Калист' },
    { min: 1000, name: 'Чтец' },
    { min: 2000, name: 'Хранитель слов' },
    { min: 3500, name: 'Толкователь' },
    { min: 6000, name: 'Мастер письма' }
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

  // Разделы, в которых копятся чернила (по режимам)
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

  // тип текста → id раздела
  const TYPE_SECTION = {
    quran: 'quran', hadith: 'hadith', story: 'stories',
    adhkar: 'adhkar', namaz: 'routes', huna1: 'huna1', huna2: 'huna2'
  };

  let cache = null;      // { by, legacy, bootstrapped }
  let lastMark = null;   // чернила на момент метки начала сессии
  let levelUpPending = null;

  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) { cache = {}; }
    if (!cache.by || typeof cache.by !== 'object') cache.by = {};
    // миграция старого формата { ink } → legacy
    if (typeof cache.ink === 'number' && isFinite(cache.ink)) {
      cache.legacy = (cache.legacy || 0) + Math.max(0, Math.round(cache.ink));
      delete cache.ink;
    }
    if (typeof cache.legacy !== 'number' || !isFinite(cache.legacy) || cache.legacy < 0) cache.legacy = 0;
    if (!cache.bootstrapped) {
      // одноразовый старт: прошлые заслуги из журналов активности всех режимов
      let past = 0;
      const modes = (typeof MODES !== 'undefined') ? Object.keys(MODES) : ['islam'];
      modes.forEach(id => {
        const k = id === 'islam' ? ACT_BASE : ACT_BASE + '__' + id;
        try {
          const a = JSON.parse(localStorage.getItem(k));
          if (a && a.days) {
            Object.values(a.days).forEach(d => {
              if (!d) return;
              past += ((d.correct || 0) * P.correct) + ((d.trainings || 0) * P.session);
            });
          }
        } catch (e) { /* повреждён — пропускаем */ }
      });
      cache.legacy += Math.max(0, Math.round(past));
      cache.bootstrapped = true;
      save();
    }
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
    const before = levelIndex(c.by[sid] || 0);
    c.by[sid] = (c.by[sid] || 0) + n;
    save();
    if (levelIndex(c.by[sid]) > before) {
      levelUpPending = { section: sid, name: LEVELS[levelIndex(c.by[sid])].name };
      toast();
    }
    return c.by[sid];
  }

  /** Чернила одного раздела. */
  function inkOf(section) { return load().by[section] || 0; }

  /** Чернила, накопленные до разделения по разделам. */
  function legacy() { return load().legacy; }

  /** Всего чернил (по всем разделам + ранее накопленное). */
  function total() {
    const c = load();
    let sum = c.legacy;
    Object.values(c.by).forEach(v => { sum += (v || 0); });
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
      toNext: next ? (next.min - ink) : 0
    };
  }

  /** Разделы режима с их чернилами и уровнем: [{id, label, ink, level}]. */
  function sections(mode) {
    const m = mode || ((typeof getMode === 'function') ? getMode() : 'islam');
    const list = SECTIONS[m] || SECTIONS.islam;
    return list.map(s => {
      const ink = inkOf(s.id);
      return { id: s.id, label: s.label, ink, level: levelInfo(ink) };
    });
  }

  /** Разбивка по всем разделам для окна «Уровни»: [{mode, title, sections}]. */
  function breakdown() {
    const modes = (typeof MODES !== 'undefined')
      ? MODES
      : { islam: { title: 'Ислам' }, arabic: { title: 'Арабский язык' } };
    return Object.keys(modes).map(mid => ({
      mode: mid,
      title: (modes[mid] && modes[mid].title) || mid,
      sections: sections(mid)
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
    el.querySelector('.ink-toast-sec').textContent = ' · ' + sectionLabel(levelUpPending.section);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4600);
  }

  return {
    P, LEVELS, SECTIONS, OTHER,
    add, total, inkOf, legacy, levelInfo, levelIndex,
    sections, breakdown, sectionForType, sectionForStory, sectionLabel, dominantSection,
    mark, sinceMark
  };
})();
