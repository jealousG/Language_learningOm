// ============================================================
//  Режимы (состояния) сайта: «Ислам» и «Арабский язык».
//  Режим определяет набор разделов (вкладок) и пространство ключей
//  хранилища: у каждого режима свой прогресс/SRS/статистика.
//  «Ислам» использует исходные ключи (обратная совместимость),
//  остальные режимы — те же ключи с суффиксом «__<режим>».
// ============================================================

const MODE_KEY = 'arabic-reader-mode-v1';

const MODES = {
  islam: {
    id: 'islam',
    title: 'Ислам',
    subtitle: 'Коран · аят · хадисы · намаз',
    sections: ['home', 'routes', 'quran', 'hadith', 'stories', 'adhkar', 'review', 'hifz'],
    types: ['quran', 'hadith', 'story', 'adhkar', 'namaz']
  },
  arabic: {
    id: 'arabic',
    title: 'Арабский язык',
    subtitle: 'Хуна Арабия · диалоги · лексика',
    sections: ['home', 'review', 'huna1', 'huna2', 'words', 'grammar'],
    types: ['huna1', 'huna2']
  }
};

let currentMode = (function () {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES[v] ? v : 'islam';
  } catch (e) { return 'islam'; }
})();

/** Ключ localStorage/sessionStorage с учётом режима. */
function modeNs(key) {
  return currentMode === 'islam' ? key : key + '__' + currentMode;
}

function getMode() { return currentMode; }

function modeSections() { return MODES[currentMode].sections; }

function sectionInMode(section) { return modeSections().includes(section); }

/** Источники слов тренажёра текущего режима: [[section, label], ...]. */
function modeSources() {
  if (currentMode === 'arabic') {
    return [['huna1', 'Хуна Арабия 1 Том'], ['huna2', 'Хуна Арабия 2 Том']];
  }
  return [['quran', 'Коран'], ['hadith', 'Хадисы'], ['stories', 'Истории'], ['adhkar', 'Азкары'], ['namaz', 'Намаз']];
}

/** Все тексты текущего режима (для тренажёра, статистики, «новых слов»). */
function modeStories() {
  if (typeof STORIES_DATA === 'undefined') return [];
  const types = MODES[currentMode].types;
  return STORIES_DATA.stories.filter(s => types.includes(s.type || 'quran'));
}

/** Переключить режим: сохранить выбор, обновить интерфейс, уйти на «Главную». */
function setMode(id) {
  if (!MODES[id] || id === currentMode) return;
  currentMode = id;
  try { localStorage.setItem(MODE_KEY, id); } catch (e) { /* не критично */ }
  applyMode();
}

/** Привести интерфейс к текущему режиму и перечитать данные режимных модулей. */
function applyMode() {
  const m = MODES[currentMode];

  document.querySelectorAll('.nav-tab[data-section]').forEach(t => {
    t.classList.toggle('hidden', !m.sections.includes(t.dataset.section));
  });
  document.querySelectorAll('.mode-btn').forEach(b => {
    const on = b.dataset.mode === currentMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const sub = document.querySelector('.topbar .logo-sub');
  if (sub) sub.textContent = m.subtitle;
  document.body.dataset.mode = currentMode;

  // данные режимных модулей перечитываем из своего пространства ключей
  if (typeof SRS !== 'undefined' && SRS.reload) SRS.reload();

  if (typeof switchTo === 'function') switchTo('home');
}
