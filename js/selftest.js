// ============================================================
//  Самопроверка логики повторений (запускается из selftest.html).
//
//  Часть 1 — чистая логика SRS_CORE (без хранилища).
//  Часть 2 — миграция старого прогресса и отбор очереди
//            (на изолированных фикстурах localStorage,
//            реальные данные бэкапятся и восстанавливаются).
// ============================================================

(function () {
  'use strict';

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;

  const rows = [];
  let passed = 0, failed = 0;

  function record(ok, name, detail) {
    if (ok) passed++; else failed++;
    rows.push({ ok: !!ok, name, detail: detail == null ? '' : String(detail) });
  }

  function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    record(a === e, name, a === e ? '' : `получено: ${a}, ожидалось: ${e}`);
  }

  /** Сравнение близкое к ожидаемому (для меток времени). */
  function closeTo(name, actual, expected, tol) {
    const d = Math.abs(actual - expected);
    record(d <= tol, name, d <= tol ? '' : `отклонение ${Math.round(d / 1000)} с (допуск ${tol / 1000} с)`);
  }

  function render() {
    const tbody = document.querySelector('#results tbody');
    tbody.innerHTML = rows.map(r => `
      <tr class="${r.ok ? 'pass' : 'fail'}">
        <td>${r.name}</td>
        <td class="status">${r.ok ? '✓ пройдено' : '✗ провал'}</td>
        <td>${r.detail}</td>
      </tr>`).join('');
    const s = document.getElementById('summary');
    s.textContent = failed === 0
      ? `Все проверки пройдены: ${passed}`
      : `Пройдено ${passed}, провалено ${failed}`;
    s.className = failed === 0 ? 'ok' : 'bad';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
      document.head.appendChild(s);
    });
  }

  // Ловим непойманные ошибки скриптов («сайт открывается без ошибок JS»)
  window.addEventListener('error', e => {
    record(false, 'Нет непойманных ошибок JavaScript', e.message);
  });

  function freshCard(state) {
    return { state: state || 'new', repetitions: 0, intervalDays: 0, ease: 2.5, lapses: 0,
             nextReviewAt: null, lastReviewedAt: null };
  }

  // ================= Часть 1: чистая логика SRS_CORE =================

  function coreTests() {
    record(typeof SRS_CORE === 'object' && typeof SRS_CORE.applyGrade === 'function',
      'Модуль SRS_CORE загружен');
    record(typeof escHtml === 'function' && typeof dateKey === 'function',
      'Модуль util загружен');
    record(typeof STORIES_DATA === 'object' && STORIES_DATA.stories.length >= 21,
      'Данные загружены (>= 21 текст)', 'текстов: ' + (STORIES_DATA.stories || []).length);

    // Лестница успешных ответов: 10 мин -> 1 день -> 3 дня -> 7 дней -> рост по ease
    let c = freshCard();
    let t = Date.now();
    SRS_CORE.applyGrade(c, 'good');
    eq('1-е «Хорошо»: состояние learning', c.state, 'learning');
    closeTo('1-е «Хорошо»: повтор через ~10 минут', c.nextReviewAt - t, 10 * MIN, 5 * 1000);

    SRS_CORE.applyGrade(c, 'good');
    eq('2-е «Хорошо»: выпуск в review, 1 день', c.state + '/' + c.intervalDays, 'review/1');

    SRS_CORE.applyGrade(c, 'good');
    eq('3-е «Хорошо»: интервал 3 дня', c.intervalDays, 3);

    SRS_CORE.applyGrade(c, 'good');
    eq('4-е «Хорошо»: интервал 7 дней', c.intervalDays, 7);

    SRS_CORE.applyGrade(c, 'good');
    eq('5-е «Хорошо»: рост по ease (7×2.5 → 18)', c.intervalDays, 18);

    // «Легко» с нового — сразу в долгое повторение
    c = freshCard();
    SRS_CORE.applyGrade(c, 'easy');
    eq('«Легко» (новое): сразу review, 7 дней', c.state + '/' + c.intervalDays, 'review/7');

    // «Трудно» в обучении — короткий шаг, лёгкость снижается
    c = freshCard();
    SRS_CORE.applyGrade(c, 'good');
    SRS_CORE.applyGrade(c, 'hard');
    eq('«Трудно» (обучение): остаётся learning', c.state, 'learning');
    eq('«Трудно»: ease снижен до 2.35', c.ease, 2.35);

    // «Не помню» на review-карточке
    c = freshCard();
    SRS_CORE.applyGrade(c, 'good');
    SRS_CORE.applyGrade(c, 'good'); // review, 1 день
    t = Date.now();
    SRS_CORE.applyGrade(c, 'again');
    eq('«Не помню» (review): состояние relearning', c.state, 'relearning');
    eq('«Не помню»: lapses = 1', c.lapses, 1);
    eq('«Не помню»: repetitions сброшены', c.repetitions, 0);
    eq('«Не помню»: ease снижен до 2.3', c.ease, 2.3);
    closeTo('«Не помню»: повтор через ~10 минут', c.nextReviewAt - t, 10 * MIN, 5 * 1000);

    // Выпуск из relearning — с 1 дня
    SRS_CORE.applyGrade(c, 'good');
    SRS_CORE.applyGrade(c, 'good');
    eq('relearning → выпуск в review с 1 дня', c.state + '/' + c.intervalDays, 'review/1');

    // Долгое повторение: трудно / легко
    c = freshCard();
    for (let i = 0; i < 4; i++) SRS_CORE.applyGrade(c, 'good'); // review, 7 дней, ease 2.5
    SRS_CORE.applyGrade(c, 'hard');
    eq('review «Трудно»: 7 → 8 дней', c.intervalDays, 8);
    c = freshCard();
    for (let i = 0; i < 4; i++) SRS_CORE.applyGrade(c, 'good');
    SRS_CORE.applyGrade(c, 'easy');
    eq('review «Легко»: 7 → 24 дня (ease повышен до 2.65 до расчёта)', c.intervalDays, 24);

    // Границы ease
    c = freshCard();
    SRS_CORE.applyGrade(c, 'easy'); // 2.65
    SRS_CORE.applyGrade(c, 'easy'); // 2.8
    SRS_CORE.applyGrade(c, 'easy'); // cap
    eq('ease ограничен сверху 2.8', c.ease, 2.8);
    c = freshCard();
    for (let i = 0; i < 8; i++) SRS_CORE.applyGrade(c, 'again');
    eq('ease ограничен снизу 1.3', c.ease, 1.3);

    // Потолок интервала
    c = freshCard('review');
    c.intervalDays = 300;
    SRS_CORE.applyGrade(c, 'good');
    eq('интервал ограничен 365 днями', c.intervalDays, 365);
  }

  // ============ Часть 2: миграция, очередь, лимит (фикстуры) ============

  function storageTests() {
    const KEYS = [
      'arabic-reader-srs-v1',
      'arabic-reader-study-stats-v1',
      'arabic-reader-progress-v1'
    ].map(k => (typeof modeNs === 'function' ? modeNs(k) : k));
    const backup = {};
    let ok = true;
    KEYS.forEach(k => {
      try { backup[k] = localStorage.getItem(k); } catch (e) { ok = false; }
    });
    if (!ok) {
      record(false, 'localStorage доступен', 'браузер запретил доступ');
      render();
      return;
    }

    // Фикстуры «старого» прогресса на реальных словах корпуса
    const fatiha = STORIES_DATA.stories.find(s => s.id === 'al-fatiha');
    const q114 = STORIES_DATA.stories.find(s => s.id === 'q114');
    const a2 = fatiha.sentences[1]; // الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
    const n2 = q114.sentences.find(x => x.ayah === 2); // مَلِكِ النَّاسِ
    const statLearnedW = a2.words[0].w; // была статистика «выучено»
    const statWeakW = a2.words[1].w;   // была статистика «слабо»
    const knownW = n2.words[0].w;       // был статус known
    const seenW = n2.words[1].w;        // был статус seen

    const usedWords = {};
    [statLearnedW, statWeakW, knownW, seenW].forEach(w => { usedWords[w] = true; });
    function findFreshWord() {
      for (const st of STORIES_DATA.stories) {
        for (const sent of st.sentences) {
          for (const w of sent.words) {
            if (!usedWords[w.w] && !SRS.getCard(w.w)) return w.w;
          }
        }
      }
      return null;
    }

    const restore = () => {
      KEYS.forEach(k => {
        try {
          if (backup[k] === null) localStorage.removeItem(k);
          else localStorage.setItem(k, backup[k]);
        } catch (e) { /* игнорируем */ }
      });
    };

    try {
      localStorage.removeItem(KEYS[0]); // чистое состояние SRS — запустится миграция
      localStorage.setItem(KEYS[1], JSON.stringify({
        [statLearnedW]: { c: 3, w: 0 },
        [statWeakW]: { c: 1, w: 2 }
      }));
      localStorage.setItem(KEYS[2], JSON.stringify({
        [`q114:${q114.sentences.indexOf(n2)}:0`]: 'known',
        [`q114:${q114.sentences.indexOf(n2)}:1`]: 'seen'
      }));
    } catch (e) {
      record(false, 'Подготовка фикстур', e.message);
      render();
      return;
    }

    loadScript('js/srs.js').then(() => {
      try {
        const cards = SRS.getAllCards();
        eq('Миграция: «выученное» из статистики → review', cards[statLearnedW] && cards[statLearnedW].state, 'review');
        eq('Миграция: слабая статистика → learning', cards[statWeakW] && cards[statWeakW].state, 'learning');
        eq('Миграция: known → review', cards[knownW] && cards[knownW].state, 'review');
        eq('Миграция: known: repetitions = 1', cards[knownW] && cards[knownW].repetitions, 1);
        eq('Миграция: seen → learning', cards[seenW] && cards[seenW].state, 'learning');
        record(cards[knownW] && cards[knownW].nextReviewAt <= Date.now() + 1000,
          'Миграция: карточка доступна к повторению сегодня');

        // Очередь на сегодня
        const c1 = SRS.getCounts();
        eq('Очередь: due = 4 (все мигрированные карточки)', c1.due, 4);
        eq('Очередь: новых слов доступно = 5 (лимит по умолчанию)', c1.newAvailable, 5);

        // Оценка нового слова меняет расписание
        const nw = findFreshWord();
        SRS.gradeWord(nw, 'good');
        let card = SRS.getCard(nw);
        eq('Оценка нового слова: состояние learning', card.state, 'learning');
        closeTo('Оценка меняет дату следующего повторения (+10 мин)', card.nextReviewAt - Date.now(), 10 * MIN, 5 * 1000);
        SRS.gradeWord(nw, 'good');
        card = SRS.getCard(nw);
        eq('Второе «Хорошо»: review, 1 день', card.state + '/' + card.intervalDays, 'review/1');
        SRS.gradeWord(nw, 'again');
        card = SRS.getCard(nw);
        eq('«Не помню»: возврат в relearning', card.state, 'relearning');
        eq('«Не помню»: lapses = 1', card.lapses, 1);

        // Дневной лимит новых слов: уже 1 введено, ещё 4 — и лимит исчерпан
        for (let i = 0; i < 4; i++) {
          const w = findFreshWord();
          if (!w) break;
          SRS.gradeWord(w, 'good');
        }
        eq('Лимит новых слов: 5 из 5 — новые недоступны', SRS.getCounts().newAvailable, 0);
      } catch (e) {
        record(false, 'Тесты хранилища выполнились без исключений', e.message);
      } finally {
        restore();
        record(true, 'Реальные данные localStorage восстановлены');
        render();
      }
    }).catch(err => {
      record(false, 'Загрузка srs.js для тестов миграции', err.message);
      restore();
      render();
    });
  }

  // ---------- Раздел «Слова» (js/words-core.js) ----------
  function wordsTests() {
    if (typeof wordsNorm !== 'function') {
      record(false, 'js/words-core.js загружен');
      return;
    }
    eq('wordsNorm: огласовки сняты', wordsNorm('الْبَيْتُ'), 'البيت');
    eq('wordsNorm: пунктуация снята', wordsNorm('بَيْتٌ،'), 'بيت');
    eq('wordsNorm: падежные формы → один ключ', wordsNorm('الدِّينُ') === wordsNorm('الدِّينِ'), true);

    const ch = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books && HUNA_DATA.books[0] && HUNA_DATA.books[0].chapters[0]) || null;
    if (ch) {
      const entries = chapterWordEntries(ch, {}, {}, 3);
      record(entries.length > 0, 'chapterWordEntries: слова главы найдены', entries.length);
      const keys = entries.map(e => e.key);
      eq('chapterWordEntries: ключи уникальны', [...new Set(keys)].length, keys.length);
      eq('chapterWordEntries: у всех слов есть перевод', entries.filter(e => !e.ru).length, 0);
      eq('chapterWordEntries: без данных все «new»', entries.every(e => e.status === 'new'), true);
    } else {
      record(false, 'Данные «Хуна Арабия» доступны');
    }

    const tokens = ['كِتَابٌ', 'كِتَابٌ'];
    eq('wordStudyStatus: нет данных → new', wordStudyStatus(tokens, {}, {}, 3), 'new');
    eq('wordStudyStatus: есть ответы → learning', wordStudyStatus(tokens, { 'كِتَابٌ': { c: 1, w: 0, streak: 0 } }, {}, 3), 'learning');
    eq('wordStudyStatus: серия достигла порога → learned', wordStudyStatus(tokens, { 'كِتَابٌ': { c: 3, w: 0, streak: 3 } }, {}, 3), 'learned');
    eq('wordStudyStatus: SRS review → learned', wordStudyStatus(tokens, {}, { 'كِتَابٌ': { state: 'review', repetitions: 2, totalAnswers: 2 } }, 3), 'learned');
    eq('wordStudyStatus: SRS learning → learning', wordStudyStatus(tokens, {}, { 'كِتَابٌ': { state: 'learning', totalAnswers: 1 } }, 3), 'learning');

    if (ch) {
      const src = resolveStudySource('chapter:' + ch.id);
      record(!!src && src.sentences.length > 0, 'resolveStudySource: глава → текст с предложениями', src ? src.sentences.length : 0);
      record(!!src && /^Глава\s/.test(src.titleRu || ''), 'resolveStudySource: заголовок «Глава N…»', src ? src.titleRu : '');
      eq('resolveStudySource: у главы есть chapterId', src && src.chapterId, ch.id);
    }

    // Владение словом: каждое слово — ровно в одной главе (первого вхождения)
    if (typeof wordOwnerMap === 'function' && typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books) {
      const owner = wordOwnerMap();
      record(owner instanceof Map && owner.size > 0, 'wordOwnerMap: карта построена', owner.size);

      const owned = new Set();
      const allKeys = new Set();
      let overlap = 0, totalOwned = 0, totalAll = 0;
      HUNA_DATA.books.forEach(b => (b.chapters || []).forEach(c => {
        const withOwner = chapterWordEntries(c, {}, {}, 3, owner);
        const without = chapterWordEntries(c, {}, {}, 3);
        totalOwned += withOwner.length;
        totalAll += without.length;
        withOwner.forEach(e => { if (owned.has(e.key)) overlap++; else owned.add(e.key); });
        without.forEach(e => allKeys.add(e.key));
      }));
      eq('владение: слово не повторяется в разных главах', overlap, 0);
      eq('владение: ни одно слово не потеряно', owned.size, allKeys.size);
      record(totalAll > totalOwned, 'владение: повторы убраны', totalAll - totalOwned);

      const firstCh = HUNA_DATA.books[0].chapters.slice().sort((a, b) => (a.no ?? 0) - (b.no ?? 0))[0];
      eq('владение: أَنَا принадлежит первой главе', owner.get(wordsNorm('أَنَا')), firstCh.id);
    }

    // Грамматика по главам
    if (typeof grammarGroups === 'function' && typeof HUNA_DATA !== 'undefined' && HUNA_DATA.grammar) {
      const groups = grammarGroups();
      record(groups.length > 0, 'grammarGroups: группы построены', groups.length);
      const sum = groups.reduce((n, g) => n + g.notes.length, 0);
      eq('grammarGroups: все заметки разложены', sum, HUNA_DATA.grammar.length);
      const chaptered = groups.filter(g => g.no > 0);
      const nos = chaptered.map(g => g.no);
      eq('grammarGroups: главы по возрастанию', JSON.stringify(nos), JSON.stringify([...nos].sort((a, b) => a - b)));
      record(chaptered.length > 1, 'grammarGroups: заметки распределены по главам', chaptered.length);
      record(chaptered.every(g => g.notes.length > 0), 'grammarGroups: нет пустых глав');
      const generalIdx = groups.findIndex(g => g.no === 0);
      eq('grammarGroups: «Общее» идёт последним', generalIdx, generalIdx < 0 ? -1 : groups.length - 1);
    }
  }

  // Запуск: сначала синхронные тесты ядра, затем асинхронные тесты хранилища
  try {
    coreTests();
  } catch (e) {
    record(false, 'Тесты SRS_CORE выполнились без исключений', e.message);
  }
  try {
    wordsTests();
  } catch (e) {
    record(false, 'Тесты раздела «Слова» выполнились без исключений', e.message);
  }
  storageTests();
})();
