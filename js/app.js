// ============================================================
//  Читаем арабский — основная логика (чистый JS, без зависимостей)
//  Озвучка: готовые записи из интернета (alquran.cloud / quran.com CDN).
//  Плеер: воспроизведение по аятам (плейлист) с единой шкалой времени,
//  пауза/стоп, перемотка ±5 секунд, регулятор скорости.
// ============================================================

const STORAGE_KEY = 'arabic-reader-progress-v1';
const STUDY_STATS_KEY = () => modeNs('arabic-reader-study-stats-v1');
const DISPLAY_KEY = 'arabic-reader-display-v1';

// ------------------------- Режимы огласовок -------------------------
// Оригинальные данные НЕ изменяются: режим создаёт только визуальную копию.
// Удаляем лишь заведомо безопасные диакритические знаки:
//   U+064B–U+0653  танвин, краткие гласные, шадда, сукун, maddah above
//   U+0670         надстрочный алиф (dagger alif): رَحْمَٰن -> رحمن
//   U+06D6–U+06ED   коранические знаки паузы и малые буквы
// НЕ удаляем: U+0654/U+0655 (хамза над/под строкой — меняет слово!),
// U+0640 (татвиль), сами буквы. «Частичные» = оставить шадда (0651) и сукун (0652).
const HARAKAT_NONE_RE = /[\u064B-\u0653\u0670\u06D6-\u06ED]/g;
const HARAKAT_PARTIAL_RE = /[\u064B-\u0650\u0653\u0670\u06D6-\u06ED]/g;

function loadDisplayPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(DISPLAY_KEY));
    if (p && ['full', 'partial', 'none'].includes(p.harakat)) return p;
  } catch (e) { /* повреждены — значения по умолчанию */ }
  return { harakat: 'full' };
}

let displayPrefs = loadDisplayPrefs();

/** Визуальная учебная копия слова (данные не меняются). */
function visualWord(text, mode) {
  if (mode === 'none') return text.replace(HARAKAT_NONE_RE, '');
  if (mode === 'partial') return text.replace(HARAKAT_PARTIAL_RE, '');
  return text;
}

function setHarakatMode(mode) {
  displayPrefs.harakat = mode;
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(displayPrefs));
  } catch (e) { /* запись не критична */ }
  applyHarakatToDom();
  updateHarakatControls();
}

/** Применить текущий режим ко всем отрисованным словам (без перерисовки). */
function applyHarakatToDom() {
  const mode = displayPrefs.harakat;
  document.querySelectorAll('.word').forEach(el => {
    if (el.dataset.orig) el.textContent = visualWord(el.dataset.orig, mode);
  });
  document.querySelectorAll('.words-ar').forEach(el => {
    if (el.dataset.orig) el.textContent = visualWord(el.dataset.orig, mode);
  });
  const b = document.getElementById('basmalaAr');
  if (b && b.dataset.orig) b.textContent = visualWord(b.dataset.orig, mode);
}

function updateHarakatControls() {
  const wrap = document.getElementById('harakatControls');
  if (!wrap) return;
  wrap.querySelectorAll('button[data-h]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.h === displayPrefs.harakat);
  });
}

// ------------------------- Запись своего чтения (локально) -------------------------
// MediaRecorder; запись не покидает браузер, никуда не отправляется
// и НЕ является проверкой правильности чтения или таджвида.

let recState = null; // { recorder, stream, url }
let recAudio = null; // воспроизведение своей записи (одно за раз)

function recSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function setRecStatus(text) {
  const el = document.getElementById('recStatus');
  if (el) el.textContent = text || '';
}

function updateRecButtons() {
  const recording = !!(recState && recState.recorder && recState.recorder.state === 'recording');
  const hasUrl = !!(recState && recState.url);
  const t = document.getElementById('recToggleBtn');
  if (t) t.textContent = recording ? '■ Остановить запись' : 'Записать моё чтение';
  const p = document.getElementById('recPlayBtn');
  if (p) p.classList.toggle('hidden', !hasUrl);
  const d = document.getElementById('recDeleteBtn');
  if (d) d.classList.toggle('hidden', !hasUrl);
}

async function toggleRecording() {
  const recording = !!(recState && recState.recorder && recState.recorder.state === 'recording');
  if (recording) {
    try { recState.recorder.stop(); } catch (e) {}
    return;
  }
  if (!recSupported()) {
    setRecStatus('Запись не поддерживается в этом браузере (или страница открыта не по localhost/https). Запись работает только локально и никуда не отправляется.');
    return;
  }
  deleteRecording(false); // новая запись заменяет предыдущую
  setRecStatus('Запрашиваем доступ к микрофону…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const opts = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm'))
      ? { mimeType: 'audio/webm' }
      : undefined;
    const recorder = new MediaRecorder(stream, opts);
    const chunks = [];
    recorder.ondataavailable = e => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach(tr => tr.stop());
      if (recState && recState.recorder === recorder) {
        recState.url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        setRecStatus('Запись готова — можно прослушать себя.');
      }
      updateRecButtons();
    };
    recState = { recorder, stream, url: null };
    recorder.start();
    setRecStatus('Идёт запись… читайте вслух, затем нажмите «Остановить запись».');
    updateRecButtons();
  } catch (err) {
    recState = null;
    setRecStatus(err && err.name === 'NotAllowedError'
      ? 'Доступ к микрофону не разрешён — его можно выдать в настройках браузера.'
      : 'Не удалось начать запись: ' + ((err && err.name) || 'ошибка'));
    updateRecButtons();
  }
}

function playRecording() {
  if (!recState || !recState.url) return;
  stopAllAudio('rec'); // одно аудио за раз: глушим слово, плеер и Хифз
  const a = new Audio(recState.url);
  recAudio = a;
  a.addEventListener('ended', () => { if (recAudio === a) recAudio = null; });
  a.play().catch(() => {
    if (recAudio === a) recAudio = null;
    setRecStatus('Не удалось воспроизвести запись.');
  });
}

/** Остановить воспроизведение своей записи (если играет). */
function stopRecordingAudio() {
  if (!recAudio) return;
  try { recAudio.pause(); } catch (e) {}
  recAudio = null;
}

function deleteRecording(showMsg) {
  stopRecordingAudio();
  if (!recState) return;
  if (recState.recorder && recState.recorder.state === 'recording') {
    try { recState.recorder.onstop = null; recState.recorder.stop(); } catch (e) {}
  }
  if (recState.stream) recState.stream.getTracks().forEach(tr => tr.stop());
  if (recState.url) URL.revokeObjectURL(recState.url);
  recState = null;
  setRecStatus(showMsg === false ? '' : 'Запись удалена.');
  updateRecButtons();
}

/** Остановить активную запись (например, при уходе с экрана), не удаляя её. */
function stopRecordingIfActive() {
  if (recState && recState.recorder && recState.recorder.state === 'recording') {
    try { recState.recorder.stop(); } catch (e) {}
  }
}

/** Состояние слов: { "storyId:sIdx:wIdx": "seen" | "known" } */
let progress = loadProgress();
let currentStory = null;

// ----- Плеер -----
let playerAudio = null;
let wantPlaying = false;   // должен ли плеер играть после загрузки нового аята
let playlist = [];        // [{src, duration}] — по аятам
let starts = [];          // starts[i] — начало аята i на общей шкале
let totalDuration = 0;
let currentAyah = 0;      // индекс текущего аята в плейлисте
let isSeeking = false;    // пользователь тянет ползунок
let metaProbeAudios = []; // скрытые Audio для определения длительностей

// ----- Аудио слова (карточка) -----
let wordAudio = null;

// ----- Разделы и тренажёр -----
let currentSection = 'quran'; // 'quran' | 'hadith'
let study = null;
let currentExercise = null; // текущее задание с вариантами: { q, options, correct, btns } — для клавиатуры

// ------------------------- Хранилище прогресса -------------------------

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  updateProgressBadge();
}

function updateProgressBadge() {
  const el = document.getElementById('progressBadge');
  if (!el) return;
  const knownCount = Object.values(progress).filter(s => s === 'known').length;
  el.textContent = `Изучено слов: ${knownCount}`;
}

function wordKey(storyId, sIdx, wIdx) {
  return `${storyId}:${sIdx}:${wIdx}`;
}

// ------------------------- Сохранение состояния интерфейса -------------------------
// Переживает обновление страницы (F5) в рамках вкладки: раздел, открытый текст, прокрутка.

const UI_STATE_KEY = 'arabic-reader-ui-state-v1';

function saveUiState() {
  try {
    const readerVisible = !document.getElementById('screen-reader').classList.contains('hidden');
    sessionStorage.setItem(UI_STATE_KEY, JSON.stringify({
      section: currentSection || null,
      storyId: (readerVisible && currentStory) ? currentStory.id : null,
      y: window.scrollY || 0
    }));
  } catch (e) { /* запись не критична */ }
}

let uiStateTimer = null;
window.addEventListener('scroll', () => {
  if (uiStateTimer) return;
  uiStateTimer = setTimeout(() => { uiStateTimer = null; saveUiState(); }, 300);
}, { passive: true });

// ------------------------- Навигация -------------------------

function goHome() {
  switchTo(currentSection);
}

/** Список историй выбранного раздела. */
function storiesOf(section) {
  return [...STORIES_DATA.stories]
    .filter(s => {
      const t = s.type || 'quran';
      if (section === 'quran') return t === 'quran';
      if (section === 'hadith') return t === 'hadith';
      if (section === 'stories') return t === 'story';
      if (section === 'adhkar') return t === 'adhkar';
      if (section === 'namaz') return t === 'namaz';
      if (section === 'huna1') return t === 'huna1';
      if (section === 'huna2') return t === 'huna2';
      return false;
    })
    .sort((a, b) => {
      if (section === 'huna1' || section === 'huna2') {
        const c = (a.chapterNo ?? 0) - (b.chapterNo ?? 0);
        if (c !== 0) return c;
        const r = (a.order ?? 0) - (b.order ?? 0);
        if (r !== 0) return r;
        return (a.dialogueNo ?? 0) - (b.dialogueNo ?? 0);
      }
      return (a.surahNo ?? 9999) - (b.surahNo ?? 9999);
    });
}

/** Переключение раздела (Главная / Коран / Хадисы / Изучение / Повторить сегодня / Хифз). */
function switchTo(section) {
  // раздел должен принадлежать текущему режиму (Ислам / Арабский язык)
  if (typeof sectionInMode === 'function' && !sectionInMode(section) && section !== 'study') {
    section = 'home';
  }
  currentSection = section;
  clearAdvance(); // останавливаем авто-переход тренажёра при смене раздела
  stopPlayer(); // плеер читалки: пауза + сброс UI
  stopAllAudio(); // один аудиопоток: глушим слово, Хифз и свою запись
  clearPlayingHighlight();
  closeWordCard();
  stopRecordingIfActive(); // останавливаем запись голоса при уходе
  ['screen-home', 'screen-routes', 'screen-list', 'screen-hadith', 'screen-stories', 'screen-adhkar', 'screen-study', 'screen-review', 'screen-hifz', 'screen-huna1', 'screen-huna2', 'screen-words', 'screen-grammar', 'screen-grammar-note', 'screen-reader'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  const screenMap = {
    home: 'screen-home',
    routes: 'screen-routes',
    quran: 'screen-list',
    hadith: 'screen-hadith',
    stories: 'screen-stories',
    adhkar: 'screen-adhkar',
    study: 'screen-study',
    review: 'screen-review',
    hifz: 'screen-hifz',
    huna1: 'screen-huna1',
    huna2: 'screen-huna2',
    words: 'screen-words',
    grammar: 'screen-grammar'
  };
  document.getElementById(screenMap[section]).classList.remove('hidden');
  document.querySelectorAll('.nav-tab[data-section]').forEach(t => {
    t.classList.toggle('active', t.dataset.section === section);
  });
  if (section === 'home' && typeof renderHome === 'function') renderHome();
  if (section === 'routes' && typeof renderRoutes === 'function') renderRoutes();
  if (section === 'quran' || section === 'hadith' || section === 'stories' || section === 'adhkar') renderStoryList(section);
  if (section === 'huna1' || section === 'huna2') renderBookList(section);
  if (section === 'words') renderWordsScreen();
  if (section === 'grammar') renderGrammarList();
  if (section === 'study') populateStudySources();
  if (section === 'review' && typeof SRS !== 'undefined') SRS.renderScreen();
  if (section === 'hifz' && typeof HIFZ !== 'undefined') HIFZ.renderScreen();
  saveUiState();
  window.scrollTo(0, 0);
}

function openStory(storyId) {
  const story = STORIES_DATA.stories.find(s => s.id === storyId);
  if (!story) return;
  stopPlayer(); // безопасно при переходе между сурами из навигации
  clearPlayingHighlight();
  stopWordAudio();
  stopRecordingIfActive();
  currentStory = story;
  if (typeof SRS !== 'undefined') SRS.setLastStory(story.id); // приоритет новых слов SRS — из открытого текста
  if (typeof markStoryVisited === 'function') markStoryVisited(story.id); // прогресс маршрутов
  renderStory(story);
  // прячем ВСЕ экраны (openStory вызывается и с «Маршрутов», и с «Главной»,
  // где screen-list/screen-hadith не единственные возможные)
  ['screen-home', 'screen-routes', 'screen-list', 'screen-hadith', 'screen-stories', 'screen-adhkar', 'screen-study', 'screen-review', 'screen-hifz', 'screen-huna1', 'screen-huna2', 'screen-words', 'screen-grammar', 'screen-grammar-note', 'screen-reader'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById('screen-reader').classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ------------------------- Списки историй по разделам -------------------------

// Статусы изучения сур: ✎ изучаю → ★ выучил
const STORY_STATUS_KEY = 'arabic-reader-story-status-v1';
const SURAH_FILTER_KEY = 'arabic-reader-surah-filter-v1';
const STORY_STATUSES = {
  learning:  { label: 'Изучаю', icon: '✎' },
  memorized: { label: 'Выучил', icon: '★' }
};
const STORY_STATUS_CYCLE = [null, 'learning', 'memorized'];
let surahSearchQuery = '';

function getStoryStatuses() {
  try { return JSON.parse(localStorage.getItem(STORY_STATUS_KEY)) || {}; } catch (e) { return {}; }
}

function setStoryStatus(storyId, status) {
  const s = getStoryStatuses();
  if (status) s[storyId] = status; else delete s[storyId];
  try { localStorage.setItem(STORY_STATUS_KEY, JSON.stringify(s)); } catch (e) { /* не критично */ }
}

function getSurahFilter() {
  try { return localStorage.getItem(SURAH_FILTER_KEY) || 'all'; } catch (e) { return 'all'; }
}

function setSurahFilter(f) {
  try { localStorage.setItem(SURAH_FILTER_KEY, f); } catch (e) { /* не критично */ }
}

/** Клик по статусу суры — переключение по кругу (не задан → хочу изучить → … → выучил). */
function cycleStoryStatus(storyId) {
  const s = getStoryStatuses();
  const cur = STORY_STATUS_CYCLE.indexOf(s[storyId] || null);
  setStoryStatus(storyId, STORY_STATUS_CYCLE[(cur + 1) % STORY_STATUS_CYCLE.length]);
  renderStoryList('quran');
}

function renderStoryList(section) {
  const listIds = {
    quran: 'storyList',
    hadith: 'hadithList',
    stories: 'storiesList',
    adhkar: 'adhkarList'
  };
  const container = document.getElementById(listIds[section] || 'storyList');
  container.innerHTML = '';

  // Панель фильтра статусов + поиск (только для Корана)
  let grid = container;
  if (section === 'quran') {
    const filter = getSurahFilter();
    const bar = document.createElement('div');
    bar.className = 'surah-filter';
    [['all', 'Все'], ['learning', '✎ Изучаю'], ['memorized', '★ Выучил']]
      .forEach(([id, label]) => {
        const b = document.createElement('button');
        b.className = 'sf-btn' + (filter === id ? ' active' : '');
        b.textContent = label;
        b.addEventListener('click', () => { setSurahFilter(id); renderStoryList('quran'); });
        bar.appendChild(b);
      });
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'sf-search';
    search.placeholder = 'Поиск: название или номер суры…';
    search.value = surahSearchQuery;
    search.addEventListener('input', () => {
      surahSearchQuery = search.value.trim().toLowerCase();
      renderSurahCards(grid);
    });
    bar.appendChild(search);
    container.appendChild(bar);

    grid = document.createElement('div');
    grid.className = 'story-grid';
    container.appendChild(grid);
  }

  renderSurahCards(grid);

  /** Карточки сур/текстов в переданный контейнер (учитывает фильтр статуса и поиск). */
  function renderSurahCards(target) {
    target.innerHTML = '';
    const sts = getStoryStatuses();
    const flt = (section === 'quran') ? getSurahFilter() : 'all';
    const q = (section === 'quran') ? surahSearchQuery : '';

    storiesOf(section).forEach(story => {
      if (section === 'quran') {
        if (flt !== 'all' && sts[story.id] !== flt) return;
        if (q && !surahMatches(story, q)) return;
      }
      const totalWords = story.sentences.reduce((sum, s) => sum + s.words.length, 0);
      const card = document.createElement('div');
      card.className = 'story-card';
      card.dataset.surah = story.surahNo || '';
      card.innerHTML = `
        <div class="sc-ar" lang="ar" dir="rtl">${escapeHtml(story.title)}</div>
        <div class="sc-ru">${escapeHtml(story.titleRu)}</div>
        <div class="sc-meta">${escapeHtml(story.level)} · ${totalWords} слов</div>
      `;
      card.addEventListener('click', () => openStory(story.id));

      // Значок «учить слова» — сразу в тренажёр по этому тексту (не открывая текст)
      const studyChip = document.createElement('button');
      studyChip.type = 'button';
      studyChip.className = 'sc-study';
      studyChip.title = 'Выучить слова из этого текста';
      studyChip.setAttribute('aria-label', 'Выучить слова из этого текста');
      studyChip.textContent = 'Aa';
      studyChip.addEventListener('click', (e) => { e.stopPropagation(); studyStory(story.id); });
      card.appendChild(studyChip);

      // Статус изучения суры (клик — переключить, не открывая суру)
      if (section === 'quran') {
        const st = sts[story.id];
        const chip = document.createElement('button');
        chip.className = 'sc-status' + (st ? ' ' + st : '');
        chip.title = 'Статус: ' + (st ? STORY_STATUSES[st].label : 'не задан') + ' (клик — переключить)';
        chip.innerHTML = st
          ? STORY_STATUSES[st].icon + ' ' + STORY_STATUSES[st].label
          : '✎';
        chip.addEventListener('click', (e) => { e.stopPropagation(); cycleStoryStatus(story.id); });
        card.appendChild(chip);
      }

      target.appendChild(card);
    });
  }
}

/** Список материалов книги «Хуна Арабия»: главы → диалоги/тексты + слова и грамматика главы. */
function renderBookList(bookId) {
  const container = document.getElementById(bookId === 'huna1' ? 'huna1List' : 'huna2List');
  if (!container) return;
  container.innerHTML = '';
  const book = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books)
    ? HUNA_DATA.books.find(b => b.id === bookId) : null;
  if (!book) {
    container.innerHTML = '<p class="stats-empty">Материалы книги не загружены.</p>';
    return;
  }

  book.chapters.forEach(ch => {
    const wrap = document.createElement('section');
    wrap.className = 'book-chapter';

    const head = document.createElement('h3');
    head.className = 'book-chapter-title';
    head.innerHTML = `Глава ${ch.no}. ${escapeHtml(ch.titleRu || '')}` +
      (ch.titleAr ? ` <span class="book-chapter-ar" lang="ar" dir="rtl">${escapeHtml(ch.titleAr)}</span>` : '');
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'book-dialogues';
    [...ch.dialogues]
      .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || ((a.no ?? 0) - (b.no ?? 0)))
      .forEach(d => {
        const card = document.createElement('div');
        card.className = 'dlg-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.innerHTML = `
          <span class="dlg-no">${escapeHtml(d.titleRu)}</span>
          ${d.topic ? `<span class="dlg-topic">${escapeHtml(d.topic)}</span>` : ''}
          ${d.characters ? `<span class="dlg-chars">${escapeHtml(d.characters)}</span>` : ''}`;
        const open = () => openStory(d.id);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sc-study';
        chip.title = 'Выучить слова из этого диалога';
        chip.setAttribute('aria-label', 'Выучить слова из этого диалога');
        chip.textContent = 'Aa';
        chip.addEventListener('click', (e) => { e.stopPropagation(); studyStory(d.id); });
        card.appendChild(chip);

        grid.appendChild(card);
      });
    wrap.appendChild(grid);

    container.appendChild(wrap);
  });
}

// Раскрытые главы грамматики (по умолчанию всё свёрнуто)
const GRAMMAR_OPEN_KEY = 'arabic-reader-grammar-open-v1';
function loadGrammarOpen() {
  try {
    const a = JSON.parse(localStorage.getItem(GRAMMAR_OPEN_KEY));
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) { return new Set(); }
}
function saveGrammarOpen() {
  try { localStorage.setItem(GRAMMAR_OPEN_KEY, JSON.stringify([...grammarOpen])); } catch (e) { /* не критично */ }
}
let grammarOpen = loadGrammarOpen();

/** Список заметок грамматики, сгруппированный по главам курса (сворачиваемые главы). */
function renderGrammarList() {
  const container = document.getElementById('grammarList');
  if (!container) return;
  container.innerHTML = '';
  const groups = (typeof grammarGroups === 'function') ? grammarGroups() : [];
  if (!groups.length) {
    container.innerHTML = '<p class="stats-empty">Заметки грамматики не загружены.</p>';
    return;
  }

  groups.forEach(g => {
    const folded = !grammarOpen.has(g.id);
    const sec = document.createElement('section');
    sec.className = 'gram-chapter' + (folded ? ' folded' : '');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'gram-chapter-title';
    head.setAttribute('aria-expanded', folded ? 'false' : 'true');
    head.innerHTML =
      `<span class="gram-caret" aria-hidden="true">${folded ? '▸' : '▾'}</span>` +
      `<span class="gram-chapter-name">${g.no ? 'Глава ' + g.no + '. ' : ''}${escapeHtml(g.titleRu || '')}` +
        (g.titleAr ? ` <span class="book-chapter-ar" lang="ar" dir="rtl">${escapeHtml(g.titleAr)}</span>` : '') +
      `</span>` +
      `<span class="gram-chapter-stat">${g.tom ? 'Том ' + g.tom + ' · ' : ''}заметок: ${g.notes.length}</span>`;

    const panel = document.createElement('div');
    panel.className = 'gram-chapter-panel' + (folded ? ' hidden' : '');

    head.addEventListener('click', () => {
      if (grammarOpen.has(g.id)) grammarOpen.delete(g.id); else grammarOpen.add(g.id);
      saveGrammarOpen();
      const nowFolded = !grammarOpen.has(g.id);
      sec.classList.toggle('folded', nowFolded);
      panel.classList.toggle('hidden', nowFolded);
      head.setAttribute('aria-expanded', nowFolded ? 'false' : 'true');
      const caret = head.querySelector('.gram-caret');
      if (caret) caret.textContent = nowFolded ? '▸' : '▾';
      updateGrammarFoldAllLabel();
    });
    sec.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grammar-list';
    g.notes.forEach(n => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gram-card';
      card.textContent = n.title;
      card.addEventListener('click', () => openGrammarNote(n.id));
      grid.appendChild(card);
    });
    panel.appendChild(grid);
    sec.appendChild(panel);
    container.appendChild(sec);
  });

  const foldAll = document.getElementById('grammarFoldAll');
  if (foldAll) {
    foldAll.onclick = () => {
      const allOpen = groups.length > 0 && groups.every(x => grammarOpen.has(x.id));
      groups.forEach(x => { if (allOpen) grammarOpen.delete(x.id); else grammarOpen.add(x.id); });
      saveGrammarOpen();
      renderGrammarList();
    };
  }
  updateGrammarFoldAllLabel();
}

/** Подпись кнопки «Свернуть/Развернуть все» в разделе «Грамматика». */
function updateGrammarFoldAllLabel() {
  const btn = document.getElementById('grammarFoldAll');
  if (!btn) return;
  const groups = (typeof grammarGroups === 'function') ? grammarGroups() : [];
  const allOpen = groups.length > 0 && groups.every(g => grammarOpen.has(g.id));
  btn.textContent = allOpen ? 'Свернуть все' : 'Развернуть все';
  btn.disabled = !groups.length;
}

/** Открыть заметку грамматики (отрендеренный HTML). */
function openGrammarNote(id) {
  const notes = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.grammar) ? HUNA_DATA.grammar : [];
  const g = notes.find(x => x.id === id);
  if (!g) return;
  document.getElementById('grammarNoteTitle').textContent = g.title;
  document.getElementById('grammarNoteBody').innerHTML = g.html || '';
  ['screen-home', 'screen-routes', 'screen-list', 'screen-hadith', 'screen-stories', 'screen-adhkar', 'screen-study', 'screen-review', 'screen-hifz', 'screen-huna1', 'screen-huna2', 'screen-words', 'screen-grammar', 'screen-reader'].forEach(sid => {
    document.getElementById(sid).classList.add('hidden');
  });
  document.getElementById('screen-grammar-note').classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ------------------------- Раздел «Слова» (Том → Глава → слова) -------------------------
// Статус изучения берётся из тех же данных, что и тренажёр/SRS:
//   «Выучено»   — серия верных ответов достигла порога режима (learnStreak)
//                 или SRS-карточка в состоянии review;
//   «Учу»       — по слову уже были ответы, но порог не достигнут;
//   «Не начато» — слово ещё не встречалось в тренировках.

// Чистая логика (wordsNorm / wordStudyStatus / chapterWordEntries / resolveStudySource)
// и подписи статусов — в js/words-core.js (загружается до app.js).
const WORDS_STATE = { book: null, query: '', status: 'all' };
let pendingStudySource = null; // источник тренажёра, заданный не через <select> (например, глава)

// Раскрытые главы (id) — запоминаются между визитами. По умолчанию список пуст,
// то есть все главы СВЁРНУТЫ: чтобы увидеть слова, раскрывают нужную главу.
const WORDS_OPEN_KEY = 'arabic-reader-words-open-v1';
function loadWordsOpen() {
  try {
    const a = JSON.parse(localStorage.getItem(WORDS_OPEN_KEY));
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) { return new Set(); }
}
function saveWordsOpen() {
  try { localStorage.setItem(WORDS_OPEN_KEY, JSON.stringify([...wordsOpen])); } catch (e) { /* не критично */ }
}
let wordsOpen = loadWordsOpen();

/** Открыть тренажёр по всем словам главы. */
function studyChapter(chId) {
  if (!chId) return;
  pendingStudySource = 'chapter:' + chId;
  switchTo('study');
  startStudy();
}

/** Раздел «Слова»: переключатель томов, поиск, фильтр по статусу. */
function renderWordsScreen() {
  const books = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books : [];
  const body = document.getElementById('wordsBody');
  if (!books.length) {
    body.innerHTML = '<p class="stats-empty">Слова не загружены.</p>';
    return;
  }
  if (!WORDS_STATE.book || !books.some(b => b.id === WORDS_STATE.book)) WORDS_STATE.book = books[0].id;

  const bookBar = document.getElementById('wordsBooks');
  bookBar.innerHTML = '';
  books.forEach(b => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'words-book-btn' + (b.id === WORDS_STATE.book ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', b.id === WORDS_STATE.book ? 'true' : 'false');
    btn.textContent = (b.title || '').replace('Хуна Арабия — ', '');
    btn.addEventListener('click', () => { WORDS_STATE.book = b.id; renderWordsScreen(); });
    bookBar.appendChild(btn);
  });

  const filters = document.getElementById('wordsFilters');
  filters.innerHTML = '';
  [['all', 'Все'], ['new', 'Не начато'], ['learning', 'Учу'], ['learned', 'Выучено']].forEach(([val, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'words-filter-btn' + (WORDS_STATE.status === val ? ' active' : '');
    btn.setAttribute('aria-pressed', WORDS_STATE.status === val ? 'true' : 'false');
    btn.textContent = label;
    btn.addEventListener('click', () => { WORDS_STATE.status = val; renderWordsScreen(); });
    filters.appendChild(btn);
  });

  const search = document.getElementById('wordsSearch');
  if (search.value !== WORDS_STATE.query) search.value = WORDS_STATE.query;
  search.oninput = () => { WORDS_STATE.query = search.value.trim(); renderWordsList(); };

  const foldAll = document.getElementById('wordsFoldAll');
  if (foldAll) {
    foldAll.onclick = () => {
      const book = books.find(b => b.id === WORDS_STATE.book);
      const chapters = (book && book.chapters) || [];
      const allOpen = chapters.length > 0 && chapters.every(c => wordsOpen.has(c.id));
      chapters.forEach(c => { if (allOpen) wordsOpen.delete(c.id); else wordsOpen.add(c.id); });
      saveWordsOpen();
      renderWordsList();
    };
  }

  renderWordsList();
}

/** Отрисовать главы и слова выбранного тома с учётом поиска/фильтра. */
function renderWordsList() {
  const book = HUNA_DATA.books.find(b => b.id === WORDS_STATE.book);
  const body = document.getElementById('wordsBody');
  const summary = document.getElementById('wordsSummary');
  body.innerHTML = '';
  if (!book) return;

  const stats = getStudyStats();
  const cards = (typeof SRS !== 'undefined' && SRS.getAllCards) ? SRS.getAllCards() : {};
  const lim = learnStreak();
  const q = WORDS_STATE.query.toLowerCase();
  const qNorm = wordsNorm(WORDS_STATE.query);
  const status = WORDS_STATE.status;
  // слово принадлежит главе первого вхождения — в остальных главах не повторяется
  const ownerMap = wordOwnerMap();

  const totals = { learned: 0, learning: 0, new: 0, all: 0 };
  const chapters = (book.chapters || []).map(ch => {
    const entries = chapterWordEntries(ch, stats, cards, lim, ownerMap);
    const st = { learned: 0, learning: 0, new: 0, all: entries.length };
    entries.forEach(e => st[e.status]++);
    totals.all += st.all; totals.learned += st.learned; totals.learning += st.learning; totals.new += st.new;
    return { ch, entries, st };
  });

  // «Оживающая рукопись»: весь том как лист, подсвечиваемый золотом
  const bookPct = totals.all ? Math.round(totals.learned / totals.all * 100) : 0;
  const doneChapters = chapters.filter(c => c.st.all > 0 && c.st.learned >= c.st.all).length;

  summary.innerHTML =
    `<div class="ms-book">
      <div class="ms-book-top">
        <span class="ms-book-label">Рукопись тома</span>
        <span class="ms-book-pct">${bookPct}%</span>
      </div>
      <div class="ms-book-bar" role="img" aria-label="Рукопись тома заполнена на ${bookPct}%">
        <div class="ms-book-fill" style="width:${bookPct}%"></div>
      </div>
      <span class="ms-book-note">завершено глав: ${doneChapters} из ${chapters.length} · каждое выученное слово проявляет строку</span>
    </div>` +
    `<span class="words-sum ws-learned">Выучено: ${totals.learned}</span>` +
    `<span class="words-sum ws-learning">Учу: ${totals.learning}</span>` +
    `<span class="words-sum ws-new">Не начато: ${totals.new}</span>` +
    `<span class="words-sum ws-all">Всего: ${totals.all}</span>`;

  const matches = (e) => {
    if (status !== 'all' && e.status !== status) return false;
    if (!q) return true;
    if (e.ru && e.ru.toLowerCase().includes(q)) return true;
    if (e.tr && e.tr.toLowerCase().includes(q)) return true;
    if (qNorm && wordsNorm(e.w).includes(qNorm)) return true;
    // ищем и по формам, вошедшим в основу (أُخْتُكُمْ находится, хотя показано «أخت»)
    if (qNorm && (e.tokens || []).some(t => wordsNorm(t).includes(qNorm))) return true;
    return false;
  };

  // при активном поиске/фильтре главы раскрываем принудительно — иначе найденное скрыто
  const forceOpen = !!q || status !== 'all';

  let shown = 0;
  chapters.forEach(({ ch, entries, st }) => {
    const visible = entries.filter(matches);
    if (!visible.length && forceOpen) return;
    shown++;

    const folded = !forceOpen && !wordsOpen.has(ch.id);

    // лист главы: штрихи-«слова» подсвечиваются золотом по мере выучивания
    const chPct = st.all ? Math.round(st.learned / st.all * 100) : 0;
    const chDashes = manuscriptDashes(st.learned, st.all, 10);
    const chComplete = st.all > 0 && st.learned >= st.all;

    const wrap = document.createElement('section');
    wrap.className = 'words-chapter' + (folded ? ' folded' : '') + (chComplete ? ' ms-complete' : '');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'words-chapter-title';
    head.setAttribute('aria-expanded', folded ? 'false' : 'true');
    head.innerHTML =
      `<span class="words-caret" aria-hidden="true">${folded ? '▸' : '▾'}</span>` +
      `<span class="words-chapter-name">Глава ${ch.no}. ${escapeHtml(ch.titleRu || '')}` +
        (ch.titleAr ? ` <span class="book-chapter-ar" lang="ar" dir="rtl">${escapeHtml(ch.titleAr)}</span>` : '') +
      `</span>` +
      `<span class="ms-leaf" role="img" aria-label="Рукопись главы: ${chPct}%">` +
        Array.from({ length: 10 }, (_, i) => `<i${i < chDashes ? ' class="on"' : ''}></i>`).join('') +
      `</span>` +
      `<span class="words-chapter-stat">${st.learned} / ${st.all} · ${chComplete ? 'лист завершён' : chPct + '%'}</span>`;

    const panel = document.createElement('div');
    panel.className = 'words-chapter-panel' + (folded ? ' hidden' : '');

    if (forceOpen) {
      head.disabled = true;
      head.classList.add('no-fold');
    } else {
      head.addEventListener('click', () => {
        if (wordsOpen.has(ch.id)) wordsOpen.delete(ch.id); else wordsOpen.add(ch.id);
        saveWordsOpen();
        const nowFolded = !wordsOpen.has(ch.id);
        wrap.classList.toggle('folded', nowFolded);
        panel.classList.toggle('hidden', nowFolded);
        head.setAttribute('aria-expanded', nowFolded ? 'false' : 'true');
        const caret = head.querySelector('.words-caret');
        if (caret) caret.textContent = nowFolded ? '▸' : '▾';
        updateFoldAllLabel();
      });
    }

    // кнопка тренировки видна ВСЕГДА — даже когда глава свёрнута
    const train = document.createElement('button');
    train.type = 'button';
    train.className = 'words-train-btn';
    train.setAttribute('aria-label', `Изучить все слова главы ${ch.no}`);
    train.title = 'Изучить все слова этой главы';
    train.innerHTML = 'Aa<span class="words-train-label"> Тренировать главу</span>';
    train.addEventListener('click', () => studyChapter(ch.id));

    const headRow = document.createElement('div');
    headRow.className = 'words-chapter-head';
    headRow.appendChild(head);
    headRow.appendChild(train);
    wrap.appendChild(headRow);

    const table = document.createElement('div');
    table.className = 'words-table';
    visible.forEach(e => {
      const row = document.createElement('div');
      row.className = 'words-row st-' + e.status;

      const ar = document.createElement('span');
      ar.className = 'words-ar';
      ar.lang = 'ar';
      ar.dir = 'rtl';
      ar.dataset.orig = e.w;
      ar.textContent = visualWord(wordDisplay(e.w), displayPrefs.harakat);

      const wordCell = document.createElement('span');
      wordCell.className = 'words-word';
      wordCell.appendChild(ar);
      if (e.tr) {
        const tr = document.createElement('span');
        tr.className = 'words-tr';
        tr.textContent = e.tr;
        wordCell.appendChild(tr);
      }

      const ru = document.createElement('span');
      ru.className = 'words-ru';
      ru.textContent = e.ru || '—';

      const stBadge = document.createElement('span');
      stBadge.className = 'words-status';
      stBadge.textContent = WORD_STATUS_LABEL[e.status];

      row.appendChild(wordCell);
      row.appendChild(ru);
      row.appendChild(stBadge);
      table.appendChild(row);
    });
    panel.appendChild(table);
    wrap.appendChild(panel);
    body.appendChild(wrap);
  });

  if (!shown) body.innerHTML = '<p class="stats-empty">Ничего не найдено.</p>';
  updateFoldAllLabel();
}

/** Подпись и доступность кнопки «Свернуть/Развернуть все» для текущего тома. */
function updateFoldAllLabel() {
  const btn = document.getElementById('wordsFoldAll');
  if (!btn) return;
  const book = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) ? HUNA_DATA.books.find(b => b.id === WORDS_STATE.book) : null;
  const chapters = (book && book.chapters) || [];
  const blocked = !!WORDS_STATE.query || WORDS_STATE.status !== 'all';
  const allOpen = chapters.length > 0 && chapters.every(c => wordsOpen.has(c.id));
  btn.textContent = allOpen ? 'Свернуть все' : 'Развернуть все';
  btn.disabled = blocked || !chapters.length;
  btn.title = blocked ? 'Недоступно при активном поиске или фильтре' : '';
}

/** Совпадение суры с поисковым запросом: русское/арабское название или номер. */
function surahMatches(story, q) {
  if (String(story.surahNo) === q) return true;
  if (story.titleRu && story.titleRu.toLowerCase().includes(q)) return true;
  if (story.title && story.title.includes(q)) return true; // арабское название — как есть
  return false;
}

// ------------------------- Рендер истории -------------------------

function renderStory(story) {
  document.getElementById('storyTitleAr').textContent = story.title;
  document.getElementById('storyTitleRu').textContent =
    story.titleRu + (story.topic ? ' · ' + story.topic : '');

  // Подпись кнопки «назад» зависит от раздела (читалка общая для всех текстов)
  const backBtn = document.getElementById('readerBackBtn');
  if (backBtn) {
    const t = story.type || 'quran';
    backBtn.textContent =
      t === 'quran'  ? '← К списку сур' :
      t === 'hadith' ? '← К списку хадисов' :
      t === 'adhkar' ? '← К списку азкаров' :
      t === 'namaz'  ? '← К разделу «Намаз»' :
      t === 'huna1'  ? '← К «Хуна Арабия 1 Том»' :
      t === 'huna2'  ? '← К «Хуна Арабия 2 Том»' :
                       '← К списку историй';
  }

  // Пояснительный текст раздела (например, «Намаз»): note — абзацы через \n
  const introEl = document.getElementById('storyIntro');
  if (introEl) {
    if (story.note) {
      introEl.innerHTML = story.note.split('\n').filter(Boolean)
        .map(p => `<p>${escapeHtml(p)}</p>`).join('');
      introEl.classList.remove('hidden');
    } else {
      introEl.innerHTML = '';
      introEl.classList.add('hidden');
    }
  }

  // Басмала (если есть)
  const bAr = document.getElementById('basmalaAr');
  const bRu = document.getElementById('basmalaRu');
  if (story.basmala) {
    bAr.dataset.orig = story.basmala;
    bAr.textContent = visualWord(story.basmala, displayPrefs.harakat);
    bRu.textContent = story.basmalaRu || '';
    bAr.parentElement.classList.remove('hidden');
  } else {
    delete bAr.dataset.orig;
    bAr.parentElement.classList.add('hidden');
  }

  const textContainer = document.getElementById('storyText');
  textContainer.innerHTML = '';

  story.sentences.forEach((sentence, sIdx) => {
    const sentenceDiv = document.createElement('div');
    sentenceDiv.className = 'sentence';
    sentenceDiv.dataset.sidx = sIdx; // атрибут data-sidx (селекторы ищут именно его)
    sentenceDiv.lang = 'ar';
    sentenceDiv.dir = 'rtl';

    // Говорящий (диалоги «Хуна Арабия») — подпись над репликой
    if (sentence.speakerRu || sentence.speakerAr) {
      const sp = document.createElement('div');
      sp.className = 'sentence-speaker';
      sp.dir = 'ltr';
      sp.textContent = (sentence.speakerRu || sentence.speakerAr) + ':';
      sentenceDiv.appendChild(sp);
    }

    // Бейдж с номером аята: клик — проиграть с этого аята
    if (sentence.ayah) {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'ayah-num';
      badge.textContent = String(sentence.ayah);
      badge.title = `Аят ${sentence.ayah} — нажми, чтобы прослушать с этого места`;
      badge.setAttribute('aria-label', `Прослушать с аята ${sentence.ayah}`);
      badge.addEventListener('click', () => playFromAyah(sIdx));
      sentenceDiv.appendChild(badge);
    } else if (sentence.audio) {
      // озвучка материала («Хуна Арабия»): клик — проиграть эту реплику
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'ayah-num play-badge';
      badge.textContent = '▶';
      badge.title = 'Прослушать эту реплику';
      badge.setAttribute('aria-label', 'Прослушать эту реплику');
      badge.addEventListener('click', () => playFromAyah(sIdx));
      sentenceDiv.appendChild(badge);
    }

    sentence.words.forEach((wordObj, wIdx) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.orig = wordObj.w; // оригинал для смены режима огласовок
      span.textContent = visualWord(wordObj.w, displayPrefs.harakat);
      span.dataset.sidx = sIdx;
      span.dataset.widx = wIdx;

      const key = wordKey(story.id, sIdx, wIdx);
      const status = progress[key];
      if (status === 'known') span.classList.add('status-known');
      else if (status === 'seen') span.classList.add('status-seen');

      span.addEventListener('mouseenter', (e) => {
        showTooltip(e, wordObj);
        if (!progress[key]) {
          progress[key] = 'seen';
          span.classList.add('status-seen');
          saveProgress();
        }
      });
      span.addEventListener('mousemove', moveTooltip);
      span.addEventListener('mouseleave', hideTooltip);

      span.addEventListener('click', () => {
        hideTooltip();
        progress[key] = 'known';
        span.classList.remove('status-seen');
        span.classList.add('status-known');
        saveProgress();
        openWordCard(wordObj);
      });

      sentenceDiv.appendChild(span);
      sentenceDiv.appendChild(document.createTextNode(' '));
    });

    const ruLine = document.createElement('div');
    ruLine.className = 'sentence-ru';
    ruLine.textContent = sentence.ru;
    sentenceDiv.appendChild(document.createElement('br'));
    if (sentence.tr) { // транслитерация формулы (латиницей)
      const trLine = document.createElement('div');
      trLine.className = 'sentence-tr';
      trLine.dir = 'ltr';
      trLine.textContent = sentence.tr;
      sentenceDiv.appendChild(trLine);
    }
    sentenceDiv.appendChild(ruLine);

    if (sentence.en) { // английский перевод (Sahih International)
      const enLine = document.createElement('div');
      enLine.className = 'sentence-en';
      enLine.lang = 'en';
      enLine.dir = 'ltr';
      enLine.textContent = sentence.en;
      sentenceDiv.appendChild(enLine);
    }

    if (sentence.when) { // метка момента: когда произносится (тексты намаза) — внизу блока
      const whenDiv = document.createElement('div');
      whenDiv.className = 'sentence-when';
      whenDiv.dir = 'ltr';
      whenDiv.textContent = sentence.when;
      sentenceDiv.appendChild(whenDiv);
    }

    textContainer.appendChild(sentenceDiv);
  });

  initPlayer(story);
  updateProgressBadge();
  updateHarakatControls();
  renderSurahNav(story);
  renderReaderStudy(story);
  saveUiState();
}

/** Кнопка в конце текста: «Выучить слова из этого …» → тренажёр по этому тексту. */
function renderReaderStudy(story) {
  const box = document.getElementById('readerStudy');
  if (!box) return;
  const t = story.type || 'quran';
  const label = t === 'quran'  ? 'Выучить слова из этой суры' :
                t === 'hadith' ? 'Выучить слова из этого хадиса' :
                t === 'adhkar' ? 'Выучить слова из этого азкара' :
                t === 'namaz'  ? 'Выучить слова из этого текста' :
                                 'Выучить слова из этой истории';
  box.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctrl-btn primary reader-study-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => studyStory(story.id));
  box.appendChild(btn);
}

/** Перейти в тренажёр «Изучение слов» и сразу начать по указанному тексту. */
function studyStory(storyId) {
  if (!storyId) return;
  switchTo('study');
  const sel = document.getElementById('studySource');
  if (sel) sel.value = storyId;
  startStudy();
}

// ------------------------- Навигация между сурами -------------------------

function renderSurahNav(story) {
  const nav = document.getElementById('surahNav');
  if (!nav) return;
  nav.innerHTML = '';
  if ((story.type || 'quran') !== 'quran') { // только для сур
    nav.classList.add('hidden');
    return;
  }
  const list = storiesOf('quran'); // отсортированы по surahNo
  const idx = list.findIndex(s => s.id === story.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = (idx >= 0 && idx < list.length - 1) ? list[idx + 1] : null;

  if (prev) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-btn small';
    b.innerHTML = `← К предыдущей суре (${escapeHtml(prev.titleRu)})`;
    b.addEventListener('click', () => openStory(prev.id));
    nav.appendChild(b);
  }
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'ctrl-btn small';
  all.textContent = 'Ко всем сурам';
  all.addEventListener('click', () => goHome());
  nav.appendChild(all);
  if (next) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctrl-btn small';
    b.innerHTML = `К следующей суре (${escapeHtml(next.titleRu)}) →`;
    b.addEventListener('click', () => openStory(next.id));
    nav.appendChild(b);
  }
  nav.classList.remove('hidden');
}

// ------------------------- Подсказка при наведении -------------------------

function showTooltip(e, wordObj) {
  const tip = document.getElementById('tooltip');
  tip.innerHTML = `<div class="tt-ar">${escapeHtml(wordDisplay(wordObj.w))}</div><div class="tt-ru">${escapeHtml(wordObj.ru || '')}</div>`;
  tip.classList.remove('hidden');
  moveTooltip(e);
}

function moveTooltip(e) {
  const tip = document.getElementById('tooltip');
  if (tip.classList.contains('hidden')) return;
  const offset = 16;
  let x = e.clientX - tip.offsetWidth / 2;
  let y = e.clientY - tip.offsetHeight - offset;
  x = Math.max(8, Math.min(x, window.innerWidth - tip.offsetWidth - 8));
  if (y < 8) y = e.clientY + offset;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').classList.add('hidden');
}

// ------------------------- Карточка слова -------------------------

function openWordCard(wordObj) {
  document.getElementById('wcAr').textContent = wordDisplay(wordObj.w);
  document.getElementById('wcTr').textContent = wordObj.tr ? 'Транскрипция: ' + wordObj.tr : '';
  document.getElementById('wcRu').textContent = wordObj.ru || '';

  setRowVisible('wcPos', wordObj.pos);
  setRowVisible('wcRoot', wordObj.root);
  setRowVisible('wcDef', wordObj.def);

  // --- статус повторения (SRS) ---
  const srsCard = (typeof SRS !== 'undefined') ? SRS.getCard(wordObj.w) : null;
  const srsEl = document.getElementById('wcSrs');
  srsEl.textContent = srsStatusText(srsCard);

  const srsBtn = document.getElementById('wcSrsAction');
  if (srsCard) {
    srsBtn.textContent = '🔁 Повторить сейчас';
    srsBtn.onclick = () => {
      closeWordCard();
      switchTo('review');
      SRS.startCustomSession([wordObj.w]);
    };
  } else {
    srsBtn.textContent = '➕ Добавить в повторение';
    srsBtn.onclick = () => {
      SRS.addWord(wordObj.w);
      openWordCard(wordObj); // обновляем статус и кнопку
    };
  }

  // --- вхождения той же формы в других местах ---
  const occBtn = document.getElementById('wcOccBtn');
  const occCount = (typeof getWordOccurrences === 'function')
    ? getWordOccurrences(wordObj.w).length
    : 0;
  if (occCount >= 2) {
    occBtn.classList.remove('hidden');
    occBtn.textContent = `Встречается в материалах: ${occCount} раз`;
    occBtn.onclick = () => showOccurrencesModal(wordObj.w);
  } else {
    occBtn.classList.add('hidden');
    occBtn.onclick = null;
  }

  // --- слова с тем же корнем ---
  const rootBtn = document.getElementById('wcRootBtn');
  const hasRoot = wordObj.root && wordObj.root !== '—'
    && wordObj.root.replace(/\s/g, '').length >= 2;
  if (hasRoot && typeof getWordsByRoot === 'function') {
    rootBtn.classList.remove('hidden');
    rootBtn.onclick = () => showRootModal(wordObj.root, wordObj.w);
  } else {
    rootBtn.classList.add('hidden');
    rootBtn.onclick = null;
  }

  const playBtn = document.getElementById('wcPlayBtn');
  if (wordObj.audio) {
    playBtn.classList.remove('hidden');
    playBtn.onclick = () => playWordAudio(wordObj.audio);
  } else {
    playBtn.classList.add('hidden');
  }

  document.getElementById('wordCard').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
  focusModal(document.getElementById('wordCard'));
}

/** Текст статуса повторения слова. */
function srsStatusText(card) {
  if (!card) return 'не в повторении';
  const when = card.nextReviewAt
    ? ' · следующее: ' + new Date(card.nextReviewAt).toLocaleDateString('ru-RU')
    : '';
  if (card.state === 'review') return 'в повторении, закреплено' + when;
  if (card.state === 'relearning') return 'повторное закрепление' + when;
  if (card.state === 'learning') return 'в изучении' + when;
  return 'новое';
}

// ------------------------- Списки вхождений и корней -------------------------

function contextHtml(sentence, highlightText) {
  return sentence.words.map(w =>
    w.w === highlightText
      ? `<mark class="occ-mark">${escapeHtml(w.w)}</mark>`
      : escapeHtml(w.w)
  ).join(' ');
}

function openListModal(title, note, rowsHtml) {
  closeWordCard();
  document.getElementById('lmTitle').textContent = title;
  document.getElementById('lmNote').textContent = note || '';
  document.getElementById('lmBody').innerHTML = rowsHtml;
  document.getElementById('listModal').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
  focusModal(document.getElementById('listModal'));
}

function closeListModal() {
  document.getElementById('listModal').classList.add('hidden');
  document.getElementById('lmBody').innerHTML = '';
}

/** Список всех вхождений формы слова с переходами к месту в тексте. */
function showOccurrencesModal(text) {
  const occ = getWordOccurrences(text);
  const rows = occ.map(o => `
    <div class="occ-item">
      <div class="occ-src">${escapeHtml(o.story.titleRu)} ·
        ${o.sentence.ayah ? 'аят ' + o.sentence.ayah : 'фраза ' + (o.sIdx + 1)}</div>
      <div class="occ-context" dir="rtl">${contextHtml(o.sentence, text)}</div>
      <button class="ctrl-btn small" onclick="openStoryAt('${o.story.id}', ${o.sIdx}, ${o.wIdx})">Открыть место →</button>
    </div>`).join('');
  openListModal(
    `Вхождения: ${text}`,
    `Точная форма встречается ${occ.length} раз(а) в материалах сайта.`,
    rows
  );
}

/** Слова с тем же корнем (в материалах сайта — не полный словарь Корана). */
function showRootModal(root, currentText) {
  const items = getWordsByRoot(root);
  const rows = items.map(x => `
    <div class="occ-item${x.text === currentText ? ' occ-current' : ''}">
      <div class="occ-word-ar">${escapeHtml(x.text)}</div>
      <div class="occ-ru">${escapeHtml(x.word.ru || '')}</div>
      <div class="occ-src">${escapeHtml(x.story.titleRu)} ·
        ${x.sentence.ayah ? 'аят ' + x.sentence.ayah : 'фраза ' + (x.sIdx + 1)}</div>
      <div class="occ-context" dir="rtl">${contextHtml(x.sentence, x.text)}</div>
      <button class="ctrl-btn small" onclick="openStoryAt('${x.story.id}', ${x.sIdx}, ${x.wIdx})">Открыть место →</button>
    </div>`).join('');
  openListModal(
    `Корень: ${root}`,
    'Слова с этим корнем в материалах сайта (это не полный словарь Корана).',
    rows
  );
}

/** Открыть текст и подсветить конкретное слово. */
function openStoryAt(storyId, sIdx, wIdx) {
  closeListModal();
  closeWordCard();
  openStory(storyId);
  setTimeout(() => {
    const el = document.querySelector(`.word[data-sidx="${sIdx}"][data-widx="${wIdx}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('jump-flash');
      setTimeout(() => el.classList.remove('jump-flash'), 2600);
    }
  }, 150);
}

/** Показать/скрыть строку карточки по наличию значения. */
function setRowVisible(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const row = el.closest('.word-card-row');
  if (value && value !== '—') {
    el.textContent = value;
    if (row) row.style.display = '';
  } else {
    el.textContent = '';
    if (row) row.style.display = 'none';
  }
}

// ------------------------- Фокус в модальных окнах -------------------------

let modalReturnFocus = null;

/** Перевести фокус в модальное окно (не оставлять его позади). */
function focusModal(modalEl) {
  modalReturnFocus = document.activeElement;
  const target = modalEl.querySelector('button, [href], select');
  if (target) {
    try { target.focus({ preventScroll: true }); } catch (e) {}
  }
}

/** Вернуть фокус на элемент, открывавший модальное окно. */
function restoreModalFocus() {
  if (modalReturnFocus && document.contains(modalReturnFocus)) {
    try { modalReturnFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  modalReturnFocus = null;
}

function closeWordCard() {
  const isOpen = (id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  };
  const anyModalOpen = isOpen('wordCard') || isOpen('listModal') || isOpen('levelsModal');
  document.getElementById('wordCard').classList.add('hidden');
  const lv = document.getElementById('levelsModal');
  if (lv) lv.classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  closeListModal();
  stopWordAudio();
  if (anyModalOpen) restoreModalFocus();
}

// ------------------------- Окно «Уровни и чернила» -------------------------

/** Открыть окно уровней. */
function openLevelsModal() {
  if (typeof INK === 'undefined') return;
  const el = document.getElementById('levelsModal');
  if (!el) return;
  renderLevelsModal();
  el.classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
  focusModal(el);
}

function closeLevelsModal() {
  const el = document.getElementById('levelsModal');
  if (el) el.classList.add('hidden');
  const anyOpen = ['wordCard', 'listModal'].some(id => {
    const m = document.getElementById(id);
    return !!m && !m.classList.contains('hidden');
  });
  const overlay = document.getElementById('overlay');
  if (!anyOpen && overlay) overlay.classList.add('hidden');
  restoreModalFocus();
}

/**
 * Содержимое окна «Уровни»: лестница «пути писца» с отметкой «Вы здесь»,
 * затем коротко начисления и разбивка чернил по разделам.
 * Уровень — один на Основу («Ислам» / «Арабский язык»).
 */
function renderLevelsModal() {
  const body = document.getElementById('levelsBody');
  if (!body) return;
  const P = INK.P;
  const cur = INK.currentMode();
  const all = INK.modes();
  const mine = all.find(m => m.id === cur) || all[0];

  // 1. Лестница уровней: где я сейчас (текущая Основа) и где вторая Основа
  const ladderHtml = `<div class="lv-ladder">
      <h4 class="lv-h">Лестница уровней</h4>
      <p class="lv-where">Вы здесь: <b>${escapeHtml(mine.level.name)}</b>
        <span class="lv-where-sub">${escapeHtml(mine.title)} · ${mine.ink} чернил${mine.level.nextName ? ' · до «' + escapeHtml(mine.level.nextName) + '»: ' + mine.level.toNext : ' · высшая ступень'}</span></p>
      <div class="lv-bar lv-bar-wide"><div class="lv-fill" style="width:${mine.level.pct}%"></div></div>
      ${INK.LEVELS.map((l, i) => {
        const here = i === mine.level.index;
        const others = all.filter(m => m.id !== mine.id && m.level.index === i);
        return `
        <div class="lv-step${here ? ' lv-step-now' : ''}">
          <span class="lv-step-no">${i + 1}</span>
          <span class="lv-step-name">${escapeHtml(l.name)}</span>
          ${here ? '<span class="lv-badge lv-badge-now">Вы здесь</span>' : ''}
          ${others.map(m => `<span class="lv-badge">${escapeHtml(m.title)}</span>`).join('')}
          <span class="lv-step-min">${l.min} чернил</span>
        </div>`;
      }).join('')}
    </div>`;

  // 2. Коротко: как копятся чернила
  const rules = [
    ['Верный ответ', '+' + P.correct],
    ['Серия из ' + P.comboEvery + ' подряд', '+' + P.comboBonus],
    ['Выученное слово', '+' + P.learned],
    ['Сборка аята', '+' + P.build],
    ['Сессия', '+' + P.session],
    ['Аят хифза', '+' + P.ayah]
  ];
  const rulesHtml = `<div class="lv-rules">
      <h4 class="lv-h">Как копятся чернила</h4>
      <div class="lv-rules-grid">
        ${rules.map(([t, v]) => `<div class="lv-rule"><span class="lv-rule-t">${escapeHtml(t)}</span><span class="lv-rule-v">${v}</span></div>`).join('')}
      </div>
      <p class="lv-note">Чернила не тратятся: это мера практики. Уровень — один на Основу.</p>
    </div>`;

  // 3. Разбивка: чернила по разделам (без отдельных уровней)
  const groups = INK.breakdown();
  const sectionsHtml = groups.map(g => `
    <div class="lv-group${g.mode === cur ? ' lv-group-now' : ''}">
      <h4 class="lv-h">${escapeHtml(g.title)} <span class="lv-group-ink">${g.ink} чернил</span></h4>
      <div class="lv-chips">
        ${g.sections.map(s => `<span class="lv-chip">${escapeHtml(s.label)} <b>${s.ink}</b></span>`).join('')}
      </div>
    </div>`).join('');

  const legacy = INK.legacyTotal();
  const legacyHtml = legacy > 0
    ? `<p class="lv-note">Ранее накоплено (заслуги до разделения по разделам): <b>${legacy}</b>${all.map(m => INK.legacyOf(m.id) > 0 ? ` · ${escapeHtml(m.title)}: ${INK.legacyOf(m.id)}` : '').join('')}.</p>`
    : '';

  body.innerHTML = ladderHtml + rulesHtml + `<div class="lv-sections">${sectionsHtml}</div>` + legacyHtml;
}

// ------------------------- Аудио отдельного слова -------------------------

function playWordAudio(src, errText) {
  stopAllAudio('word'); // одно аудио за раз: глушим плеер, Хифз и свою запись
  const a = new Audio(src);
  wordAudio = a;
  a.addEventListener('ended', () => { if (wordAudio === a) wordAudio = null; });
  a.play().catch(err => {
    showPlayerStatus(errText || 'Не удалось воспроизвести слово. Проверьте интернет-соединение.');
  });
}

// Последовательное проигрывание озвученных реплик (для материалов, озвученных
// не полностью: плеер не собирается, а значок ▶ должен вести реплики дальше).
let sentenceChain = null;   // { story, idx }

function stopWordAudio() {
  sentenceChain = null;   // последовательное проигрывание реплик прерывается
  if (wordAudio) {
    wordAudio.pause();
    wordAudio = null;
  }
}

/** Проиграть реплику idx и по окончании — следующую озвученную (без плеера). */
function playSentenceFrom(story, idx) {
  const sents = (story && story.sentences) || [];
  if (idx < 0 || idx >= sents.length || !sents[idx] || !sents[idx].audio) {
    sentenceChain = null;
    return;
  }
  stopAllAudio('word');
  highlightAyah(idx);
  const a = new Audio(encodeURI(sents[idx].audio));
  wordAudio = a;
  sentenceChain = { story, idx };
  a.addEventListener('ended', () => {
    if (wordAudio !== a) return;                 // уже переключили/остановили
    if (sentenceChain && sentenceChain.idx === idx) playSentenceFrom(story, idx + 1);
  });
  a.addEventListener('error', () => {
    if (wordAudio !== a) return;
    sentenceChain = null;
    showPlayerStatus('Не удалось воспроизвести озвучку реплики.', true);
  });
  a.play().catch(() => {
    sentenceChain = null;
    showPlayerStatus('Не удалось воспроизвести озвучку реплики.', true);
  });
}

/**
 * Один аудиопоток на весь сайт: перед новым воспроизведением глушим
 * предыдущее — слово, плеер читалки, Хифз и воспроизведение своей записи.
 * keep — источник, который стартует сейчас и глушить который не нужно
 * ('word' | 'player' | 'hifz' | 'rec').
 */
function stopAllAudio(keep) {
  if (keep !== 'word') stopWordAudio();
  if (keep !== 'player') pausePlayer();
  if (keep !== 'hifz' && typeof HIFZ !== 'undefined') HIFZ.stop();
  if (keep !== 'rec') stopRecordingAudio();
}

// ------------------------- Плеер истории (по аятам) -------------------------

// Доступные чтецы (все — cdn.islamic.network, 128 kbps; в данных URL Афаси).
const RECITERS = [
  { id: 'ar.alafasy',      name: 'Мишари аль-Афаси' },
  { id: 'ar.husary',       name: 'Махмуд аль-Хусари' },
  { id: 'ar.mahermuaiqly', name: 'Махер аль-Муайкли' }
];
const RECITER_KEY = 'arabic-reader-reciter-v1';
let currentReciter = (function () {
  try {
    const v = localStorage.getItem(RECITER_KEY);
    if (v && RECITERS.some(r => r.id === v)) return v;
  } catch (e) { /* нет доступа */ }
  return 'ar.alafasy';
})();

/** URL аудио аята для выбранного чтеца — локальный файл (audio/<чтец>/<аят>.mp3). */
function reciterUrl(url) {
  const m = String(url).match(/(\d+)\.mp3\s*$/);
  if (!m) return String(url);
  return 'audio/' + currentReciter.replace('ar.', '') + '/' + m[1] + '.mp3';
}

/** CDN-версия того же аята (запасной источник, если локального файла нет). */
function cdnUrl(url) {
  return String(url).replace('/ar.alafasy/', '/' + currentReciter + '/');
}

/** Смена чтеца (единая точка): глобальная переменная + localStorage + плейлист читалки. */
function setReciter(id) {
  if (!id || !RECITERS.some(r => r.id === id)) return;
  currentReciter = id;
  try { localStorage.setItem(RECITER_KEY, id); } catch (e) { /* не критично */ }
  const sel = document.getElementById('reciterSelect');
  if (sel && sel.value !== id) sel.value = id;
  if (typeof currentStory !== 'undefined' && currentStory && playlist.length) {
    stopPlayer();
    initPlayer(currentStory); // пересобираем плейлист с новым чтецом
  }
}

/** Локальный URL для Хифза (хелпер с защитой на случай порядка загрузки). */
function ayahAudioLocal(url) {
  return (typeof reciterUrl === 'function') ? reciterUrl(url) : url;
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showPlayerStatus(text, isError) {
  const el = document.getElementById('playerStatus');
  if (!text) { el.classList.add('hidden'); return; }
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.background = isError ? '#fdecea' : 'var(--accent-soft)';
  el.style.color = isError ? '#b3261e' : 'var(--accent)';
}

/**
 * Подготовка плейлиста: собираем аудио предложений и узнаём их длительности.
 * Два вида аудио: аяты Корана (`ayahAudio` — локальный файл чтеца + CDN-фолбэк)
 * и озвучка материалов «Хуна Арабия» (`audio` — обычный локальный mp3).
 */
function initPlayer(story) {
  resetPlayerUI();
  // Плеер показываем/скрываем на КАЖДОМ открытии текста: раньше он только
  // скрывался, поэтому после любого текста без аудио (хадисы, намаз, истории)
  // пропадал и в Коране — до перезагрузки страницы.
  const hasAll = story.sentences.every(s => !!(s.ayahAudio || s.audio));
  // «Чтец» относится только к аятам Корана: в озвучке материалов выбор чтеца не нужен
  const isQuran = story.sentences.some(s => !!s.ayahAudio);
  const reciterCtrl = document.querySelector('.reciter-control');
  if (reciterCtrl) reciterCtrl.classList.toggle('hidden', !isQuran);
  const bar = document.querySelector('.player-bar');
  if (!hasAll || !story.sentences.length) {
    if (bar) bar.classList.add('hidden');
    return;
  }
  if (bar) bar.classList.remove('hidden');
  // индексы плейлиста = индексы предложений (у всех есть аудио)
  playlist = story.sentences.map(s => s.ayahAudio
    ? {
        src: reciterUrl(s.ayahAudio),  // локальный файл чтеца
        cdn: cdnUrl(s.ayahAudio),      // запасной источник (CDN)
        triedCdn: false,
        duration: 0
      }
    : {
        src: encodeURI(s.audio),       // озвучка материала (локальный mp3)
        cdn: null,
        triedCdn: false,
        duration: 0
      });

  // Узнаём длительности через скрытые Audio с preload=metadata
  metaProbeAudios.forEach(a => { a.src = ''; });
  metaProbeAudios = [];
  starts = [];
  totalDuration = 0;
  currentAyah = 0;

  let remaining = playlist.length;
  const fallbackTimer = setTimeout(() => finishDurations(true), 8000);

  playlist.forEach((item, i) => {
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.src = item.src;
    probe.addEventListener('loadedmetadata', () => {
      if (isFinite(probe.duration) && probe.duration > 0) item.duration = probe.duration;
      if (--remaining === 0) { clearTimeout(fallbackTimer); finishDurations(false); }
    });
    probe.addEventListener('error', () => {
      if (--remaining === 0) { clearTimeout(fallbackTimer); finishDurations(false); }
    });
    metaProbeAudios.push(probe);
  });

  function finishDurations(timedOut) {
    // Тем, у кого длительность не определилась, даём оценку 5 с
    playlist.forEach(item => { if (!item.duration) item.duration = 5; });
    starts = [];
    let acc = 0;
    playlist.forEach(item => { starts.push(acc); acc += item.duration; });
    totalDuration = acc;
    document.getElementById('timeTotal').textContent = fmtTime(totalDuration);
    document.getElementById('seekBar').max = totalDuration;
    if (timedOut) showPlayerStatus('Аудио загружалось медленно — шкала времени приблизительная.');
  }
}

function resetPlayerUI() {
  if (playerAudio) {
    playerAudio.pause();
    playerAudio.removeAttribute('src');
    playerAudio.load();
  }
  // Сбрасываем и состояние плейлиста: иначе при открытии текста без аудио
  // (или озвученного не полностью) оставался плейлист предыдущего текста —
  // значок реплики играл бы чужой файл.
  playlist = [];
  starts = [];
  totalDuration = 0;
  currentAyah = 0;
  wantPlaying = false;
  document.getElementById('seekBar').value = 0;
  document.getElementById('timeCurrent').textContent = '0:00';
  document.getElementById('timeTotal').textContent = '0:00';
  document.getElementById('btnPlayPause').textContent = '▶';
  showPlayerStatus('');
}

/** Общая позиция на шкале (сек) для текущего состояния плеера. */
function globalPosition() {
  const inAyah = playerAudio && isFinite(playerAudio.currentTime) ? playerAudio.currentTime : 0;
  return (starts[currentAyah] || 0) + inAyah;
}

/** Перейти к произвольной позиции на общей шкале. */
function seekToGlobal(t) {
  if (!playlist.length) return;
  if (!isFinite(t)) t = 0;   // длительности ещё не измерены
  t = Math.max(0, Math.min(t, Math.max(0, totalDuration - 0.05)));
  let idx = 0;
  for (let i = 0; i < playlist.length; i++) {
    if (t >= starts[i]) idx = i;
  }
  const offset = t - starts[idx];
  if (idx !== currentAyah || !playerAudio || !playerAudio.src ||
      playerAudio.src !== absoluteUrl(playlist[idx].src)) {
    loadAyah(idx, offset);
  } else {
    playerAudio.currentTime = offset;
  }
  updateTimeUI(t);
  highlightAyah(idx);
}

function absoluteUrl(src) {
  try { return new URL(src, location.href).href; } catch (e) { return src; }
}

/** Загрузить аят idx в плеер (и, при needPlay, воспроизвести с позиции offset). */
let needPlayAfterLoad = false;

function loadAyah(idx, offset) {
  if (!playerAudio || !playlist.length) return;
  currentAyah = idx;
  playerAudio.src = playlist[idx].src;
  if (offset && offset > 0) {
    needPlayAfterLoad = offset;
  } else {
    needPlayAfterLoad = 0;
  }
}

function playFromAyah(sIdx) {
  closeWordCard();
  // плеер не собран (материал озвучен не полностью) — ведём реплики по порядку
  if (!playlist.length) {
    playSentenceFrom(currentStory, sIdx);
    return;
  }
  // длительности ещё измеряются (starts пуст) — грузим эту реплику напрямую
  if (!isFinite(starts[sIdx])) {
    loadAyah(sIdx, 0);
    highlightAyah(sIdx);
    playPlayer();
    return;
  }
  seekToGlobal(starts[sIdx]);
  playPlayer();
}

/** Предыдущая / следующая реплика (кнопки плеера). */
function stepSentence(dir) {
  const sents = (currentStory && currentStory.sentences) || [];
  if (!playlist.length) {
    // материал озвучен не полностью: идём по озвученным репликам
    let i = sentenceChain ? sentenceChain.idx + dir : (dir > 0 ? -1 : sents.length);
    for (; i >= 0 && i < sents.length; i += dir) {
      if (sents[i] && sents[i].audio) { playSentenceFrom(currentStory, i); return; }
    }
    return;
  }
  const idx = Math.max(0, Math.min(playlist.length - 1, currentAyah + dir));
  loadAyah(idx, 0);
  highlightAyah(idx);
  playPlayer();
}

function playPlayer() {
  if (!playlist.length || !playerAudio) return;
  // один аудиопоток: перед стартом аятов глушим слово, Хифз и свою запись
  stopAllAudio('player');
  wantPlaying = true;
  if (!playerAudio.src) {
    loadAyah(0, 0);
  }
  // если стоим в самом конце — начинаем сначала (когда длительности уже измерены)
  if (totalDuration > 0 && globalPosition() >= totalDuration - 0.1) {
    loadAyah(0, 0);
  }
  playerAudio.play().catch(err => {
    showPlayerStatus('Не удалось воспроизвести аудио. Проверьте интернет-соединение.', true);
  });
}

function pausePlayer() {
  wantPlaying = false;
  if (playerAudio) playerAudio.pause();
}

function stopPlayer() {
  wantPlaying = false;
  if (playerAudio) {
    playerAudio.pause();
    playerAudio.removeAttribute('src');
    playerAudio.load();
  }
  currentAyah = 0;
  updateTimeUI(0);
  document.getElementById('btnPlayPause').textContent = '▶';
  clearPlayingHighlight();
  showPlayerStatus('');
}

function togglePlayPause() {
  if (!playerAudio) return;
  if (playerAudio.paused) playPlayer();
  else pausePlayer();
}

function updateTimeUI(globalT) {
  document.getElementById('timeCurrent').textContent = fmtTime(globalT);
  if (!isSeeking) document.getElementById('seekBar').value = globalT;
}

// ------------------------- Подсветка текущего аята -------------------------

function highlightAyah(sIdx) {
  document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
  const target = document.querySelector(`.sentence[data-sidx="${sIdx}"]`);
  if (target) {
    target.classList.add('playing');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' }); // аят — к середине экрана
  }
}

function clearPlayingHighlight() {
  document.querySelectorAll('.sentence.playing').forEach(el => el.classList.remove('playing'));
}

// ------------------------- Тренажёр слов -------------------------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return escHtml(s); // единая реализация — js/util.js
}

/** Уникальные слова истории с контекстом первого вхождения (для пропусков в тексте). */
/**
 * Уникальные слова текста, сгруппированные по ОСНОВЕ (лемме): аффиксные формы
 * одного слова дают одну запись, и тренажёр спрашивает саму основу
 * (أُخْتُكُمْ → أُخْت «сестра»).
 */
function uniqueWordItems(story) {
  const seen = new Set();
  const items = [];
  story.sentences.forEach(sent => sent.words.forEach((w, i) => {
    if (typeof isStudyableWord === 'function' && !isStudyableWord(w)) return; // имена/цифры не изучаем
    const key = wordBaseKey(w);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({ word: baseWord(w), sentence: sent, gapIndex: i });
  }));
  return items;
}

/**
 * Список уникальных значений поля по истории (или [] для null).
 * Для 'w' возвращаются ОСНОВЫ слов — варианты ответа в тренажёре должны быть
 * того же вида, что и правильный ответ (иначе «сестра» спорила бы с «ваша сестра»).
 */
function collectFieldValues(story, field) {
  const set = new Set();
  if (story) story.sentences.forEach(s => s.words.forEach(w => {
    const v = (field === 'w') ? wordBase(w) : w[field];
    if (v) set.add(v);
  }));
  return [...set];
}

/** 3 дистрактора: тот же источник -> вся база; фильтр по длине, чтобы не было очевидно неверных. */
function pickDistractors(correct, story, field, maxDiff) {
  if (maxDiff == null) maxDiff = 8;
  const all = story ? collectFieldValues(story, field).filter(v => v && v !== correct) : [];
  let pool = all.filter(v => Math.abs(v.length - correct.length) <= maxDiff);
  if (pool.length < 3) pool = all;
  if (pool.length < 3) {
    STORIES_DATA.stories.forEach(s => {
      if (s !== story) collectFieldValues(s, field).forEach(v => {
        if (v && v !== correct) pool.push(v);
      });
    });
    pool = [...new Set(pool)];
  }
  return shuffle(pool).slice(0, 3);
}

/** Заполнить выбор источника для изучения (все тексты сайта, по разделам). */
function populateStudySources() {
  const sel = document.getElementById('studySource');
  const prev = sel.value;
  sel.innerHTML = '';
  // специальный источник: новые слова из всех текстов
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = 'Новые слова — все тексты';
  sel.appendChild(newOpt);
  (typeof modeSources === 'function'
    ? modeSources()
    : [['quran', 'Коран'], ['hadith', 'Хадисы'], ['stories', 'Истории'], ['adhkar', 'Азкары'], ['namaz', 'Намаз']]
  ).forEach(([sec, label]) => {
    const og = document.createElement('optgroup');
    og.label = label;
    storiesOf(sec).forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.titleRu;
      og.appendChild(o);
    });
    // главы книг «Хуна Арабия» — тренировка всех слов главы
    if (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) {
      const book = HUNA_DATA.books.find(b => b.id === sec);
      if (book) (book.chapters || []).forEach(ch => {
        const o = document.createElement('option');
        o.value = 'chapter:' + ch.id;
        o.textContent = `Глава ${ch.no}. ${ch.titleRu} — все слова`;
        og.appendChild(o);
      });
    }
    sel.appendChild(og);
  });  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  // формат (варианты / флеш-карточки) — только в режиме «Арабский язык»
  const fmtRow = document.getElementById('studyFormatRow');
  if (fmtRow) fmtRow.classList.toggle('hidden', !isArabicMode());
  renderStudyDashboard();
}

function backToStudySetup() {
  clearAdvance();
  document.getElementById('studyGame').classList.add('hidden');
  document.getElementById('studySetup').classList.remove('hidden');
  renderStudyDashboard();
}

// ------------------------- Статистика изучения слов -------------------------

function getStudyStats() {
  try {
    return JSON.parse(localStorage.getItem(STUDY_STATS_KEY())) || {};
  } catch (e) {
    return {};
  }
}

function saveStudyStats(stats) {
  localStorage.setItem(STUDY_STATS_KEY(), JSON.stringify(stats));
}

/** Записать результат ответа по слову. */
function recordWordResult(wordText, ok) {
  const stats = getStudyStats();
  const e = stats[wordText] || { c: 0, w: 0 };
  if (ok) e.c++; else e.w++;
  stats[wordText] = e;
  saveStudyStats(stats);
  // журнал активности для серии дней и статистики «Главной»
  if (typeof logActivity === 'function') {
    logActivity({ reviews: 1, correct: ok ? 1 : 0, words: 1 });
  }
}

/** Слово считается выученным, если перевес правильных ответов >= 2. */
function isLearnedEntry(e) {
  return (e.c - e.w) >= 2;
}

/** Индекс всех слов сайта: text -> {ru, sourceTitle, sourceId}. */
function buildWordIndex() {
  const idx = new Map();
  const pool = (typeof modeStories === 'function') ? modeStories() : [...STORIES_DATA.stories];
  [...pool]
    .sort((a, b) => (a.chapterNo ?? a.surahNo ?? 9999) - (b.chapterNo ?? b.surahNo ?? 9999))
    .forEach(s => {
      s.sentences.forEach(sent => sent.words.forEach(w => {
        if (!idx.has(w.w)) idx.set(w.w, { ru: w.ru, sourceTitle: s.titleRu, sourceId: s.id });
      }));
    });
  return idx;
}

/** Панель прогресса на основе SRS-карточек: в изучении / закреплено / точность. */
function renderStudyDashboard() {
  const el = document.getElementById('studyStats');
  if (!el) return;
  const srsCards = (typeof SRS !== 'undefined') ? SRS.getAllCards() : {};
  const stats = getStudyStats(); // старая статистика — для «сложных слов»

  let learning = 0, solid = 0, totalAnswers = 0, correctAnswers = 0;
  Object.values(srsCards).forEach(c => {
    if (c.state === 'review') solid++;
    else if (c.state === 'learning' || c.state === 'relearning') learning++;
    totalAnswers += c.totalAnswers || 0;
    correctAnswers += c.correctAnswers || 0;
  });

  // Сложные слова — по ошибкам (пишутся и тренажёром, и повторениями)
  const idx = buildWordIndex();
  const hard = [];
  Object.entries(stats).forEach(([text, e]) => {
    if (e.w > 0 && idx.has(text)) hard.push({ text, e });
  });
  hard.sort((a, b) => b.e.w - a.e.w || (b.e.w - b.e.c) - (a.e.w - a.e.c));

  // Секции прогресса: «Коран», «Хадисы», «Истории», «Азкары» (сворачиваемые)
  const sectionsHtml = [['quran', 'Коран'], ['hadith', 'Хадисы'], ['stories', 'Истории'], ['adhkar', 'Азкары'], ['namaz', 'Намаз']].map(([sec, label]) => {
    const rows = [];
    let secSolid = 0, secTotal = 0;
    storiesOf(sec).forEach(s => {
      const seen = new Set();
      let started = 0, done = 0, total = 0;
      s.sentences.forEach(sent => sent.words.forEach(w => {
        if (seen.has(w.w)) return;
        seen.add(w.w);
        total++;
        const c = srsCards[w.w];
        if (c && c.state && c.state !== 'new') {
          started++;
          if (c.state === 'review') done++;
        }
      }));
      secSolid += done; secTotal += total;
      const startPct = total ? Math.round(started / total * 100) : 0;
      const solidPct = total ? Math.round(done / total * 100) : 0;
      rows.push(`
        <div class="src-row" title="${escapeHtml(s.titleRu)} — тёмная часть: закреплено, светлая: в изучении">
          <span class="src-name">${escapeHtml(s.titleRu)}</span>
          <div class="src-bar"><i class="seg-start" style="width:${startPct}%"></i><i class="seg-solid" style="width:${solidPct}%"></i></div>
          <span class="src-count">${done}/${total}</span>
        </div>`);
    });
    return `
      <details class="stats-section">
        <summary>${label}<span class="ss-badge">${secSolid}/${secTotal} закреплено</span></summary>
        <div class="stats-section-body"><div class="src-progress">${rows.join('')}</div></div>
      </details>`;
  }).join('');

  const accuracy = totalAnswers ? Math.round(correctAnswers / totalAnswers * 100) : 0;
  // чернила и уровень текущей Основы (один «путь писца» на Основу)
  const inkMode = (typeof INK !== 'undefined') ? INK.modeInk() : 0;
  const inkLevel = (typeof INK !== 'undefined') ? INK.modeLevel() : null;

  const hardHtml = hard.length
    ? hard.slice(0, 8).map(({ text, e }) => `
        <div class="hw-item">
          <span class="hw-ar">${escapeHtml(text)}</span>
          <span class="hw-ru">${escapeHtml(idx.get(text).ru || '')}</span>
          <span class="hw-stat">✗ ${e.w} · <span class="ok">✓ ${e.c}</span></span>
        </div>`).join('')
    : '<p class="stats-empty">Пока нет ошибок — пройдите тренировку, и здесь появятся слова, которые даются труднее всего.</p>';

  el.innerHTML = `
    <div class="stats-row stats-row-4">
      <div class="stat-box"><div class="stat-num">${learning}</div><div class="stat-label">слов в изучении</div></div>
      <div class="stat-box"><div class="stat-num">${solid}</div><div class="stat-label">закреплено (в повторении)</div></div>
      <div class="stat-box"><div class="stat-num">${learnedWordsCount()}</div><div class="stat-label">выучено (5 верных подряд)</div></div>
      <div class="stat-box"><div class="stat-num">${totalAnswers ? accuracy + '%' : '—'}</div><div class="stat-label">точность ответов</div></div>
      ${inkLevel ? `<button type="button" class="stat-box ink-box" id="inkTotalBox"><div class="stat-num">${inkMode}</div><div class="stat-label">чернил · ${escapeHtml(inkLevel.name)}</div></button>` : ''}
    </div>
    ${sectionsHtml}
    <p class="stats-legend">Полоса: <span class="seg-demo start"></span> взято в изучение · <span class="seg-demo solid"></span> закреплено (периодическое повторение)</p>
    <h4 class="stats-subtitle">Самые сложные слова</h4>
    <div class="hard-words">${hardHtml}</div>`;

  const inkBox = document.getElementById('inkTotalBox');
  if (inkBox) inkBox.addEventListener('click', () => openLevelsModal());
}

// ------------------------- Типы заданий -------------------------

const EX_TYPE_LABELS = {
  't1-choice': 'Слово → перевод',
  't2': 'Перевод → арабское слово',
  't3': 'Аудио → арабское слово',
  't4': 'Вставь пропущенное слово',
  't5': 'Корень слова',
  't6': 'Грамматика',
  't7-context': 'Значение в контексте'
};

// Параметры единой тренировки слов
const LEARN_STREAK = 5;        // столько верных ответов подряд — слово «выучено» (режим «Ислам»)
const LEARN_STREAK_ARABIC = 3; // в «Арабском языке» порог мягче: лексику не заучиваем наизусть
const STUDY_SESSION_MAX = 50;  // максимум вопросов в одной сессии
const STUDY_BUILD_EVERY = 5;   // каждые N слов — задание «собери аят» (только «Ислам»)
const STUDY_ADVANCE_SEC = 10;     // «Ислам»: сколько секунд на разбор после ответа, затем авто-переход
const STUDY_ADVANCE_SEC_AR = 3;   // «Арабский язык»: лексика, разбор не нужен — короче

/** Порог «выучено» для текущего режима. */
function learnStreak() {
  return (typeof getMode === 'function' && getMode() === 'arabic') ? LEARN_STREAK_ARABIC : LEARN_STREAK;
}

/** Текущий режим — «Арабский язык»? */
function isArabicMode() {
  return (typeof getMode === 'function') && getMode() === 'arabic';
}

/** Отменить авто-переход к следующему вопросу. */
function clearAdvance() {
  if (typeof study !== 'undefined' && study && study.advanceTimer) {
    clearInterval(study.advanceTimer);
    study.advanceTimer = null;
  }
}

/** Сколько секунд даётся на разбор после ответа (по режиму). */
function studyAdvanceSec() {
  return isArabicMode() ? STUDY_ADVANCE_SEC_AR : STUDY_ADVANCE_SEC;
}

/** Запустить авто-переход через studyAdvanceSec() (с обратным отсчётом на кнопке). */
function scheduleAdvance() {
  clearAdvance();
  if (typeof study === 'undefined' || !study) return;
  let left = studyAdvanceSec();
  const btn = document.getElementById('exNextBtn') || document.getElementById('bNextBtn');
  const render = () => { if (btn) btn.textContent = left > 0 ? `Дальше → (${left})` : 'Дальше →'; };
  render();
  study.advanceTimer = setInterval(() => {
    left--;
    if (left <= 0) { clearAdvance(); nextStudyQuestion(); return; }
    render();
  }, 1000);
}

/** Прокрутить к началу вопроса — так, чтобы была видна шапка «Изучаю: …». */
function scrollToStudyTop() {
  const el = document.querySelector('#studyGame .study-top') || document.getElementById('studyStage');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Грамматический вопрос по полю pos (только надёжно извлекаемые случаи).
 * Возвращает { q, options, correct } или null.
 */
function grammarQuestion(word) {
  const pos = (word.pos || '').toLowerCase();
  if (!pos) return null;
  const isVerb = pos.startsWith('глагол') || pos.startsWith('гл.') || pos.startsWith('глагол-связка');
  if (isVerb) {
    if (pos.includes('повелит')) {
      return { q: 'Какая это форма глагола?', options: ['Повелительное наклонение', 'Прошедшее время'], correct: 'Повелительное наклонение' };
    }
    if (pos.includes('прош')) {
      return { q: 'Какое время у этого глагола?', options: ['Прошедшее время', 'Настоящее время'], correct: 'Прошедшее время' };
    }
    if (pos.includes('наст')) {
      return { q: 'Какое время у этого глагола?', options: ['Прошедшее время', 'Настоящее время'], correct: 'Настоящее время' };
    }
    if (pos.includes('страдательн')) {
      return { q: 'Какой залог у этого глагола?', options: ['Активный', 'Страдательный'], correct: 'Страдательный' };
    }
    // без конкретного признака (время/наклонение/залог) вопроса нет
    return null;
  }
  // Имена и служебные слова (существительные, частицы, предлоги, союзы) грамматического
  // вопроса не получают по решению пользователя: убраны вопросы «это глагольная форма или
  // имя (существительное)?» и «это служебное слово или самостоятельное?».
  return null;
}

/** Дистракторы-корни: из того же источника, той же «длины» (по числу букв корня). */
function pickRootDistractors(correctRoot, story) {
  const tokens = r => r.trim().split(/\s+/).length;
  const ok = r => r && r !== '—' && r !== correctRoot && tokens(r) >= 2;
  let pool = [];
  if (story) story.sentences.forEach(s => s.words.forEach(w => { if (ok(w.root)) pool.push(w.root); }));
  if (pool.length < 3) {
    STORIES_DATA.stories.forEach(s => {
      if (s === story) return;
      s.sentences.forEach(sn => sn.words.forEach(w => {
        if (ok(w.root)) pool.push(w.root);
      }));
    });
  }
  pool = [...new Set(pool)];
  const sameLen = pool.filter(r => tokens(r) === tokens(correctRoot));
  if (sameLen.length >= 3) pool = sameLen;
  return shuffle(pool).slice(0, 3);
}

/** Типы заданий, доступные для слова (по его данным). В «Арабском» — без корня,
 *  пропусков в тексте и аудио; вместо этого «значение в контексте». */
function availableTypesFor(item) {
  const arabic = isArabicMode();
  const t = ['t1-choice', 't2'];
  if (!arabic) {
    if (item.word.audio) t.push('t3');
    if (item.sentence && item.sentence.words.length <= 10) t.push('t4');
    if (item.word.root && item.word.root !== '—' && item.word.root.replace(/\s/g, '').length >= 2) t.push('t5');
  }
  if (grammarQuestion(item.word)) t.push('t6');
  if (arabic && item.sentence && item.sentence.ru) t.push('t7-context');
  return t;
}

/** Выбрать тип, не повторяя предыдущий. */
function pickType(item, prevType) {
  const avail = shuffle(availableTypesFor(item));
  return avail.find(t => t !== prevType) || avail[0];
}

// ------------------------- Сессия тренажёра -------------------------

/** Пул «новых слов»: со всех текстов, ещё не выученные; сначала ни разу не встречавшиеся. */
function newWordsPool() {
  const stats = getStudyStats();
  const items = [];
  const seen = new Set();
  const pool = (typeof modeStories === 'function') ? modeStories() : [...STORIES_DATA.stories];
  [...pool]
    .sort((a, b) => (a.chapterNo ?? a.surahNo ?? 9999) - (b.chapterNo ?? b.surahNo ?? 9999))
    .forEach(s => s.sentences.forEach(sent => sent.words.forEach((w, i) => {
      if (typeof isStudyableWord === 'function' && !isStudyableWord(w)) return; // имена/цифры не изучаем
      if (seen.has(w.w)) return;
      seen.add(w.w);
      if (isWordLearned(w.w)) return;
      const e = stats[w.w];
      items.push({ word: w, sentence: sent, gapIndex: i, story: s, seenBefore: !!e, streak: (e && e.streak) || 0 });
    })));
  // ни разу не встречавшиеся — вперёд; затем по возрастанию серии верных ответов
  items.sort((a, b) => (a.seenBefore - b.seenBefore) || (a.streak - b.streak));
  return items;
}

function startStudy() {
  const sourceId = pendingStudySource || document.getElementById('studySource').value;
  pendingStudySource = null;
  const isNew = sourceId === '__new__';
  const story = isNew ? null : resolveStudySource(sourceId);
  if (!isNew && (!story || !story.sentences.length)) return;

  // что изучаем прямо сейчас
  const nameEl = document.getElementById('studySourceName');
  if (nameEl) nameEl.textContent = isNew ? 'Изучаю: Новые слова — все тексты' : 'Изучаю: ' + story.titleRu;

  // слова, которые ещё не выучены (выученные не показываем)
  let pool = isNew
    ? newWordsPool()
    : uniqueWordItems(story).filter(it => !isWordLearned(it.word.w));
  // глава: берём только слова, впервые встречающиеся в ней, — уже пройденные не повторяем
  if (!isNew && story.chapterId && typeof wordOwnerMap === 'function') {
    const owner = wordOwnerMap();
    pool = pool.filter(it => owner.get(wordBaseKey(it.word)) === story.chapterId);
  }

  if (!pool.length) {
    document.getElementById('studySetup').classList.add('hidden');
    document.getElementById('studyGame').classList.remove('hidden');
    document.getElementById('studyProgressText').textContent = 'Все слова выучены';
    document.getElementById('studyScoreText').textContent = '';
    document.getElementById('studyStage').innerHTML = `
      <div class="study-summary">
        <div>Все слова уже выучены</div>
        <p class="study-hint">Они остаются в разделе «Повторить сегодня» для долгосрочного повторения.</p>
        <div class="study-actions" style="justify-content:center">
          <button class="ctrl-btn small primary" id="studyBackBtn2">Выбрать другой источник</button>
        </div>
      </div>`;
    document.getElementById('studyBackBtn2').addEventListener('click', backToStudySetup);
    return;
  }

  const arabic = isArabicMode();
  const formatSel = document.getElementById('studyFormat');
  const cardMode = arabic && formatSel && formatSel.value === 'cards';

  // сессия: слова + (только в «Исламе») периодическая сборка аята, не больше STUDY_SESSION_MAX
  const maxBuilds = arabic ? 0 : Math.floor(STUDY_SESSION_MAX / STUDY_BUILD_EVERY);
  const wordLimit = STUDY_SESSION_MAX - maxBuilds;

  // для «новых слов» сохраняем приоритет (новые — вперёд), для текста — перемешиваем
  const chosen = isNew ? pool.slice(0, wordLimit) : shuffle(pool).slice(0, wordLimit);

  let questions;
  if (cardMode) {
    // флеш-карточки: без вариантов, с самооценкой («знаю / не знаю»)
    questions = chosen.map(item => ({ kind: 'card', word: item.word, sentence: item.sentence, gapIndex: item.gapIndex, story: item.story || story }));
  } else {
    let prevType = null;
    const wordQs = shuffle(chosen).map(item => {
      const type = pickType(item, prevType);
      prevType = type;
      return { kind: 'word', word: item.word, sentence: item.sentence, gapIndex: item.gapIndex, type, story: item.story || story };
    });

    // предложения для сборки: из выбранных слов (новые) или все предложения текста
    let sentenceItems;
    if (isNew) {
      const seenS = new Set();
      sentenceItems = [];
      wordQs.forEach(q => {
        if (q.sentence && !seenS.has(q.sentence)) { seenS.add(q.sentence); sentenceItems.push({ sentence: q.sentence, story: q.story }); }
      });
    } else {
      sentenceItems = shuffle(story.sentences).map(s => ({ sentence: s, story }));
    }
    const buildCount = Math.min(sentenceItems.length, maxBuilds);

    questions = [];
    let si = 0;
    wordQs.forEach((q, i) => {
      questions.push(q);
      if (buildCount && (i + 1) % STUDY_BUILD_EVERY === 0 && si < buildCount) {
        const bi = sentenceItems[si++];
        questions.push({ kind: 'build', sentence: bi.sentence, story: bi.story });
      }
    });
  }

  study = { story, sourceId, questions, idx: 0, score: 0, wrong: 0, locked: false, missed: [], learned: [], combo: 0 };
  if (typeof INK !== 'undefined') INK.mark(); // прирост чернил покажем в итоге сессии
  document.getElementById('studySetup').classList.add('hidden');
  document.getElementById('studyGame').classList.remove('hidden');
  renderStudyQuestion();
}

/** Раздел для начисления чернил по заданию тренажёра. */
function inkSectionForQuestion(q) {
  if (typeof INK === 'undefined') return null;
  if (q && q.story) return INK.sectionForStory(q.story);
  if (study && study.story) return INK.sectionForStory(study.story);
  return null;
}

function updateStudyProgress() {
  document.getElementById('studyProgressText').textContent =
    `Вопрос ${study.idx + 1} из ${study.questions.length}`;
  document.getElementById('studyScoreText').textContent = `✅ ${study.score}`;
}

function renderStudyQuestion() {
  clearAdvance();
  currentExercise = null; // старые варианты больше не активны
  study.locked = false;
  updateStudyProgress();
  const q = study.questions[study.idx];

  if (q.kind === 'build') {
    renderBuilder(q.sentence, q.story);
    scrollToStudyTop();
    return;
  }
  if (q.kind === 'card') {
    renderFlashcard(q);
    scrollToStudyTop();
    return;
  }
  renderExercise(q);
  scrollToStudyTop();
}

/** Дистракторы-переводы фраз: чужие предложения того же источника (или режима). */
function pickSentenceDistractors(correct, story) {
  const pool = [];
  const add = st => (st.sentences || []).forEach(s => { if (s.ru && s.ru !== correct) pool.push(s.ru); });
  if (story) add(story);
  if (pool.length < 3) {
    const all = (typeof modeStories === 'function') ? modeStories() : STORIES_DATA.stories;
    all.forEach(add);
  }
  return [...new Set(pool)].sort(() => Math.random() - 0.5).slice(0, 3);
}

/** Флеш-карточка: слово → «Показать ответ» → «Не знаю / Знаю» (самооценка). */
function renderFlashcard(q) {
  const stage = document.getElementById('studyStage');
  const w = q.word;
  stage.innerHTML = `
    <div class="ex-type-label">Флеш-карточка</div>
    <div class="study-question-ar" lang="ar" dir="rtl">${escapeHtml(wordDisplay(w.w))}</div>
    <div id="cardAnswer" class="hidden"></div>
    <div class="study-actions" id="cardActions" style="justify-content:center;margin-top:16px">
      <button class="ctrl-btn primary" id="cardShowBtn">Показать ответ</button>
    </div>
    <div class="ex-skip-row"><button class="study-exit" id="exSkipBtn" title="Пропустить без изменения интервала">Пропустить карточку →</button></div>`;

  document.getElementById('exSkipBtn').addEventListener('click', skipExercise);

  document.getElementById('cardShowBtn').addEventListener('click', () => {
    const box = document.getElementById('cardAnswer');
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="study-word-info">
        ${w.tr ? `<div class="swi-tr">${escapeHtml(w.tr)}</div>` : ''}
        <div class="swi-ru">${escapeHtml(w.ru || '')}</div>
        ${w.def ? `<div class="srs-meta">${escapeHtml(w.def)}</div>` : ''}
        ${w.pos ? `<div class="srs-meta">${escapeHtml(w.pos)}</div>` : ''}
      </div>`;
    document.getElementById('cardActions').innerHTML = `
      <button class="ctrl-btn small" id="cardAgainBtn">Не знаю</button>
      <button class="ctrl-btn small primary" id="cardKnowBtn">Знаю</button>`;
    document.getElementById('cardAgainBtn').addEventListener('click', () => answerCard(q, false));
    document.getElementById('cardKnowBtn').addEventListener('click', () => answerCard(q, true));
  });
}

/** Самооценка во флеш-карточке: «знаю» = верно, «не знаю» = ошибка. */
function answerCard(q, ok) {
  if (study.locked) return;
  study.locked = true;
  if (ok) study.score++; else { study.wrong++; addMissed(q.word); }
  document.getElementById('studyScoreText').textContent = `✅ ${study.score}`;
  const streak = recordStudyAnswer(q.word.w, ok);
  inkAnswer(ok, streak, registerLearned(q.word.w, streak), inkSectionForQuestion(q));

  const lim = learnStreak();
  const fb = document.createElement('div');
  fb.className = 'study-word-info';
  fb.innerHTML = `
    <p class="study-hint">Верных ответов подряд: ${Math.min(streak, lim)} из ${lim}${streak >= lim ? ' — слово выучено ✓' : ''}.</p>
    <div class="study-actions" style="justify-content:center">
      <button class="ctrl-btn primary" id="exNextBtn">Дальше →</button>
    </div>`;
  document.getElementById('studyStage').appendChild(fb);
  document.getElementById('exNextBtn').addEventListener('click', () => { clearAdvance(); nextStudyQuestion(); });
  fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
  scheduleAdvance();
}

/** Аят/фраза с пропуском (RTL, подсветка пропуска). */
function renderGapSentence(q, fill) {
  const words = q.sentence.words
    .map((x, i) => i === q.gapIndex
      ? `<span class="gap-blank${fill ? (fill.ok ? ' filled-ok' : ' filled-bad') : ''}">${fill ? escapeHtml(fill.text) : ''}</span>`
      : escapeHtml(x.w))
    .join(' ');
  return `<div class="gap-sentence" lang="ar" dir="rtl">${words}</div>`;
}

function renderExercise(q) {
  const stage = document.getElementById('studyStage');
  const w = q.word;
  let prompt = '';
  let options = [];
  let correct = null;
  let isArOption = false; // варианты — арабские слова

  switch (q.type) {
    case 't1-choice': {
      correct = w.ru;
      options = shuffle([correct, ...pickDistractors(correct, study.story, 'ru')]);
      prompt = `<div class="study-question-ar" lang="ar" dir="rtl">${escapeHtml(wordDisplay(w.w))}</div>`;
      break;
    }
    case 't2': {
      correct = w.w;
      options = shuffle([correct, ...pickDistractors(correct, study.story, 'w')]);
      prompt = `<div class="study-question-ru">${escapeHtml(w.ru || '')}</div>`;
      isArOption = true;
      break;
    }
    case 't3': {
      correct = w.w;
      options = shuffle([correct, ...pickDistractors(correct, study.story, 'w')]);
      prompt = `<div class="study-audio-wrap"><button class="study-audio-btn" id="exAudioBtn">▶ Прослушать слово</button></div>
        <p class="study-hint" style="text-align:center">Запускать нужно самому — можно слушать несколько раз.</p>`;
      isArOption = true;
      break;
    }
    case 't4': {
      // пропуск в предложении: верный ответ — ТА форма, что стоит в тексте
      const inText = (q.sentence.words[q.gapIndex] || {}).w;
      correct = inText || w.w;
      const siblings = [...new Set(q.sentence.words.filter(x => x.w !== correct).map(x => x.w))];
      let pool = siblings.filter(v => Math.abs(v.length - correct.length) <= 4);
      if (pool.length < 3) pool = siblings;
      if (pool.length < 3) pool = pool.concat(pickDistractors(correct, study.story, 'w', 4));
      options = shuffle([correct, ...shuffle([...new Set(pool)]).slice(0, 3)]);
      prompt = renderGapSentence(q, null);
      isArOption = true;
      break;
    }
    case 't5': {
      correct = w.root;
      options = shuffle([correct, ...pickRootDistractors(correct, study.story)]);
      prompt = `<div class="study-question-ar" lang="ar" dir="rtl">${escapeHtml(wordDisplay(w.w))}</div>
        <div class="ex-question-ru">Какой у этого слова корень?</div>`;
      isArOption = true;
      break;
    }
    case 't6': {
      const g = grammarQuestion(w);
      if (!g) { // грамматического вопроса нет (например, служебное слово) — обычный «слово → перевод»
        correct = w.ru;
        options = shuffle([correct, ...pickDistractors(correct, study.story, 'ru')]);
        prompt = `<div class="study-question-ar" lang="ar" dir="rtl">${escapeHtml(wordDisplay(w.w))}</div>`;
        break;
      }
      correct = g.correct;
      options = g.options;
      prompt = `<div class="study-question-ar" lang="ar" dir="rtl">${escapeHtml(wordDisplay(w.w))}</div>
        <div class="ex-question-ru">${escapeHtml(g.q)}</div>`;
      break;
    }
    case 't7-context': {
      // понимание: дана фраза из диалога, выбрать её перевод
      correct = q.sentence.ru;
      options = shuffle([correct, ...pickSentenceDistractors(correct, study.story)]);
      const hl = q.sentence.words
        .map((x, i) => i === q.gapIndex
          ? `<b class="ctx-word">${escapeHtml(x.w)}</b>`
          : escapeHtml(x.w))
        .join(' ');
      prompt = `<div class="gap-sentence" lang="ar" dir="rtl">${hl}</div>
        <div class="ex-question-ru">Что означает эта фраза?</div>`;
      break;
    }
  }

  const optionsHtml = options.map((o, i) => isArOption
      ? `<button class="option-btn"><span class="ob-num">${i + 1}</span><span class="ob-ar">${escapeHtml(wordDisplay(o))}</span></button>`
      : `<button class="option-btn"><span class="ob-num">${i + 1}</span><span class="ob-text">${escapeHtml(o)}</span></button>`
    ).join('');

  stage.innerHTML = `
    <div class="ex-type-label">${EX_TYPE_LABELS[q.type]}</div>
    ${prompt}
    ${optionsHtml ? `<div class="study-options" id="exOptions">${optionsHtml}</div>` : ''}
    <div class="ex-skip-row"><button class="study-exit" id="exSkipBtn" title="Пропустить без изменения интервала">Пропустить карточку →</button></div>
    <div id="exFeedback"></div>`;

  document.getElementById('exSkipBtn').addEventListener('click', skipExercise);

  if (q.type === 't3' && w.audio) {
    document.getElementById('exAudioBtn').addEventListener('click', () => playWordAudio(w.audio));
  }
  const btns = [...stage.querySelectorAll('#exOptions .option-btn')];
  btns.forEach((b, i) => {
    b.addEventListener('click', () => answerExercise(q, i, options, correct, b, btns));
  });
  // для выбора варианта с клавиатуры (цифры 1–4)
  currentExercise = btns.length ? { q, options, correct, btns } : null;
}

/** Клавиатура в тренажёре: 1–4 выбирают вариант, Enter — «Дальше». */
function handleStudyKeys(e) {
  const screen = document.getElementById('screen-study');
  if (!screen || screen.classList.contains('hidden')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (typeof study === 'undefined' || !study) return;

  if (/^[1-9]$/.test(e.key)) {
    if (study.locked || !currentExercise) return;
    const idx = parseInt(e.key, 10) - 1;
    if (idx < currentExercise.btns.length) { e.preventDefault(); currentExercise.btns[idx].click(); }
    return;
  }
  if (e.key === 'Enter') {
    if (!study.locked) return; // до ответа Enter ничего не делает
    const next = document.getElementById('exNextBtn') || document.getElementById('bNextBtn');
    if (next) { e.preventDefault(); next.click(); }
  }
}

/** Ответ на задание: подсветка + результат + разбор слова. Без самооценки. */
function answerExercise(q, i, options, correct, clickedBtn, allBtns) {
  if (study.locked) return;
  study.locked = true;
  const ok = options[i] === correct;
  if (ok) study.score++; else { study.wrong++; addMissed(q.word); }
  allBtns.forEach((b, j) => {
    b.disabled = true;
    if (options[j] === correct) b.classList.add('correct');
  });
  if (!ok) clickedBtn.classList.add('wrong');
  document.getElementById('studyScoreText').textContent = `✅ ${study.score}`;

  // для пропуска в тексте — заполнить пропуск правильным словом
  if (q.type === 't4') {
    const gapEl = document.querySelector('.gap-sentence');
    if (gapEl) gapEl.outerHTML = renderGapSentence(q, { text: correct, ok });
  }

  // запись результата: SRS-расписание + статистика + серия верных ответов
  const streak = recordStudyAnswer(q.word.w, ok);
  inkAnswer(ok, streak, registerLearned(q.word.w, streak), inkSectionForQuestion(q));
  showExerciseResult(q, ok, streak);
}

/** Отметить слово выученным (первое достижение порога в этой сессии). */
function registerLearned(text, streak) {
  if (streak >= learnStreak() && !study.learned.some(x => x === text)) {
    study.learned.push(text);
    return true;
  }
  return false;
}

/** Золотые чернила за ответ тренажёра: верный ответ + серия + выученное слово. */
function inkAnswer(ok, streak, newlyLearned, section) {
  if (typeof INK === 'undefined') return;
  study.combo = ok ? (study.combo || 0) + 1 : 0;
  if (ok) INK.add(INK.P.correct, section);
  if (study.combo > 0 && study.combo % INK.P.comboEvery === 0) INK.add(INK.P.comboBonus, section);
  if (newlyLearned) INK.add(INK.P.learned, section);
}

/** Единая точка результата в тренажёре: SRS + статистика + серия верных ответов. */
function recordStudyAnswer(text, ok) {
  if (typeof SRS !== 'undefined') SRS.gradeWord(text, ok ? 'good' : 'again');
  else recordWordResult(text, ok);
  return bumpWordStreak(text, ok); // текущая серия верных подряд
}

/** Разбор слова после ответа: верно/неверно + перевод + «Дальше». */
function showExerciseResult(q, ok, streak) {
  study.locked = true;
  const w = q.word;
  const fb = document.getElementById('exFeedback');
  const lim = learnStreak();
  const learned = streak >= lim;
  let extra = '';
  if (q.type === 't4') {
    extra = `
      <div class="gap-reveal">${escapeHtml(q.sentence.words.map(x => x.w).join(' '))}</div>
      <div class="gap-reveal-ru">${escapeHtml(q.sentence.ru || '')}</div>`;
  }
  fb.innerHTML = `
    ${extra}
    <div class="study-word-info">
      <div class="ex-result ${ok ? 'ex-ok' : 'ex-bad'}">${ok ? 'Верно' : 'Неверно'}</div>
      <div class="swi-ar">${escapeHtml(wordDisplay(w.w))}</div>
      ${w.tr ? `<div class="swi-tr">${escapeHtml(w.tr)}</div>` : ''}
      <div class="swi-ru">${escapeHtml(w.ru || '')}</div>
      ${(!isArabicMode() && w.root && w.root !== '—') ? `<div class="srs-meta">Корень: <span class="arabic-inline">${escapeHtml(w.root)}</span></div>` : ''}
      ${w.pos ? `<div class="srs-meta">${escapeHtml(w.pos)}</div>` : ''}
      ${w.audio ? '<button class="ctrl-btn small" id="exInfoAudioBtn">Прослушать</button>' : ''}
      <div class="study-actions" style="justify-content:center;margin-top:14px">
        <button class="ctrl-btn primary" id="exNextBtn">Дальше →</button>
      </div>
      <p class="study-hint">Верных ответов подряд: ${Math.min(streak, lim)} из ${lim}${learned ? ' — слово выучено ✓' : ''}.</p>
    </div>`;
  if (w.audio) {
    document.getElementById('exInfoAudioBtn').addEventListener('click', () => playWordAudio(w.audio));
  }
  document.getElementById('exNextBtn').addEventListener('click', () => { clearAdvance(); nextStudyQuestion(); });
  // показать пояснение и дать время на разбор, затем авто-переход
  fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
  scheduleAdvance();
}

/** Серия верных ответов подряд по слову. */
function getWordStreak(text) {
  const e = getStudyStats()[text];
  return (e && e.streak) || 0;
}

/** Верно → серия +1, ошибка → сброс. Возвращает текущую серию. */
function bumpWordStreak(text, ok) {
  const stats = getStudyStats();
  const e = stats[text] || { c: 0, w: 0 };
  e.streak = ok ? ((e.streak || 0) + 1) : 0;
  stats[text] = e;
  saveStudyStats(stats);
  return e.streak;
}

/** Слово выучено, если набрано нужное число верных подряд. */
function isWordLearned(text) {
  const e = getStudyStats()[text];
  return !!e && (e.streak || 0) >= learnStreak();
}

/** Сколько слов выучено (по всем текстам). */
function learnedWordsCount() {
  let n = 0;
  const lim = learnStreak();
  Object.values(getStudyStats()).forEach(e => { if (e && (e.streak || 0) >= lim) n++; });
  return n;
}

/** Запомнить слово для итогового списка «стоит повторить» (без дублей). */
function addMissed(word) {
  if (!word || !study || !study.missed) return;
  if (study.missed.some(x => x.w === word.w)) return;
  study.missed.push({ w: word.w, ru: word.ru || '' });
}

/** Пропуск: без изменения интервала и статистики. */
function skipExercise() {
  if (study.locked) return;
  clearAdvance();
  nextStudyQuestion();
}

function nextStudyQuestion() {
  clearAdvance();
  study.idx++;
  if (study.idx >= study.questions.length) renderStudyEnd();
  else renderStudyQuestion();
}

/** Подпись кнопки продолжения: дальше идут ещё не выученные слова того же источника. */
function studyContinueLabel(sourceId) {
  if (sourceId && sourceId.indexOf('chapter:') === 0) return 'Изучить новые слова из этой главы';
  if (sourceId === '__new__') return 'Изучить новые слова';
  return 'Изучить новые слова из этого текста';
}

/** Продолжить тренировку того же источника (выученные слова уже исключены). */
function restartStudy() {
  const src = (study && study.sourceId) || document.getElementById('studySource').value;
  if (!src) { backToStudySetup(); return; }
  pendingStudySource = src;
  startStudy();
}

function renderStudyEnd() {
  const total = study.questions.length;
  const pct = Math.round(study.score / total * 100);
  document.getElementById('studyProgressText').textContent = 'Готово!';
  const stage = document.getElementById('studyStage');
  // завершённая тренировка — учебный день (журнал активности) + чернила за сессию
  if (typeof logActivity === 'function') logActivity({ trainings: 1 });
  if (typeof INK !== 'undefined') {
    const sec = INK.dominantSection((study.questions || []).map(q => inkSectionForQuestion(q)))
      || (study.story ? INK.sectionForStory(study.story) : null);
    INK.add(INK.P.session, sec);
  }
  const missed = study.missed || [];
  const missedHtml = missed.length ? `
      <div class="study-missed">
        <div class="sm-title">Стоит повторить:</div>
        ${missed.map(x => `<div class="sm-item"><span class="sm-ar" lang="ar" dir="rtl">${escapeHtml(x.w)}</span><span class="sm-ru">${escapeHtml(x.ru)}</span></div>`).join('')}
      </div>` : '';
  stage.innerHTML = `
    <div class="study-summary">
      <div>Правильных ответов:</div>
      <div class="big">${study.score} / ${total}</div>
      <div class="percent">${pct}% · ошибок: ${study.wrong || 0}</div>
      ${(study.learned && study.learned.length) ? `<div class="study-learned">Выучено слов в этой сессии: <b>${study.learned.length}</b></div>` : ''}
      ${renderInkEarned()}
      ${missedHtml}
      <div class="study-actions" style="justify-content:center">
        <button class="ctrl-btn small primary" id="studyRetryBtn">${escapeHtml(studyContinueLabel(study.sourceId))}</button>
        <button class="ctrl-btn small" id="studyBackBtn">Выбрать другой источник</button>
      </div>
    </div>`;
  document.getElementById('studyRetryBtn').addEventListener('click', restartStudy);
  document.getElementById('studyBackBtn').addEventListener('click', backToStudySetup);
  renderStudyDashboard(); // обновляем «Мой прогресс» сразу по завершении
}

/** Строка итога: сколько золотых чернил принесла сессия. */
function renderInkEarned() {
  if (typeof INK === 'undefined') return '';
  const n = INK.sinceMark();
  return n > 0 ? `<div class="ink-earned">Золотых чернил за сессию: <b>+${n}</b></div>` : '';
}

/** Режим «собери аят / фразу»: слова в разброс, собираем порядок кликами. */
function renderBuilder(sentence, sentenceStory) {
  const stage = document.getElementById('studyStage');
  const n = sentence.words.length;
  const indices = sentence.words.map((_, i) => i);
  const chosen = [];
  const label = sentence.ayah
    ? `аят № ${sentence.ayah}`
    : 'фраза';

  stage.innerHTML = `
    <p class="study-hint">Собери в правильном порядке — <b>${label}</b> (кликай по словам):</p>
    <div class="builder-answer" id="bAnswer"></div>
    <div class="builder-pool" id="bPool"></div>
    <div class="study-actions">
      <button class="ctrl-btn small primary" id="bCheck">Проверить</button>
      <button class="ctrl-btn small" id="bReset">Сбросить</button>
    </div>`;

  const pool = document.getElementById('bPool');
  const ans = document.getElementById('bAnswer');

  shuffle(indices).forEach(i => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = sentence.words[i].w;
    chip.addEventListener('click', () => {
      if (study.locked) return;
      chosen.push(i);
      chip.classList.add('used');
      const a = document.createElement('span');
      a.className = 'chip';
      a.textContent = sentence.words[i].w;
      a.addEventListener('click', () => {
        if (study.locked) return;
        const pos = chosen.indexOf(i);
        if (pos >= 0) {
          chosen.splice(pos, 1);
          a.remove();
          chip.classList.remove('used');
        }
      });
      ans.appendChild(a);
    });
    pool.appendChild(chip);
  });

  document.getElementById('bCheck').addEventListener('click', () => {
    if (study.locked) return;
    study.locked = true;
    const ok = chosen.length === n && chosen.every((v, i) => sentence.words[v].w === sentence.words[i].w);
    if (ok) {
      study.score++;
      ans.classList.add('builder-ok');
      // верная сборка аята засчитывается всем его словам
      sentence.words.forEach(w => recordWordResult(w.w, true));
    } else {
      ans.classList.add('builder-bad');
      ans.innerHTML = '';
      sentence.words.forEach(w => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.textContent = wordDisplay(w.w);
        ans.appendChild(c);
      });
    }
    document.getElementById('studyScoreText').textContent = `✅ ${study.score}`;
    // золотые чернила: сборка — сложнее обычного ответа
    if (typeof INK !== 'undefined') {
      const sec = inkSectionForQuestion({ story: sentenceStory });
      study.combo = ok ? (study.combo || 0) + 1 : 0;
      if (ok) INK.add(INK.P.correct + INK.P.build, sec);
      if (study.combo > 0 && study.combo % INK.P.comboEvery === 0) INK.add(INK.P.comboBonus, sec);
    }

    // После сборки: перевод + озвучка (если есть) + «Дальше»
    const info = document.createElement('div');
    info.className = 'study-word-info';
    info.innerHTML = `
      <div class="swi-ru">${escapeHtml(sentence.ru || '')}</div>
      <div class="study-actions" style="justify-content:center">
        ${sentence.ayahAudio ? '<button class="ctrl-btn small" id="bPlayBtn">▶ Прослушать аят</button>' : ''}
        <button class="ctrl-btn small primary" id="bNextBtn">Дальше →</button>
      </div>`;
    stage.appendChild(info);
    if (sentence.ayahAudio) {
      const playBtn = document.getElementById('bPlayBtn');
      playBtn.addEventListener('click', () => playWordAudio(sentence.ayahAudio));
      if (ok) playWordAudio(sentence.ayahAudio); // авто-озвучка при верной сборке
    }
    document.getElementById('bNextBtn').addEventListener('click', () => { clearAdvance(); nextStudyQuestion(); });
    info.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scheduleAdvance();
  });

  document.getElementById('bReset').addEventListener('click', () => {
    if (study.locked) return;
    renderBuilder(sentence, sentenceStory);
  });
}

// ------------------------- Инициализация -------------------------

document.addEventListener('DOMContentLoaded', () => {
  playerAudio = document.getElementById('audioPlayer');
  playerAudio.preload = 'auto';

  // Навигация по разделам
  document.querySelectorAll('.nav-tab[data-section]').forEach(t => {
    t.addEventListener('click', () => switchTo(t.dataset.section));
  });
  document.getElementById('studyStartBtn').addEventListener('click', startStudy);
  document.getElementById('studyExitBtn').addEventListener('click', backToStudySetup);

  // Режимы огласовок (только визуальная копия, данные не меняются)
  document.querySelectorAll('#harakatControls button[data-h]').forEach(btn => {
    btn.addEventListener('click', () => setHarakatMode(btn.dataset.h));
  });

  // Выбор чтеца
  const reciterSel = document.getElementById('reciterSelect');
  if (reciterSel) {
    RECITERS.forEach(r => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name;
      reciterSel.appendChild(o);
    });
    reciterSel.value = currentReciter;
    reciterSel.addEventListener('change', () => setReciter(reciterSel.value));
  }

  // Запись своего чтения (локально, без отправки наружу)
  document.getElementById('recToggleBtn').addEventListener('click', toggleRecording);
  document.getElementById('recPlayBtn').addEventListener('click', playRecording);
  document.getElementById('recDeleteBtn').addEventListener('click', () => deleteRecording(true));

  const gramBack = document.getElementById('grammarBackBtn');
  if (gramBack) gramBack.addEventListener('click', () => switchTo('grammar'));

  updateProgressBadge();

  // Синхронизация высоты шапки для sticky-плеера (чтобы никогда не уезжал под неё)
  const syncHeaderHeight = () => {
    const st = document.querySelector('.sticky-top');
    if (st) document.documentElement.style.setProperty('--header-h', st.offsetHeight + 'px');
  };
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);

  // Последний экран читаем ДО applyMode(): applyMode вызывает switchTo('home'),
  // который перезаписал бы сохранённый раздел и сломал восстановление после F5.
  let restored = null;
  try { restored = JSON.parse(sessionStorage.getItem(UI_STATE_KEY)); } catch (e) { /* нет состояния */ }

  // Режим (Ислам / Арабский язык): вкладки, пространство ключей, данные модулей
  if (typeof applyMode === 'function') applyMode();

  // Восстановление последнего экрана и позиции прокрутки (после обновления страницы)
  const validSections = ['home', 'routes', 'quran', 'hadith', 'stories', 'adhkar', 'study', 'review', 'hifz', 'huna1', 'huna2', 'words', 'grammar'];
  if (restored && validSections.includes(restored.section) &&
      (typeof sectionInMode !== 'function' || sectionInMode(restored.section))) {
    switchTo(restored.section);
    if (restored.storyId && STORIES_DATA.stories.some(s => s.id === restored.storyId)) {
      openStory(restored.storyId);
    }
    if (restored.y) setTimeout(() => window.scrollTo(0, restored.y), 60);
  } else {
    switchTo('home');
  }

  const btnPlay = document.getElementById('btnPlayPause');
  const btnStop = document.getElementById('btnStop');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const seekBar = document.getElementById('seekBar');
  const speedSelect = document.getElementById('speedSelect');

  btnPlay.addEventListener('click', togglePlayPause);
  btnStop.addEventListener('click', stopPlayer);
  if (btnPrev) btnPrev.addEventListener('click', () => stepSentence(-1));
  if (btnNext) btnNext.addEventListener('click', () => stepSentence(1));

  speedSelect.addEventListener('change', () => {
    if (playerAudio) playerAudio.playbackRate = parseFloat(speedSelect.value);
  });

  // Перетаскивание ползунка
  seekBar.addEventListener('input', () => {
    isSeeking = true;
    document.getElementById('timeCurrent').textContent = fmtTime(parseFloat(seekBar.value));
  });
  seekBar.addEventListener('change', () => {
    isSeeking = false;
    seekToGlobal(parseFloat(seekBar.value));
    if (!playerAudio.paused) playPlayer(); else updateTimeUI(parseFloat(seekBar.value));
  });

  // События плеера
  playerAudio.addEventListener('timeupdate', () => {
    if (!isSeeking) updateTimeUI(globalPosition());
  });

  playerAudio.addEventListener('loadedmetadata', () => {
    // точная длительность аята — обновляем шкалу, если была оценка
    const item = playlist[currentAyah];
    if (item && isFinite(playerAudio.duration) && playerAudio.duration > 0) {
      const wasEstimated = !item.duration || item.duration === 5;
      if (wasEstimated) {
        item.duration = playerAudio.duration;
        let acc = 0;
        starts = playlist.map(it => { const s = acc; acc += it.duration; return s; });
        totalDuration = acc;
        document.getElementById('seekBar').max = totalDuration;
        document.getElementById('timeTotal').textContent = fmtTime(totalDuration);
      }
    }
  });

  playerAudio.addEventListener('canplay', () => {
    if (needPlayAfterLoad) {
      try { playerAudio.currentTime = needPlayAfterLoad; } catch (e) {}
      needPlayAfterLoad = 0;
    }
    // авто-возобновление после перемотки на другой аят во время воспроизведения
    if (wantPlaying && playerAudio.paused) {
      playerAudio.play().catch(() => {});
    }
  });

  playerAudio.addEventListener('play', () => {
    btnPlay.textContent = '⏸';
    highlightAyah(currentAyah);
    showPlayerStatus('');
  });

  playerAudio.addEventListener('pause', () => {
    btnPlay.textContent = '▶';
  });

  playerAudio.addEventListener('ended', () => {
    // переход к следующему аяту или завершение
    if (currentAyah < playlist.length - 1) {
      loadAyah(currentAyah + 1, 0);
      playPlayer();
    } else {
      btnPlay.textContent = '▶';
      clearPlayingHighlight();
      updateTimeUI(totalDuration);
    }
  });

  playerAudio.addEventListener('error', () => {
    if (!playlist.length) return;
    const item = playlist[currentAyah];
    // локальный файл не нашёлся — пробуем CDN (однократно для этого аята)
    if (item && !item.triedCdn && item.src !== item.cdn) {
      item.triedCdn = true;
      item.src = item.cdn;
      loadAyah(currentAyah, 0);
      if (wantPlaying) playPlayer();
      return;
    }
    showPlayerStatus('Ошибка загрузки аудио. Проверьте папку audio/ или интернет-соединение.', true);
  });

  // Тренажёр: цифры 1–4 выбирают вариант ответа, Enter — «Дальше»
  document.addEventListener('keydown', handleStudyKeys);

  // Esc закрывает модальные окна; Tab не выходит за пределы открытого окна
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeWordCard();
      return;
    }
    if (e.key !== 'Tab') return;
    const modals = ['wordCard', 'listModal', 'levelsModal']
      .map(id => document.getElementById(id))
      .filter(m => m && !m.classList.contains('hidden'));
    if (!modals.length) return;
    const modal = modals[modals.length - 1];
    const focusables = [...modal.querySelectorAll('button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (document.activeElement !== modal && !modal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  });
});
