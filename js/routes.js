// ============================================================
//  Раздел «Намаз» — путь понимания и заучивания молитвы.
//  Построен на движке шагов с прогрессом (read/study/hifz/review).
//
//    kind: 'read'         — прочитать текст (завершается открытием текста);
//    kind: 'study'        — проработать слова в тренажёре (авто: ≥60% слов
//                           имеют ответы в SRS);
//    kind: 'hifz'         — заучивание аятов в Хифзе (авто: ≥60% аятов
//                           имеют карточки хифза);
//    kind: 'words-review' — повторение слов по графику;
//    kind: 'ayat-review'  — мураджа'а аятов.
//  Любой шаг можно отметить выполненным вручную (кнопка ✓).
// ============================================================

const ROUTES = [
  {
    id: 'namaz-adhan-iqama',
    title: 'Азан и Икъама — призывы к молитве',
    goal: 'Научиться читать призыв к молитве и понять, чем икъама отличается от азана, а утренний азан — от остальных.',
    steps: [
      { kind: 'read', storyId: 'namaz-adhan', title: 'Азан — призыв к молитве',
        hint: 'Все фразы азана с транслитерацией и разбором; в азане Фаджра — «Молитва лучше сна».' },
      { kind: 'read', storyId: 'namaz-iqama', title: 'Икъама — призыв перед самой молитвой',
        hint: 'Отличия от азана: читается быстро, с фразой «قَدْ قَامَتِ الصَّلَاةُ».' }
    ]
  },
  {
    id: 'namaz-prepare',
    title: 'Подготовка: намерение и чистота',
    goal: 'Понять два условия молитвы: правильное намерение и очищение.',
    steps: [
      { kind: 'read', storyId: 'hadith-niyyat', title: 'Хадис: «Дела — по намерениям»',
        hint: 'Первый хадис «Сахиха» аль-Бухари — основа намерения в намазе.' },
      { kind: 'read', storyId: 'hadith-tuhur', title: 'Хадис: «Чистота — половина веры»',
        hint: 'Омовение (тахарат) — условие действительности молитвы.' }
    ]
  },
  {
    id: 'namaz-conditions',
    title: 'Условия действительности и принятия молитвы',
    goal: 'Знать, что должно быть соблюдено, чтобы молитва была действительной и принятой.',
    steps: [
      { kind: 'read', storyId: 'namaz-conditions', title: 'Шурут: условия молитвы с разбором терминов',
        hint: 'Чистота, время, кибла, аурат, намерение; а также искренность и смирение.' }
    ]
  },
  {
    id: 'namaz-parts',
    title: 'Из чего состоит намаз',
    goal: 'Разобраться в устройстве молитвы: ракааты, кыям, руку, суджуд и ступени действий.',
    steps: [
      { kind: 'read', storyId: 'namaz-parts', title: 'Части намаза: ракааты, аркан, ваджибат, сунны',
        hint: 'Структура ракаата и различие между столпами, необходимыми и желательными действиями.' }
    ]
  },
  {
    id: 'namaz-order',
    title: 'Порядок намаза: все тексты по порядку',
    goal: 'Знать, что и когда произносится в молитве — от такбира ихтирам до саляма.',
    steps: [
      { kind: 'read', storyId: 'namaz-full', title: 'Все тексты намаза с разбором',
        hint: 'Каждая формула — с плашкой «когда произносится» и пословным разбором.' }
    ]
  },
  {
    id: 'namaz-tashahhud',
    title: 'Ташаххуд и зикры после намаза',
    goal: 'Понимать каждое слово ташаххуда и завершающего тасбиха.',
    steps: [
      { kind: 'read', storyId: 'namaz-tashahhud', title: 'Ташаххуд: Ат-тахиййат — пословный разбор',
        hint: 'Слова, произносимые сидя после двух ракаатов.' },
      { kind: 'read', storyId: 'namaz-dhikr', title: 'Зикры после намаза: тасбих 33/33/34',
        hint: '«СубханаЛлах» 33, «Альхамдулиллях» 33, «Аллаху Акбар» 34 — с разбором.' },
      { kind: 'words-review', title: 'Повторение слов намаза',
        hint: 'Закрепите лексику по графику интервального повторения.' }
    ]
  },
  {
    id: 'namaz-fajr',
    title: 'Особенности утренней молитвы (Фаджр)',
    goal: 'Понять, чем Фаджр отличается от других намазов: время, азан, число ракаатов.',
    steps: [
      { kind: 'read', storyId: 'namaz-fajr', title: 'Фаджр: истинная заря, сунна и фард',
        hint: 'Почему в азане Фаджра звучит «Молитва лучше сна» и как читается утренний намаз.' }
    ]
  }
];

// ------------------------- хранилище прогресса маршрутов -------------------------

const ROUTES_KEY = 'arabic-reader-routes-v1';

function loadRoutesStore() {
  try {
    const s = JSON.parse(localStorage.getItem(ROUTES_KEY));
    if (s && typeof s === 'object') {
      return { visited: s.visited || {}, manual: s.manual || {} };
    }
  } catch (e) { /* повреждены — чистое состояние */ }
  return { visited: {}, manual: {} };
}

let routesStore = loadRoutesStore();

function saveRoutesStore() {
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify(routesStore));
  } catch (e) { /* запись не критична */ }
}

/** Отметить текст прочитанным (вызывается при открытии). */
function markStoryVisited(storyId) {
  if (!routesStore.visited[storyId]) {
    routesStore.visited[storyId] = true;
    saveRoutesStore();
  }
}

// ------------------------- действия шагов -------------------------

function stepAction(step) {
  switch (step.kind) {
    case 'read':
      if (step.storyId) openStory(step.storyId);
      break;
    case 'study':
      switchTo('study');
      document.getElementById('studySource').value = step.storyId;
      startStudy();
      break;
    case 'hifz':
      switchTo('hifz');
      if (typeof HIFZ !== 'undefined') HIFZ.startFor(step.storyId);
      break;
    case 'words-review':
      switchTo('review');
      if (typeof SRS !== 'undefined') SRS.startDefaultSession();
      break;
    case 'ayat-review':
      switchTo('hifz');
      if (typeof HIFZ !== 'undefined') HIFZ.startQueue();
      break;
  }
}

// ------------------------- экран -------------------------

function renderRoutes() {
  const el = document.getElementById('routesDashboard');
  if (!el) return;

  el.innerHTML = ROUTES.map(route => {
    const stepsHtml = route.steps.map((step, i) => `
      <li class="route-step" data-route="${route.id}" data-step="${i}" role="button" tabindex="0">
        <span class="rs-num">${i + 1}</span>
        <div class="rs-body">
          <div class="rs-title">${escapeHtml(step.title)}</div>
          <div class="rs-hint">${escapeHtml(step.hint || '')}</div>
        </div>
      </li>`).join('');

    return `
      <div class="study-panel route-panel">
        <h3 class="study-panel-title">${escapeHtml(route.title)}</h3>
        <p class="route-goal">${escapeHtml(route.goal)}</p>
        <ol class="route-steps">${stepsHtml}</ol>
      </div>`;
  }).join('');

  // клик по всей области шага (+ Enter/Space с клавиатуры)
  el.querySelectorAll('.route-step[data-route]').forEach(li => {
    const activate = () => {
      const route = ROUTES.find(r => r.id === li.dataset.route);
      const step = route && route.steps[+li.dataset.step];
      if (step) stepAction(step);
    };
    li.addEventListener('click', activate);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });
}
