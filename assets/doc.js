/* ИСМ XML — чтение документов Word 97–2003 (.doc) прямо в браузере.
   Файл .doc — составной файл OLE (CFB) с потоками WordDocument и 0Table/1Table (спецификация MS-DOC).
   Читаются: основной текст по таблице фрагментов (CLX), свойства абзацев (стиль, таблица, список),
   таблица стилей (заголовки по встроенным стилям «Заголовок 1–9» и уровню структуры),
   списки (LSTF, LVL, LFO) — чтобы восстановить автоматическую нумерацию пунктов, которой нет в тексте.
   Результат — те же блоки, что у разбора .docx в convert.js:
   {type:'p', text, label, labelKind, bullet, heading, styleName} и {type:'table', rows:[[{lines}]]}. */
(() => {
  'use strict';
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const END = 0xFFFFFFFA; // номера секторов от этого значения — служебные (конец цепочки, свободный сектор)

  /* ---------- Составной файл OLE (CFB) ---------- */
  function cfb(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (u8.length < 512 || SIG.some((b, i) => u8[i] !== b)) throw new Error('NOT_CFB');
    const sec = 1 << dv.getUint16(0x1E, true);
    const mini = 1 << dv.getUint16(0x20, true);
    const nFat = dv.getUint32(0x2C, true);
    const dirStart = dv.getUint32(0x30, true);
    const cutoff = dv.getUint32(0x38, true);
    const miniFatStart = dv.getUint32(0x3C, true);
    const nMiniFat = dv.getUint32(0x40, true);
    const off = (s) => (s + 1) * sec; // заголовок занимает «нулевой» сектор
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(0x4C + i * 4, true));
    let difat = dv.getUint32(0x44, true);
    for (let k = 0, n = dv.getUint32(0x48, true); k < n && difat < END && off(difat) + sec <= u8.length; k++) {
      const o = off(difat);
      for (let i = 0; i < sec / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
      difat = dv.getUint32(o + sec - 4, true);
    }
    const per = sec / 4;
    const fat = new Uint32Array(fatSecs.length * per);
    fatSecs.forEach((s, i) => { const o = off(s); if (o + sec > u8.length) return; for (let j = 0; j < per; j++) fat[i * per + j] = dv.getUint32(o + j * 4, true); });
    const chain = (start, table) => {
      const out = [];
      const seen = new Set();
      for (let s = start; s < END && s < table.length && !seen.has(s); s = table[s]) { seen.add(s); out.push(s); }
      return out;
    };
    const readChain = (start, size) => {
      const secs = chain(start, fat);
      const out = new Uint8Array(secs.length * sec);
      secs.forEach((s, i) => { const o = off(s); out.set(u8.subarray(o, Math.min(o + sec, u8.length)), i * sec); });
      return size == null ? out : out.subarray(0, Math.min(size, out.length));
    };
    const dir = readChain(dirStart);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const d = new DataView(dir.buffer, dir.byteOffset + o, 128);
      const len = d.getUint16(0x40, true);
      let name = '';
      for (let i = 0; i < Math.min(31, Math.max(0, len / 2 - 1)); i++) name += String.fromCharCode(d.getUint16(i * 2, true));
      entries.push({ name, type: d.getUint8(0x42), left: d.getUint32(0x44, true), right: d.getUint32(0x48, true), child: d.getUint32(0x4C, true), start: d.getUint32(0x74, true), size: d.getUint32(0x78, true) });
    }
    // Потоки верхнего уровня: у встроенных объектов (ObjectPool) бывают свои WordDocument и 1Table
    const top = [];
    const seen = new Set();
    const visit = (i) => {
      if (i >= entries.length || i >= END || seen.has(i)) return;
      seen.add(i);
      top.push(entries[i]);
      visit(entries[i].left); visit(entries[i].right);
    };
    if (entries[0]) visit(entries[0].child);
    let miniStream = null;
    let miniFat = null;
    function stream(name) { return readEntry(top.find((x) => x.type === 2 && x.name === name)); }
    function readEntry(e) {
      if (!e) return null;
      if (e.size >= cutoff) return readChain(e.start, e.size);
      if (!miniStream) {
        miniStream = readChain(entries[0].start, entries[0].size);
        const mf = readChain(miniFatStart, nMiniFat * sec);
        const md = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
        miniFat = new Uint32Array(Math.floor(mf.byteLength / 4));
        for (let i = 0; i < miniFat.length; i++) miniFat[i] = md.getUint32(i * 4, true);
      }
      const secs = chain(e.start, miniFat);
      const out = new Uint8Array(secs.length * mini);
      secs.forEach((s, i) => out.set(miniStream.subarray(s * mini, s * mini + mini), i * mini));
      return out.subarray(0, e.size);
    }
    // Поток по пути внутри хранилищ: ['ObjectPool', '_1234', 'Package'] (встроенные объекты)
    const kidsOf = (i) => { const out = []; const sn = new Set(); const v = (k) => { if (k >= entries.length || k >= END || sn.has(k)) return; sn.add(k); out.push(entries[k]); v(entries[k].left); v(entries[k].right); }; v(i); return out; };
    function streamPath(names) {
      let level = entries[0] ? kidsOf(entries[0].child) : [];
      let e = null;
      for (let k = 0; k < names.length; k++) {
        e = level.find((x) => x.name === names[k]);
        if (!e) return null;
        if (k < names.length - 1) level = kidsOf(e.child);
      }
      return e && e.type === 2 ? readEntry(e) : null;
    }
    function list(names) {
      let level = entries[0] ? kidsOf(entries[0].child) : [];
      for (const n of names) { const e = level.find((x) => x.name === n); if (!e) return []; level = kidsOf(e.child); }
      return level.map((x) => ({ name: x.name, type: x.type }));
    }
    return { stream, streamPath, list, names: top.map((e) => e.name) };
  }

  /* ---------- Свойства (sprm) ---------- */
  // Длина операнда sprm по полю spra; переменная длина — первый байт (особые случаи — таблицы и табуляции)
  function eachSprm(bytes, fn) {
    let i = 0;
    while (i + 2 <= bytes.length) {
      const op = bytes[i] | (bytes[i + 1] << 8);
      i += 2;
      let len;
      switch (op >> 13) {
        case 0: case 1: len = 1; break;
        case 2: case 4: case 5: len = 2; break;
        case 3: len = 4; break;
        case 7: len = 3; break;
        default:
          if (op === 0xD608 || op === 0xD606) len = (bytes[i] | (bytes[i + 1] << 8)) + 1;
          else if (op === 0xC615 && bytes[i] === 255) {
            const del = bytes[i + 1] || 0;
            const add = bytes[i + 2 + del * 4] || 0;
            len = 1 + 1 + del * 4 + 1 + add * 3;
          } else len = bytes[i] + 1;
      }
      if (i + len > bytes.length) break;
      fn(op, bytes, i, len);
      i += len;
    }
  }
  const S = { ilvl: 0x260A, ilfo: 0x460B, inTable: 0x2416, ttp: 0x2417, outLvl: 0x2640, itap: 0x6649, innerTtp: 0x244C, innerCell: 0x244B };
  function paraSprms(bytes) {
    const p = {};
    if (!bytes) return p;
    eachSprm(bytes, (op, b, i) => {
      if (op === S.ilvl) p.ilvl = b[i];
      else if (op === S.ilfo) p.ilfo = (b[i] | (b[i + 1] << 8)) << 16 >> 16;
      else if (op === S.inTable) p.inTable = !!b[i];
      else if (op === S.ttp) p.ttp = !!b[i];
      else if (op === S.outLvl) p.outLvl = b[i];
      else if (op === S.itap) p.itap = b[i] | (b[i + 1] << 8);
      else if (op === S.innerTtp) p.innerTtp = !!b[i];
      else if (op === S.innerCell) p.innerCell = !!b[i];
      else if (op === 0x2403 || op === 0x2461) p.jc = b[i];
      else if (op === 0xA413) p.before = b[i] | (b[i + 1] << 8);
      else if (op === 0xA414) p.after = b[i] | (b[i + 1] << 8);
      else if (op === 0x6412) { p.line = (b[i] | (b[i + 1] << 8)) << 16 >> 16; p.lineMult = !!(b[i + 2] | (b[i + 3] << 8)); }
    });
    return p;
  }

  // Свойства символов: рисунок (sprmCPicLocation, sprmCFSpec), встроенный объект (sprmCFOle2/sprmCFObj), кегль, полужирный
  function charSprms(bytes) {
    const p = {};
    if (!bytes) return p;
    eachSprm(bytes, (op, b, i) => {
      if (op === 0x6A03) p.picLoc = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
      else if (op === 0x0855) p.spec = !!b[i];
      else if (op === 0x080A || op === 0x085A) p.ole = !!b[i];
      else if (op === 0x0806) p.data = !!b[i];
      else if (op === 0x4A43) p.hps = b[i] | (b[i + 1] << 8);
      else if (op === 0x0835) p.bold = b[i] === 1 || b[i] === 0x81;
      else if (op === 0x0836) p.italic = b[i] === 1 || b[i] === 0x81;
    });
    return p;
  }

  /* ---------- Нумерация ---------- */
  const NFC = { 0: 'decimal', 1: 'upperRoman', 2: 'lowerRoman', 3: 'upperLetter', 4: 'lowerLetter', 5: 'ordinal', 22: 'decimalZero', 23: 'bullet', 58: 'russianLower', 59: 'russianUpper', 255: 'none' };
  const ROMAN = (n) => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; m.forEach(([v, r]) => { while (n >= v) { s += r; n -= v; } }); return s; };
  const RUS = 'абвгдежзиклмнопрстуфхцчшщэюя';
  function fmtNum(n, fmt) {
    switch (fmt) {
      case 'upperRoman': return ROMAN(n).toUpperCase();
      case 'lowerRoman': return ROMAN(n);
      case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1).repeat(Math.floor((n - 1) / 26) + 1);
      case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1).repeat(Math.floor((n - 1) / 26) + 1);
      case 'russianLower': return RUS[(n - 1) % RUS.length].repeat(Math.floor((n - 1) / RUS.length) + 1);
      case 'russianUpper': return RUS[(n - 1) % RUS.length].toUpperCase().repeat(Math.floor((n - 1) / RUS.length) + 1);
      case 'decimalZero': return n < 10 ? `0${n}` : String(n);
      case 'none': return '';
      default: return String(n);
    }
  }

  /* ---------- Сводка документа (название) ---------- */
  function summaryTitle(bytes) {
    try {
      if (!bytes || bytes.length < 48) return '';
      const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const so = d.getUint32(44, true);
      const n = d.getUint32(so + 4, true);
      let cp = 1252;
      let titleAt = -1;
      for (let i = 0; i < n && i < 64; i++) {
        const pid = d.getUint32(so + 8 + i * 8, true);
        const at = so + d.getUint32(so + 12 + i * 8, true);
        if (pid === 1 && d.getUint32(at, true) === 2) cp = d.getUint16(at + 4, true);
        if (pid === 2) titleAt = at;
      }
      if (titleAt < 0) return '';
      const type = d.getUint32(titleAt, true);
      const cnt = d.getUint32(titleAt + 4, true);
      if (type === 0x1F) { let s = ''; for (let k = 0; k < cnt; k++) s += String.fromCharCode(d.getUint16(titleAt + 8 + k * 2, true)); return norm(s.replace(/\0/g, '')); }
      if (type !== 0x1E) return '';
      const raw = bytes.subarray(titleAt + 8, titleAt + 8 + cnt);
      const enc = cp === 65001 ? 'utf-8' : cp === 1200 ? 'utf-16le' : `windows-${cp}`;
      return norm(new TextDecoder(enc).decode(raw).replace(/\0/g, ''));
    } catch { return ''; }
  }

  const CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };

  /* ---------- Документ Word ---------- */
  function parse(buf) {
    let c;
    try { c = cfb(buf); } catch (e) {
      if (e.message === 'NOT_CFB') throw new Error('Файл не похож на документ Word 97–2003. Откройте его в Word и сохраните как .docx или .doc.');
      throw new Error('Файл .doc повреждён: ' + e.message);
    }
    const wd = c.stream('WordDocument');
    if (!wd || wd.length < 0x200) throw new Error('В файле нет текста Word (поток WordDocument). Возможно, это другой документ Office — сохраните его как .docx.');
    const W = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    const ident = W.getUint16(0, true);
    if (ident !== 0xA5EC && ident !== 0xA5DC) throw new Error('Файл не похож на документ Word 97–2003.');
    const nFib = W.getUint16(2, true);
    if (nFib < 0xC1) throw new Error('Документ сохранён в Word 6.0/95 — этот формат не поддерживается. Откройте его в Word и сохраните как .docx.');
    const flags = W.getUint16(0x0A, true);
    if (flags & 0x0100) throw new Error('Документ защищён паролем. Снимите защиту в Word и загрузите файл снова.');
    const tbl = c.stream(flags & 0x0200 ? '1Table' : '0Table');
    if (!tbl) throw new Error('В документе нет таблицы фрагментов текста (поток 0Table/1Table).');
    const T = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    const fib = (o) => (o + 8 <= wd.length ? [W.getUint32(o, true), W.getUint32(o + 4, true)] : [0, 0]);
    const cbRgFcLcb = W.getUint16(0x98, true);
    const ccpText = W.getInt32(0x4C, true);
    const [fcClx, lcbClx] = fib(0x1A2);
    const [fcStshf, lcbStshf] = fib(0xA2);
    const [fcBtePapx, lcbBtePapx] = fib(0x102);
    const [fcPlfLst, lcbPlfLst] = cbRgFcLcb >= 75 ? fib(0x2E2) : [0, 0];
    const [fcPlfLfo, lcbPlfLfo] = cbRgFcLcb >= 75 ? fib(0x2EA) : [0, 0];
    const [fcBteChpx, lcbBteChpx] = fib(0xFA);
    const [fcPlcSpa, lcbPlcSpa] = fib(0x1DA);
    const [fcDgg, lcbDgg] = fib(0x22A);
    const [fcTxbx, lcbTxbx] = fib(0x25A);
    const [fcSed, lcbSed] = fib(0xCA);
    const ccpTxbxStart = ccpText + W.getInt32(0x50, true) + W.getInt32(0x54, true) + W.getInt32(0x5C, true) + W.getInt32(0x60, true);
    const ccpTxbx = W.getInt32(0x64, true);
    const inTbl = (o, n) => o >= 0 && o + n <= tbl.length;

    // 1. Таблица фрагментов: какие участки потока WordDocument составляют текст и в какой кодировке
    let o = fcClx;
    const end = Math.min(fcClx + lcbClx, tbl.length);
    while (o < end && tbl[o] === 0x01) o += 3 + T.getInt16(o + 1, true);
    if (o >= end || tbl[o] !== 0x02) throw new Error('В документе не найдена таблица фрагментов текста — файл повреждён или создан не в Word.');
    const lcb = T.getUint32(o + 1, true);
    const plc = o + 5;
    const nPcd = Math.floor((lcb - 4) / 12);
    const pieces = [];
    for (let i = 0; i < nPcd; i++) {
      const cpStart = T.getUint32(plc + i * 4, true);
      const cpEnd = T.getUint32(plc + (i + 1) * 4, true);
      const raw = T.getUint32(plc + (nPcd + 1) * 4 + i * 8 + 2, true);
      const compressed = (raw & 0x40000000) !== 0;
      pieces.push({ cpStart, cpEnd, fc: compressed ? (raw & 0x3FFFFFFF) / 2 : raw, compressed });
    }

    // 2. Свойства абзацев: страницы FKP (по 512 байт) в потоке WordDocument
    const papx = [];
    if (lcbBtePapx >= 12 && inTbl(fcBtePapx, lcbBtePapx)) {
      const n = Math.floor((lcbBtePapx - 4) / 8);
      for (let i = 0; i < n; i++) {
        const pn = T.getUint32(fcBtePapx + (n + 1) * 4 + i * 4, true) & 0x3FFFFF;
        const po = pn * 512;
        if (po + 512 > wd.length) continue;
        const crun = wd[po + 511];
        for (let k = 0; k < crun; k++) {
          const fcS = W.getUint32(po + k * 4, true);
          const fcE = W.getUint32(po + (k + 1) * 4, true);
          const bOff = wd[po + (crun + 1) * 4 + k * 13] * 2;
          let istd = 0;
          let sprms = null;
          if (bOff) {
            let cb = wd[po + bOff];
            let p = po + bOff + 1;
            let size;
            if (cb === 0) { cb = wd[p]; p++; size = cb * 2; } else size = cb * 2 - 1;
            if (size >= 2 && p + size <= po + 512) { istd = W.getUint16(p, true); sprms = wd.subarray(p + 2, p + size); }
          }
          papx.push({ fcS, fcE, istd, props: paraSprms(sprms) });
        }
      }
      papx.sort((a, b) => a.fcS - b.fcS);
    }
    const papxAt = (fc) => {
      let lo = 0, hi = papx.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const x = papx[mid];
        if (fc < x.fcS) hi = mid - 1; else if (fc >= x.fcE) lo = mid + 1; else return x;
      }
      return null;
    };

    // 2а. Свойства символов: страницы FKP CHPX (рисунки, объекты, кегль)
    const chpx = [];
    if (lcbBteChpx >= 12 && inTbl(fcBteChpx, lcbBteChpx)) {
      const n = Math.floor((lcbBteChpx - 4) / 8);
      for (let i = 0; i < n; i++) {
        const pn = T.getUint32(fcBteChpx + (n + 1) * 4 + i * 4, true) & 0x3FFFFF;
        const po = pn * 512;
        if (po + 512 > wd.length) continue;
        const crun = wd[po + 511];
        for (let k = 0; k < crun; k++) {
          const fcS = W.getUint32(po + k * 4, true);
          const fcE = W.getUint32(po + (k + 1) * 4, true);
          const bOff = wd[po + (crun + 1) * 4 + k] * 2;
          let props = {};
          if (bOff) { const cb = wd[po + bOff]; if (po + bOff + 1 + cb <= po + 512) props = charSprms(wd.subarray(po + bOff + 1, po + bOff + 1 + cb)); }
          chpx.push({ fcS, fcE, props });
        }
      }
      chpx.sort((a, b) => a.fcS - b.fcS);
    }
    const chpxAt = (fc) => {
      let lo = 0, hi = chpx.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const x = chpx[mid];
        if (fc < x.fcS) hi = mid - 1; else if (fc >= x.fcE) lo = mid + 1; else return x.props;
      }
      return {};
    };

    // 3. Стили: имя, встроенный номер (sti 1–9 — «Заголовок 1–9»), наследование, список и уровень структуры
    const styles = [];
    if (lcbStshf > 4 && inTbl(fcStshf, lcbStshf)) {
      const s0 = fcStshf;
      const cbStshi = T.getUint16(s0, true);
      const cstd = T.getUint16(s0 + 2, true);
      const cbBase = T.getUint16(s0 + 4, true) || 10;
      let p = s0 + 2 + cbStshi;
      const sEnd = s0 + lcbStshf;
      for (let i = 0; i < cstd && p + 2 <= sEnd; i++) {
        const cbStd = T.getUint16(p, true);
        p += 2;
        if (!cbStd) { styles.push(null); continue; }
        const st = p;
        p += cbStd;
        if (p > sEnd) break;
        try {
          const sti = T.getUint16(st, true) & 0x0FFF;
          const w1 = T.getUint16(st + 2, true);
          const stk = w1 & 0x0F;
          const istdBase = w1 >> 4;
          const cupx = T.getUint16(st + 4, true) & 0x0F;
          let q = st + cbBase;
          const cch = T.getUint16(q, true);
          q += 2;
          let name = '';
          for (let k = 0; k < cch && q + k * 2 + 2 <= p; k++) name += String.fromCharCode(T.getUint16(q + k * 2, true));
          q += cch * 2 + 2;
          let props = {};
          let chp = {};
          if (stk === 1 && cupx >= 1 && q + 2 <= p) {
            const cbUpx = T.getUint16(q, true);
            if (cbUpx >= 2 && q + 2 + cbUpx <= p) props = paraSprms(tbl.subarray(q + 4, q + 2 + cbUpx));
            let q2 = q + 2 + cbUpx; if (q2 % 2) q2++;
            if (cupx >= 2 && q2 + 2 <= p) { const cb2 = T.getUint16(q2, true); if (cb2 && q2 + 2 + cb2 <= p) chp = charSprms(tbl.subarray(q2 + 2, q2 + 2 + cb2)); }
          }
          styles.push({ sti, stk, istdBase, name: name.split(',')[0], props, chp });
        } catch { styles.push(null); }
      }
    }
    const styleProp = (istd, key, guard = 0) => {
      const s = styles[istd];
      if (!s || guard > 12) return undefined;
      if (s.props[key] !== undefined) return s.props[key];
      return s.istdBase !== 0x0FFF ? styleProp(s.istdBase, key, guard + 1) : undefined;
    };

    // 4. Списки: LSTF и уровни LVL сразу за ними; LFO — экземпляры списков с переопределениями
    const readLvl = (p) => {
      const start = T.getInt32(p, true);
      const nfc = tbl[p + 4];
      const fl = tbl[p + 5];
      const cbChpx = tbl[p + 24];
      const cbPapx = tbl[p + 25];
      let q = p + 28 + cbPapx + cbChpx;
      const cch = T.getUint16(q, true);
      q += 2;
      const xst = [];
      for (let k = 0; k < cch; k++) xst.push(T.getUint16(q + k * 2, true));
      return { lvl: { start, fmt: NFC[nfc] || 'decimal', legal: !!(fl & 4), xst }, next: q + cch * 2 };
    };
    const lists = new Map();
    try {
      if (lcbPlfLst > 2 && inTbl(fcPlfLst, lcbPlfLst)) {
        let p = fcPlfLst;
        const cLst = T.getInt16(p, true);
        p += 2;
        const lstf = [];
        for (let i = 0; i < cLst; i++) { lstf.push({ lsid: T.getInt32(p, true), simple: !!(tbl[p + 26] & 1) }); p += 28; }
        for (const l of lstf) {
          const lv = [];
          for (let k = 0; k < (l.simple ? 1 : 9); k++) { const r = readLvl(p); lv.push(r.lvl); p = r.next; }
          lists.set(l.lsid, lv);
        }
      }
    } catch { /* без списков — нумерация возьмётся из текста, если она там есть */ }
    const lfos = [];
    try {
      if (lcbPlfLfo > 4 && inTbl(fcPlfLfo, 4)) {
        let p = fcPlfLfo;
        const n = T.getInt32(p, true);
        p += 4;
        const head = [];
        for (let i = 0; i < n; i++) { head.push({ lsid: T.getInt32(p, true), clfolvl: tbl[p + 12] }); p += 16; }
        for (const h of head) {
          p += 4;
          const over = {};
          const lvls = {};
          for (let k = 0; k < h.clfolvl; k++) {
            const iStartAt = T.getInt32(p, true);
            const fl = T.getUint32(p + 4, true);
            p += 8;
            const ilvl = fl & 0x0F;
            if (fl & 0x10) over[ilvl] = iStartAt;
            if (fl & 0x20) { const r = readLvl(p); p = r.next; lvls[ilvl] = r.lvl; if (!(fl & 0x10)) over[ilvl] = r.lvl.start; }
          }
          lfos.push({ lsid: h.lsid, over, lvls });
        }
      }
    } catch { /* переопределения списков необязательны */ }

    const counters = new Map();
    const seenLfo = new Set();
    function label(ilfo, ilvl) {
      const lfo = lfos[ilfo - 1];
      if (!lfo) return null;
      const base = lists.get(lfo.lsid);
      if (!base) return null;
      const lvlOf = (i) => lfo.lvls[i] || base[Math.min(i, base.length - 1)];
      const lv = lvlOf(ilvl);
      if (!lv) return null;
      if (lv.fmt === 'bullet') return { bullet: true };
      const c = counters.get(lfo.lsid) || [];
      counters.set(lfo.lsid, c);
      if (!seenLfo.has(ilfo)) {
        seenLfo.add(ilfo);
        Object.keys(lfo.over).forEach((il) => { for (let i = +il; i < 9; i++) c[i] = undefined; });
      }
      const startOf = (i) => (lfo.over[i] ?? (lvlOf(i) ? lvlOf(i).start : 1));
      c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl] + 1;
      for (let i = ilvl + 1; i < 9; i++) c[i] = undefined;
      let text = '';
      for (const ch of lv.xst) {
        if (ch < 9) { const v = c[ch] === undefined ? startOf(ch) : c[ch]; text += fmtNum(v, lv.legal ? 'decimal' : (lvlOf(ch) ? lvlOf(ch).fmt : 'decimal')); } else text += String.fromCharCode(ch);
      }
      text = norm(text);
      if (!text) return null;
      const kind = /letter|russian/i.test(lv.fmt) && !/\d/.test(text) ? 'letter' : /^[\d.\s]+$/.test(text) && /\d/.test(text) ? 'num' : 'other';
      return { text, kind, bullet: false };
    }

    // Символы диапазона CP по таблице фрагментов: fn(ch, fc, cp)
    function eachChar(cpFrom, cpTo, fn) {
      for (const pc of pieces) {
        if (pc.cpEnd <= cpFrom || pc.cpStart >= cpTo) continue;
        const a = Math.max(pc.cpStart, cpFrom), b = Math.min(pc.cpEnd, cpTo);
        for (let cp = a; cp < b; cp++) {
          const fc = pc.fc + (cp - pc.cpStart) * (pc.compressed ? 1 : 2);
          if (fc + (pc.compressed ? 1 : 2) > wd.length) return;
          let ch = pc.compressed ? wd[fc] : wd[fc] | (wd[fc + 1] << 8);
          if (pc.compressed && ch >= 0x80 && ch <= 0x9F) ch = CP1252[ch] || ch;
          fn(ch, fc, cp);
        }
      }
    }

    // Страница: размер и поля последнего раздела (SEPX), в пунктах — для положения плавающих фигур
    const page = { w: 595.3, h: 841.9, left: 85.05, right: 42.55, top: 56.7, bottom: 56.7 };
    try {
      if (lcbSed >= 16 && inTbl(fcSed, lcbSed)) {
        const n = Math.floor((lcbSed - 4) / 16);
        const fcSepx = T.getInt32(fcSed + (n + 1) * 4 + (n - 1) * 12 + 2, true);
        if (fcSepx > 0 && fcSepx + 2 < wd.length) {
          const cb = W.getUint16(fcSepx, true);
          eachSprm(wd.subarray(fcSepx + 2, Math.min(wd.length, fcSepx + 2 + cb)), (op, b, i) => {
            const v = (b[i] | (b[i + 1] << 8)) << 16 >> 16;
            const u = b[i] | (b[i + 1] << 8);
            if (op === 0xB01F) page.w = u / 20; else if (op === 0xB020) page.h = u / 20;
            else if (op === 0xB021) page.left = u / 20; else if (op === 0xB022) page.right = u / 20;
            else if (op === 0x9023) page.top = Math.abs(v) / 20; else if (op === 0x9024) page.bottom = Math.abs(v) / 20;
          });
        }
      }
    } catch { /* поля по умолчанию */ }
    const textW = page.w - page.left - page.right, textH = page.h - page.top - page.bottom;
    let estY = 0;
    const nextPage = (v) => Math.ceil((v + 0.01) / textH) * textH;
    // высота абзаца: строки × межстрочный интервал + интервалы до/после (свойства абзаца → стиль)
    const defHps0 = () => (styles[0] && styles[0].chp && styles[0].chp.hps) || 24;
    function paraHeight(chars, px) {
      const pp = px ? px.props : {};
      const istd = px ? px.istd : 0;
      const g = (k) => pp[k] ?? styleProp(istd, k);
      let hps = defHps0();
      for (let k = istd, guard = 0; styles[k] && guard < 12; k = styles[k].istdBase, guard++) { if (styles[k].chp && styles[k].chp.hps) { hps = styles[k].chp.hps; break; } if (styles[k].istdBase === 0x0FFF) break; }
      const size = hps / 2;
      const lines = Math.max(1, Math.ceil(chars * size * 0.47 / Math.max(100, textW)));
      const natural = size * 1.15;
      const line = g('line');
      let lh = natural;
      if (line) lh = g('lineMult') ? natural * line / 240 : line < 0 ? -line / 20 : Math.max(line / 20, natural);
      return lines * lh + (g('before') || 0) / 20 + (g('after') || 0) / 20;
    }

    // 5. Текст: абзацы до знака абзаца (\r), ячейки таблиц до знака ячейки (\x07); поля — только результат.
    // Рисунки: символ 0x01 (в строке; PICF в потоке Data или объект ObjectPool) и 0x08 (плавающая фигура, PlcSpa) —
    // запоминаются и выводятся блоками {type:'pending'} после своего абзаца.
    const blocks = [];
    let text = '';
    const fields = [];
    let rows = null;
    let row = null;
    let cell = [];
    let inToc = false;
    let pics = [];
    let cellPics = [];
    const flushTable = () => {
      if (row && row.length) rows.push(row);
      const good = (rows || []).filter((r) => r.some((x) => x.lines.length));
      if (good.length) blocks.push({ type: 'table', rows: good });
      const py = estY;
      good.forEach((r) => { const cw = textW / Math.max(1, r.length); estY += Math.max(1, ...r.map((c) => c.lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length * 5.4 / Math.max(30, cw - 10))), 0))) * 13.8 + 4; });
      cellPics.forEach((pc) => blocks.push({ type: 'pending', pic: pc, py }));
      rows = null; row = null; cell = []; cellPics = [];
    };
    function paragraph(t, px) {
      const istd = px ? px.istd : 0;
      const pp = px ? px.props : {};
      const st = styles[istd] || null;
      const sname = st ? st.name : '';
      if ((st && st.sti >= 19 && st.sti <= 27) || /^toc|оглавлен|table of contents/i.test(sname)) return;
      if (/^(оглавление|содержание)$/i.test(t)) { inToc = true; return; }
      if (inToc && /\s\d+$/.test(t) && t.length < 140) return;
      inToc = false;
      let heading = null;
      const outLvl = pp.outLvl ?? styleProp(istd, 'outLvl');
      const hm = sname.match(/^(?:heading|заголовок)\s*(\d)/i);
      if (st && st.sti >= 1 && st.sti <= 9) heading = st.sti;
      else if (hm) heading = +hm[1];
      else if (outLvl !== undefined && outLvl < 3) heading = outLvl + 1;
      else if (/заголовок приложения|appendix/i.test(sname)) heading = 1;
      const b = { type: 'p', text: t, styleName: sname, heading };
      const ilfo = pp.ilfo ?? styleProp(istd, 'ilfo');
      const ilvl = pp.ilvl ?? styleProp(istd, 'ilvl') ?? 0;
      if (ilfo > 0 && ilfo < 0x7FF) {
        const lb = label(ilfo, Math.min(8, ilvl));
        if (lb && lb.bullet) b.bullet = true;
        else if (lb && lb.text) { b.label = lb.text; b.labelKind = lb.kind; }
      }
      if (!b.label && !b.bullet) {
        const m = t.match(/^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/);
        if (m && !/^\d{4}$/.test(m[1]) && !m[1].split('.').slice(1).some((x) => x === '0') && (m[1].match(/\d+/g) || []).length <= 6) { b.label = m[1]; b.labelKind = 'num'; b.text = m[2]; }
        else if (/^[-–—•·▪●○◦]\s+\S/.test(t)) { b.bullet = true; b.text = t.replace(/^[-–—•·▪●○◦]\s+/, ''); }
      }
      blocks.push(b);
    }
    function endMark(ch, fc) {
      const px = papxAt(fc);
      const pp = px ? px.props : {};
      const t = norm(text);
      text = '';
      if (ch === 0x07 || (pp.inTable && (pp.itap || 1) >= 1)) {
        if (!rows) rows = [];
        if (!row) row = [];
        cellPics.push(...pics); pics = [];
        if (ch === 0x07 && pp.ttp) { if (row.length) rows.push(row); row = null; cell = []; return; }
        if (t) cell.push(t);
        if (ch === 0x07) { row.push({ lines: cell }); cell = []; }
        return;
      }
      if (rows) flushTable();
      const py = estY;
      estY += paraHeight(t.length, px);
      if (t) paragraph(t, px);
      pics.forEach((pc) => blocks.push({ type: 'pending', pic: pc, py }));
      pics = [];
      if (ch === 0x0C) estY = nextPage(estY);
    }
    let fieldObj = null;
    const limit = Math.max(0, ccpText);
    eachChar(0, limit, (ch, fc, cp) => {
      if (ch === 0x13) { fields.push('code'); return; }
      if (ch === 0x14) {
        if (fields.length) fields[fields.length - 1] = 'result';
        const cx = chpxAt(fc);
        if (cx.ole && cx.picLoc !== undefined) fieldObj = cx.picLoc;
        return;
      }
      if (ch === 0x15) { fields.pop(); if (!fields.length) fieldObj = null; return; }
      if (ch === 0x0D || ch === 0x07 || ch === 0x0C) { endMark(ch, fc); return; }
      if (fields.length && fields[fields.length - 1] === 'code') return;
      if (ch === 0x01) {
        const cx = chpxAt(fc);
        if (cx.picLoc === undefined || cx.data) return;
        if (cx.ole) pics.push({ kind: 'docpic', obj: cx.picLoc, fc: null });
        else pics.push({ kind: 'docpic', fc: cx.picLoc, obj: fieldObj });
        return;
      }
      if (ch === 0x08) { pics.push({ kind: 'docshape', cp }); return; }
      if (ch === 0x0B || ch === 0x09 || ch === 0xA0) { text += ' '; return; }
      if (ch === 0x1E) { text += '-'; return; }
      if (ch < 0x20 || ch === 0x1F) return; // сноски, мягкий перенос
      text += String.fromCharCode(ch);
    });
    if (norm(text) || pics.length) endMark(0x0D, -1);
    if (rows) flushTable();

    // 6. Рисунки и фигуры: таблица привязок (PlcSpa), надписи (подокумент надписей), OfficeArt (DggInfo)
    let art = null;
    if (blocks.some((b) => b.type === 'pending')) {
      const spa = [];
      try {
        if (lcbPlcSpa >= 30 && inTbl(fcPlcSpa, lcbPlcSpa)) {
          const n = Math.floor((lcbPlcSpa - 4) / 30);
          for (let i = 0; i < n; i++) {
            const o2 = fcPlcSpa + (n + 1) * 4 + i * 26;
            const fl = T.getUint16(o2 + 20, true);
            spa.push({ cp: T.getInt32(fcPlcSpa + i * 4, true), spid: T.getInt32(o2, true), x0: T.getInt32(o2 + 4, true) / 20, y0: T.getInt32(o2 + 8, true) / 20, x1: T.getInt32(o2 + 12, true) / 20, y1: T.getInt32(o2 + 16, true) / 20, bx: (fl >> 1) & 3, by: (fl >> 3) & 3, below: !!(fl & 0x4000) });
          }
        }
      } catch { /* без привязок */ }
      const txbx = [];
      try {
        if (lcbTxbx >= 26 && inTbl(fcTxbx, lcbTxbx) && ccpTxbx > 0) {
          const n = Math.floor((lcbTxbx - 4) / 26);
          const defHps = (styles[0] && styles[0].chp && styles[0].chp.hps) || 24;
          for (let i = 0; i < n; i++) {
            const a = T.getInt32(fcTxbx + i * 4, true), b = T.getInt32(fcTxbx + (i + 1) * 4, true);
            const lid = T.getInt32(fcTxbx + (n + 1) * 4 + i * 22 + 14, true);
            const paras = [];
            let cur = { s: '', hps: null, bold: false };
            const fl = [];
            eachChar(ccpTxbxStart + a, ccpTxbxStart + Math.min(b, ccpTxbx), (ch, fc) => {
              if (ch === 0x13) { fl.push('code'); return; }
              if (ch === 0x14) { if (fl.length) fl[fl.length - 1] = 'result'; return; }
              if (ch === 0x15) { fl.pop(); return; }
              if (ch === 0x0D || ch === 0x07 || ch === 0x0C) {
                const px = papxAt(fc);
                const jc = px ? (px.props.jc ?? styleProp(px.istd, 'jc')) : undefined;
                cur.align = jc === 1 ? 'center' : jc === 2 ? 'right' : 'left';
                paras.push(cur); cur = { s: '', hps: null, bold: false }; return;
              }
              if (fl.length && fl[fl.length - 1] === 'code') return;
              if (ch === 0x0B || ch === 0x09 || ch === 0xA0) { cur.s += ' '; return; }
              if (ch < 0x20) return;
              if (cur.hps === null) { const cx = chpxAt(fc); cur.hps = cx.hps || defHps; cur.bold = !!cx.bold; }
              cur.s += String.fromCharCode(ch);
            });
            if (cur.s) paras.push(cur);
            txbx.push({ spid: lid, paras: paras.filter((x) => norm(x.s)).map((x) => ({ s: norm(x.s), size: (x.hps || defHps) / 2, bold: x.bold, align: x.align || 'left' })) });
          }
        }
      } catch { /* без надписей */ }
      art = { wd, tbl, data: c.stream('Data'), cfb: c, dgg: lcbDgg > 8 && inTbl(fcDgg, lcbDgg) ? tbl.subarray(fcDgg, fcDgg + lcbDgg) : null, spa, txbx, page, defSize: ((styles[0] && styles[0].chp && styles[0].chp.hps) || 24) / 2 };
    }
    const meta = {};
    const title = summaryTitle(c.stream('\u0005SummaryInformation'));
    if (title.length > 3) meta.coreTitle = title;
    return { blocks, meta, art };
  }

  window.ISM = window.ISM || {};
  window.ISM.doc = { parse, cfb };
})();
