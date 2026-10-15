// ============================================================
//  Хифз — режим заучивания Корана.
//  Использует существующие суры, аяты и аудио проекта.
//
//  Прогресс аятов хранится ОТДЕЛЬНО от прогресса слов:
//  ключ arabic-reader-hifz-v1, карточка аята:
//  { state: new|learning|review|relearning, repetitions, intervalDays,
//    ease, nextReviewAt, lastReviewedAt, lapses, confidence }
//
//  Воспроизведение: цепочка ended-событий + setTimeout для пауз,
//  безопасная отмена (cancel-флаг), без setInterval.
// ============================================================

const HIFZ = (() => {
  const KEY = 'arabic-reader-hifz-v1';
  const DAY = SRS_CORE.DAY; // используется для «недавно выученных» (7 дней)

  // Делегирование общим модулям (единственные реализации — util.js и srs-core.js)
  const esc = s => escHtml(s);
  const endOfToday = () => endOfTodayTs();

  // ------------------------- хранилище -------------------------

  function blank() {
    return { version: 1, ayat: {}, last: { surahId: null, from: null, to: null, mode: 'listen' } };
  }

  let store = loadStore();

  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object' && s.ayat) return s;
    } catch (e) { /* повреждены — чистое состояние */ }
    return blank();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) { /* запись не критична */ }
    updateBadge();
  }

  function blankCard() {
    return {
      state: 'new', repetitions: 0, intervalDays: 0, ease: 2.5,
      nextReviewAt: null, lastReviewedAt: null, lapses: 0, confidence: 'new'
    };
  }

  // ------------------------- данные Корана -------------------------

  function quranStories() {
    const all = (typeof STORIES_DATA !== 'undefined' && STORIES_DATA.stories) || [];
    return [...all]
      .filter(s => (s.type || 'quran') === 'quran' && s.sentences.some(x => x.ayahAudio))
      .sort((a, b) => (a.surahNo ?? 9999) - (b.surahNo ?? 9999));
  }

  function ayahKey(story, sent) {
    return story.id + ':' + sent.ayah;
  }

  function ayahText(sent) {
    return sent.ar || sent.words.map(w => w.w).join(' ');
  }

  function allAyat() {
    const res = [];
    quranStories().forEach(st => {
      st.sentences.forEach(sent => {
        if (sent.ayahAudio) res.push({ story: st, sent, key: ayahKey(st, sent) });
      });
    });
    return res;
  }

  /** Оценить аят: общий SM-2 (srs-core.js) + уверенность + график повторения. */
  function gradeAyah(key, g) {
    let card = store.ayat[key];
    if (!card) card = store.ayat[key] = blankCard();
    SRS_CORE.applyGrade(card, g);
    card.confidence = (g === 'again' || g === 'hard') ? 'weak' : (g === 'easy' ? 'strong' : 'good');
    save();
    // журнал активности для серии дней и статистики дашборда
    if (typeof logActivity === 'function') {
      logActivity({ reviews: 1, correct: g !== 'again' ? 1 : 0 });
    }
    // золотые чернила: аят оценён не «Не помню»
    if (typeof INK !== 'undefined' && g !== 'again') INK.add(INK.P.ayah);
  }

  // ------------------------- счётчики -------------------------

  function dueList() {
    const eod = endOfToday();
    return allAyat()
      .map(a => ({ ...a, card: store.ayat[a.key] }))
      .filter(x => x.card && x.card.nextReviewAt && x.card.nextReviewAt <= eod)
      .sort((a, b) => a.card.nextReviewAt - b.card.nextReviewAt);
  }

  function counts() {
    const now = Date.now();
    const eod = endOfToday();
    const all = allAyat();
    const byKey = {};
    all.forEach(a => { byKey[a.key] = a; });
    let due = 0, learning = 0, solid = 0, hard = 0, recent = 0;
    const recentList = [];
    Object.entries(store.ayat).forEach(([k, c]) => {
      if (!c || typeof c !== 'object' || !byKey[k]) return;
      if (c.state === 'review') {
        solid++;
        if (c.lastReviewedAt && now - c.lastReviewedAt < 7 * DAY) {
          recent++;
          recentList.push({ a: byKey[k], c });
        }
      } else if (c.state === 'learning' || c.state === 'relearning') {
        learning++;
      }
      if ((c.lapses || 0) >= 1) hard++;
      if (c.nextReviewAt && c.nextReviewAt <= eod) due++;
    });
    recentList.sort((x, y) => (y.c.lastReviewedAt || 0) - (x.c.lastReviewedAt || 0));
    return {
      total: all.length,
      fresh: all.length - Object.keys(store.ayat).filter(k => byKey[k]).length,
      due, learning, solid, hard, recent, recentList
    };
  }

  // ------------------------- движок воспроизведения -------------------------

  let play = null; // активная последовательность (одна одновременно)

  function stopPlayback() {
    if (!play) return;
    play.cancelled = true;
    if (play.timer) clearTimeout(play.timer);
    if (play.audio) { try { play.audio.pause(); } catch (e) {} }
    play = null;
    updateTransport();
  }

  function pausePlayback() {
    if (!play || play.paused) return;
    play.paused = true;
    if (play.audio) play.audio.pause();
    if (play.timer) {
      clearTimeout(play.timer);
      play.timerLeft = Math.max(0, play.timerDur - (Date.now() - play.timerStart));
      play.timer = null;
    }
    updateTransport();
  }

  function resumePlayback() {
    if (!play || !play.paused) return;
    play.paused = false;
    if (play.audio) play.audio.play().catch(() => {});
    if (play.timerLeft != null && play.timerLeft > 0 && play.timerFn) {
      const left = play.timerLeft;
      play.timerLeft = null;
      const fn = play.timerFn;
      play.timerStart = Date.now();
      play.timerDur = left;
      play.timer = setTimeout(() => {
        if (play) { play.timer = null; play.timerFn = null; }
        fn();
      }, left);
    }
    updateTransport();
  }

  /** Один аудиофайл (краткая справка/проверка) — тоже управляемо паузой. */
  /** Audio аята: локальный файл + однократный фолбэк на CDN (как в читалке). */
  function makeAyahAudio(url) {
    const local = (typeof ayahAudioLocal === 'function') ? ayahAudioLocal(url) : url;
    const cdn = (typeof cdnUrl === 'function') ? cdnUrl(url) : url;
    const a = new Audio(local);
    if (cdn && cdn !== local) a._fallback = cdn; // используем при ошибке загрузки
    return a;
  }

  /** Попробовать фолбэк на CDN; true — если переключились. */
  function tryFallback(a) {
    if (!a || !a._fallback) return false;
    const fb = a._fallback;
    a._fallback = null;
    a.src = fb;
    a.play().catch(() => {});
    return true;
  }

  function playOnce(url) {
    stopPlayback();
    // не накладываем потоки: глушим плеер, слово и свою запись
    if (typeof stopAllAudio === 'function') stopAllAudio('hifz');
    else {
      if (typeof pausePlayer === 'function') pausePlayer();
      if (typeof stopWordAudio === 'function') stopWordAudio();
    }
    const a = makeAyahAudio(url);
    a.playbackRate = (session && session.speed) || 1;
    play = { cancelled: false, paused: false, audio: a, timer: null, timerFn: null, timerStart: 0, timerDur: 0, timerLeft: null };
    const P = play;
    a.addEventListener('ended', () => {
      if (play && play.audio === a) { play = null; updateTransport(); }
    });
    a.addEventListener('error', () => {
      if (P.cancelled) return;
      if (tryFallback(a)) return; // локального файла нет — пробуем CDN
      if (play && play.audio === a) { play = null; updateTransport(); }
    });
    a.play().catch(() => {});
    updateTransport();
  }

  /**
   * Проиграть последовательность аятов.
   * opts: { repeats: число|Infinity, speed, pauseMs }
   * onProgress(si, rep) — перед каждым воспроизведением; onDone() — по завершении всех.
   */
  function playSequence(sents, opts, onProgress, onDone) {
    stopPlayback(); // единственная активная цепочка — никаких параллельных
    // и глушим прочие потоки: плеер, слово, свою запись
    if (typeof stopAllAudio === 'function') stopAllAudio('hifz');
    else {
      if (typeof pausePlayer === 'function') pausePlayer();
      if (typeof stopWordAudio === 'function') stopWordAudio();
    }
    play = { cancelled: false, paused: false, audio: null, timer: null, timerFn: null, timerStart: 0, timerDur: 0, timerLeft: null };
    const P = play;
    let si = 0, rep = 0;

    function gap(ms, fn) {
      if (P.cancelled) return;
      if (!ms || ms <= 0) { fn(); return; }
      P.timerFn = fn;
      P.timerStart = Date.now();
      P.timerDur = ms;
      P.timer = setTimeout(() => {
        P.timer = null;
        P.timerFn = null;
        fn();
      }, ms);
    }

    function step() {
      if (P.cancelled) return;
      if (si >= sents.length) {
        stopPlayback();
        if (onDone) onDone();
        return;
      }
      rep = 0;
      playRep();
    }

    function playRep() {
      if (P.cancelled) return;
      if (onProgress) onProgress(si, rep);
      const a = makeAyahAudio(sents[si].ayahAudio);
      a.playbackRate = opts.speed || 1;
      P.audio = a;
      a.addEventListener('ended', () => {
        if (P.cancelled) return;
        rep++;
        if (opts.repeats !== Infinity && rep >= opts.repeats) {
          si++;
          gap(opts.pauseMs, step);
        } else {
          gap(opts.pauseMs, playRep);
        }
      });
      a.addEventListener('error', () => {
        if (P.cancelled) return;
        if (tryFallback(a)) return; // локального файла нет — пробуем CDN
        si++; rep = 0;
        gap(0, step);
      });
      a.play().catch(() => {});
    }

    step();
  }

  function updateTransport() {
    const btn = document.getElementById('hfPlayPause');
    if (!btn) return;
    if (!play) btn.textContent = '▶ Старт';
    else if (play.paused) btn.textContent = '▶ Продолжить';
    else btn.textContent = '⏸ Пауза';
  }

  // ------------------------- сессия -------------------------

  let session = null; // { mode, story?, sents?, list?(queue), idx, level, step, repeats, speed, pauseMs, startPlayback? }

  const LEVELS = [
    'полный текст + перевод',
    'текст без перевода',
    'часть слов скрыта',
    'начало видно, конец скрыт',
    'только первое слово',
    'полностью скрытый текст'
  ];

  function sessionItems() {
    return session.mode === 'queue' ? session.list : session.sents;
  }

  function currentItem() {
    if (session.mode === 'queue') return session.list[session.idx];
    const sent = session.sents[session.idx];
    return { story: session.story, sent, key: ayahKey(session.story, sent) };
  }

  function updateProgress(text) {
    const el = document.getElementById('hifzProgressText');
    if (el) el.textContent = text;
  }

  function setScore(text) {
    const el = document.getElementById('hifzScoreText');
    if (el) el.textContent = text || '';
  }

  function showSession() {
    document.getElementById('hifzOverviewPanel').classList.add('hidden');
    document.getElementById('hifzSetupPanel').classList.add('hidden');
    document.getElementById('hifzSessionPanel').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function nextAyah() {
    stopPlayback();
    session.idx++;
    session.level = 0;
    session.step = 1;
    renderSession();
  }

  function renderSession() {
    const items = sessionItems();
    if (!items || !items.length || session.idx >= items.length) {
      renderSessionEnd(!items || !items.length);
      return;
    }
    setScore('');
    updateProgress(`Аят ${session.idx + 1} из ${items.length}`);
    switch (session.mode) {
      case 'listen':
      case 'read':
        renderListen();
        break;
      case 'hide':
        renderHide();
        break;
      case 'continue':
      case 'queue':
        renderContinue(session.mode === 'queue');
        break;
      case 'chain':
        renderChain();
        break;
    }
  }

  function renderSessionEnd(empty) {
    stopPlayback();
    updateProgress(empty ? 'Нет аятов' : 'Готово!');
    if (!empty && typeof logActivity === 'function') {
      logActivity({ trainings: 1 }); // завершённая тренировка аятов — учебный день
    }
    if (!empty && typeof INK !== 'undefined') INK.add(INK.P.session); // золотые чернила за сессию
    const stage = document.getElementById('hifzStage');
    stage.innerHTML = `
      <div class="srs-summary">
        <div class="big">${empty ? '📖' : '🎉'}</div>
        <div class="percent">${empty
          ? 'Нет аятов к повторению — всё повторено. Выберите аяты для изучения нового.'
          : 'Сессия хифза завершена'}</div>
        <div class="study-actions" style="justify-content:center">
          <button class="ctrl-btn small primary" id="hfAgainBtn">Ещё раз</button>
          <button class="ctrl-btn small" id="hfSetupBtn">К настройкам</button>
        </div>
      </div>`;
    document.getElementById('hfAgainBtn').addEventListener('click', () => {
      if (session && session.mode === 'queue') startQueue();
      else startHifz();
    });
    document.getElementById('hfSetupBtn').addEventListener('click', renderScreen);
  }

  // ------------------------- режим «Слушай и повторяй» / «Чтение с аудио» -------------------------

  /** Подсветить звучащий аят в режиме чтения и подкрутить его к середине экрана (как в читалке). */
  function highlightReadItem(idx) {
    document.querySelectorAll('.hf-read-item').forEach(el => {
      el.classList.toggle('playing', +el.dataset.i === idx);
    });
    const cur = document.querySelector(`.hf-read-item[data-i="${idx}"]`);
    if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderListen() {
    const stage = document.getElementById('hifzStage');
    const isRead = session.mode === 'read';
    const it = currentItem();
    const reps = session.repeats;

    if (isRead) {
      // чтение: весь выбранный диапазон, текущий аят подсвечивается
      const list = session.sents.map((s, i) => `
        <div class="hf-read-item${i === session.idx ? ' playing' : ''}" lang="ar" dir="rtl" data-i="${i}">
          <span class="hf-read-no">${s.ayah}</span>
          <span>${esc(ayahText(s))}</span>
        </div>`).join('');
      stage.innerHTML = `
        <div class="hf-read-list">${list}</div>
        <div class="hifz-controls">
          <button class="ctrl-btn" id="hfPrev" ${session.idx === 0 ? 'disabled' : ''}>← Пред.</button>
          <button class="ctrl-btn primary" id="hfPlayPause">▶ Старт</button>
          <button class="ctrl-btn" id="hfNext" ${session.idx >= session.sents.length - 1 ? 'disabled' : ''}>След. →</button>
          <button class="ctrl-btn" id="hfStopBtn">⏹ Остановить</button>
        </div>
        <div id="hfCompletion"></div>`;
      session.startPlayback = () => {
        // база фиксируется на старте: подсветка = base + si (а не накопительно, иначе индексы перескакивают)
        const base = session.idx;
        playSequence(session.sents.slice(base), { repeats: 1, speed: session.speed, pauseMs: session.pauseMs },
          (si) => {
            const abs = base + si;
            session.idx = abs;
            updateProgress(`Аят ${abs + 1} из ${session.sents.length}`);
            highlightReadItem(abs);
            const p = document.getElementById('hfPrev'); if (p) p.disabled = abs === 0;
            const n = document.getElementById('hfNext'); if (n) n.disabled = abs >= session.sents.length - 1;
          },
          () => renderSessionEnd(false));
      };
    } else {
      stage.innerHTML = `
        <div class="hf-ayah-ar" lang="ar" dir="rtl">${esc(ayahText(it.sent))}</div>
        <div class="hf-ayah-ru">${esc(it.sent.ru || '')}</div>
        <div class="hf-rep-info" id="hfRepInfo">Нажмите «Старт»: аят проиграется ${reps === Infinity ? 'до остановки' : reps + ' раз(а)'} с паузами ${session.pauseMs ? (session.pauseMs / 1000) + ' с' : 'без пауз'}.</div>
        <div class="hifz-controls">
          <button class="ctrl-btn" id="hfPrev" ${session.idx === 0 ? 'disabled' : ''}>← Пред.</button>
          <button class="ctrl-btn primary" id="hfPlayPause">▶ Старт</button>
          <button class="ctrl-btn" id="hfRestart">↻ Повторить аят</button>
          <button class="ctrl-btn" id="hfNext">След. →</button>
          <button class="ctrl-btn" id="hfStopBtn">⏹ Остановить</button>
        </div>
        <p class="study-hint">Слушайте и читайте вслух за чтецом (или после него).</p>
        <div id="hfCompletion"></div>`;
      session.startPlayback = () => {
        playSequence([it.sent], { repeats: reps, speed: session.speed, pauseMs: session.pauseMs },
          (si, rep) => {
            const el = document.getElementById('hfRepInfo');
            if (el) el.textContent = reps === Infinity
              ? `Повтор ${rep + 1}…`
              : `Повтор ${rep + 1} из ${reps}`;
          },
          () => showCompletion());
      };
    }

    bindTransport(stage);
    updateTransport();
  }

  function bindTransport(stage) {
    const playBtn = document.getElementById('hfPlayPause');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!play) {
          if (typeof session.startPlayback === 'function') session.startPlayback();
        } else if (play.paused) resumePlayback();
        else pausePlayback();
        updateTransport();
      });
    }
    const prev = document.getElementById('hfPrev');
    if (prev) prev.addEventListener('click', () => {
      if (session.idx > 0) { stopPlayback(); session.idx--; session.level = 0; renderSession(); }
    });
    const next = document.getElementById('hfNext');
    if (next) next.addEventListener('click', () => nextAyah());
    const restart = document.getElementById('hfRestart');
    if (restart) restart.addEventListener('click', () => {
      if (typeof session.startPlayback === 'function') session.startPlayback();
    });
    const stopBtn = document.getElementById('hfStopBtn');
    if (stopBtn) stopBtn.addEventListener('click', () => {
      stopPlayback();
      showCompletion();
    });
  }

  /** Панель после завершения: Ещё раз / Следующий аят / Проверить себя / Завершить. */
  function showCompletion() {
    const el = document.getElementById('hfCompletion');
    if (!el) return;
    el.innerHTML = `
      <div class="study-word-info">
        <p class="study-hint" style="margin-top:0">Оцените аят («Проверить себя») — только тогда он попадёт в график мураджа'а.</p>
        <div class="study-actions" style="justify-content:center">
          <button class="ctrl-btn small" data-a="again">Ещё раз</button>
          <button class="ctrl-btn small" data-a="next">Следующий аят</button>
          <button class="ctrl-btn small primary" data-a="check">Проверить себя</button>
          <button class="ctrl-btn small" data-a="done">Завершить</button>
        </div>
      </div>`;
    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'again') { renderSession(); if (typeof session.startPlayback === 'function') session.startPlayback(); }
        else if (a === 'next') nextAyah();
        else if (a === 'check') checkSelf();
        else renderScreen();
      });
    });
  }

  /** «Проверить себя» — вспомнить аят и оценить воспроизведение. */
  function checkSelf() {
    const it = currentItem();
    const stage = document.getElementById('hifzStage');
    stage.innerHTML = `
      <div class="ex-type-label">Проверка памяти</div>
      <div class="ex-question-ru">Вспомните аят целиком (мысленно или вслух), затем откройте ответ.</div>
      <div id="hfCheckArea"></div>`;
    gradingPanel(it, document.getElementById('hfCheckArea'), () => {
      const nav = document.createElement('div');
      nav.className = 'study-actions';
      nav.style.justifyContent = 'center';
      nav.innerHTML = `
        <button class="ctrl-btn small primary" id="hfChkNext">Следующий аят →</button>
        <button class="ctrl-btn small" id="hfChkDone">Завершить</button>`;
      document.getElementById('hfCheckArea').appendChild(nav);
      document.getElementById('hfChkNext').addEventListener('click', () => nextAyah());
      document.getElementById('hfChkDone').addEventListener('click', () => renderScreen());
    });
  }

  // ------------------------- режим «Постепенное скрытие» -------------------------

  function renderMasked(sent, level) {
    const words = sent.words.map(w => esc(w.w));
    const n = words.length;
    return words.map((t, i) => {
      let hidden = false;
      if (level === 2) hidden = (i % 3 === 2);           // каждое третье слово
      else if (level === 3) hidden = i >= Math.ceil(n / 2); // начало видно, конец скрыт
      else if (level === 4) hidden = i > 0;              // только первое слово
      else if (level === 5) hidden = true;               // полностью скрыт
      return hidden ? `<span class="hf-mask" title="Нажмите, чтобы подглядеть">${t}</span>` : t;
    }).join(' ');
  }

  function renderHide() {
    const stage = document.getElementById('hifzStage');
    const it = currentItem();
    const sent = it.sent;
    session.level = Math.max(0, Math.min(5, session.level || 0));

    stage.innerHTML = `
      <div class="hf-ayah-ru ${session.level === 0 ? '' : 'hidden'}" id="hfRu">${esc(sent.ru || '')}</div>
      <div class="hf-ayah-ar" lang="ar" dir="rtl" id="hfText">${renderMasked(sent, session.level)}</div>
      <div class="hf-level-row">
        <button class="ctrl-btn small" id="hfLvlDown">− проще</button>
        <span class="hf-level-label">Уровень ${session.level + 1}/6: ${LEVELS[session.level]}</span>
        <button class="ctrl-btn small" id="hfLvlUp">сложнее +</button>
      </div>
      <div class="study-actions" style="justify-content:center">
        <button class="ctrl-btn small" id="hfListen">🔊 Прослушать</button>
        <button class="ctrl-btn small" id="hfShowAll">Показать весь текст</button>
        <button class="ctrl-btn small primary" id="hfReveal">Показать ответ</button>
        <button class="ctrl-btn small" id="hfNextAyah">Следующий аят →</button>
      </div>
      <p class="study-hint">Скрывайте текст постепенно; скрытые слова открываются кликом. Переходите между уровнями вручную.</p>
      <div id="hfCompletion"></div>`;

    stage.onclick = (e) => {
      const m = e.target.closest('.hf-mask');
      if (m) m.classList.toggle('revealed');
    };

    document.getElementById('hfLvlDown').addEventListener('click', () => { session.level--; renderHide(); });
    document.getElementById('hfLvlUp').addEventListener('click', () => { session.level++; renderHide(); });
      document.getElementById('hfListen').addEventListener('click', () => playOnce(sent.ayahAudio));
    document.getElementById('hfShowAll').addEventListener('click', () => {
      session.level = 0;
      renderHide();
    });
    document.getElementById('hfNextAyah').addEventListener('click', () => nextAyah());
    document.getElementById('hfReveal').addEventListener('click', () => {
      // полное раскрытие + самооценка
      session.level = 0;
      const txt = document.getElementById('hfText');
      if (txt) txt.innerHTML = renderMasked(sent, 0);
      const ru = document.getElementById('hfRu');
      if (ru) ru.classList.remove('hidden');
      gradingPanel(it, document.getElementById('hfCompletion'), () => {
        const nav = document.createElement('div');
        nav.className = 'study-actions';
        nav.style.justifyContent = 'center';
        nav.innerHTML = '<button class="ctrl-btn small primary" id="hfHideNext">Следующий аят →</button>';
        document.getElementById('hfCompletion').appendChild(nav);
        document.getElementById('hfHideNext').addEventListener('click', () => nextAyah());
      });
    });
  }

  // ------------------------- режим «Продолжи аят» / очередь мураджа'а -------------------------

  function firstHalfText(sent) {
    const n = sent.words.length;
    return sent.words.slice(0, Math.ceil(n / 2)).map(w => w.w).join(' ');
  }

  function renderContinue(isQueue) {
    const stage = document.getElementById('hifzStage');
    const it = currentItem();
    const sent = it.sent;
    const story = it.story;

    // вариант подсказки: начало / предыдущий аят / перевод / первые слова
    const variants = ['start', 'words', 'tr'];
    const sentIdx = story.sentences.indexOf(sent);
    if (sentIdx > 0) variants.push('prev');
    const variant = variants[Math.floor(Math.random() * variants.length)];

    let promptHtml = '';
    switch (variant) {
      case 'start':
        promptHtml = `<div class="hf-ayah-ar" lang="ar" dir="rtl">${esc(firstHalfText(sent))} …</div>
          <div class="ex-question-ru">Продолжите аят.</div>`;
        break;
      case 'words': {
        const k = 1 + Math.floor(Math.random() * 3);
        promptHtml = `<div class="hf-ayah-ar" lang="ar" dir="rtl">${esc(sent.words.slice(0, k).map(w => w.w).join(' '))} …</div>
          <div class="ex-question-ru">Продолжите аят.</div>`;
        break;
      }
      case 'prev':
        promptHtml = `<div class="hf-ayah-ar hf-dim">${esc(ayahText(story.sentences[sentIdx - 1]))}</div>
          <div class="ex-question-ru">Предыдущий аят показан — вспомните следующий.</div>`;
        break;
      case 'tr':
        promptHtml = `<div class="study-question-ru">${esc(sent.ru || '')}</div>
          <div class="ex-question-ru">Вспомните аят по переводу.</div>`;
        break;
    }

    stage.innerHTML = `
      <div class="ex-type-label">${isQueue ? 'Мураджа\'а — повторение по графику' : 'Продолжи аят'}</div>
      ${promptHtml}
      <div id="hfAnswer"></div>`;
    gradingPanel(it, document.getElementById('hfAnswer'), () => {
      setTimeout(() => nextAyah(), 600);
    });
  }

  /** Панель «Показать ответ» + оценка качества воспроизведения (обновляет график аята). */
  function gradingPanel(it, container, onGraded) {
    container.innerHTML = `
      <div class="srs-reveal-wrap"><button class="ctrl-btn primary wide" id="hfGrReveal">Показать ответ</button></div>
      <div id="hfGrAnswer"></div>`;
    container.querySelector('#hfGrReveal').addEventListener('click', () => {
      const ans = container.querySelector('#hfGrAnswer');
      ans.innerHTML = `
        <div class="study-word-info">
          <div class="gap-reveal">${esc(ayahText(it.sent))}</div>
          <div class="gap-reveal-ru">${esc(it.sent.ru || '')}</div>
          ${it.sent.ayahAudio ? '<button class="ctrl-btn small" id="hfGrAudio">🔊 Прослушать аят</button>' : ''}
          <div class="srs-grades" style="margin-top:14px">
            <button class="grade-btn grade-again" data-g="again">Не помню</button>
            <button class="grade-btn grade-hard" data-g="hard">Трудно</button>
            <button class="grade-btn grade-good" data-g="good">Хорошо</button>
            <button class="grade-btn grade-easy" data-g="easy">Легко</button>
          </div>
          <p class="study-hint">Оцените точность воспроизведения — это задаёт интервал мураджа'а.</p>
        </div>`;
      const audioBtn = ans.querySelector('#hfGrAudio');
      if (audioBtn) audioBtn.addEventListener('click', () => playOnce(it.sent.ayahAudio));
      ans.querySelectorAll('.grade-btn').forEach(b => {
        b.addEventListener('click', () => {
          gradeAyah(it.key, b.dataset.g);
          onGraded();
        });
      });
    });
  }

  // ------------------------- режим «Связка аятов» -------------------------

  function chainTextHtml(sents, step) {
    return sents.slice(0, step).map((s, i) => `
      <div class="hf-read-item${i === step - 1 ? ' chain-new' : ''}" lang="ar" dir="rtl">
        <span class="hf-read-no">${s.ayah}</span>
        <span>${esc(ayahText(s))}</span>
      </div>`).join('');
  }

  function renderChain() {
    const stage = document.getElementById('hifzStage');
    const sents = session.sents;
    const maxStep = sents.length;
    session.step = Math.max(1, Math.min(maxStep, session.step || 1));
    const step = session.step;

    const stepBtns = [];
    for (let k = 1; k <= maxStep; k++) {
      stepBtns.push(`<button class="chip-step${k === step ? ' active' : ''}" data-k="${k}">${k === 1 ? 'Аят 1' : 'Аяты 1–' + k}</button>`);
    }

    stage.innerHTML = `
      <p class="study-hint">Полезный сценарий: 1 → 1+2 → 1+2+3… Но порядок не обязателен — выберите любой шаг.</p>
      <div class="hifz-chain-steps">${stepBtns.join('')}</div>
      <div class="hf-read-list">${chainTextHtml(sents, step)}</div>
      <div class="hifz-controls">
        <button class="ctrl-btn primary" id="hfPlayPause">▶ Проиграть шаг</button>
        <button class="ctrl-btn" id="hfNextStep" ${step >= maxStep ? 'disabled' : ''}>Следующий шаг →</button>
        <button class="ctrl-btn" id="hfGradeStep">Оценить новый аят</button>
        <button class="ctrl-btn" id="hfStopBtn">⏹ Остановить</button>
      </div>
      <div id="hfCompletion"></div>`;

    stage.querySelectorAll('.chip-step').forEach(b => {
      b.addEventListener('click', () => { stopPlayback(); session.step = +b.dataset.k; renderChain(); });
    });
    document.getElementById('hfNextStep').addEventListener('click', () => {
      stopPlayback();
      session.step = Math.min(maxStep, session.step + 1);
      renderChain();
    });
    document.getElementById('hfGradeStep').addEventListener('click', () => {
      const newSent = sents[session.step - 1];
      gradingPanel({ story: session.story, sent: newSent, key: ayahKey(session.story, newSent) },
        document.getElementById('hfCompletion'), () => {});
    });
    document.getElementById('hfStopBtn').addEventListener('click', () => stopPlayback());
    session.startPlayback = () => {
      playSequence(sents.slice(0, session.step), { repeats: 1, speed: session.speed, pauseMs: session.pauseMs },
        null, () => {});
    };
    bindTransport(stage);
    updateTransport();
  }

  // ------------------------- экран -------------------------

  function renderDashboard() {
    const el = document.getElementById('hifzDashboard');
    if (!el) return;
    const c = counts();
    const recentRows = c.recentList.slice(0, 5).map(x => `
      <div class="src-row">
        <span class="src-name">${esc(x.a.story.titleRu)}, аят ${x.a.sent.ayah}</span>
        <span class="src-count">${x.c.confidence === 'strong' ? 'уверенно' : x.c.confidence === 'good' ? 'хорошо' : 'слабо'}</span>
      </div>`).join('');
    el.innerHTML = `
      <div class="stats-row stats-row-4">
        <div class="stat-box"><div class="stat-num">${c.fresh}</div><div class="stat-label">новых аятов</div></div>
        <div class="stat-box"><div class="stat-num">${c.due}</div><div class="stat-label">к повторению сегодня</div></div>
        <div class="stat-box"><div class="stat-num">${c.hard}</div><div class="stat-label">трудных аятов</div></div>
        <div class="stat-box"><div class="stat-num">${c.recent}</div><div class="stat-label">недавно выученных</div></div>
      </div>
      <p class="study-hint">Аят попадает в график мураджа'а только после вашей оценки: «Проверить себя» после слушания, «Показать ответ» в самопроверке или «Оценить новый аят» в связке. Прослушивание — тренировка, но само по себе прогресс аята не меняет.</p>
      <div class="srs-actions-center">
        <button class="ctrl-btn primary" id="hfQueueBtn" ${c.due ? '' : 'disabled'}>Начать мураджа'а — повторить аяты (${c.due})</button>
      </div>
      <h4 class="stats-subtitle">Недавно выученные</h4>
      <div class="src-progress">${recentRows || '<p class="stats-empty">Пока пусто: здесь появятся аяты, закреплённые успешными оценками (в течение 7 дней после перехода в долгосрочное повторение).</p>'}</div>`;
    const qbtn = document.getElementById('hfQueueBtn');
    if (qbtn) qbtn.addEventListener('click', () => startQueue());
  }

  function fillRangeSelects(story) {
    const from = document.getElementById('hfFrom');
    const to = document.getElementById('hfTo');
    const nums = story.sentences.map(s => s.ayah);
    from.innerHTML = nums.map(n => `<option value="${n}">${n}</option>`).join('');
    to.innerHTML = nums.map(n => `<option value="${n}">${n}</option>`).join('');
    const last = store.last || {};
    if (last.from && nums.includes(last.from)) from.value = last.from;
    if (last.to && nums.includes(last.to)) to.value = last.to;
    else to.value = nums[nums.length - 1];
  }

  function renderSetupForm() {
    const form = document.getElementById('hifzSetupForm');
    if (!form) return;
    const stories = quranStories();
    const last = store.last || {};
    const reciters = (typeof RECITERS !== 'undefined') ? RECITERS : [];
    form.innerHTML = `
      <label class="study-label">Сура</label>
      <select id="hfSurah" class="study-select">
        ${stories.map(s => `<option value="${s.id}">${esc(s.titleRu)}</option>`).join('')}
      </select>
      <div class="hf-range-row">
        <div><label class="study-label">Аят от</label><select id="hfFrom" class="study-select"></select></div>
        <div><label class="study-label">до</label><select id="hfTo" class="study-select"></select></div>
      </div>
      <label class="study-label">Режим</label>
      <select id="hfMode" class="study-select">
        <option value="listen">Изучение нового — слушай и повторяй</option>
        <option value="read">Чтение с аудио</option>
        <option value="hide">Проверка памяти — постепенное скрытие текста</option>
        <option value="continue">Проверка памяти — продолжи аят</option>
        <option value="chain">Связка аятов (1 → 1+2 → 1+2+3…)</option>
        <option value="queue">Повторение выученного — по графику</option>
      </select>
      <label class="study-label">Чтец</label>
      <select id="hfReciter" class="study-select">
        ${reciters.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}
      </select>
      <div class="hf-range-row hf-opts-row">
        <div><label class="study-label">Повторов аудио</label>
          <select id="hfRepeats" class="study-select">
            <option value="3">3</option><option value="5" selected>5</option>
            <option value="10">10</option><option value="0">∞</option>
          </select></div>
        <div><label class="study-label">Скорость</label>
          <select id="hfSpeed" class="study-select">
            <option value="0.6">0.6×</option>
            <option value="0.75">0.75×</option>
            <option value="1" selected>1×</option>
          </select></div>
        <div><label class="study-label">Пауза после аята</label>
          <select id="hfPause" class="study-select">
            <option value="0">без паузы</option>
            <option value="3">3 секунды</option>
            <option value="5" selected>5 секунд</option>
            <option value="10">10 секунд</option>
          </select></div>
      </div>
      <button class="ctrl-btn primary wide" id="hfStart">Начать</button>
      <p class="study-hint">Для «повторения по графику» сура и аяты не нужны — берутся аяты, подошедшие по расписанию мураджа'а.</p>`;

    // не теряем уже выбранную суру при повторном рендере формы
    const prevSurah = (document.getElementById('hfSurah') || {}).value || null;
    const surahSel = document.getElementById('hfSurah');
    if (prevSurah && stories.some(s => s.id === prevSurah)) surahSel.value = prevSurah;
    else if (last.surahId && stories.some(s => s.id === last.surahId)) surahSel.value = last.surahId;
    fillRangeSelects(stories.find(s => s.id === surahSel.value) || stories[0]);
    // режим по умолчанию — «Изучение нового»; «Повторение выученного» (queue) не запоминаем
    if (last.mode && last.mode !== 'queue') document.getElementById('hfMode').value = last.mode;
    toggleRangeForMode();

    // чтец — общая настройка сайта (как в читалке)
    const recSel = document.getElementById('hfReciter');
    if (recSel) {
      const cur = (typeof currentReciter !== 'undefined') ? currentReciter : (reciters[0] && reciters[0].id);
      if (cur) recSel.value = cur;
      recSel.addEventListener('change', () => {
        if (typeof setReciter === 'function') setReciter(recSel.value);
        else if (typeof currentReciter !== 'undefined') currentReciter = recSel.value;
      });
    }

    surahSel.addEventListener('change', () => {
      fillRangeSelects(stories.find(s => s.id === surahSel.value) || stories[0]);
    });
    document.getElementById('hfMode').addEventListener('change', toggleRangeForMode);
    document.getElementById('hfStart').addEventListener('click', startHifz);
  }

  function toggleRangeForMode() {
    const isQueue = document.getElementById('hfMode').value === 'queue';
    ['hfFrom', 'hfTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isQueue;
    });
    const surahSel = document.getElementById('hfSurah');
    if (surahSel) surahSel.disabled = isQueue;
  }

  function readSetupValues() {
    return {
      surahId: document.getElementById('hfSurah').value,
      from: parseInt(document.getElementById('hfFrom').value, 10),
      to: parseInt(document.getElementById('hfTo').value, 10),
      mode: document.getElementById('hfMode').value,
      repeats: document.getElementById('hfRepeats').value === '0'
        ? Infinity
        : parseInt(document.getElementById('hfRepeats').value, 10),
      speed: parseFloat(document.getElementById('hfSpeed').value),
      pauseMs: parseInt(document.getElementById('hfPause').value, 10) * 1000
    };
  }

  function startHifz() {
    const v = readSetupValues();
    store.last = { surahId: v.surahId, from: v.from, to: v.to, mode: v.mode };
    save();

    if (v.mode === 'queue') return startQueue();

    const story = quranStories().find(s => s.id === v.surahId);
    if (!story) return;
    const from = Math.min(v.from, v.to);
    const to = Math.max(v.from, v.to);
    const sents = story.sentences.filter(s => s.ayah >= from && s.ayah <= to);
    if (!sents.length) return;

    session = {
      mode: v.mode, story, sents, idx: 0, level: 0, step: 1,
      repeats: v.repeats, speed: v.speed, pauseMs: v.pauseMs
    };
    showSession();
    renderSession();
  }

  function startQueue() {
    const v = readSetupValues();
    const list = dueList();
    session = {
      mode: 'queue', list, idx: 0,
      speed: v.speed || 1, pauseMs: v.pauseMs || 0
    };
    showSession();
    renderSession();
  }

  function renderScreen() {
    stopPlayback();
    session = null;
    document.getElementById('hifzSessionPanel').classList.add('hidden');
    document.getElementById('hifzOverviewPanel').classList.remove('hidden');
    document.getElementById('hifzSetupPanel').classList.remove('hidden');
    renderDashboard();
    renderSetupForm();
    updateBadge();
  }

  // ------------------------- бейдж вкладки -------------------------

  function updateBadge() {
    const el = document.getElementById('hifzNavBadge');
    if (!el) return;
    try {
      const n = counts().due;
      el.textContent = n;
      el.classList.toggle('hidden', n === 0);
    } catch (e) { /* скрыть при ошибке */ }
  }

  const exitBtn = document.getElementById('hifzExitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      stopPlayback();
      renderScreen();
    });
  }

  // ------------------------- API -------------------------

  return {
    renderScreen,
    dueCount() { return counts().due; },
    startQueue,
    stop() { stopPlayback(); },
    /** Сводные счётчики для дашборда. */
    getCounts() { return counts(); },
    /** Самые трудные аяты: [{story, sent, key, lapses, state}]. */
    hardAyatList(limit) {
      const byKey = {};
      allAyat().forEach(a => { byKey[a.key] = a; });
      const res = [];
      Object.entries(store.ayat).forEach(([k, c]) => {
        const a = byKey[k];
        if (!a || !c || (c.lapses || 0) < 1) return;
        res.push({ story: a.story, sent: a.sent, key: k, lapses: c.lapses || 0, state: c.state });
      });
      res.sort((x, y) => y.lapses - x.lapses);
      return res.slice(0, limit || 8);
    },
    /** Запустить повторение конкретного списка аятов (например, трудных). */
    startAyatSession(list) {
      if (!list || !list.length) return;
      let speed = 1, pauseMs = 0;
      try {
        const v = readSetupValues();
        speed = v.speed || 1;
        pauseMs = v.pauseMs || 0;
      } catch (e) { /* форма ещё не отрисована — значения по умолчанию */ }
      session = { mode: 'queue', list: list.slice(), idx: 0, speed, pauseMs };
      showSession();
      renderSession();
    },
    /** Карточка аята (для маршрутов) или null. */
    getCard(key) {
      const c = store.ayat[key];
      return c ? JSON.parse(JSON.stringify(c)) : null;
    },
    /** Запустить заучивание всей суры в режиме «Слушай и повторяй». */
    startFor(storyId) {
      const story = quranStories().find(s => s.id === storyId);
      if (!story) return;
      let speed = 1, pauseMs = 5000;
      try {
        const v = readSetupValues();
        speed = v.speed || 1;
        pauseMs = isNaN(v.pauseMs) ? 5000 : v.pauseMs;
      } catch (e) { /* значения по умолчанию */ }
      session = {
        mode: 'listen', story,
        sents: story.sentences.filter(s => s.ayahAudio),
        idx: 0, level: 0, step: 1,
        repeats: 5, speed, pauseMs
      };
      showSession();
      renderSession();
    }
  };
})();
