/* ИСМ XML — поиск пересекающихся требований.
   Формулировки сравниваются по словам с учётом окончаний (стеммер Snowball для русского языка)
   с весами TF-IDF: редкие слова значат больше, частые («должен», «система») — меньше.
   Сходство — косинус между векторами формулировок, от 0 до 1. */
(() => {
  'use strict';

  /* ---------- Стеммер Snowball (русский) ---------- */
  const PERFECTIVE = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
  const REFLEXIVE = /(с[яь])$/;
  const ADJECTIVE = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
  const PARTICIPLE = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
  const VERB = /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
  const NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
  const DERIV = /[^аеиоуыэюя][аеиоуыэюя]+[^аеиоуыэюя]+[аеиоуыэюя].*(?<=о)сть?$/;
  const cache = new Map();
  function stem(w) {
    if (cache.has(w)) return cache.get(w);
    let word = w.toLowerCase().replace(/ё/g, 'е');
    if (!/[а-я]/.test(word)) { cache.set(w, word); return word; }
    const m = /^(.*?[аеиоуыэюя])(.*)$/.exec(word);
    if (!m) { cache.set(w, word); return word; }
    const pre = m[1];
    let rv = m[2];
    let t = rv.replace(PERFECTIVE, '');
    if (t === rv) {
      rv = rv.replace(REFLEXIVE, '');
      t = rv.replace(ADJECTIVE, '');
      if (t !== rv) rv = t.replace(PARTICIPLE, '');
      else { t = rv.replace(VERB, ''); rv = t === rv ? rv.replace(NOUN, '') : t; }
    } else rv = t;
    rv = rv.replace(/и$/, '');
    if (DERIV.test(rv)) rv = rv.replace(/ость?$/, '');
    t = rv.replace(/ь$/, '');
    if (t !== rv) rv = t;
    else { rv = rv.replace(/ейше?$/, ''); rv = rv.replace(/нн$/, 'н'); }
    const out = pre + rv;
    cache.set(w, out);
    return out;
  }

  /* ---------- Слова ---------- */
  const STOP = new Set(('и в во не на с со по для к ко от из о об обо а но или либо что как так же ли бы то это этот эта эти тот та те '
    + 'при до после между над под через без про у же уже еще ещё все всех всем весь вся всё его ее её их им ими ей ему он она оно они '
    + 'который которая которое которые которых которым каждый каждая каждое каждого каждой каждому также том тем чем где когда если '
    + 'должен должна должно должны следует необходимо обязан обязана обязаны требуется требуются допускается допускаются недопустимы '
    + 'запрещается рекомендуется может могут быть был была было были является являются осуществляется обеспечивается '
    + 'настоящий настоящего данный данного данной данные соответствии согласно числе том случае т п д др в т ч').split(/\s+/));
  const WORD = /[а-яёa-z0-9]+(?:[-–][а-яёa-z0-9]+)*/gi;
  function tokens(text) {
    const out = [];
    for (const m of String(text).toLowerCase().matchAll(WORD)) {
      const w = m[0].replace(/ё/g, 'е');
      if (STOP.has(w)) continue;
      if (/^\d+$/.test(w) ? w.length < 2 : w.length < 3) continue;
      out.push(stem(w));
    }
    return out;
  }

  /* ---------- Пары ---------- */
  // items: [{key, text, group, quote, polarity}] → пары со сходством ≥ minScore
  function findPairs(items, opts = {}) {
    const minScore = opts.minScore ?? 0.5;
    const N = items.length;
    const toks = items.map((it) => tokens(it.text));
    const df = new Map();
    toks.forEach((ts) => new Set(ts).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const vecs = toks.map((ts) => {
      const tf = new Map();
      ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      const v = new Map();
      let n2 = 0;
      tf.forEach((c, t) => { const w = (1 + Math.log(c)) * Math.log(1 + N / df.get(t)); v.set(t, w); n2 += w * w; });
      const n = Math.sqrt(n2) || 1;
      v.forEach((w, t) => v.set(t, w / n));
      return v;
    });
    const post = new Map();
    vecs.forEach((v, i) => v.forEach((w, t) => { if (!post.has(t)) post.set(t, []); post.get(t).push([i, w]); }));
    const pairs = [];
    for (let i = 0; i < N; i++) {
      const acc = new Map();
      vecs[i].forEach((w, t) => {
        const list = post.get(t);
        if (list.length > Math.max(40, N * 0.6)) return; // слишком общее слово
        for (const [j, wj] of list) if (j > i) acc.set(j, (acc.get(j) || 0) + w * wj);
      });
      acc.forEach((score, j) => {
        if (score < minScore) return;
        const a = items[i], b = items[j];
        if (opts.skip && opts.skip(a, b)) return;
        const shared = new Set([...vecs[i].keys()].filter((t) => vecs[j].has(t)));
        const conflict = a.polarity && b.polarity && a.polarity !== b.polarity && score >= minScore;
        pairs.push({ a: a.key, b: b.key, score, shared, kind: conflict ? 'conflict' : score >= (opts.dupScore ?? 0.8) ? 'dup' : 'overlap' });
      });
    }
    pairs.sort((x, y) => y.score - x.score);
    return pairs;
  }

  // Подсветка общих слов: возвращает HTML с <mark> вокруг слов, чьи основы есть в shared
  function highlight(text, shared, esc) {
    let out = '', last = 0;
    for (const m of String(text).matchAll(WORD)) {
      const w = m[0].toLowerCase().replace(/ё/g, 'е');
      out += esc(text.slice(last, m.index));
      out += !STOP.has(w) && shared.has(stem(w)) ? `<mark>${esc(m[0])}</mark>` : esc(m[0]);
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  window.ISM = window.ISM || {};
  window.ISM.overlap = { stem, tokens, findPairs, highlight };
})();
