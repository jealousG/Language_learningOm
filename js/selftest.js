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

  // Последний render + явный маркер завершения: сводка пишется по стадиям,
  // поэтому раннее чтение страницы даёт неполное число (например, только
  // синхронные тесты). Автопроверки должны ждать data-selftest="done".
  function finish() {
    render();
    document.body.setAttribute('data-selftest', 'done');
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
        finish();
      }
    }).catch(err => {
      record(false, 'Загрузка srs.js для тестов миграции', err.message);
      restore();
      finish();
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

    // wordDisplay — слово для показа ОТДЕЛЬНО от текста (без обрамляющей пунктуации)
    if (typeof wordDisplay === 'function') {
      eq('wordDisplay: арабская запятая убрана', wordDisplay('الْكَهْفِ،'), 'الْكَهْفِ');
      eq('wordDisplay: арабский вопрос убран', wordDisplay('اسْمُكَ؟'), 'اسْمُكَ');
      eq('wordDisplay: арабская точка с запятой убрана', wordDisplay('الْجُمُعَةِ؛'), 'الْجُمُعَةِ');
      eq('wordDisplay: слово без пунктуации не тронуто', wordDisplay('كِتَابٌ'), 'كِتَابٌ');
      eq('wordDisplay: скобки убраны', wordDisplay('(مكة)'), 'مكة');
      eq('wordDisplay: пустой вход', wordDisplay(''), '');
      eq('wordDisplay: огласовки сохранены', wordDisplay('طَيِّبَةٌ،'), 'طَيِّبَةٌ');
    } else {
      record(false, 'wordDisplay загружен');
    }

    // Лемматизация: формы одного слова (с приставками/местоименными суффиксами)
    // дают одну запись — основа берётся из словарной статьи (поле base).
    if (typeof wordBase === 'function') {
      eq('wordBase: форма с суффиксом → основа', wordBase({ w: 'أُخْتُكُمْ', base: 'أخت' }), 'أخت');
      eq('wordBase: без основы → сама форма', wordBase({ w: 'كِتَابٌ' }), 'كِتَابٌ');
      eq('wordBaseKey: формы одной основы совпадают',
        wordBaseKey({ w: 'أُخْتِي', base: 'أخت' }) === wordBaseKey({ w: 'أخت' }), true);
      const bw = baseWord({ w: 'أُخْتُكُمْ', base: 'أخت', baseRu: 'сестра', baseTr: 'ухт', ru: 'ваша сестра', tr: 'ухтукум' });
      eq('baseWord: показываем основу', bw.w, 'أخت');
      eq('baseWord: перевод основы, не формы', bw.ru, 'сестра');
      eq('baseWord: без основы объект не меняется', baseWord({ w: 'كِتَابٌ' }).w, 'كِتَابٌ');
    } else {
      record(false, 'wordBase загружен');
    }

    const ch = (typeof HUNA_DATA !== 'undefined' && HUNA_DATA.books && HUNA_DATA.books[0] && HUNA_DATA.books[0].chapters[0]) || null;
    if (ch) {
      const entries = chapterWordEntries(ch, {}, {}, 3);
      // «сестра» в главе «Знакомство» была 4 раза (أخت, أُخْتِي, أُخْتُكُمْ, وَالْأُخْتِ)
      const sisters = entries.filter(e => /أُخْت|أخت/.test(e.w));
      eq('лемматизация: «сестра» — одна запись в главе', sisters.length, 1);
      if (sisters.length === 1) {
        eq('лемматизация: показана основа «أخت»', sisters[0].w, 'أخت');
        record(sisters[0].tokens.length >= 2, 'лемматизация: формы собраны в tokens', sisters[0].tokens.join(','));
      }
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

    // «Оживающая рукопись»: подсветка штрихов листа
    if (typeof manuscriptDashes === 'function') {
      eq('manuscriptDashes: 0 из 100 → 0 штрихов', manuscriptDashes(0, 100, 10), 0);
      eq('manuscriptDashes: 50 из 100 → 5', manuscriptDashes(50, 100, 10), 5);
      eq('manuscriptDashes: 100 из 100 → все 10', manuscriptDashes(100, 100, 10), 10);
      eq('manuscriptDashes: 8 из 185 → 0 (округление вниз)', manuscriptDashes(8, 185, 10), 0);
      eq('manuscriptDashes: 19 из 185 → 1', manuscriptDashes(19, 185, 10), 1);
      eq('manuscriptDashes: пустая глава → 0', manuscriptDashes(0, 0, 10), 0);
      eq('manuscriptDashes: потолок при переполнении', manuscriptDashes(120, 100, 10), 10);
      eq('manuscriptDashes: ноль сегментов → 0', manuscriptDashes(50, 100, 0), 0);
      eq('manuscriptDashes: 95 из 100 → 10 (округление к ближайшему)', manuscriptDashes(95, 100, 10), 10);
    }
  }

  // ================= Часть 3: золотые чернила =================

  function inkTests() {
    record(typeof INK === 'object' && typeof INK.add === 'function', 'Модуль INK загружен');
    if (typeof INK === 'undefined') return;

    // чистая логика уровней (пороги включительно)
    eq('INK: 0 → «Новичок»', INK.levelIndex(0), 0);
    eq('INK: 149 → уровень 0', INK.levelIndex(149), 0);
    eq('INK: 150 → уровень 1 (Ученик)', INK.levelIndex(150), 1);
    eq('INK: 450 → уровень 2 (Читающий)', INK.levelIndex(450), 2);
    eq('INK: 1000 → уровень 3 (Знающий)', INK.levelIndex(1000), 3);
    eq('INK: 6000 → высший уровень', INK.levelIndex(6000), INK.LEVELS.length - 1);
    eq('INK: потолок уровня', INK.levelIndex(999999), INK.LEVELS.length - 1);
    eq('INK: названия ступеней', INK.LEVELS.map(l => l.name).join(' · '),
      'Новичок · Ученик · Читающий · Знающий · Умелый · Опытный · Мастер');

    const names = INK.LEVELS.map(l => l.name);
    eq('INK: имена уровней уникальны', new Set(names).size, names.length);
    const mins = INK.LEVELS.map(l => l.min);
    eq('INK: пороги возрастают', JSON.stringify(mins), JSON.stringify([...mins].sort((a, b) => a - b)));

    // начисления: с бэкапом реального хранилища чернил
    const KEY = 'arabic-reader-ink-v1';
    let backup = null;
    try { backup = localStorage.getItem(KEY); } catch (e) { /* нет доступа — тесты ниже пропустим */ }
    try {
      const before = INK.total();
      const hadithBefore = INK.inkOf('hadith');
      INK.mark();
      INK.add(INK.P.correct, 'quran');
      INK.add(INK.P.comboBonus, 'quran');
      eq('INK: add аккумулирует', INK.total() - before, INK.P.correct + INK.P.comboBonus);
      eq('INK: sinceMark считает прирост сессии', INK.sinceMark(), INK.P.correct + INK.P.comboBonus);
      INK.add(0, 'quran');
      INK.add(-5, 'quran');
      eq('INK: add игнорирует неположительные', INK.sinceMark(), INK.P.correct + INK.P.comboBonus);

      // чернила раздельные: в quran накопилось, в hadith — не изменилось
      const qInk = INK.inkOf('quran');
      record(qInk >= INK.P.correct + INK.P.comboBonus, 'INK: чернила копятся в своём разделе', qInk);
      eq('INK: чужой раздел не тронут', INK.inkOf('hadith'), hadithBefore);

      // уровни: чистая функция по числу чернил
      eq('INK: levelInfo(150) → «Ученик»', INK.levelInfo(150).name, 'Ученик');
      eq('INK: levelInfo(300) → 50% до следующего', INK.levelInfo(300).pct, 50);
      eq('INK: levelInfo(0) → 0%', INK.levelInfo(0).pct, 0);
      eq('INK: levelInfo(6000) → высший (100%)', INK.levelInfo(6000).pct, 100);
      eq('INK: levelInfo(300) → до следующего 150', INK.levelInfo(300).toNext, 150);

      // ОДИН уровень на Основу: чернила Основы = сумма её разделов + «ранее накопленное»
      const quranBefore = INK.inkOf('quran');
      const islBefore = INK.modeInk('islam');
      const arBefore = INK.modeInk('arabic');
      INK.add(INK.P.correct, 'quran');
      eq('INK: чернила «Ислама» выросли на ответ', INK.modeInk('islam') - islBefore, INK.P.correct);
      eq('INK: «Арабский» не тронут чужим разделом', INK.modeInk('arabic'), arBefore);
      eq('INK: раздел входит в чернила своей Основы', INK.inkOf('quran') - quranBefore, INK.P.correct);
      eq('INK: уровень Основы считается по её чернилам',
        INK.modeLevel('islam').index, INK.levelIndex(INK.modeInk('islam')));
      eq('INK: у Основы один уровень на все её разделы',
        INK.modeLevel('islam').name, INK.levelInfo(INK.modeInk('islam')).name);

      // чернила без точной атрибуции не теряются: «Прочее» текущей Основы
      const mid = INK.currentMode();
      const modeBefore = INK.modeInk(mid);
      INK.add(INK.P.correct); // без раздела
      eq('INK: чернила без раздела попадают в текущую Основу', INK.modeInk(mid) - modeBefore, INK.P.correct);
      record(INK.sectionInkList(mid).some(s => s.label === 'Прочее' && s.ink > 0),
        'INK: «Прочее» видно в разбивке Основы');
      eq('INK: у «Прочее» нет своего уровня',
        INK.sectionInkList(mid).filter(s => s.label === 'Прочее').length, 1);
    } finally {
      try {
        if (backup === null) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, backup);
      } catch (e) { /* игнорируем */ }
    }

    // разделы и атрибуция (чистая логика)
    eq('INK: тип quran → раздел quran', INK.sectionForType('quran'), 'quran');
    eq('INK: тип story → раздел stories', INK.sectionForType('story'), 'stories');
    eq('INK: тип namaz → раздел routes', INK.sectionForType('namaz'), 'routes');
    eq('INK: тип huna2 → раздел huna2', INK.sectionForType('huna2'), 'huna2');
    eq('INK: неизвестный тип → «прочее»', INK.sectionForType('zzz'), 'other');
    eq('INK: доминирующий раздел сессии', INK.dominantSection(['quran', 'quran', 'hadith']), 'quran');
    eq('INK: пустой список → null', INK.dominantSection([]), null);
    const isl = INK.sectionInkList('islam');
    record(isl.length >= 6 && isl.some(s => s.id === 'hifz'), 'INK: у «Ислама» есть раздел «Хифз»', isl.length);
    eq('INK: разбивка — только чернила, без уровней', 'level' in (isl[0] || {}), false);
    const ar = INK.sectionInkList('arabic');
    eq('INK: у «Арабского» два тома', ar.map(s => s.id).join(','), 'huna1,huna2');

    // Основы: ровно две, у каждой ровно один уровень
    const ms = INK.modes();
    eq('INK: Основ ровно две', ms.map(m => m.id).join(','), 'islam,arabic');
    record(ms.every(m => m.level && typeof m.level.name === 'string' && typeof m.ink === 'number'),
      'INK: у каждой Основы один уровень и свой счёт');
    eq('INK: уровень Основы — не уровень раздела',
      INK.modeOfSection('hifz'), 'islam');
    eq('INK: раздел «Прочее» без Основы', INK.modeOfSection('other'), null);
    const legacySum = INK.legacyTotal();
    const legacyParts = ms.reduce((a, m) => a + INK.legacyOf(m.id), 0);
    eq('INK: «ранее накопленное» разнесено по Основам без потерь', legacyParts, legacySum);
    record(INK.modeInk('islam') >= INK.inkOf('quran'), 'INK: чернила Основы ≥ чернил одного раздела', INK.modeInk('islam'));
  }

  // ------------------- Игры («Мемори+»): ядро -------------------
  function gamesTests() {
    if (typeof gamePairPool !== 'function') {
      record(false, 'Игры: ядро games-core.js загружено');
      return;
    }
    record(true, 'Игры: ядро games-core.js загружено');

    const pool = gamePairPool([
      { word: { w: 'كتاب', ru: 'книга' }, sentence: null, gapIndex: 0 },
      { word: { w: 'قلم', ru: 'книга' }, sentence: null, gapIndex: 0 },
      { word: { w: 'الله', ru: 'Аллах', pos: 'имя собств.' }, sentence: null },
      { word: { w: '19', ru: '19', pos: 'числ.' }, sentence: null },
      { word: { w: 'بيت', ru: '' }, sentence: null },
      { word: { w: 'باب', ru: 'дверь' }, sentence: null, gapIndex: 0 }
    ]);
    eq('Игры: пул пар — только слова с переводом и без дублей перевода', pool.length, 2);
    eq('Игры: пул пар — имена и цифры отброшены', pool.map(p => p.word.w).join(','), 'كتاب,باب');

    const pairs = [
      { word: { w: 'كتاب' }, ru: 'книга' },
      { word: { w: 'باب' }, ru: 'дверь' }
    ];
    const board = gameBuildBoard(pairs, 2, 'pair', () => 0.5);
    eq('Игры: доска — по две карточки на пару', board.length, 4);
    eq('Игры: доска — ровно две пары', [...new Set(board.map(c => c.pairId))].length, 2);
    record(board.filter(c => c.kind === 'ar').length === 2 && board.filter(c => c.kind === 'ru').length === 2,
      'Игры: доска — 2 арабские и 2 переводные карточки');

    const sent = { words: [{ w: 'أنا' }, { w: 'طالب' }, { w: 'جديد' }], ru: 'я новый студент' };
    eq('Игры: пропуск вместо слова', gameGapSentence(sent, 1), 'أنا _____ جديد');
    eq('Игры: пропуск без индекса — перевод', gameGapSentence(sent, -1), 'я новый студент');

    eq('Игры: буквы слова без огласовок', gameWordLetters('كِتَابٌ').join(''), 'كتاب');
    eq('Игры: буквы без пунктуации', gameWordLetters('الْكَهْفِ،').join(''), 'الكهف');

    const letters = gameScramble('كتاب', () => 0.5);
    eq('Игры: перемешанные буквы — тот же набор', letters.slice().sort().join(''), gameWordLetters('كتاب').sort().join(''));

    record(gameAssemblyCorrect(['ك', 'ت', 'ا', 'ب'], 'كِتَابٌ'), 'Игры: сборка — верное слово с огласовками');
    record(!gameAssemblyCorrect(['ك', 'ا', 'ت', 'ب'], 'كتاب'), 'Игры: сборка — неверный порядок');

    const recall = gameRecallWords([{ word: { w: 'أ' } }, { word: { w: 'ب' } }, { word: { w: 'ج' } }], { 'ب': 3, 'ج': 1 }, 2);
    eq('Игры: закрепление — сначала слова с ошибками', recall.map(r => r.word.w).join(''), 'بج');
    eq('Игры: закрепление — не больше запрошенного', gameRecallWords([{ word: { w: 'أ' } }], {}, 3).length, 1);

    record(gameRecordBetter(null, { seconds: 10, moves: 5 }), 'Игры: рекорд — первый результат всегда рекорд');
    record(gameRecordBetter({ seconds: 20, moves: 9 }, { seconds: 10, moves: 12 }), 'Игры: рекорд — по времени');
    record(!gameRecordBetter({ seconds: 10, moves: 8 }, { seconds: 10, moves: 9 }), 'Игры: рекорд — при равном времени по ходам');

    eq('Игры: рекорд отдельный для каждой главы',
      gameRecordKey('chapter:huna2-g9', 'pair', 6) === gameRecordKey('chapter:huna2-g10', 'pair', 6), false);
    eq('Игры: ключ рекорда — источник + режим + размер',
      gameRecordKey('chapter:huna2-g9', 'gap', 8), 'chapter:huna2-g9|gap:8');
    eq('Игры: без источника — общий ключ',
      gameRecordKey('', 'pair', 6), '*|pair:6');

    // ------------------- «Корень» -------------------
    eq('Корень: ключ из «ك ت ب»', gameRootKey('ك ت ب'), 'كتب');
    eq('Корень: пустой/«—» — нет корня', gameRootKey('—') + '|' + gameRootKey(''), '|');
    eq('Корень: показ по буквам', gameRootDisplay('كتب'), 'ك · ت · ب');

    const famItems = [
      { word: { w: 'كَتَبَ', ru: 'писать', root: 'ك ت ب' } },
      { word: { w: 'كِتَاب', ru: 'книга', root: 'ك ت ب' } },
      { word: { w: 'مَكْتَب', ru: 'стол', root: 'ك ت ب' } },
      { word: { w: 'قَلَم', ru: 'ручка', root: 'ق ل م' } },
      { word: { w: 'قَالَ', ru: 'говорить', root: 'ق و ل' } },
      { word: { w: 'الله', ru: 'Аллах', root: 'أ ل ه', pos: 'имя собств.' } },
      { word: { w: 'بِلَا', ru: 'без', root: '' } }
    ];
    const fams = gameRootFamilies(famItems, 2);
    eq('Корень: семейства с ≥2 словами', fams.length, 1);
    eq('Корень: в семействе только слова этого корня', fams[0].key, 'كتب');
    eq('Корень: размер семейства', fams[0].words.length, 3);

    const opts = gameRootOptions('كتب', fams.concat([{ key: 'قلم', words: [] }, { key: 'قول', words: [] }, { key: 'علم', words: [] }]), 4);
    eq('Корень: четыре варианта', opts.length, 4);
    record(opts.indexOf('كتب') >= 0, 'Корень: правильный вариант среди ответов');
    eq('Корень: варианты без повторов', new Set(opts).size, 4);

    const qs = gameRootQuestions(fams, 10);
    eq('Корень: вопросов не больше, чем слов', qs.length, 3);

    const round = gameFamilyRound(
      { key: 'كتب', words: fams[0].words },
      fams.concat([{ key: 'قلم', words: [{ word: { w: 'قَلَم' }, ru: 'ручка' }] }, { key: 'قول', words: [{ word: { w: 'قَالَ' }, ru: 'говорить' }] }]),
      4, 12
    );
    eq('Корень: в раунде нужно не больше 4 слов', round.need, 3);
    record(round.cards.length <= 12 && round.cards.length >= round.need,
      'Корень: карточек в раунде — от need до 12', round.cards.length);
    eq('Корень: правильных карточек в раунде', round.cards.filter(c => c.right).length, 3);

    record(gameRootBetter(null, { score: 1, seconds: 30 }, 'quiz'), 'Корень: первый результат — рекорд');
    record(gameRootBetter({ score: 5, seconds: 30 }, { score: 8, seconds: 40 }, 'quiz'), 'Корень: викторина — больше очков лучше');
    record(!gameRootBetter({ score: 8, seconds: 30 }, { score: 5, seconds: 10 }, 'quiz'), 'Корень: меньше очков — не рекорд');
    record(gameRootBetter({ score: 8, seconds: 40 }, { score: 8, seconds: 25 }, 'quiz'), 'Корень: при равных очках — быстрее лучше');
    record(gameRootBetter({ mistakes: 1, seconds: 40 }, { mistakes: 3, seconds: 25 }, 'family'), 'Корень: семейство — по времени');

    // ------------------- «Клоуз» -------------------
    const clozSent1 = { words: [{ w: 'هَذَا' }, { w: 'كِتَابٌ' }], ru: 'это книга' };
    const clozSent2 = { words: [{ w: 'الْبَيْتُ' }], ru: 'дом' };
    const clozSent3 = { words: [{ w: 'قَلَمٌ' }], ru: 'ручка' };
    const clozItems = [
      { word: { w: 'كِتَاب', ru: 'книга' }, sentence: clozSent1, gapIndex: 1 },
      { word: { w: 'هَذَا', ru: 'это' }, sentence: clozSent1, gapIndex: 0 },
      { word: { w: 'بَيْت', ru: 'дом' }, sentence: clozSent2, gapIndex: 0 },
      { word: { w: 'قَلَم', ru: 'ручка' }, sentence: clozSent3, gapIndex: 0 }
    ];
    const clozOpts = gameClozeOptions('كتاب', clozItems, 4);
    eq('Клоуз: четыре варианта', clozOpts.length, 4);
    record(clozOpts.indexOf('كتاب') >= 0, 'Клоуз: правильное слово среди вариантов');
    eq('Клоуз: варианты без повторов', new Set(clozOpts).size, 4);

    const clozQs = gameClozeQuestions(clozItems, 10);
    eq('Клоуз: одно предложение — один вопрос', clozQs.length, 3);
    record(clozQs.every(q => q.options.indexOf(q.correct) >= 0), 'Клоуз: правильный ответ есть в вариантах');
    record(clozQs.every(q => q.sentence && q.gapIndex >= 0 && q.gapIndex < q.sentence.words.length),
      'Клоуз: пропуск указывает на слово в предложении');
    record(clozQs.every(q => !!q.ru), 'Клоуз: у пропущенного слова есть перевод');

    // ------------------- Словарь главы в тренажёре -------------------
    if (typeof chapterVocabItems === 'function' && typeof HUNA_DATA !== 'undefined') {
      const ch = HUNA_DATA.books[0].chapters[0];
      const vocab = chapterVocabItems(ch.id, new Set());
      record(Array.isArray(vocab), 'Глава: словарные слова возвращаются тренажёру');
      record(vocab.every(it => it.word && it.word.w && it.word.ru),
        'Глава: словарные слова пригодны для тренажёра (есть слово и перевод)');
      record(vocab.every(it => it.sentence === null && it.gapIndex === 0),
        'Глава: у словарных слов нет предложения — контекстные задания им не достанутся');
      const allKeys = new Set(chapterWordEntries(ch, {}, {}, 5, null).map(e => e.key));
      eq('Глава: если все слова уже в текстах — добавок нет',
        chapterVocabItems(ch.id, allKeys).length, 0);
      const skipSome = chapterVocabItems(ch.id, new Set());
      if (skipSome.length) {
        const skipOne = new Set([chapterWordEntries(ch, {}, {}, 5, null).find(e => e.key).key]);
        record(chapterVocabItems(ch.id, skipOne).length < skipSome.length,
          'Глава: исключённые слова не попадают в добавки');
      }
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
  try {
    inkTests();
  } catch (e) {
    record(false, 'Тесты золотых чернил выполнились без исключений', e.message);
  }
  try {
    gamesTests();
  } catch (e) {
    record(false, 'Тесты игр выполнились без исключений', e.message);
  }
  storageTests();
})();
