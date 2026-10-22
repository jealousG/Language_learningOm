// ============================================================
//  SRS — система интервального повторения («Повторить сегодня»).
//  Алгоритм: упрощённый детерминированный SM-2, полностью локальный.
//  Хранилище: localStorage, ключ arabic-reader-srs-v1.
//
//  Обратная совместимость:
//   - старые ключи (arabic-reader-progress-v1, arabic-reader-study-stats-v1)
//     НЕ удаляются и продолжают работать (читалка и тренажёр не меняются);
//   - при первом запуске выполняется одноразовая миграция старых статусов
//     в карточки SRS: seen -> learning, known -> review;
//   - повреждённые данные не ломают сайт (везде try/catch).
//
//  Модель карточки:
//   { repetitions, intervalDays, ease, nextReviewAt, lastReviewedAt,
//     lapses, totalAnswers, correctAnswers, lastResult,
//     state: "new" | "learning" | "review" | "relearning", introDate }
// ============================================================

const SRS = (() => {
  // Ключи зависят от режима («Ислам» — исходные, другие — с суффиксом): у каждого режима свой SRS.
  const KEY = () => modeNs('arabic-reader-srs-v1');
  const OLD_STATS_KEY = () => modeNs('arabic-reader-study-stats-v1');
  const OLD_PROGRESS_KEY = () => modeNs('arabic-reader-progress-v1');
  const OVERDUE_BLOCK = 20; // просроченных >= этого -> новые не добавляются

  // Делегирование общим модулям (единственные реализации — util.js и srs-core.js)
  const esc = s => escHtml(s);
  const todayKey = d => dateKey(d);
  const endOfToday = () => endOfTodayTs();

  // ------------------------- хранилище -------------------------

  function blank() {
    return {
      version: 1,
      migrated: false,
      cards: {},                                   // "текст слова" -> карточка
      settings: { newPerDay: 5 },
      daily: { date: todayKey(), newCount: 0 },     // сколько новых слов введено сегодня
      lastStoryId: null                             // последний открытый текст (для выбора новых слов)
    };
  }

  let store = loadStore();

  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY()));
      if (s && typeof s === 'object' && s.cards && s.settings) {
        if (!s.daily || typeof s.daily !== 'object') s.daily = { date: todayKey(), newCount: 0 };
        return s;
      }
    } catch (e) { /* повреждены — начинаем с чистого состояния */ }
    return blank();
  }

  function save() {
    try {
      localStorage.setItem(KEY(), JSON.stringify(store));
    } catch (e) { /* запись не критична для работы сайта */ }
    updateBadge();
  }

  /** Перечитать хранилище (после смены режима). */
  function reload() {
    buildCorpus();
    store = loadStore();
    migrate();
    updateBadge();
  }

  function ensureDaily() {
    if (!store.daily || store.daily.date !== todayKey()) {
      store.daily = { date: todayKey(), newCount: 0 };
    }
  }

  function makeCard(state) {
    return {
      repetitions: 0,
      intervalDays: 0,
      ease: 2.5,
      nextReviewAt: null,
      lastReviewedAt: null,
      lapses: 0,
      totalAnswers: 0,
      correctAnswers: 0,
      lastResult: null,
      state: state || 'new',
      introDate: null
    };
  }

  // ------------------------- корпус слов -------------------------

  let corpus = { list: [], map: new Map() };

  function buildCorpus() {
    try {
      const list = [];
      const map = new Map();
      // корпус — только тексты текущего режима (Ислам / Арабский язык)
      const stories = (typeof modeStories === 'function')
        ? modeStories()
        : ((typeof STORIES_DATA !== 'undefined' && STORIES_DATA.stories) || []);
      const sorted = [...stories].sort((a, b) =>
        (a.chapterNo ?? a.surahNo ?? 9999) - (b.chapterNo ?? b.surahNo ?? 9999));
      sorted.forEach(st => {
        (st.sentences || []).forEach(sent => {
          (sent.words || []).forEach(w => {
            if (!w || !w.w || map.has(w.w)) return; // одна карточка на одинаковую форму
            // имена собственные и цифры (числа в формате цифр) не изучаем
            if (typeof isStudyableWord === 'function' && !isStudyableWord(w)) return;
            const item = { text: w.w, word: w, story: st };
            map.set(w.w, item);
            list.push(item);
          });
        });
      });
      corpus = { list, map };
    } catch (e) {
      corpus = { list: [], map: new Map() };
    }
  }

  // ------------------------- миграция старых данных -------------------------

  function migrate() {
    if (store.migrated) return;
    const now = Date.now();

    // 1) Статистика тренажёра: «выученные» -> review, остальные с попытками -> learning
    try {
      const stats = JSON.parse(localStorage.getItem(OLD_STATS_KEY())) || {};
      Object.entries(stats).forEach(([text, e]) => {
        if (!corpus.map.has(text) || store.cards[text]) return;
        if (!e || typeof e !== 'object') return;
        const c = Math.max(0, +e.c || 0);
        const w = Math.max(0, +e.w || 0);
        const learned = (c - w) >= 2; // тот же критерий, что в старой панели прогресса
        const card = makeCard(learned ? 'review' : 'learning');
        card.totalAnswers = c + w;
        card.correctAnswers = c;
        card.lapses = w;
        if (learned) {
          card.repetitions = 2;
          card.intervalDays = 1;
        }
        card.nextReviewAt = now; // доступно к повторению сегодня
        store.cards[text] = card;
      });
    } catch (e) { /* старые данные повреждены — пропускаем */ }

    // 2) Статусы читалки: known -> review, seen -> learning (только для слов без карточки)
    try {
      const prog = JSON.parse(localStorage.getItem(OLD_PROGRESS_KEY())) || {};
      const stories = (typeof modeStories === 'function')
        ? modeStories()
        : ((typeof STORIES_DATA !== 'undefined' && STORIES_DATA.stories) || []);
      stories.forEach(st => {
        (st.sentences || []).forEach((sent, sIdx) => {
          (sent.words || []).forEach((w, wIdx) => {
            if (!w || !w.w) return;
            const status = prog[`${st.id}:${sIdx}:${wIdx}`];
            if (status !== 'seen' && status !== 'known') return;
            if (store.cards[w.w]) return; // карточка уже создана по статистике
            const card = makeCard(status === 'known' ? 'review' : 'learning');
            if (status === 'known') {
              card.repetitions = 1;
              card.intervalDays = 1;
            }
            card.nextReviewAt = now;
            store.cards[w.w] = card;
          });
        });
      });
    } catch (e) { /* старые данные повреждены — пропускаем */ }

    store.migrated = true;
    save();
  }

  // ------------------------- алгоритм (общий SM-2 из srs-core.js) -------------------------

  /** Оценка слова: расписание (общий SM-2) + счётчики ответов. */
  function applyGrade(card, grade) {
    card.totalAnswers = (card.totalAnswers || 0) + 1;
    card.lastResult = grade;
    if (grade !== 'again') card.correctAnswers = (card.correctAnswers || 0) + 1;
    SRS_CORE.applyGrade(card, grade);
  }

  // ------------------------- счётчики и очередь -------------------------

  /** Кандидаты в «новые»: слова без карточки или не начавшие изучение. */
  function newCandidates() {
    const res = [];
    corpus.list.forEach(item => {
      const c = store.cards[item.text];
      if (!c || (c.state === 'new' && c.totalAnswers === 0)) res.push(item.text);
    });
    return res;
  }

  function counts() {
    ensureDaily();
    const now = Date.now();
    const eod = endOfToday();
    let due = 0, overdueReview = 0, hard = 0, learning = 0, solid = 0;
    Object.values(store.cards).forEach(c => {
      if (!c || typeof c !== 'object') return;
      if (c.state === 'review') solid++;
      else if (c.state === 'learning' || c.state === 'relearning') learning++;
      if ((c.lapses || 0) >= 2) hard++;
      if (c.nextReviewAt && c.nextReviewAt <= eod) {
        due++;
        if ((c.state === 'review' || c.state === 'relearning') && c.nextReviewAt < now) {
          overdueReview++;
        }
      }
    });
    const allowance = Math.max(0, (store.settings.newPerDay || 5) - (store.daily.newCount || 0));
    const newTotal = newCandidates().length;
    const blocked = overdueReview >= OVERDUE_BLOCK;
    return {
      due,
      overdueReview,
      hard,
      learning,
      solid,
      allowance,
      newTotal,
      blocked,
      newAvailable: blocked ? 0 : Math.min(allowance, newTotal)
    };
  }

  /**
   * Очередь сессии. Приоритеты:
   *  1) просроченные карточки (самые старые — первыми);
   *  2) карточки короткого обучения;
   *  3) внутри групп — чаще забываемые первыми;
   *  4) новые слова в рамках дневного лимита
   *     (сначала незавершённые, затем слова последнего открытого текста, затем по корпусу).
   */
  function buildQueue() {
    ensureDaily();
    const now = Date.now();
    const eod = endOfToday();
    const dueList = [];
    Object.entries(store.cards).forEach(([text, c]) => {
      if (c && c.nextReviewAt && c.nextReviewAt <= eod) dueList.push({ text, c });
    });
    dueList.sort((a, b) => {
      const pa = (a.c.state === 'review' || a.c.state === 'relearning') ? 0 : 1;
      const pb = (b.c.state === 'review' || b.c.state === 'relearning') ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.c.nextReviewAt !== b.c.nextReviewAt) return a.c.nextReviewAt - b.c.nextReviewAt;
      return (b.c.lapses || 0) - (a.c.lapses || 0);
    });
    const queue = dueList.map(d => d.text);

    const c = counts();
    if (c.newAvailable > 0) {
      pickNewWords(c.newAvailable).forEach(t => queue.push(t));
    }
    return queue;
  }

  function pickNewWords(n) {
    // 1) уже созданные, но не начатые карточки
    const result = [];
    corpus.list.forEach(item => {
      const c = store.cards[item.text];
      if (result.length < n && c && c.state === 'new' && c.totalAnswers === 0) {
        result.push(item.text);
      }
    });
    // 2) свежие слова: сначала из последнего открытого текста, затем по корпусу
    const fresh = corpus.list.filter(i => !store.cards[i.text]);
    const last = store.lastStoryId;
    const ordered = [];
    if (last) fresh.forEach(i => { if (i.story.id === last) ordered.push(i); });
    fresh.forEach(i => { if (!last || i.story.id !== last) ordered.push(i); });
    for (const item of ordered) {
      if (result.length >= n) break;
      store.cards[item.text] = makeCard('new'); // карточка создаётся, «введение» засчитается при показе
      result.push(item.text);
    }
    return result;
  }

  // ------------------------- сессия повторения -------------------------

  let session = null; // { queue, idx, revealed, stats: {again, hard, good, easy} }

  function startSession() {
    const queue = buildQueue();
    if (!queue.length) { renderScreen(); return; }
    session = { queue, idx: 0, revealed: false, stats: { again: 0, hard: 0, good: 0, easy: 0 } };
    if (typeof INK !== 'undefined') INK.mark();
    document.getElementById('srsOverviewPanel').classList.add('hidden');
    const panel = document.getElementById('srsSessionPanel');
    panel.classList.remove('hidden');
    renderCard();
  }

  function endSession() {
    const s = session.stats;
    const done = session.queue.length;
    const remaining = counts().due;
    if (typeof INK !== 'undefined') {
      // бонус за сессию — в самый частый раздел сессии
      const sec = INK.dominantSection((session.queue || []).map(inkSectionForWord));
      INK.add(INK.P.session, sec);
    }
    const inkEarned = (typeof INK !== 'undefined') ? INK.sinceMark() : 0;
    const stage = document.getElementById('srsStage');
    stage.innerHTML = `
      <div class="srs-summary">
        <div>Повторение завершено</div>
        <div class="big">🎉</div>
        <div class="percent">Карточек: ${done}</div>
        <div class="srs-tally">
          <span class="grade-good">Хорошо: ${s.good + s.easy}</span> ·
          <span class="grade-hard">Трудно: ${s.hard}</span> ·
          <span class="grade-again">Не помню: ${s.again}</span>
        </div>
        ${inkEarned > 0 ? `<div class="ink-earned">Золотых чернил за сессию: <b>+${inkEarned}</b></div>` : ''}
        ${remaining > 0
          ? `<p class="study-hint">Осталось на сегодня: ${remaining}. Забытые слова вернутся через несколько минут — продолжите позже.</p>`
          : '<p class="study-hint">На сегодня всё повторено 👍</p>'}
        <div class="study-actions" style="justify-content:center">
          <button class="ctrl-btn small primary" id="srsDoneBtn">Готово</button>
        </div>
      </div>`;
    document.getElementById('srsDoneBtn').addEventListener('click', () => {
      session = null;
      renderScreen();
    });
  }

  function nextCard() {
    session.idx++;
    session.revealed = false;
    if (session.idx >= session.queue.length) endSession();
    else renderCard();
  }

  function renderCard() {
    const text = session.queue[session.idx];
    const info = corpus.map.get(text);
    if (!info) { nextCard(); return; }
    const word = info.word;

    document.getElementById('srsProgressText').textContent =
      `Карточка ${session.idx + 1} из ${session.queue.length}`;
    document.getElementById('srsScoreText').textContent =
      `✓ ${session.stats.good + session.stats.easy + session.stats.hard} · ✗ ${session.stats.again}`;

    const stage = document.getElementById('srsStage');
    stage.innerHTML = `
        <div class="srs-card-ar" lang="ar" dir="rtl">${esc(wordDisplay(text))}</div>
      ${word.audio ? `<div class="study-audio-wrap"><button class="study-audio-btn" id="srsAudioBtn">🔊 Прослушать слово</button></div>` : ''}
      <div class="srs-reveal-wrap"><button class="ctrl-btn primary wide" id="srsRevealBtn">Показать ответ</button></div>
      <div class="srs-answer hidden" id="srsAnswer">
        <div class="swi-ru">${esc(word.ru || '')}</div>
        ${word.tr ? `<div class="swi-tr">${esc(word.tr)}</div>` : ''}
        ${(word.root && word.root !== '—') ? `<div class="srs-meta">Корень: <span class="arabic-inline">${esc(word.root)}</span></div>` : ''}
        ${word.pos ? `<div class="srs-meta">${esc(word.pos)}</div>` : ''}
        <div class="srs-meta src">${esc(info.story.titleRu)}</div>
      </div>
      <div class="srs-grades hidden" id="srsGrades">
        <button class="grade-btn grade-again" data-g="again">Не помню <span class="kbd">1</span></button>
        <button class="grade-btn grade-hard" data-g="hard">Трудно <span class="kbd">2</span></button>
        <button class="grade-btn grade-good" data-g="good">Хорошо <span class="kbd">3</span></button>
        <button class="grade-btn grade-easy" data-g="easy">Легко <span class="kbd">4</span></button>
      </div>`;

    if (word.audio) {
      document.getElementById('srsAudioBtn').addEventListener('click', () => {
        if (typeof playWordAudio === 'function') playWordAudio(word.audio);
      });
    }
    document.getElementById('srsRevealBtn').addEventListener('click', revealAnswer);
    document.querySelectorAll('#srsGrades .grade-btn').forEach(b => {
      b.addEventListener('click', () => grade(b.dataset.g));
    });
  }

  function revealAnswer() {
    if (!session || session.revealed) return;
    session.revealed = true;
    const revealBtn = document.getElementById('srsRevealBtn');
    if (revealBtn) revealBtn.parentElement.classList.add('hidden');
    document.getElementById('srsAnswer').classList.remove('hidden');
    document.getElementById('srsGrades').classList.remove('hidden');
  }

  /** Применить оценку к карточке слова: алгоритм + лимит новых + сохранение. */
  function applyAndStore(text, grade) {
    let card = store.cards[text];
    if (!card) card = store.cards[text] = makeCard('new');
    applyGrade(card, grade);
    // первое «введение» нового слова — считаем дневной лимит
    if (!card.introDate || card.introDate !== todayKey()) {
      card.introDate = todayKey();
      store.daily.newCount = (store.daily.newCount || 0) + 1;
    }
    save();
    return card;
  }

  /**
   * Единая точка оценки слова: SRS-расписание + старая статистика
   * (список «сложных слов») + журнал активности (серия дней).
   * Вызывается и сессией «Повторить сегодня», и тренажёром.
   */
  function answerWord(text, grade) {
    applyAndStore(text, grade);
    if (typeof recordWordResult === 'function') {
      recordWordResult(text, grade !== 'again');
    }
  }

  /** Раздел чернил по слову (по тексту-источнику). */
  function inkSectionForWord(text) {
    if (typeof INK === 'undefined') return null;
    const info = corpus.map.get(text);
    return info ? INK.sectionForStory(info.story) : null;
  }

  function grade(g) {
    if (!session || !session.revealed) return;
    const text = session.queue[session.idx];
    answerWord(text, g);
    session.stats[g]++;
    // золотые чернила: «Хорошо/Легко» — верный ответ, «Трудно» — половинный
    if (typeof INK !== 'undefined') {
      const sec = inkSectionForWord(text);
      if (g === 'good' || g === 'easy') INK.add(INK.P.correct, sec);
      else if (g === 'hard') INK.add(1, sec);
    }
    if (g === 'again') session.queue.push(text); // повтор в текущей сессии
    nextCard();
  }

  // ------------------------- экран «Повторить сегодня» -------------------------

  function renderScreen() {
    const panel = document.getElementById('srsOverviewPanel');
    const sessionPanel = document.getElementById('srsSessionPanel');
    if (!panel) return;
    sessionPanel.classList.add('hidden');
    panel.classList.remove('hidden');
    session = null;

    const c = counts();
    const nothing = c.due === 0 && c.newAvailable === 0;
    const hifzDue = (typeof HIFZ !== 'undefined') ? HIFZ.dueCount() : 0;
    const hifzBlock = (typeof HIFZ !== 'undefined')
      ? `<div class="hifz-cta-srs">📖 Хифз: аятов к повторению — <b>${hifzDue}</b>
          <button class="ctrl-btn small" id="srsToHifzBtn">Перейти в Хифз</button></div>`
      : '';

    panel.innerHTML = `
      <div class="stats-row">
        <div class="stat-box"><div class="stat-num">${c.due}</div><div class="stat-label">к повторению сегодня</div></div>
        <div class="stat-box"><div class="stat-num">${c.newAvailable}</div><div class="stat-label">новых слов доступно</div></div>
        <div class="stat-box"><div class="stat-num">${c.hard}</div><div class="stat-label">трудных слов</div></div>
      </div>
      ${hifzBlock}
      ${nothing ? '<p class="srs-done">На сегодня всё повторено 👍<br>Возвращайтесь завтра — или потренируйтесь в разделе «Изучение слов».</p>' : ''}
      ${c.blocked && c.newTotal > 0 ? '<p class="srs-note">Слишком много просроченных слов — сначала разберите их, новые подключатся после.</p>' : ''}
      <div class="srs-actions-center">
        <button class="ctrl-btn primary" id="srsStartBtn" ${nothing ? 'disabled' : ''}>Начать повторение</button>
      </div>
      <p class="study-hint">Сначала повторяются просроченные слова, затем — новые. Отвечайте честно: «Не помню» вернёт слово через несколько минут.<br>Клавиши: пробел — показать ответ, 1–4 — оценка.</p>
      <label class="study-label">Новых слов в день</label>
      <select id="srsNewPerDay" class="study-select srs-select-sm">
        <option value="3">3</option>
        <option value="5">5 (рекомендуется)</option>
        <option value="10">10</option>
        <option value="15">15</option>
      </select>`;

    document.getElementById('srsStartBtn').addEventListener('click', startSession);
    const toHifz = document.getElementById('srsToHifzBtn');
    if (toHifz) {
      toHifz.addEventListener('click', () => {
        if (typeof switchTo === 'function') switchTo('hifz');
      });
    }
    const sel = document.getElementById('srsNewPerDay');
    sel.value = String(store.settings.newPerDay || 5);
    sel.addEventListener('change', () => {
      store.settings.newPerDay = parseInt(sel.value, 10) || 5;
      save();
      renderScreen();
    });
  }

  // ------------------------- бейдж на вкладке -------------------------

  function updateBadge() {
    const el = document.getElementById('srsNavBadge');
    if (!el) return;
    try {
      const n = counts().due;
      el.textContent = n;
      el.classList.toggle('hidden', n === 0);
    } catch (e) { /* скрыть при ошибке */ }
  }

  // ------------------------- клавиатура и выход -------------------------

  document.addEventListener('keydown', (e) => {
    if (!session) return;
    const screen = document.getElementById('screen-review');
    if (!screen || screen.classList.contains('hidden')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!session.revealed) {
        e.preventDefault();
        revealAnswer();
      }
      return;
    }
    if (session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
      grade(['again', 'hard', 'good', 'easy'][+e.key - 1]);
    }
  });

  const exitBtn = document.getElementById('srsExitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      session = null;
      renderScreen();
    });
  }

  // ------------------------- API -------------------------

  // Инициализация при загрузке скрипта (данные уже загружены, DOM готов):
  // строим корпус слов и выполняем одноразовую миграцию старого прогресса.
  buildCorpus();
  migrate();

  return {
    renderScreen,
    reload,
    setLastStory(id) {
      if (store.lastStoryId !== id) {
        store.lastStoryId = id;
        save();
      }
    },
    /** Последний открытый текст (для «Продолжить чтение» на главной) или null. */
    getLastStory() {
      const id = store.lastStoryId;
      if (!id || typeof STORIES_DATA === 'undefined') return null;
      return STORIES_DATA.stories.find(s => s.id === id) || null;
    },
    /** Оценить слово извне (из тренажёра «Изучение слов»): расписание + статистика + активность. */
    gradeWord(text, g) {
      answerWord(text, g);
    },
    /** У слова уже была хотя бы одна попытка ответа (для выбора активного типа задания). */
    hasCardAnswered(text) {
      const c = store.cards[text];
      return !!(c && (c.totalAnswers || 0) > 0);
    },
    /** Все карточки (для панели «Мой прогресс»). Возвращает копию данных. */
    getAllCards() {
      const out = {};
      Object.entries(store.cards).forEach(([t, c]) => {
        if (c && typeof c === 'object') out[t] = c;
      });
      return out;
    },
    /** Сводные счётчики для дашборда. */
    getCounts() {
      return counts();
    },
    /** Сколько новых слов введено сегодня. */
    getDailyNewCount() {
      ensureDaily();
      return store.daily.newCount || 0;
    },
    /** Самые трудные слова (частые «Не помню» + ошибки): [{text, score, lapses, wrong, state}]. */
    hardWordList(limit) {
      const res = [];
      let stats = {};
      try {
        stats = JSON.parse(localStorage.getItem(OLD_STATS_KEY())) || {};
      } catch (e) { /* повреждены — пропускаем */ }
      Object.entries(store.cards).forEach(([text, c]) => {
        const wrong = (stats[text] && stats[text].w) || 0;
        const score = (c.lapses || 0) + wrong;
        if (score >= 2) res.push({ text, score, lapses: c.lapses || 0, wrong, state: c.state });
      });
      // слова, трудные только по старой статистике (без SRS-карточки)
      Object.entries(stats).forEach(([text, e]) => {
        if (store.cards[text] || !e || e.w < 2) return;
        if (!corpus.map.has(text)) return;
        res.push({ text, score: e.w, lapses: 0, wrong: e.w, state: null });
      });
      res.sort((a, b) => b.score - a.score);
      return res.slice(0, limit || 8);
    },
    /** Запустить повторение конкретного списка слов (например, трудных). */
    startCustomSession(texts) {
      if (!texts || !texts.length) return;
      session = {
        queue: texts.slice(), idx: 0, revealed: false,
        stats: { again: 0, hard: 0, good: 0, easy: 0 }
      };
      if (typeof INK !== 'undefined') INK.mark();
      document.getElementById('srsOverviewPanel').classList.add('hidden');
      document.getElementById('srsSessionPanel').classList.remove('hidden');
      renderCard();
    },
    /** Запустить обычную сессию повторения (очередь по графику + новые). */
    startDefaultSession() {
      startSession();
    },
    /** Запустить сессию только новых слов (в рамках дневного лимита). true — если начата. */
    startNewSession() {
      ensureDaily();
      const c = counts();
      const queue = c.newAvailable > 0 ? pickNewWords(c.newAvailable) : [];
      if (!queue.length) { renderScreen(); return false; }
      session = { queue: queue.slice(), idx: 0, revealed: false, stats: { again: 0, hard: 0, good: 0, easy: 0 } };
      if (typeof INK !== 'undefined') INK.mark();
      document.getElementById('srsOverviewPanel').classList.add('hidden');
      document.getElementById('srsSessionPanel').classList.remove('hidden');
      renderCard();
      return true;
    },
    /** Карточка слова (для статуса в карточке чтения) или null. */
    getCard(text) {
      const c = store.cards[text];
      return c ? JSON.parse(JSON.stringify(c)) : null;
    },
    /** Добавить слово в повторение вручную (из карточки слова). */
    addWord(text) {
      if (!store.cards[text]) {
        const card = makeCard('learning');
        card.nextReviewAt = Date.now();
        store.cards[text] = card;
        save();
      }
      return store.cards[text];
    }
  };
})();
