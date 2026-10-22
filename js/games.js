/**
 * «Игры» — раздел в режиме «Арабский язык».
 * Первая игра: «Мемори+» — пары «слово ↔ перевод» (или «пропуск ↔ слово»),
 * после доски — закрепление: собрать слово из букв по переводу.
 * Чернила, журнал активности и уровни — общие с остальным сайтом.
 */
const GAMES_KEY = 'arabic-reader-games-v1';
const GAMES_RECALL_COUNT = 3;
const MEM_MISMATCH_MS = 2500;   // сколько держим открытой неверную пару (по просьбе: 2.5 с)

let MEM = null;          // состояние партии «Мемори»
let memTimerId = null;

// ------------------------- рекорды и настройки -------------------------

function gameRecords() {
  try {
    const rec = JSON.parse(localStorage.getItem(GAMES_KEY)) || {};
    // старый формат ключей рекордов ('pair:6' без источника) — переносим в общий зачёт
    if (rec.memory) {
      let moved = false;
      Object.keys(rec.memory).forEach(k => {
        if (k.indexOf('|') < 0) { rec.memory['*|' + k] = rec.memory[k]; delete rec.memory[k]; moved = true; }
      });
      if (moved) saveGameRecords(rec);
    }
    return rec;
  } catch (e) { return {}; }
}

function saveGameRecords(r) {
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(r)); } catch (e) { /* не критично */ }
}

// ------------------------- источники слов -------------------------

function gameBooks() {
  return (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books : [];
}

/** Источники: все слова тома, глава, невыученные. */
function gamesSources() {
  const out = [];
  gameBooks().forEach(b => {
    const tom = String(b.id).replace('huna', '');
    out.push({ id: 'book:' + b.id, group: 'Том ' + tom, label: 'Все слова тома' });
    (b.chapters || []).forEach(c => {
      out.push({ id: 'chapter:' + c.id, group: 'Том ' + tom, label: 'Гл. ' + c.no + ' · ' + (c.titleRu || '') });
    });
  });
  out.push({ id: 'weak', group: 'Все главы', label: 'Невыученные слова' });
  return out;
}

/** Тексты выбранного источника. */
function gamesStories(sourceId) {
  const pool = (typeof modeStories === 'function') ? modeStories() : [];
  if (!sourceId || sourceId === 'weak') return pool;
  if (sourceId.indexOf('book:') === 0) {
    const id = sourceId.slice(5);
    return pool.filter(s => s.bookId === id);
  }
  if (sourceId.indexOf('chapter:') === 0) {
    const id = sourceId.slice(8);
    return pool.filter(s => s.chapterId === id);
  }
  return pool;
}

/** Элементы [{word, sentence, gapIndex, story}] без повторов по основе. */
function gamesItems(sourceId) {
  const seen = new Set();
  const items = [];
  gamesStories(sourceId).forEach(st => {
    (st.sentences || []).forEach(sent => {
      (sent.words || []).forEach((w, i) => {
        if (typeof isStudyableWord === 'function' && !isStudyableWord(w)) return;
        if (sourceId === 'weak' && typeof isWordLearned === 'function' && isWordLearned(w.w)) return;
        const key = (typeof wordBaseKey === 'function') ? wordBaseKey(w) : (w.w || '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        items.push({ word: (typeof baseWord === 'function') ? baseWord(w) : w, sentence: sent, gapIndex: i, story: st });
      });
    });
  });
  return items;
}

/** Раздел чернил (по типу текста источника). */
function gamesInkSection(sourceId) {
  if (typeof INK === 'undefined') return null;
  const type = (sourceId && sourceId.indexOf('book:') === 0) ? sourceId.slice(5) : 'huna2';
  return (typeof INK.sectionForType === 'function') ? INK.sectionForType(type) : null;
}

// ------------------------- экран «Игры» -------------------------

function renderGames() {
  const hub = document.getElementById('gamesHub');
  if (!hub) return;
  const selSource = document.getElementById('memSource');
  if (selSource && !selSource.options.length) {
    const groups = new Map();
    gamesSources().forEach(s => {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    });
    groups.forEach((list, gname) => {
      const grp = document.createElement('optgroup');
      grp.label = gname;
      list.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.label;
        grp.appendChild(o);
      });
      selSource.appendChild(grp);
    });
  }
  const rec = gameRecords();
  const opts = rec.opts || {};
  if (selSource && opts.source) selSource.value = opts.source;
  const selMode = document.getElementById('memMode');
  if (selMode && opts.mode) selMode.value = opts.mode;
  const selSize = document.getElementById('memSize');
  if (selSize && opts.size) selSize.value = String(opts.size);
  renderMemoryRecord();
  if (typeof renderRootCard === 'function') renderRootCard();
  if (typeof renderClozeCard === 'function') renderClozeCard();
}

/** Рекорд для сочетания «источник + режим + размер» (или общий — из старого формата). */
function memoryBestRecord(sourceId, mode, size) {
  const rec = gameRecords();
  const mem = rec.memory || {};
  return mem[gameRecordKey(sourceId, mode, size)] || mem['*|' + mode + ':' + size] || null;
}

function renderMemoryRecord() {
  const el = document.getElementById('memRecord');
  if (!el) return;
  const sourceId = (document.getElementById('memSource') || {}).value || '';
  const mode = (document.getElementById('memMode') || {}).value || 'pair';
  const size = (document.getElementById('memSize') || {}).value || '6';
  const best = memoryBestRecord(sourceId, mode, size);
  el.textContent = best
    ? 'Лучшее: ' + fmtTime(best.seconds) + ' · ' + best.moves + ' ' + gameMovesWord(best.moves)
    : 'Рекорда пока нет';
}

// ------------------------- партия -------------------------

function memStartGame() {
  const sourceId = (document.getElementById('memSource') || {}).value || '';
  const mode = (document.getElementById('memMode') || {}).value || 'pair';
  const size = parseInt((document.getElementById('memSize') || {}).value, 10) || 6;
  const pool = gamePairPool(gamesItems(sourceId));
  if (pool.length < 2) {
    showMemoryMessage('В этом источнике слишком мало слов для игры.');
    return;
  }
  const actual = Math.min(size, pool.length);
  const board = gameBuildBoard(pool, actual, mode);
  const pairs = memPairsFromBoard(board);

  // сохраняем выбор
  const rec = gameRecords();
  rec.opts = { source: sourceId, mode: mode, size: actual };
  rec.plays = (rec.plays || 0) + 1;
  saveGameRecords(rec);

  MEM = {
    sourceId: sourceId,
    mode: mode,
    size: actual,
    best: memoryBestRecord(sourceId, mode, actual),   // лучшее время по этому источнику
    board: board,
    pairs: pairs,
    openIdx: [],
    locked: false,
    done: false,
    moves: 0,
    matched: 0,
    mistakes: {},
    startedAt: Date.now(),
    elapsed: 0,
    section: gamesInkSection(sourceId),
    ink: 0,
    recall: [],
    recallIdx: 0,
    recallOk: 0
  };

  document.getElementById('gamesHub').classList.add('hidden');
  document.getElementById('memoryGame').classList.remove('hidden');
  document.getElementById('memResult').classList.add('hidden');
  document.getElementById('memRecall').classList.add('hidden');
  renderMemoryBoard();
  updateMemoryHud();
  renderMemoryBest();
  clearInterval(memTimerId);
  memTimerId = setInterval(() => {
    if (!MEM || MEM.done) return;
    MEM.elapsed = (Date.now() - MEM.startedAt) / 1000;
    updateMemoryHud();
  }, 250);
}

/** Пары с доски: {id, ar, ru, word:{w,ru}} — для закрепления. */
function memPairsFromBoard(board) {
  const map = new Map();
  board.forEach(c => {
    if (!map.has(c.pairId)) map.set(c.pairId, { id: c.pairId });
    const p = map.get(c.pairId);
    if (c.kind === 'ar') p.ar = c.text; else p.ru = c.text;
  });
  return [...map.values()].map(p => ({ id: p.id, ar: p.ar, ru: p.ru, word: { w: p.ar, ru: p.ru } }));
}

function renderMemoryBoard() {
  const boardEl = document.getElementById('memBoard');
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--mem-cols', MEM.size > 6 ? 4 : 4);
  MEM.board.forEach((card, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mem-card';
    b.dataset.idx = String(idx);
    b.innerHTML = '<span class="mem-face mem-back">؟</span>' +
      '<span class="mem-face mem-front"' + (card.rtl ? ' dir="rtl"' : '') + '></span>';
    b.querySelector('.mem-front').textContent = card.text;
    b.addEventListener('click', () => memFlip(idx));
    boardEl.appendChild(b);
  });
}

function memCardEl(idx) {
  return document.querySelector('.mem-card[data-idx="' + idx + '"]');
}

function memFlip(idx) {
  if (!MEM || MEM.locked || MEM.done) return;
  const card = MEM.board[idx];
  if (!card || card.open || card.matched) return;
  card.open = true;
  const el = memCardEl(idx);
  if (el) el.classList.add('open');
  MEM.openIdx.push(idx);
  if (MEM.openIdx.length < 2) return;

  MEM.moves++;
  updateMemoryHud();
  const [a, b] = MEM.openIdx;
  const ca = MEM.board[a], cb = MEM.board[b];

  if (ca.pairId === cb.pairId) {
    ca.matched = cb.matched = true;
    MEM.openIdx = [];
    MEM.matched++;
    MEM.ink += 2;
    if (typeof INK !== 'undefined') INK.add(2, MEM.section);
    if (typeof logActivity === 'function') logActivity({ reviews: 1, correct: 1, words: 1 });
    [a, b].forEach(i => {
      const e = memCardEl(i);
      if (e) { e.classList.add('matched'); e.disabled = true; }
    });
    updateMemoryHud();
    if (MEM.matched === MEM.size) memBoardDone();
  } else {
    MEM.locked = true;
    // ошибка засчитывается обоим словам, которые были открыты
    [a, b].forEach(i => {
      const c = MEM.board[i];
      const p = MEM.pairs.find(x => x.id === c.pairId);
      if (p) MEM.mistakes[p.word.w] = (MEM.mistakes[p.word.w] || 0) + 1;
    });
    [a, b].forEach(i => { const e = memCardEl(i); if (e) e.classList.add('wrong'); });
    setTimeout(() => {
      [a, b].forEach(i => {
        const e = memCardEl(i);
        if (e) e.classList.remove('open', 'wrong');
        if (MEM.board[i]) MEM.board[i].open = false;
      });
      MEM.openIdx = [];
      MEM.locked = false;
    }, MEM_MISMATCH_MS);
  }
}

function updateMemoryHud() {
  if (!MEM) return;
  const t = document.getElementById('memTimer');
  if (t) t.textContent = fmtTime(MEM.elapsed || ((Date.now() - MEM.startedAt) / 1000));
  const m = document.getElementById('memMoves');
  if (m) m.textContent = MEM.moves + ' ' + gameMovesWord(MEM.moves);
  const p = document.getElementById('memPairs');
  if (p) p.textContent = MEM.matched + '/' + MEM.size;
}

/** Показать справа лучшее время по текущему источнику (если уже играли). */
function renderMemoryBest() {
  const el = document.getElementById('memBest');
  if (!el) return;
  if (MEM && MEM.best) {
    el.textContent = 'Лучшее здесь: ' + fmtTime(MEM.best.seconds) + ' · ' +
      MEM.best.moves + ' ' + gameMovesWord(MEM.best.moves);
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function gameMovesWord(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'ход';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'хода';
  return 'ходов';
}

/** Доска закрыта: переходим к закреплению. */
function memBoardDone() {
  MEM.done = true;
  MEM.elapsed = (Date.now() - MEM.startedAt) / 1000;
  clearInterval(memTimerId);
  memTimerId = null;
  MEM.recall = gameRecallWords(MEM.pairs, MEM.mistakes, GAMES_RECALL_COUNT);
  MEM.recallIdx = 0;
  MEM.recallOk = 0;
  if (!MEM.recall.length) { memFinish(); return; }
  document.getElementById('memRecall').classList.remove('hidden');
  memRecallStep();
}

function memRecallStep() {
  const cur = MEM.recall[MEM.recallIdx];
  if (!cur) { memFinish(); return; }
  MEM.letters = gameScramble(cur.word.w).map(ch => ({ ch: ch, used: false }));
  MEM.placed = [];
  document.getElementById('recallRu').textContent = cur.ru;
  const prog = document.getElementById('recallProgress');
  if (prog) prog.textContent = 'Слово ' + (MEM.recallIdx + 1) + ' из ' + MEM.recall.length;
  renderRecallBoard();
  showRecallMsg('');
}

function renderRecallBoard() {
  const slot = document.getElementById('recallSlot');
  if (slot) {
    slot.textContent = MEM.placed.join('');
    slot.dir = 'rtl';
  }
  const box = document.getElementById('recallLetters');
  if (!box) return;
  box.innerHTML = '';
  MEM.letters.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'recall-tile' + (t.used ? ' used' : '');
    b.textContent = t.ch;
    b.dir = 'rtl';
    if (!t.used) b.addEventListener('click', () => memPlaceLetter(i));
    box.appendChild(b);
  });
}

function memPlaceLetter(i) {
  if (!MEM || MEM.done && MEM.recallIdx >= MEM.recall.length) return;
  const t = MEM.letters[i];
  if (!t || t.used) return;
  t.used = true;
  MEM.placed.push(t.ch);
  renderRecallBoard();
  if (MEM.placed.length === MEM.letters.length) memCheckAssembly();
}

function memClearLetters() {
  if (!MEM || !MEM.letters) return;
  MEM.letters.forEach(t => { t.used = false; });
  MEM.placed = [];
  renderRecallBoard();
  showRecallMsg('');
}

function memCheckAssembly() {
  const cur = MEM.recall[MEM.recallIdx];
  if (!cur) return;
  if (gameAssemblyCorrect(MEM.placed, cur.word.w)) {
    MEM.recallOk++;
    MEM.ink += 5;
    if (typeof INK !== 'undefined') INK.add(5, MEM.section);
    showRecallMsg('Верно: ' + cur.word.w, false);
    MEM.recallIdx++;
    setTimeout(() => { if (MEM) memRecallStep(); }, 700);
  } else {
    showRecallMsg('Пока не то — попробуйте ещё раз', true);
    const slot = document.getElementById('recallSlot');
    if (slot) slot.classList.add('shake');
    setTimeout(() => {
      if (slot) slot.classList.remove('shake');
      if (MEM) memClearLetters();
    }, 800);
  }
}

function showRecallMsg(text, isError) {
  const el = document.getElementById('recallMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

/** Итог партии: время, ходы, рекорд. */
function memFinish() {
  const rec = gameRecords();
  rec.memory = rec.memory || {};
  const key = gameRecordKey(MEM.sourceId, MEM.mode, MEM.size);
  const prev = memoryBestRecord(MEM.sourceId, MEM.mode, MEM.size);
  const result = { seconds: Math.round(MEM.elapsed), moves: MEM.moves, at: Date.now() };
  const isRecord = gameRecordBetter(prev, result);
  if (isRecord) rec.memory[key] = result;
  rec.recallCorrect = (rec.recallCorrect || 0) + MEM.recallOk;
  saveGameRecords(rec);

  if (typeof logActivity === 'function') logActivity({ trainings: 1 });

  const el = document.getElementById('memResult');
  el.classList.remove('hidden');
  el.innerHTML =
    '<div class="study-summary">' +
      '<div class="mem-result-title">' + (isRecord ? 'Новый рекорд!' : 'Партия завершена') + '</div>' +
      '<div class="mem-result-stats">' +
        '<span>' + fmtTime(MEM.elapsed) + '</span>' +
        '<span>' + MEM.moves + ' ' + gameMovesWord(MEM.moves) + '</span>' +
        '<span>' + MEM.size + ' пар</span>' +
        '<span>закрепление: ' + MEM.recallOk + ' из ' + (MEM.recall.length || 0) + '</span>' +
      '</div>' +
      '<div class="mem-result-ink">+' + MEM.ink + ' чернил</div>' +
      (prev ? '<div class="mem-result-prev">Прошлое лучшее: ' + fmtTime(prev.seconds) + ' · ' + prev.moves + ' ' + gameMovesWord(prev.moves) + '</div>' : '') +
      '<div class="study-actions" style="justify-content:center">' +
        '<button class="ctrl-btn primary" id="memAgainBtn">Играть ещё</button>' +
        '<button class="ctrl-btn" id="memHubBtn">Другая игра</button>' +
      '</div>' +
    '</div>';
  document.getElementById('memAgainBtn').addEventListener('click', memStartGame);
  document.getElementById('memHubBtn').addEventListener('click', memBackToHub);
  renderMemoryRecord();
  MEM = null;
}

function memBackToHub() {
  clearInterval(memTimerId);
  memTimerId = null;
  MEM = null;
  document.getElementById('memoryGame').classList.add('hidden');
  document.getElementById('gamesHub').classList.remove('hidden');
  renderGames();
}

function memQuit() {
  memBackToHub();
}

function showMemoryMessage(text) {
  const el = document.getElementById('memRecord');
  if (el) el.textContent = text;
}

/** Остановить игру при уходе из раздела. */
function gamesStop() {
  clearInterval(memTimerId);
  memTimerId = null;
  MEM = null;
  if (typeof rootStop === 'function') rootStop();
  if (typeof clozeStop === 'function') clozeStop();
  const game = document.getElementById('memoryGame');
  if (game) game.classList.add('hidden');
  const hub = document.getElementById('gamesHub');
  if (hub) hub.classList.remove('hidden');
}

const GAMES = {
  render: renderGames,
  start: memStartGame,
  stop: gamesStop
};

// ========================= «Корень» =========================

let ROOT = null;          // состояние партии «Корень»
let rootTimerId = null;
const ROOT_QUIZ_COUNT = 10;   // слов в викторине
const ROOT_ROUNDS = 3;        // раундов «собери семейство»

function rootBestRecord(sourceId, mode) {
  const map = gameRecords().root || {};
  return map[sourceId + '|' + mode] || null;
}

function renderRootCard() {
  const sel = document.getElementById('rootSource');
  if (sel && !sel.options.length) {
    const groups = new Map();
    gamesSources().forEach(s => {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    });
    groups.forEach((list, gname) => {
      const grp = document.createElement('optgroup');
      grp.label = gname;
      list.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.label;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
  }
  const opts = gameRecords().opts || {};
  if (sel && opts.rootSource) sel.value = opts.rootSource;
  renderRootRecord();
}

function rootModeValue() {
  return (document.getElementById('rootMode') || {}).value || 'quiz';
}

function renderRootRecord() {
  const el = document.getElementById('rootRecord');
  if (!el) return;
  const sourceId = (document.getElementById('rootSource') || {}).value || '';
  const mode = rootModeValue();
  const best = rootBestRecord(sourceId, mode);
  if (!best) { el.textContent = 'Рекорда пока нет'; return; }
  el.textContent = mode === 'family'
    ? 'Лучшее: ' + fmtTime(best.seconds) + ' · ошибок ' + best.mistakes
    : 'Лучшее: ' + best.score + ' из ' + best.total + ' · ' + fmtTime(best.seconds);
}

function rootMsg(text, isError) {
  ['rootMsg', 'rootFamilyMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  });
}

function rootHud() {
  if (!ROOT) return;
  const t = document.getElementById('rootTimer');
  if (t) t.textContent = fmtTime(ROOT.elapsed || ((Date.now() - ROOT.startedAt) / 1000));
  const s = document.getElementById('rootScore');
  if (s) s.textContent = ROOT.score + ' из ' + ROOT.total;
  const p = document.getElementById('rootProgress');
  if (p) p.textContent = Math.min(ROOT.idx + 1, ROOT.steps || ROOT.total) + '/' + (ROOT.steps || ROOT.total);
}

function rootBestLine() {
  const el = document.getElementById('rootBest');
  if (!el) return;
  const best = rootBestRecord(
    (document.getElementById('rootSource') || {}).value || '',
    rootModeValue()
  );
  if (!best) { el.textContent = ''; el.classList.add('hidden'); return; }
  el.textContent = rootModeValue() === 'family'
    ? 'Лучшее: ' + fmtTime(best.seconds)
    : 'Лучшее: ' + best.score + ' из ' + best.total;
  el.classList.remove('hidden');
}

function rootStartGame() {
  const sourceId = (document.getElementById('rootSource') || {}).value || '';
  const mode = rootModeValue();
  const families = gameRootFamilies(gamesItems(sourceId), 2);
  if (families.length < 5) {
    const el = document.getElementById('rootRecord');
    if (el) el.textContent = 'В этом источнике слишком мало слов с корнем.';
    return;
  }
  const rec = gameRecords();
  rec.opts = Object.assign({}, rec.opts || {}, { rootSource: sourceId });
  saveGameRecords(rec);

  ROOT = {
    sourceId: sourceId,
    mode: mode,
    families: families,
    score: 0,
    mistakes: 0,
    idx: 0,
    total: 0,
    ink: 0,
    section: gamesInkSection(sourceId),
    startedAt: Date.now(),
    elapsed: 0,
    locked: false,
    famNeed: 0,
    famFound: 0
  };

  if (mode === 'family') {
    let withFamily = families.filter(f => f.words.length >= 3);
    if (withFamily.length < ROOT_ROUNDS) {
      // в главе мало корней с 3+ словами — берём корни всего тома
      const bookId = (sourceId.indexOf('chapter:') === 0)
        ? 'book:' + sourceId.slice(8).split('-')[0]
        : sourceId;
      const wide = gameRootFamilies(gamesItems(bookId), 3);
      if (wide.length > withFamily.length) { withFamily = wide; ROOT.families = wide; }
    }
    ROOT.rounds = gameShuffle(withFamily.length ? withFamily : families).slice(0, ROOT_ROUNDS);
    ROOT.steps = ROOT.rounds.length;
    // «очки» в этом режиме — найденные слова
    ROOT.total = ROOT.rounds.reduce((a, f) => a + Math.min(4, f.words.length), 0);
  } else {
    ROOT.questions = gameRootQuestions(families, ROOT_QUIZ_COUNT);
    ROOT.total = ROOT.questions.length;
    ROOT.steps = ROOT.questions.length;
  }

  document.getElementById('gamesHub').classList.add('hidden');
  document.getElementById('rootGame').classList.remove('hidden');
  document.getElementById('rootResult').classList.add('hidden');
  rootBestLine();
  rootHud();
  clearInterval(rootTimerId);
  rootTimerId = setInterval(() => {
    if (!ROOT) return;
    ROOT.elapsed = (Date.now() - ROOT.startedAt) / 1000;
    rootHud();
  }, 250);

  if (mode === 'family') rootRenderFamily(); else rootRenderQuiz();
}

// --------- режим «найди корень» ---------

function rootRenderQuiz() {
  if (!ROOT) return;
  const q = ROOT.questions[ROOT.idx];
  if (!q) { rootFinish(); return; }
  ROOT.locked = false;
  document.getElementById('rootQuiz').classList.remove('hidden');
  document.getElementById('rootFamily').classList.add('hidden');
  document.getElementById('rootResult').classList.add('hidden');
  const wEl = document.getElementById('rootWord');
  if (wEl) wEl.textContent = (typeof wordDisplay === 'function') ? wordDisplay(q.word.w) : q.word.w;
  const ruEl = document.getElementById('rootWordRu');
  if (ruEl) ruEl.textContent = q.ru;

  const opts = gameRootOptions(q.familyKey, ROOT.families, 4);
  const box = document.getElementById('rootOptions');
  box.innerHTML = '';
  opts.forEach((key, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'root-option';
    b.dataset.root = key;
    b.innerHTML = '<span class="root-option-num">' + (i + 1) + '</span>' +
      '<span class="root-option-ar" dir="rtl">' + escapeHtml(gameRootDisplay(key)) + '</span>';
    b.addEventListener('click', () => rootAnswerQuiz(key, b));
    box.appendChild(b);
  });
  rootMsg('');
  rootHud();
}

function rootAnswerQuiz(key, btn) {
  if (!ROOT || ROOT.locked) return;
  ROOT.locked = true;
  const q = ROOT.questions[ROOT.idx];
  const ok = key === q.familyKey;
  document.querySelectorAll('#rootOptions .root-option').forEach(b => {
    b.classList.add('done');
    if (b.dataset.root === q.familyKey) b.classList.add('right');
  });
  if (ok) {
    btn.classList.add('right');
    ROOT.score++;
    ROOT.ink += 2;
    if (typeof INK !== 'undefined') INK.add(2, ROOT.section);
    if (typeof logActivity === 'function') logActivity({ reviews: 1, correct: 1, words: 1 });
    rootMsg('Верно');
  } else {
    btn.classList.add('wrong');
    ROOT.mistakes++;
    rootMsg('Корень: ' + gameRootDisplay(q.familyKey), true);
  }
  rootHud();
  setTimeout(() => { if (ROOT) { ROOT.idx++; rootRenderQuiz(); } }, ok ? 700 : 1800);
}

// --------- режим «собери семейство» ---------

function rootRenderFamily() {
  if (!ROOT) return;
  const fam = ROOT.rounds[ROOT.idx];
  if (!fam) { rootFinish(); return; }
  ROOT.locked = false;
  ROOT.famNeed = 0;
  ROOT.famFound = 0;
  document.getElementById('rootQuiz').classList.add('hidden');
  document.getElementById('rootFamily').classList.remove('hidden');
  document.getElementById('rootResult').classList.add('hidden');
  const keyEl = document.getElementById('rootFamilyKey');
  if (keyEl) keyEl.textContent = gameRootDisplay(fam.key);

  const rnd = gameFamilyRound(fam, ROOT.families, 4, 12);
  ROOT.famNeed = rnd.need;
  const grid = document.getElementById('rootFamilyGrid');
  grid.innerHTML = '';
  rnd.cards.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'root-family-tile';
    const disp = (typeof wordDisplay === 'function') ? wordDisplay(c.text) : c.text;
    b.innerHTML = '<span class="rft-ar" dir="rtl">' + escapeHtml(disp) + '</span>' +
      '<span class="rft-ru">' + escapeHtml(c.ru) + '</span>';
    b.addEventListener('click', () => rootFamilyTap(b, c));
    grid.appendChild(b);
  });
  rootMsg('');
  rootHud();
}

function rootFamilyTap(btn, card) {
  if (!ROOT || ROOT.locked) return;
  if (btn.classList.contains('found') || btn.classList.contains('bad')) return;
  if (card.right) {
    btn.classList.add('found');
    ROOT.famFound++;
    ROOT.score++;
    ROOT.ink += 2;
    if (typeof INK !== 'undefined') INK.add(2, ROOT.section);
    if (typeof logActivity === 'function') logActivity({ reviews: 1, correct: 1, words: 1 });
    rootHud();
    if (ROOT.famFound >= ROOT.famNeed) {
      ROOT.locked = true;
      ROOT.ink += 5;
      if (typeof INK !== 'undefined') INK.add(5, ROOT.section);
      rootMsg('Семейство собрано');
      setTimeout(() => { if (ROOT) { ROOT.idx++; rootRenderFamily(); } }, 800);
    }
  } else {
    btn.classList.add('bad');
    ROOT.mistakes++;
    rootMsg('Это другое семейство', true);
    rootHud();
  }
}

// --------- итог ---------

function rootFinish() {
  if (!ROOT) return;
  ROOT.elapsed = (Date.now() - ROOT.startedAt) / 1000;
  clearInterval(rootTimerId);
  rootTimerId = null;

  const rec = gameRecords();
  rec.root = rec.root || {};
  const key = ROOT.sourceId + '|' + ROOT.mode;
  const prev = rec.root[key] || null;
  const result = {
    score: ROOT.score,
    total: ROOT.total,
    mistakes: ROOT.mistakes,
    seconds: Math.round(ROOT.elapsed),
    at: Date.now()
  };
  const isRecord = gameRootBetter(prev, result, ROOT.mode);
  if (isRecord) rec.root[key] = result;
  saveGameRecords(rec);
  if (typeof logActivity === 'function') logActivity({ trainings: 1 });

  const state = ROOT;
  ROOT = null;
  const el = document.getElementById('rootResult');
  el.classList.remove('hidden');
  el.innerHTML =
    '<div class="study-summary">' +
      '<div class="mem-result-title">' + (isRecord ? 'Новый рекорд!' : 'Партия завершена') + '</div>' +
      '<div class="mem-result-stats">' +
        '<span>' + fmtTime(state.elapsed) + '</span>' +
        '<span>' + state.score + ' из ' + state.total + '</span>' +
        '<span>ошибок: ' + state.mistakes + '</span>' +
      '</div>' +
      '<div class="mem-result-ink">+' + state.ink + ' чернил</div>' +
      (prev ? '<div class="mem-result-prev">Прошлое лучшее: ' +
        (state.mode === 'family' ? fmtTime(prev.seconds) : prev.score + ' из ' + prev.total) + '</div>' : '') +
      '<div class="study-actions" style="justify-content:center">' +
        '<button class="ctrl-btn primary" id="rootAgainBtn">Играть ещё</button>' +
        '<button class="ctrl-btn" id="rootHubBtn">Другая игра</button>' +
      '</div>' +
    '</div>';
  document.getElementById('rootAgainBtn').addEventListener('click', rootStartGame);
  document.getElementById('rootHubBtn').addEventListener('click', rootBackToHub);
  renderRootRecord();
}

function rootBackToHub() {
  clearInterval(rootTimerId);
  rootTimerId = null;
  ROOT = null;
  document.getElementById('rootGame').classList.add('hidden');
  document.getElementById('gamesHub').classList.remove('hidden');
  renderGames();
}

function rootStop() {
  clearInterval(rootTimerId);
  rootTimerId = null;
  ROOT = null;
  const game = document.getElementById('rootGame');
  if (game) game.classList.add('hidden');
}
// ========================= «Клоуз» =========================

let CLOZE = null;
let clozTimerId = null;
const CLOZE_COUNT = 10;   // предложений в партии

function clozeBestRecord(sourceId) {
  const map = gameRecords().cloze || {};
  return map[sourceId] || null;
}

function renderClozeCard() {
  const sel = document.getElementById('clozeSource');
  if (sel && !sel.options.length) {
    const groups = new Map();
    gamesSources().forEach(s => {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    });
    groups.forEach((list, gname) => {
      const grp = document.createElement('optgroup');
      grp.label = gname;
      list.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.label;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
  }
  const opts = gameRecords().opts || {};
  if (sel && opts.clozeSource) sel.value = opts.clozeSource;
  renderClozeRecord();
}

function renderClozeRecord() {
  const el = document.getElementById('clozeRecord');
  if (!el) return;
  const sourceId = (document.getElementById('clozeSource') || {}).value || '';
  const best = clozeBestRecord(sourceId);
  el.textContent = best
    ? 'Лучшее: ' + best.score + ' из ' + best.total + ' · ' + fmtTime(best.seconds)
    : 'Рекорда пока нет';
}

function clozeMsg(text, isError) {
  const el = document.getElementById('clozeMsg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function clozeHud() {
  if (!CLOZE) return;
  const t = document.getElementById('clozeTimer');
  if (t) t.textContent = fmtTime(CLOZE.elapsed || ((Date.now() - CLOZE.startedAt) / 1000));
  const s = document.getElementById('clozeScore');
  if (s) s.textContent = CLOZE.score + ' из ' + CLOZE.total;
  const p = document.getElementById('clozeProgress');
  if (p) p.textContent = Math.min(CLOZE.idx + 1, CLOZE.total) + '/' + CLOZE.total;
}

function clozeBestLine() {
  const el = document.getElementById('clozeBest');
  if (!el) return;
  const best = clozeBestRecord(CLOZE ? CLOZE.sourceId : '');
  if (!best) { el.textContent = ''; el.classList.add('hidden'); return; }
  el.textContent = 'Лучшее: ' + best.score + ' из ' + best.total;
  el.classList.remove('hidden');
}

/** Предложение с пропуском (gapIndex = -1 — показать целиком). */
function clozeSentenceHtml(sentence, gapIndex) {
  const words = (sentence && sentence.words) || [];
  return words.map((w, i) => {
    if (i === gapIndex) return '<span class="cloze-gap">____</span>';
    return '<span class="cloze-word">' + escapeHtml((w && w.w) || '') + '</span>';
  }).join(' ');
}

function clozeStartGame() {
  const sourceId = (document.getElementById('clozeSource') || {}).value || '';
  const items = gamesItems(sourceId);
  const questions = gameClozeQuestions(items, CLOZE_COUNT);
  if (questions.length < 3) {
    const el = document.getElementById('clozeRecord');
    if (el) el.textContent = 'В этом источнике слишком мало предложений.';
    return;
  }
  const rec = gameRecords();
  rec.opts = Object.assign({}, rec.opts || {}, { clozeSource: sourceId });
  saveGameRecords(rec);

  CLOZE = {
    sourceId: sourceId,
    items: items,
    questions: questions,
    idx: 0,
    score: 0,
    mistakes: 0,
    total: questions.length,
    ink: 0,
    section: gamesInkSection(sourceId),
    startedAt: Date.now(),
    elapsed: 0,
    locked: false
  };

  document.getElementById('gamesHub').classList.add('hidden');
  document.getElementById('clozeGame').classList.remove('hidden');
  document.getElementById('clozeResult').classList.add('hidden');
  closBestHide();
  clozeHud();
  clearInterval(clozTimerId);
  clozTimerId = setInterval(() => {
    if (!CLOZE) return;
    CLOZE.elapsed = (Date.now() - CLOZE.startedAt) / 1000;
    clozeHud();
  }, 250);
  clozeBestLine();
  clozeRender();
}

function closBestHide() {
  const el = document.getElementById('clozeResult');
  if (el) el.classList.add('hidden');
}

function clozeRender() {
  if (!CLOZE) return;
  const q = CLOZE.questions[CLOZE.idx];
  if (!q) { clozeFinish(); return; }
  CLOZE.locked = false;
  const sentEl = document.getElementById('clozeSentence');
  if (sentEl) sentEl.innerHTML = clozeSentenceHtml(q.sentence, q.gapIndex);
  const ruEl = document.getElementById('clozeRu');
  if (ruEl) ruEl.textContent = q.sentence.ru || '';
  const after = document.getElementById('clozeAfter');
  if (after) { after.className = 'cloze-after hidden'; after.innerHTML = ''; }
  const box = document.getElementById('clozeOptions');
  box.innerHTML = '';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cloze-option';
    b.dataset.opt = opt;
    b.innerHTML = '<span class="cloze-option-num">' + (i + 1) + '</span>' +
      '<span class="cloze-option-ar" dir="rtl">' + escapeHtml(opt) + '</span>';
    b.addEventListener('click', () => clozeAnswer(opt, b));
    box.appendChild(b);
  });
  clozeMsg('');
  clozeHud();
}

function clozeAnswer(opt, btn) {
  if (!CLOZE || CLOZE.locked) return;
  CLOZE.locked = true;
  const q = CLOZE.questions[CLOZE.idx];
  const ok = opt === q.correct;
  document.querySelectorAll('#clozeOptions .cloze-option').forEach(b => {
    b.classList.add('done');
    if (b.dataset.opt === q.correct) b.classList.add('right');
  });
  if (ok) {
    btn.classList.add('right');
    CLOZE.score++;
    CLOZE.ink += 2;
    if (typeof INK !== 'undefined') INK.add(2, CLOZE.section);
    if (typeof logActivity === 'function') logActivity({ reviews: 1, correct: 1, words: 1 });
    clozeMsg('Верно');
  } else {
    btn.classList.add('wrong');
    CLOZE.mistakes++;
    clozeMsg('Правильно: ' + q.correct + (q.ru ? ' — ' + q.ru : ''), true);
  }
  const sentEl = document.getElementById('clozeSentence');
  if (sentEl) sentEl.innerHTML = clozeSentenceHtml(q.sentence, -1);
  const after = document.getElementById('clozeAfter');
  if (after) {
    after.className = 'cloze-after';
    after.innerHTML = '<b dir="rtl">' + escapeHtml(q.correct) + '</b> — ' + escapeHtml(q.ru || '');
  }
  clozeHud();
  setTimeout(() => { if (CLOZE) { CLOZE.idx++; clozeRender(); } }, ok ? 900 : 2400);
}

function clozeFinish() {
  if (!CLOZE) return;
  CLOZE.elapsed = (Date.now() - CLOZE.startedAt) / 1000;
  clearInterval(clozTimerId);
  clozTimerId = null;

  const rec = gameRecords();
  rec.cloze = rec.cloze || {};
  const key = CLOZE.sourceId;
  const prev = rec.cloze[key] || null;
  const result = {
    score: CLOZE.score,
    total: CLOZE.total,
    mistakes: CLOZE.mistakes,
    seconds: Math.round(CLOZE.elapsed),
    at: Date.now()
  };
  const isRecord = gameRootBetter(prev, result, 'quiz');
  if (isRecord) rec.cloze[key] = result;
  saveGameRecords(rec);
  if (typeof logActivity === 'function') logActivity({ trainings: 1 });

  const state = CLOZE;
  CLOZE = null;
  const el = document.getElementById('clozeResult');
  el.classList.remove('hidden');
  el.innerHTML =
    '<div class="study-summary">' +
      '<div class="mem-result-title">' + (isRecord ? 'Новый рекорд!' : 'Партия завершена') + '</div>' +
      '<div class="mem-result-stats">' +
        '<span>' + fmtTime(state.elapsed) + '</span>' +
        '<span>' + state.score + ' из ' + state.total + '</span>' +
        '<span>ошибок: ' + state.mistakes + '</span>' +
      '</div>' +
      '<div class="mem-result-ink">+' + state.ink + ' чернил</div>' +
      (prev ? '<div class="mem-result-prev">Прошлое лучшее: ' + prev.score + ' из ' + prev.total + '</div>' : '') +
      '<div class="study-actions" style="justify-content:center">' +
        '<button class="ctrl-btn primary" id="clozeAgainBtn">Играть ещё</button>' +
        '<button class="ctrl-btn" id="clozeHubBtn">Другая игра</button>' +
      '</div>' +
    '</div>';
  document.getElementById('clozeAgainBtn').addEventListener('click', clozeStartGame);
  document.getElementById('clozeHubBtn').addEventListener('click', clozeBackToHub);
  renderClozeRecord();
}

function clozeBackToHub() {
  clearInterval(clozTimerId);
  clozTimerId = null;
  CLOZE = null;
  document.getElementById('clozeGame').classList.add('hidden');
  document.getElementById('gamesHub').classList.remove('hidden');
  renderGames();
}

function clozeStop() {
  clearInterval(clozTimerId);
  clozTimerId = null;
  CLOZE = null;
  const game = document.getElementById('clozeGame');
  if (game) game.classList.add('hidden');
}