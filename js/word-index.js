// ============================================================
//  Индексы слов и корней — строятся ОДИН раз при загрузке.
//
//  WORD_INDEX: точная форма слова -> [{story, sentence, sIdx, wIdx}]
//  ROOT_INDEX: корень -> [{text, word, story, sentence, sIdx, wIdx}]
//              (одна запись на уникальную форму слова)
//
//  Используется карточкой слова: «Встречается в материалах»
//  и «Слова с этим корнем». Глобального поиска при рендере нет.
// ============================================================

const WORD_INDEX = new Map();
const ROOT_INDEX = new Map();

(function buildWordIndexes() {
  const stories = (typeof STORIES_DATA !== 'undefined' && STORIES_DATA.stories) || [];
  stories.forEach(st => {
    (st.sentences || []).forEach((sent, sIdx) => {
      (sent.words || []).forEach((w, wIdx) => {
        if (!w || !w.w) return;
        const entry = { story: st, sentence: sent, sIdx, wIdx };
        if (!WORD_INDEX.has(w.w)) WORD_INDEX.set(w.w, []);
        WORD_INDEX.get(w.w).push(entry);

        const root = (w.root || '').trim();
        if (root && root !== '—' && root.replace(/\s/g, '').length >= 2) {
          if (!ROOT_INDEX.has(root)) ROOT_INDEX.set(root, []);
          const arr = ROOT_INDEX.get(root);
          if (!arr.some(x => x.text === w.w)) {
            arr.push({ text: w.w, word: w, story: st, sentence: sent, sIdx, wIdx });
          }
        }
      });
    });
  });
})();

/** Все вхождения точной формы слова по всем материалам сайта. */
function getWordOccurrences(text) {
  return WORD_INDEX.get(text) || [];
}

/** Уникальные формы слов с данным корнем (в материалах сайта). */
function getWordsByRoot(root) {
  return ROOT_INDEX.get((root || '').trim()) || [];
}
