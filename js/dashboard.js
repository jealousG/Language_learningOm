// ============================================================
//  Учебный дашборд («Главная») — теплокарта практики + ежедневный план.
//
//  Журнал активности: localStorage arabic-reader-activity-v1
//    { days: { "ГГГГ-ММ-ДД": { reviews, correct, trainings, words } } }
//    words — проработанные слова за день (ось яркости теплокарты).
//
//  Учебный день считается завершённым, если:
//    - ответлено >= 3 карточек (слов или аятов), или
//    - завершена хотя бы одна тренировка.
//  Простое открытие сайта серию не продолжает.
// ============================================================

const ACTIVITY_KEY = () => modeNs('arabic-reader-activity-v1');
const ACTIVITY_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_HISTORY_DAYS = 400;  // храним ~год (теплокарта «Главной»)
const STUDY_DAY_MIN_REVIEWS = 3;    // минимум ответов для «учебного дня»
const HEAT_WEEKS = 53;              // ширина теплокарты, как у GitHub

// Делегирование общей утилите даты (единственная реализация — js/util.js)
const actDateKey = d => dateKey(d);

function loadActivity() {
  try {
    const a = JSON.parse(localStorage.getItem(ACTIVITY_KEY()));
    if (a && typeof a === 'object' && a.days) return a;
  } catch (e) { /* повреждены — чистый журнал */ }
  return { days: {} };
}

function saveActivity(a) {
  try {
    localStorage.setItem(ACTIVITY_KEY(), JSON.stringify(a));
  } catch (e) { /* запись не критична */ }
}

/** Записать активность за сегодня: { reviews, correct, trainings, words }. */
function logActivity(delta) {
  if (!delta) return;
  const a = loadActivity();
  const k = actDateKey();
  const d = a.days[k] || { reviews: 0, correct: 0, trainings: 0, words: 0 };
  d.reviews += delta.reviews || 0;
  d.correct += delta.correct || 0;
  d.trainings += delta.trainings || 0;
  d.words += delta.words || 0;
  a.days[k] = d;
  // чистим старую историю
  const cutoff = Date.now() - ACTIVITY_HISTORY_DAYS * ACTIVITY_DAY_MS;
  Object.keys(a.days).forEach(kk => {
    const t = new Date(kk + 'T00:00:00').getTime();
    if (isNaN(t) || t < cutoff) delete a.days[kk];
  });
  saveActivity(a);
}

function isStudyDay(a, k) {
  const d = a.days[k];
  return !!d && ((d.reviews || 0) >= STUDY_DAY_MIN_REVIEWS || (d.trainings || 0) >= 1);
}

/** Серия учебных дней (сегодня может быть ещё не завершён — тогда считаем до вчера). */
function calcStreak(a) {
  let streak = 0;
  const d = new Date();
  if (!isStudyDay(a, actDateKey(d))) d.setDate(d.getDate() - 1);
  while (isStudyDay(a, actDateKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Успешность ответов за последние N дней: { pct, reviews } или null. */
function successRate(a, daysN) {
  let reviews = 0, correct = 0;
  const d = new Date();
  for (let i = 0; i < daysN; i++) {
    const day = a.days[actDateKey(d)];
    if (day) { reviews += day.reviews || 0; correct += day.correct || 0; }
    d.setDate(d.getDate() - 1);
  }
  if (!reviews) return null;
  return { pct: Math.round(correct / reviews * 100), reviews };
}

// ------------------------- теплокарта «Моя практика» -------------------------

/** Русская форма слова «слово» по числу. */
function pluralWords(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'слово';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'слова';
  return 'слов';
}

/** Проработано слов за день (старые записи без слова words — берём reviews). */
function dayWords(d) {
  if (!d) return 0;
  return (typeof d.words === 'number') ? d.words : (d.reviews || 0);
}

/**
 * Данные теплокарты: столбец = неделя (Пн…Вс), последние ~53 недели.
 * Возвращает { weeks: [{ month, cells: [{ key, date, words }] }], total, max }.
 */
function buildHeatmap(a) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (HEAT_WEEKS * 7 - 1) * ACTIVITY_DAY_MS);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // выравнивание на понедельник

  const weeks = [];
  let total = 0, max = 0, cur = null;
  for (let d = new Date(start); d.getTime() <= today.getTime(); d = new Date(d.getTime() + ACTIVITY_DAY_MS)) {
    const key = actDateKey(d);
    const words = dayWords(a.days[key]);
    if ((d.getDay() + 6) % 7 === 0 || !cur) {
      cur = { month: d.getMonth(), cells: [] };
      weeks.push(cur);
    }
    cur.cells.push({ key, date: new Date(d), words });
    total += words;
    if (words > max) max = words;
  }
  return { weeks, total, max };
}

function heatLevel(words, max) {
  if (!words || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil(words / max * 4)));
}

const HEAT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function renderHeatmap(a) {
  const { weeks, total, max } = buildHeatmap(a);
  const todayKey = actDateKey();
  const dateFmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  let monthsHtml = '', gridHtml = '', prevMonth = -1;
  weeks.forEach(w => {
    monthsHtml += `<span class="heat-month">${w.month !== prevMonth ? HEAT_MONTHS[w.month] : ''}</span>`;
    prevMonth = w.month;
    let col = '';
    w.cells.forEach(c => {
      const lvl = heatLevel(c.words, max);
      const title = c.words
        ? `${c.words} ${pluralWords(c.words)} · ${dateFmt(c.date)}`
        : `${dateFmt(c.date)} — занятий нет`;
      const mark = c.key === todayKey ? ' heat-today' : '';
      col += `<span class="heat-cell l${lvl}${mark}" title="${escapeHtml(title)}"></span>`;
    });
    gridHtml += `<span class="heat-week">${col}</span>`;
  });

  return `
    <div class="heat-wrap">
      <div class="heat-months">${monthsHtml}</div>
      <div class="heat-body">
        <div class="heat-daylabels"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
        <div class="heat-grid">${gridHtml}</div>
      </div>
      <div class="heat-foot">
        <span class="heat-total">${total} ${pluralWords(total)} за год</span>
        <span class="heat-legend">меньше <i class="heat-cell l0"></i><i class="heat-cell l1"></i><i class="heat-cell l2"></i><i class="heat-cell l3"></i><i class="heat-cell l4"></i> больше</span>
      </div>
    </div>`;
}

// ------------------------- экран «Главная» -------------------------

function renderHome() {
  const el = document.getElementById('homeDashboard');
  if (!el) return;

  const haveSrs = typeof SRS !== 'undefined';
  const haveHifz = typeof HIFZ !== 'undefined';
  const sc = haveSrs ? SRS.getCounts() : { due: 0, newAvailable: 0, hard: 0, learning: 0, solid: 0 };
  const hc = haveHifz ? HIFZ.getCounts() : { due: 0, hard: 0, learning: 0 };
  const dailyNew = haveSrs ? SRS.getDailyNewCount() : 0;

  const a = loadActivity();
  const today = a.days[actDateKey()] || { reviews: 0, correct: 0, trainings: 0, words: 0 };
  const streak = calcStreak(a);
  const r7 = successRate(a, 7);
  const r30 = successRate(a, 30);

  const todayDate = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const lastStory = haveSrs ? SRS.getLastStory() : null; // для «Продолжить чтение»
  const isIslam = (typeof getMode === 'function') ? getMode() === 'islam' : true;
  const inkLi = (typeof INK !== 'undefined') ? INK.levelInfo() : null;
  const inkHtml = inkLi ? `
      <div class="ink-line">
        <span class="ink-level">${escapeHtml(inkLi.name)}</span>
        <span class="ink-amount">${INK.total()} золотых чернил</span>
      </div>
      <div class="ink-bar" role="img" aria-label="Прогресс уровня: ${inkLi.pct}%">
        <div class="ink-fill" style="width:${inkLi.pct}%"></div>
      </div>
      <p class="ink-next">${inkLi.nextName
        ? 'до «' + escapeHtml(inkLi.nextName) + '»: ' + inkLi.toNext
        : 'высший уровень достигнут'}</p>` : '';

  const countersHtml = isIslam
    ? `${sc.due} слов и ${hc.due} аятов ждут повторения${sc.newAvailable ? ' · доступно новых слов: ' + sc.newAvailable : ''}`
    : `${sc.due} слов ждут повторения${sc.newAvailable ? ' · доступно новых слов: ' + sc.newAvailable : ''}`;

  const trioHtml = isIslam ? `
      <button class="home-card hc-review" id="hmReviewWords2" type="button">
        <span class="home-card-kicker">Слова</span>
        <span class="home-card-title">Повторение слов</span>
        <span class="home-card-note">${sc.due ? sc.due + ' карточек сегодня' : 'пока нечего повторять'}</span>
      </button>
      <button class="home-card hc-hifz" id="hmReviewAyat" type="button">
        <span class="home-card-kicker">Коран</span>
        <span class="home-card-title">Хифз</span>
        <span class="home-card-note">${hc.due ? hc.due + ' аятов к повторению' : 'аяты в спокойном темпе'}</span>
      </button>
      <button class="home-card hc-read" id="hmReadMore" type="button">
        <span class="home-card-kicker">Чтение</span>
        <span class="home-card-title">Продолжить чтение</span>
        <span class="home-card-note">${lastStory ? 'вы читали: ' + escapeHtml(lastStory.titleRu) : 'список сур'}</span>
      </button>` : `
      <button class="home-card hc-review" id="hmReviewWords2" type="button">
        <span class="home-card-kicker">Слова</span>
        <span class="home-card-title">Повторение слов</span>
        <span class="home-card-note">${sc.due ? sc.due + ' карточек сегодня' : 'пока нечего повторять'}</span>
      </button>
      <button class="home-card hc-hifz" id="hmHuna1" type="button">
        <span class="home-card-kicker">Учебник</span>
        <span class="home-card-title">Хуна Арабия 1 Том</span>
        <span class="home-card-note">главы · диалоги · слова</span>
      </button>
      <button class="home-card hc-read" id="hmHuna2" type="button">
        <span class="home-card-kicker">Учебник</span>
        <span class="home-card-title">Хуна Арабия 2 Том</span>
        <span class="home-card-note">главы · диалоги · слова</span>
      </button>`;

  el.innerHTML = `
    <section class="home-heat">
      <div class="heat-head">
        <p class="hero-date">${todayDate}${streak > 0 ? ' · серия ' + streak + ' ' + (streak === 1 ? 'день' : 'дн.') : ''}</p>
        ${inkHtml}
        <h3 class="hero-title">Моя практика</h3>
      </div>
      ${renderHeatmap(a)}
    </section>

    <section class="home-actions">
      <button class="ctrl-btn primary hero-cta" id="hmNewWords" type="button">Изучить новые слова</button>
      <button class="ctrl-btn hero-cta" id="hmReviewWords" type="button">
        Повторить изученные слова${sc.due ? '<span class="ha-count">' + sc.due + '</span>' : ''}
      </button>
      <p class="hero-counters">${countersHtml}</p>
    </section>

    <section class="home-trio">${trioHtml}</section>

    <div class="study-panel">
      <details class="stats-section">
        <summary>Подробная статистика<span class="ss-badge">серия: ${streak} дн.</span></summary>
        <div class="stats-section-body">
          <div class="stats-row stats-row-5">
            <div class="stat-box"><div class="stat-num">${sc.due}</div><div class="stat-label">слов к повторению</div></div>
            <div class="stat-box"><div class="stat-num">${sc.newAvailable}</div><div class="stat-label">новых слов</div></div>
            ${isIslam ? `<div class="stat-box"><div class="stat-num">${hc.due}</div><div class="stat-label">аятов к повторению</div></div>` : ''}
            <div class="stat-box"><div class="stat-num">${sc.hard}</div><div class="stat-label">трудных слов</div></div>
            ${isIslam ? `<div class="stat-box"><div class="stat-num">${hc.hard}</div><div class="stat-label">трудных аятов</div></div>` : ''}
          </div>
          <div class="home-stats-grid">
            <div class="hs-item"><span class="hs-label">новых слов сегодня</span><span class="hs-val">${dailyNew}</span></div>
            <div class="hs-item"><span class="hs-label">слов в обучении</span><span class="hs-val">${sc.learning}</span></div>
            <div class="hs-item"><span class="hs-label">слов в долгосрочном повторении</span><span class="hs-val">${sc.solid}</span></div>
            ${isIslam ? `<div class="hs-item"><span class="hs-label">аятов в изучении</span><span class="hs-val">${hc.learning}</span></div>` : ''}
            <div class="hs-item"><span class="hs-label">серия учебных дней</span><span class="hs-val">${streak}</span></div>
            <div class="hs-item"><span class="hs-label">успешность за 7 дней</span><span class="hs-val">${r7 ? r7.pct + '%' : '—'}</span></div>
            <div class="hs-item"><span class="hs-label">успешность за 30 дней</span><span class="hs-val">${r30 ? r30.pct + '%' : '—'}</span></div>
            <div class="hs-item"><span class="hs-label">проработано слов сегодня</span><span class="hs-val">${today.words || 0}</span></div>
          </div>
          <p class="study-hint">${streak > 0
            ? 'Серия продолжается — занимайтесь в своём темпе.'
            : 'Сегодня можно начать новую серию: серия засчитывается от трёх ответов или одной тренировки.'}</p>
        </div>
      </details>
    </div>

    <div class="study-panel">
      <details class="stats-section">
        <summary>Мой прогресс<span class="ss-badge">выучено: ${learnedWordsCount()}</span></summary>
        <div class="stats-section-body" id="studyStats"></div>
      </details>
    </div>`;

  renderStudyDashboard(); // прогресс слов (перенесён из раздела «Изучение слов»)

  document.getElementById('hmNewWords').addEventListener('click', () => {
    switchTo('study');
    const sel = document.getElementById('studySource');
    if (sel) sel.value = '__new__';
    startStudy();
  });
  document.getElementById('hmReviewWords').addEventListener('click', () => switchTo('review'));
  document.getElementById('hmReviewWords2').addEventListener('click', () => switchTo('review'));
  const hmAyat = document.getElementById('hmReviewAyat');
  if (hmAyat) hmAyat.addEventListener('click', () => {
    switchTo('hifz');
    if (haveHifz) HIFZ.startQueue();
  });
  const hmHuna1 = document.getElementById('hmHuna1');
  if (hmHuna1) hmHuna1.addEventListener('click', () => switchTo('huna1'));
  const hmHuna2 = document.getElementById('hmHuna2');
  if (hmHuna2) hmHuna2.addEventListener('click', () => switchTo('huna2'));
  const hmReadMore = document.getElementById('hmReadMore');
  if (hmReadMore) hmReadMore.addEventListener('click', () => {
    if (lastStory) openStory(lastStory.id); else switchTo('quran');
  });
}
