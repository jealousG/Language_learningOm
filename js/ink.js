// ============================================================
//  «Золотые чернила» — игровая валюта усердия.
//  Начисляются за осмысленные действия: верные ответы, серии,
//  выученные слова, сборку аятов, завершённые сессии. Не тратятся:
//  это мера практики, а не магазин. Счёт общий для обоих режимов.
//  Хранилище (глобальное): arabic-reader-ink-v1
//  { ink: число, bootstrapped: bool }
//  При первом запуске прошлые заслуги пересчитываются из журналов
//  активности обоих режимов (верные ответы ×2 + тренировки ×15).
// ============================================================

const INK = (() => {
  const KEY = 'arabic-reader-ink-v1';
  const ACT_BASE = 'arabic-reader-activity-v1';

  // Путь писца: порог уровня в чернилах
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

  let cache = null;      // { ink, bootstrapped }
  let lastMark = null;   // чернила на момент метки начала сессии
  let levelUpPending = null;

  function load() {
    if (cache) return cache;
    try {
      cache = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) { cache = {}; }
    if (typeof cache.ink !== 'number' || !isFinite(cache.ink) || cache.ink < 0) cache.ink = 0;
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
      cache.ink += Math.max(0, Math.round(past));
      cache.bootstrapped = true;
      save();
    }
    return cache;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* не критично */ }
  }

  /** Добавить чернила (только положительные). Возвращает новый итог. */
  function add(n) {
    n = Math.round(n);
    if (!n || n <= 0) return total();
    const c = load();
    const before = levelIndex(c.ink);
    c.ink += n;
    save();
    const after = levelIndex(c.ink);
    if (after > before) {
      levelUpPending = LEVELS[after].name;
      toast();
    }
    return c.ink;
  }

  function total() { return load().ink; }

  /** Индекс уровня для произвольного числа чернил (чистая функция). */
  function levelIndex(ink) {
    let i = 0;
    for (let j = 0; j < LEVELS.length; j++) if (ink >= LEVELS[j].min) i = j;
    return i;
  }

  /** Уровень и прогресс до следующего: {name, index, pct, nextName, toNext}. */
  function levelInfo() {
    const ink = total();
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
    el.innerHTML = 'Новый уровень: <b></b>';
    el.querySelector('b').textContent = levelUpPending;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4600);
  }

  return { P, LEVELS, add, total, levelInfo, levelIndex, mark, sinceMark };
})();
