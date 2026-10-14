// ============================================================
//  SRS_CORE — общий алгоритм интервального повторения (SM-2)
//  для слов (srs.js) и аятов (hifz.js). Единственная реализация.
//
//  applyGrade управляет только планированием:
//    state, repetitions, lapses, intervalDays, ease,
//    nextReviewAt, lastReviewedAt.
//  Счётчики ответов (totalAnswers и т.п.) ведёт вызывающая сторона.
//
//  Лестница успешных ответов: 10 мин -> 1 день -> 3 дня -> 7 дней
//  -> дальнейший рост по коэффициенту лёгкости (ease).
//  «Не помню» возвращает карточку в короткое обучение (relearning
//  для забытых review-карточек), «Легко» выпускает сразу на 7 дней.
// ============================================================

const SRS_CORE = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const MIN = 60 * 1000;
  const LEARNING_STEP = 10 * MIN; // короткий шаг обучения
  const EASE_MIN = 1.3;
  const EASE_MAX = 2.8;
  const REVIEW_CAP = 365; // максимум дней между повторениями

  function clampEase(e) {
    return Math.max(EASE_MIN, Math.min(EASE_MAX, e || 2.5));
  }

  function applyGrade(card, grade) {
    const now = Date.now();
    const prevState = card.state;
    card.lastReviewedAt = now;

    // «Не помню»: ошибка, возврат в короткое обучение.
    if (grade === 'again') {
      card.lapses = (card.lapses || 0) + 1;
      card.repetitions = 0;
      card.intervalDays = 0;
      card.state = prevState === 'review' ? 'relearning' : 'learning';
      card.ease = clampEase((card.ease || 2.5) - 0.20);
      card.nextReviewAt = now + LEARNING_STEP;
      return;
    }

    if (grade === 'hard') card.ease = clampEase((card.ease || 2.5) - 0.15);
    if (grade === 'easy') card.ease = clampEase((card.ease || 2.5) + 0.15);
    // ВАЖНО: ease обновляется ДО расчёта интервала, поэтому «Легко»/«Трудно»
    // в долгом повторении умножают на уже изменённый коэффициент (как в классическом SM-2).

    // Короткая фаза (new / learning / relearning).
    if (prevState === 'new' || prevState === 'learning' || prevState === 'relearning') {
      if (grade === 'hard') {
        card.state = 'learning';
        card.intervalDays = 0;
        card.nextReviewAt = now + LEARNING_STEP;
        return;
      }
      card.repetitions = (card.repetitions || 0) + 1;
      if (grade === 'easy') {
        card.state = 'review';
        card.intervalDays = 7;
        card.nextReviewAt = now + 7 * DAY;
        return;
      }
      if (card.repetitions === 1) {
        card.state = 'learning';
        card.intervalDays = 0;
        card.nextReviewAt = now + LEARNING_STEP;
      } else {
        card.state = 'review';
        // забытая карточка возвращается аккуратнее — с 1 дня
        const days = prevState === 'relearning'
          ? 1
          : [1, 3, 7][Math.min(card.repetitions - 2, 2)];
        card.intervalDays = days;
        card.nextReviewAt = now + days * DAY;
      }
      return;
    }

    // Долгое повторение (review).
    let iv = card.intervalDays || 1;
    if (grade === 'hard') {
      iv = Math.max(1, Math.round(iv * 1.2));
    } else if (grade === 'good') {
      // ранние интервалы следуют документированной лестнице: 1 → 3 → 7 дней,
      // далее — рост по коэффициенту лёгкости
      if (iv <= 1) iv = 3;
      else if (iv <= 3) iv = 7;
      else iv = Math.max(iv + 1, Math.round(iv * (card.ease || 2.5)));
    } else { // easy
      iv = Math.max(iv + 2, Math.round(iv * (card.ease || 2.5) * 1.3));
    }
    card.intervalDays = Math.min(iv, REVIEW_CAP);
    card.nextReviewAt = now + card.intervalDays * DAY;
  }

  return { DAY, LEARNING_STEP, clampEase, applyGrade };
})();
