/**
 * «Игры» — раздел в режиме «Арабский язык».
 * Первая игра: «Мемори+» — пары «слово ↔ перевод» (или «пропуск ↔ слово»),
 * после доски — закрепление: собрать слово из букв по переводу.
 * Чернила, журнал активности и уровни — общие с остальным сайтом.
 */
const GAMES_KEY = 'arabic-reader-games-v1';
const GAMES_RECALL_COUNT = 3;
const MEM_MISMATCH_MS = 1200;   // сколько держим открытой неверную пару (было 700 мс — слишком быстро)

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
