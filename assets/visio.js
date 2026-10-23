/* ИСМ XML — чтение схем Visio (.vsdx, .vsdm) прямо в браузере.
   .vsdx — архив Open Packaging: visio/pages/pageN.xml (фигуры страницы), visio/masters/masterN.xml (мастер-фигуры
   трафаретов), visio/document.xml (стили). Каждая страница отрисовывается в SVG: геометрия фигур (линии, дуги, кривые,
   эллипсы), заливка, линии и стрелки, текст с переносом по ширине текстового блока, группы и рисунки.
   Значения ячеек берутся из фигуры, затем из её мастер-фигуры, затем из стилей — как в Visio.
   Для документа ИСМ собирается текст фигур: дорожки (кто) и шаги внутри них (что делает), остальные надписи по порядку. */
(() => {
  'use strict';
  const NSV = 'http://schemas.microsoft.com/office/visio/2012/main';
  const NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PT = 72; // единица SVG — пункт; в Visio длины в дюймах
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const r2 = (x) => Math.round(x * 100) / 100;
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const PALETTE = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#E6E6E6', '#CDCDCD', '#B3B3B3', '#9A9A9A', '#808080', '#666666', '#4D4D4D', '#333333', '#1A1A1A'];
  function color(v) {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
    if (/^\d+$/.test(s)) return PALETTE[+s] || null;
    const m = s.match(/^RGB\((\d+),\s*(\d+),\s*(\d+)\)$/i);
    if (m) return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
    return null;
  }

  /* ---------- Листы фигур: ячейки, разделы, геометрия, текст ---------- */
  function rowCells(row) { const c = {}; kids(row, 'Cell').forEach((x) => { c[x.getAttribute('N')] = x.getAttribute('V'); }); return c; }
  function sheetOf(el) {
    const s = { el, id: el.getAttribute('ID'), cells: {}, sec: {}, geom: {}, text: null, shapes: [], foreign: null, attrs: {} };
    for (const a of ['Type', 'Master', 'MasterShape', 'LineStyle', 'FillStyle', 'TextStyle', 'NameU', 'Name', 'Del']) s.attrs[a] = el.getAttribute(a);
    for (const ch of el.children) {
      const ln = ch.localName;
      if (ln === 'Cell') s.cells[ch.getAttribute('N')] = ch.getAttribute('V');
      else if (ln === 'Section') {
        const n = ch.getAttribute('N');
        if (n === 'Geometry') {
          const g = { cells: rowCells(ch), rows: {}, del: ch.getAttribute('Del') === '1' };
          kids(ch, 'Row').forEach((r) => { g.rows[r.getAttribute('IX')] = { T: r.getAttribute('T'), cells: rowCells(r), del: r.getAttribute('Del') === '1' }; });
          s.geom[ch.getAttribute('IX') || '0'] = g;
        } else {
          const rows = {};
          kids(ch, 'Row').forEach((r, i) => { rows[r.getAttribute('IX') ?? r.getAttribute('N') ?? String(i)] = rowCells(r); });
          s.sec[n] = rows;
        }
      } else if (ln === 'Text') s.text = ch;
      else if (ln === 'Shapes') s.shapes = kids(ch, 'Shape');
      else if (ln === 'ForeignData') s.foreign = ch;
    }
    return s;
  }

  // Путь внутри пакета: «../media/image1.png» относительно visio/pages/
  function resolve(dir, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (dir + target).split('/');
    const out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  let measureCtx = null;
  function textWidth(str, size, font, bold, italic) {
    if (!measureCtx) { const c = document.createElement('canvas'); measureCtx = c.getContext('2d'); }
    measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px ${font ? `"${font}", ` : ''}Arial, sans-serif`;
    return measureCtx.measureText(str).width * size / 100;
  }

  async function parse(buf) {
    if (!window.JSZip) throw new Error('JSZip не загружен');
    let zip;
    try { zip = await window.JSZip.loadAsync(buf); } catch { throw new Error('Файл не открывается как схема Visio .vsdx. Старый формат .vsd нужно пересохранить в Visio как .vsdx.'); }
    const xml = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const relsOf = async (p) => {
      const dir = p.slice(0, p.lastIndexOf('/') + 1);
      const r = await xml(`${dir}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`);
      const m = {};
      if (r) Array.from(r.getElementsByTagName('Relationship')).forEach((e) => { m[e.getAttribute('Id')] = resolve(dir, e.getAttribute('Target')); });
      return m;
    };
    const pagesX = await xml('visio/pages/pages.xml');
    if (!pagesX) throw new Error('В архиве нет страниц Visio (visio/pages/pages.xml) — это не схема .vsdx.');
    const pagesRels = await relsOf('visio/pages/pages.xml');

    // Стили документа и шрифты
    const docX = await xml('visio/document.xml');
    const styles = {};
    const faces = {};
    if (docX) {
      Array.from(docX.getElementsByTagNameNS(NSV, 'StyleSheet')).forEach((st) => { const s = sheetOf(st); styles[s.id] = s; });
      Array.from(docX.getElementsByTagNameNS(NSV, 'FaceName')).forEach((f) => { faces[f.getAttribute('ID')] = f.getAttribute('NameU') || f.getAttribute('Name'); });
    }
    // Мастер-фигуры
    const masters = {};
    const mastersX = await xml('visio/masters/masters.xml');
    if (mastersX) {
      const mrels = await relsOf('visio/masters/masters.xml');
      for (const m of Array.from(mastersX.getElementsByTagNameNS(NSV, 'Master'))) {
        const rel = kid(m, 'Rel');
        const path = rel && mrels[rel.getAttributeNS(NSR, 'id') || rel.getAttribute('r:id')];
        const mx = path ? await xml(path) : null;
        const shapes = {};
        const top = [];
        const index = (els, into) => els.forEach((el) => { const s = sheetOf(el); shapes[s.id] = s; into.push(s); s.kids = []; index(s.shapes, s.kids); });
        if (mx) index(kids(kid(mx.documentElement, 'Shapes'), 'Shape'), top);
        masters[m.getAttribute('ID')] = { name: m.getAttribute('NameU') || m.getAttribute('Name') || '', shapes, top, rels: path ? await relsOf(path) : {} };
      }
    }
    const images = {};
    async function imageData(path) {
      if (images[path] !== undefined) return images[path];
      const f = zip.file(path);
      const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext];
      images[path] = f && type ? `data:${type};base64,${await f.async('base64')}` : null;
      return images[path];
    }

    // Значение ячейки: фигура → мастер-фигура → стиль (по цепочке родительских стилей)
    const LINE = /^(Line|BeginArrow|EndArrow|Rounding)/;
    const FILL = /^(Fill|Shdw)/;
    function styleCell(styleId, name, kind, guard = 0) {
      const st = styles[styleId];
      if (!st || guard > 16) return undefined;
      if (st.cells[name] !== undefined) return st.cells[name];
      const parent = st.attrs[kind] ?? st.attrs.LineStyle;
      return parent != null && parent !== styleId ? styleCell(parent, name, kind, guard + 1) : undefined;
    }
    function cellOf(s, name) {
      for (let x = s; x; x = x.master) if (x.cells[name] !== undefined) return x.cells[name];
      const kind = LINE.test(name) ? 'LineStyle' : FILL.test(name) ? 'FillStyle' : 'TextStyle';
      for (let x = s; x; x = x.master) { const id = x.attrs[kind]; if (id != null) { const v = styleCell(id, name, kind); if (v !== undefined) return v; } }
      return styleCell('0', name, kind);
    }
    function secRow(s, sec, ix) {
      const out = {};
      const chain = [];
      for (let x = s; x; x = x.master) chain.unshift(x);
      const kind = 'TextStyle';
      const styleRow = (id, guard = 0) => { const st = styles[id]; if (!st || guard > 16) return {}; const parent = st.attrs[kind]; return { ...(parent != null && parent !== id ? styleRow(parent, guard + 1) : {}), ...((st.sec[sec] || {})[ix] || (st.sec[sec] || {})['0'] || {}) }; };
      const sid = chain.map((x) => x.attrs.TextStyle).filter((x) => x != null).pop();
      Object.assign(out, styleRow(sid ?? '0'));
      chain.forEach((x) => Object.assign(out, (x.sec[sec] || {})[ix] || {}));
      return out;
    }
    function geometry(s) {
      const secs = {};
      const chain = [];
      for (let x = s; x; x = x.master) chain.unshift(x);
      chain.forEach((x) => Object.entries(x.geom).forEach(([ix, g]) => {
        if (g.del) { delete secs[ix]; return; }
        const cur = secs[ix] || (secs[ix] = { cells: {}, rows: {} });
        Object.assign(cur.cells, g.cells);
        Object.entries(g.rows).forEach(([rix, r]) => {
          if (r.del) { delete cur.rows[rix]; return; }
          const cr = cur.rows[rix] || (cur.rows[rix] = { T: r.T, cells: {} });
          if (r.T) cr.T = r.T;
          Object.assign(cr.cells, r.cells);
        });
      }));
      return Object.keys(secs).sort((a, b) => a - b).map((k) => secs[k]);
    }

    /* ---------- Матрицы: локальные координаты фигуры (дюймы, ось Y вверх) → страница ---------- */
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    function localMatrix(s) {
      const v = (n, d = 0) => num(cellOf(s, n), d);
      const w = v('Width'), h = v('Height');
      const a = v('Angle');
      const fx = v('FlipX') ? -1 : 1, fy = v('FlipY') ? -1 : 1;
      const cos = Math.cos(a), sin = Math.sin(a);
      let m = [1, 0, 0, 1, v('PinX'), v('PinY')];
      m = mul(m, [cos, sin, -sin, cos, 0, 0]);
      m = mul(m, [fx, 0, 0, fy, 0, 0]);
      return mul(m, [1, 0, 0, 1, -num(cellOf(s, 'LocPinX'), w / 2), -num(cellOf(s, 'LocPinY'), h / 2)]);
    }

    /* ---------- Геометрия → путь SVG ---------- */
    function arcPoints(x0, y0, x1, y1, bow, n = 16) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0;
      const c = Math.hypot(dx, dy);
      if (Math.abs(bow) < 1e-9 || c < 1e-9) return [[x1, y1]];
      const nx = -dy / c, ny = dx / c; // нормаль к хорде; дуга выгибается на bow в сторону -нормали (как в Visio)
      const mx = cx - nx * bow, my = cy - ny * bow;
      return threePointArc(x0, y0, mx, my, x1, y1, n);
    }
    function threePointArc(x0, y0, xm, ym, x1, y1, n = 16) {
      const d = 2 * (x0 * (ym - y1) + xm * (y1 - y0) + x1 * (y0 - ym));
      if (Math.abs(d) < 1e-12) return [[x1, y1]];
      const ux = ((x0 * x0 + y0 * y0) * (ym - y1) + (xm * xm + ym * ym) * (y1 - y0) + (x1 * x1 + y1 * y1) * (y0 - ym)) / d;
      const uy = ((x0 * x0 + y0 * y0) * (x1 - xm) + (xm * xm + ym * ym) * (x0 - x1) + (x1 * x1 + y1 * y1) * (xm - x0)) / d;
      const r = Math.hypot(x0 - ux, y0 - uy);
      const a0 = Math.atan2(y0 - uy, x0 - ux), am = Math.atan2(ym - uy, xm - ux), a1 = Math.atan2(y1 - uy, x1 - ux);
      const norm2 = (a) => { while (a < 0) a += 2 * Math.PI; while (a >= 2 * Math.PI) a -= 2 * Math.PI; return a; };
      let sweep = norm2(a1 - a0);
      if (norm2(am - a0) > sweep) sweep -= 2 * Math.PI; // средняя точка должна лежать на дуге
      const pts = [];
      for (let i = 1; i <= n; i++) { const a = a0 + sweep * i / n; pts.push([ux + r * Math.cos(a), uy + r * Math.sin(a)]); }
      pts[pts.length - 1] = [x1, y1];
      return pts;
    }
    // Эллиптическая дуга Visio: через текущую точку, контрольную (a,b) и конечную; угол большой оси c, отношение осей d
    function ellArcPoints(x0, y0, x1, y1, a, b, ang, ratio) {
      if (!ratio) return [[x1, y1]];
      const cos = Math.cos(-ang), sin = Math.sin(-ang);
      const to = (x, y) => [(x * cos - y * sin) / ratio, x * sin + y * cos];
      const back = (x, y) => { const xx = x * ratio; return [xx * Math.cos(ang) - y * Math.sin(ang), xx * Math.sin(ang) + y * Math.cos(ang)]; };
      const p0 = to(x0, y0), pm = to(a, b), p1 = to(x1, y1);
      return threePointArc(p0[0], p0[1], pm[0], pm[1], p1[0], p1[1], 20).map(([x, y]) => back(x, y));
    }
    function ellipsePoints(cx, cy, ax, ay, bx, by, n = 36) {
      const pts = [];
      for (let i = 0; i <= n; i++) { const t = 2 * Math.PI * i / n; pts.push([cx + (ax - cx) * Math.cos(t) + (bx - cx) * Math.sin(t), cy + (ay - cy) * Math.cos(t) + (by - cy) * Math.sin(t)]); }
      return pts;
    }
    const formulaNums = (f) => (String(f || '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);

    function pathFor(s, toSvg) {
      const w = num(cellOf(s, 'Width')), h = num(cellOf(s, 'Height'));
      const out = [];
      for (const g of geometry(s)) {
        if (g.cells.NoShow === '1') continue;
        let d = '';
        let start = null, cur = [0, 0], prev = null;
        let segs = 0;
        const P = (x, y) => { const p = toSvg(x, y); return `${r2(p[0])} ${r2(p[1])}`; };
        const lineTo = (x, y) => { d += ` L${P(x, y)}`; prev = cur; cur = [x, y]; segs++; };
        const rows = Object.keys(g.rows).sort((a, b) => a - b).map((k) => g.rows[k]);
        for (const r of rows) {
          const c = r.cells;
          const X = num(c.X), Y = num(c.Y), A = num(c.A), B = num(c.B), C = num(c.C), D = num(c.D);
          const rel = /^Rel/.test(r.T || '');
          const sx = (v) => (rel ? v * w : v), sy = (v) => (rel ? v * h : v);
          switch (r.T) {
            case 'MoveTo': case 'RelMoveTo':
              cur = [sx(X), sy(Y)]; start = cur; d += ` M${P(...cur)}`; break;
            case 'LineTo': case 'RelLineTo': lineTo(sx(X), sy(Y)); break;
            case 'ArcTo': arcPoints(cur[0], cur[1], X, Y, A).forEach(([x, y]) => lineTo(x, y)); break;
            case 'EllipticalArcTo': case 'RelEllipticalArcTo':
              ellArcPoints(cur[0], cur[1], sx(X), sy(Y), sx(A), sy(B), C, D).forEach(([x, y]) => lineTo(x, y)); break;
            case 'RelCubBezTo':
              d += ` C${P(A * w, B * h)} ${P(C * w, D * h)} ${P(X * w, Y * h)}`; prev = [C * w, D * h]; cur = [X * w, Y * h]; segs++; break;
            case 'RelQuadBezTo':
              d += ` Q${P(A * w, B * h)} ${P(X * w, Y * h)}`; prev = [A * w, B * h]; cur = [X * w, Y * h]; segs++; break;
            case 'Ellipse': {
              const pts = ellipsePoints(X, Y, A, B, C, D);
              d += ` M${P(...pts[0])}${pts.slice(1).map((p) => ` L${P(...p)}`).join('')} Z`; start = null; segs += pts.length; break;
            }
            case 'PolylineTo': {
              const n = formulaNums(c.A !== undefined ? r.cells.A : '');
              const f = String(r.cells.A || '');
              const relPts = /POLYLINE\(\s*0\s*,\s*0/i.test(f);
              const nums = n.slice(2);
              for (let i = 0; i + 1 < nums.length; i += 2) lineTo(relPts ? nums[i] * w : nums[i], relPts ? nums[i + 1] * h : nums[i + 1]);
              lineTo(X, Y); break;
            }
            case 'NURBSTo': {
              const nums = formulaNums(r.cells.E).slice(4);
              const relPts = /NURBS\([^,]*,[^,]*,\s*0\s*,\s*0/i.test(String(r.cells.E || ''));
              for (let i = 0; i + 3 < nums.length; i += 4) lineTo(relPts ? nums[i] * w : nums[i], relPts ? nums[i + 1] * h : nums[i + 1]);
              lineTo(X, Y); break;
            }
            case 'SplineStart': case 'SplineKnot': lineTo(X, Y); break;
            default: break;
          }
        }
        if (!d) continue;
        const closed = start && Math.hypot(cur[0] - start[0], cur[1] - start[1]) < 1e-6 && segs > 1;
        if (closed) d += ' Z';
        out.push({ d: d.trim(), closed: closed || /Z$/.test(d.trim()), noFill: g.cells.NoFill === '1', noLine: g.cells.NoLine === '1', prev, cur });
      }
      return out;
    }

    /* ---------- Текст фигуры ---------- */
    function textRuns(s) {
      const src = s.text || (() => { for (let x = s.master; x; x = x.master) if (x.text) return x.text; return null; })();
      if (!src) return [];
      const owner = s.text ? s : (() => { for (let x = s.master; x; x = x.master) if (x.text) return x; return s; })();
      const paras = [{ text: '', cp: '0', pp: '0' }];
      let cp = '0', pp = '0';
      const fieldVal = (ix) => { const row = (owner.sec.Field || {})[ix] || (s.sec.Field || {})[ix]; return row && row.Value != null ? String(row.Value) : ''; };
      for (const n of src.childNodes) {
        if (n.nodeType === 3) {
          const parts = n.nodeValue.split(/\r\n|\n|\r|\u2028|\u2029/);
          parts.forEach((t, i) => { if (i) paras.push({ text: '', cp, pp }); paras[paras.length - 1].text += t; });
        } else if (n.nodeType === 1) {
          if (n.localName === 'cp') { cp = n.getAttribute('IX') || '0'; if (!paras[paras.length - 1].text) paras[paras.length - 1].cp = cp; }
          else if (n.localName === 'pp') { pp = n.getAttribute('IX') || '0'; if (!paras[paras.length - 1].text) paras[paras.length - 1].pp = pp; }
          else if (n.localName === 'tp') paras[paras.length - 1].text += ' ';
          else if (n.localName === 'fld') paras[paras.length - 1].text += fieldVal(n.getAttribute('IX') || '0') || n.textContent || '';
        }
      }
      while (paras.length && !norm(paras[paras.length - 1].text)) paras.pop();
      return paras;
    }
    function wrap(str, max, size, font, bold, italic) {
      const words = str.split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      for (const wd of words) {
        const cand = line ? `${line} ${wd}` : wd;
        if (!line || textWidth(cand, size, font, bold, italic) <= max) { line = cand; continue; }
        lines.push(line);
        line = wd;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }

    /* ---------- Страница ---------- */
    async function renderPage(pageEl, pageX, rels, background) {
      const ps = sheetOf(kid(pageEl, 'PageSheet') || pageEl);
      const pw = num(ps.cells.PageWidth, 8.5), ph = num(ps.cells.PageHeight, 11);
      const toSvg = (m) => (x, y) => { const p = apply(m, x, y); bbox(p[0], p[1]); return [p[0] * PT, (ph - p[1]) * PT]; };
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const bbox = (x, y) => { if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y; };
      const svg = [];
      const markers = new Map();
      const items = []; // надписи для документа ИСМ
      const marker = (col, size, start) => {
        const key = `${col}-${size}-${start ? 's' : 'e'}`;
        if (!markers.has(key)) {
          const id = `ah${markers.size + 1}`;
          const k = [0.5, 0.75, 1, 1.25, 1.6, 2, 2.6][Math.max(0, Math.min(6, size))] * 6;
          markers.set(key, { id, svg: `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${r2(k)}" markerHeight="${r2(k)}" markerUnits="userSpaceOnUse" orient="${start ? 'auto-start-reverse' : 'auto'}"><path d="M0 0L10 5L0 10z" fill="${col}"/></marker>` });
        }
        return markers.get(key).id;
      };
      async function drawShape(el, parentM, masterCtx, depth) {
        const s = sheetOf(el);
        // мастер-фигура: у верхней фигуры — первая фигура мастера, у вложенной — по MasterShape
        const mid = s.attrs.Master ?? (masterCtx ? masterCtx.id : null);
        const mst = mid != null ? masters[mid] : null;
        if (mst) {
          if (s.attrs.MasterShape != null) s.master = mst.shapes[s.attrs.MasterShape] || null;
          else if (s.attrs.Master != null) s.master = mst.top.length === 1 ? mst.top[0] : mst.top[0] || null;
        }
        if (cellOf(s, 'Del') === '1') return;
        const m = mul(parentM, localMatrix(s));
        const w = num(cellOf(s, 'Width')), h = num(cellOf(s, 'Height'));
        const oneD = cellOf(s, 'BeginX') !== undefined && cellOf(s, 'EndX') !== undefined;
        const hidden = num(cellOf(s, 'Visible'), 1) === 0;
        if (!hidden) {
          // Рисунок (Foreign)
          if (s.attrs.Type === 'Foreign' && s.foreign) {
            const rel = kid(s.foreign, 'Rel');
            const rid = rel && (rel.getAttributeNS(NSR, 'id') || rel.getAttribute('r:id'));
            const path = rid && (rels[rid] || (mst && mst.rels[rid]));
            const data = path ? await imageData(path) : null;
            const iw = num(cellOf(s, 'ImgWidth'), w), ih = num(cellOf(s, 'ImgHeight'), h);
            const ix = num(cellOf(s, 'ImgOffsetX')), iy = num(cellOf(s, 'ImgOffsetY'));
            const t = mul(m, [1, 0, 0, -1, ix, iy + ih]);
            [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y]) => { const p = apply(m, x, y); bbox(p[0], p[1]); });
            const sm = [t[0] * PT, -t[1] * PT, t[2] * PT, -t[3] * PT, t[4] * PT, (ph - t[5]) * PT];
            if (data) svg.push(`<image href="${data}" x="0" y="0" width="${r2(iw)}" height="${r2(ih)}" preserveAspectRatio="none" transform="matrix(${sm.map((x) => r2(x * 1000) / 1000).join(' ')})"/>`);
          }
          // Геометрия
          const lineCol = color(cellOf(s, 'LineColor')) || '#000000';
          const linePat = num(cellOf(s, 'LinePattern'), 1);
          const lineW = Math.max(0.25, num(cellOf(s, 'LineWeight'), 0.01) * PT);
          const fillPat = num(cellOf(s, 'FillPattern'), 1);
          const fillCol = color(cellOf(s, 'FillForegnd')) || '#FFFFFF';
          const fillTr = num(cellOf(s, 'FillForegndTrans'), 0);
          const lineTr = num(cellOf(s, 'LineColorTrans'), 0);
          const dash = linePat > 1 ? ({ 2: [4, 3], 3: [1, 2], 4: [4, 2, 1, 2], 9: [8, 3], 10: [2, 2], 16: [8, 3, 2, 3] }[linePat] || [4, 3]).map((x) => r2(x * Math.max(1, lineW))) : null;
          const begA = num(cellOf(s, 'BeginArrow')), endA = num(cellOf(s, 'EndArrow'));
          const paths = pathFor(s, toSvg(m));
          paths.forEach((p, i) => {
            const fill = p.closed && !p.noFill && fillPat > 0 ? fillCol : 'none';
            const stroke = p.noLine || linePat === 0 ? 'none' : lineCol;
            if (fill === 'none' && stroke === 'none') return;
            let attrs = `d="${p.d}" fill="${fill}" stroke="${stroke}"`;
            if (fill !== 'none' && fillTr > 0) attrs += ` fill-opacity="${r2(1 - fillTr)}"`;
            if (stroke !== 'none') {
              attrs += ` stroke-width="${r2(lineW)}" stroke-linejoin="round"`;
              if (lineTr > 0) attrs += ` stroke-opacity="${r2(1 - lineTr)}"`;
              if (dash) attrs += ` stroke-dasharray="${dash.join(' ')}"`;
              if (!p.closed && begA > 0 && i === 0) attrs += ` marker-start="url(#${marker(lineCol, num(cellOf(s, 'BeginArrowSize'), 2), true)})"`;
              if (!p.closed && endA > 0 && i === paths.length - 1) attrs += ` marker-end="url(#${marker(lineCol, num(cellOf(s, 'EndArrowSize'), 2), false)})"`;
            }
            svg.push(`<path ${attrs}/>`);
          });
        }
        // Вложенные фигуры группы: из страницы или, если их там нет, из мастера
        const childEls = s.shapes.length ? s.shapes : (s.master && s.master.shapes && s.master.shapes.length && s.attrs.Type === 'Group' ? s.master.shapes : []);
        const ctx = mid != null ? { id: mid } : masterCtx;
        for (const ch of childEls) await drawShape(ch, m, ctx, depth + 1);
        // Текст
        if (!hidden && num(cellOf(s, 'HideText')) !== 1) {
          const paras = textRuns(s);
          const plain = norm(paras.map((p) => p.text).join(' '));
          if (plain) {
            const tw = num(cellOf(s, 'TxtWidth'), w), th = num(cellOf(s, 'TxtHeight'), h);
            const tm = mul(m, mul([1, 0, 0, 1, num(cellOf(s, 'TxtPinX'), w / 2), num(cellOf(s, 'TxtPinY'), h / 2)],
              mul([Math.cos(num(cellOf(s, 'TxtAngle'))), Math.sin(num(cellOf(s, 'TxtAngle'))), -Math.sin(num(cellOf(s, 'TxtAngle'))), Math.cos(num(cellOf(s, 'TxtAngle'))), 0, 0],
                [1, 0, 0, 1, -num(cellOf(s, 'TxtLocPinX'), tw / 2), -num(cellOf(s, 'TxtLocPinY'), th / 2)])));
            let t = mul(tm, [1, 0, 0, -1, 0, th]); // в блоке текста ось Y вниз
            if (t[0] * t[3] - t[1] * t[2] > 0) t = mul(t, [-1, 0, 0, 1, tw, 0]); // зеркальная фигура — текст не переворачиваем
            const L = num(cellOf(s, 'LeftMargin'), 0.0556), R = num(cellOf(s, 'RightMargin'), 0.0556), Tm = num(cellOf(s, 'TopMargin'), 0.0556), Bm = num(cellOf(s, 'BottomMargin'), 0.0556);
            const va = num(cellOf(s, 'VerticalAlign'), 1);
            const lines = [];
            for (const p of paras) {
              const ch = secRow(s, 'Character', p.cp);
              const pa = secRow(s, 'Paragraph', p.pp);
              const size = Math.max(0.02, num(ch.Size, 0.1667));
              const fv = ch.Font;
              const font = fv == null ? 'Calibri' : /^\d+$/.test(fv) ? (faces[fv] || 'Calibri') : fv === 'Themed' ? 'Calibri' : fv;
              const st = num(ch.Style);
              const bold = !!(st & 1), italic = !!(st & 2), under = !!(st & 4);
              const col = color(ch.Color) || '#000000';
              const align = num(pa.HorzAlign, 1);
              wrap(norm(p.text), Math.max(0.1, tw - L - R), size, font, bold, italic).forEach((ln) => lines.push({ ln, size, font, bold, italic, under, col, align }));
            }
            const total = lines.reduce((a, l) => a + l.size * 1.2, 0);
            let y = va === 0 ? Tm : va === 2 ? th - Bm - total : (th - total) / 2;
            const sm = [t[0] * PT, -t[1] * PT, t[2] * PT, -t[3] * PT, t[4] * PT, (ph - t[5]) * PT];
            const spans = lines.map((l) => {
              y += l.size * 1.2;
              const x = l.align === 0 ? L : l.align === 2 ? tw - R : tw / 2;
              const anchor = l.align === 0 ? 'start' : l.align === 2 ? 'end' : 'middle';
              return `<tspan x="${r2(x * 1000) / 1000}" y="${r2((y - l.size * 0.27) * 1000) / 1000}" font-size="${r2(l.size * 1000) / 1000}" font-family="${esc(l.font)}, Arial, sans-serif" fill="${l.col}" text-anchor="${anchor}"${l.bold ? ' font-weight="bold"' : ''}${l.italic ? ' font-style="italic"' : ''}${l.under ? ' text-decoration="underline"' : ''}>${esc(l.ln)}</tspan>`;
            }).join('');
            // Фон текста (подписи соединителей в Visio обычно на белом фоне)
            const bgv = cellOf(s, 'TextBkgnd');
            const bgc = bgv && bgv !== '0' ? (color(/^\d+$/.test(bgv) ? String(+bgv - 1) : bgv) || null) : null;
            const tr = num(cellOf(s, 'TextBkgndTrans'), 0);
            let bgRect = '';
            if (bgc && tr < 1 && lines.length) {
              const wmax = Math.max(...lines.map((l) => textWidth(l.ln, l.size, l.font, l.bold, l.italic)));
              const al = lines[0].align;
              const bx = al === 0 ? L : al === 2 ? tw - R - wmax : (tw - wmax) / 2;
              const by = y - total;
              bgRect = `<rect x="${r2((bx - 0.02) * 1000) / 1000}" y="${r2((by) * 1000) / 1000}" width="${r2((wmax + 0.04) * 1000) / 1000}" height="${r2(total * 1000) / 1000}" fill="${bgc}"${tr > 0 ? ` fill-opacity="${r2(1 - tr)}"` : ''}/>`;
            }
            svg.push(`<g transform="matrix(${sm.map((x) => r2(x * 1000) / 1000).join(' ')})">${bgRect}<text>${spans}</text></g>`);
            [[0, 0], [tw, 0], [tw, th], [0, th]].forEach(([x, yy]) => { const p = apply(tm, x, yy); bbox(p[0], p[1]); });
            if (!background) {
              const c = apply(m, w / 2, h / 2);
              const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, yy]) => apply(m, x, yy));
              const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
              const cats = Object.values(s.sec.User || {}).concat(s.master ? Object.values(s.master.sec.User || {}) : []).map((r) => String(r.Value || '')).join(' ');
              items.push({ text: plain, x: c[0], y: c[1], x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), oneD, depth,
                master: `${(mst && mst.name) || ''} ${s.attrs.NameU || ''} ${(s.master && s.master.attrs.NameU) || ''} ${cats}` });
            }
          }
        }
      }
      if (background) for (const el of kids(kid(background.documentElement, 'Shapes'), 'Shape')) await drawShape(el, [1, 0, 0, 1, 0, 0], null, 0);
      const bgCount = svg.length;
      for (const el of kids(kid(pageX.documentElement, 'Shapes'), 'Shape')) await drawShape(el, [1, 0, 0, 1, 0, 0], null, 0);
      if (svg.length === bgCount && !items.length) return { width: pw, height: ph, svg: '', items };
      // Рамка: содержимое с полями, но не меньше нужного для подписи
      const pad = 0.15;
      const x0 = Number.isFinite(box.x0) ? box.x0 - pad : 0, x1 = Number.isFinite(box.x1) ? box.x1 + pad : pw;
      const y0 = Number.isFinite(box.y0) ? box.y0 - pad : 0, y1 = Number.isFinite(box.y1) ? box.y1 + pad : ph;
      const vb = [x0 * PT, (ph - y1) * PT, (x1 - x0) * PT, (y1 - y0) * PT].map(r2);
      const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}"><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#FFFFFF"/>${markers.size ? `<defs>${[...markers.values()].map((x) => x.svg).join('')}</defs>` : ''}${svg.join('')}</svg>`;
      return { width: vb[2], height: vb[3], svg: out, items };
    }

    const pageList = Array.from(pagesX.getElementsByTagNameNS(NSV, 'Page'));
    const byId = {};
    for (const p of pageList) {
      const rel = kid(p, 'Rel');
      const path = rel && pagesRels[rel.getAttributeNS(NSR, 'id') || rel.getAttribute('r:id')];
      byId[p.getAttribute('ID')] = { el: p, path };
    }
    const pages = [];
    for (const p of pageList) {
      if (p.getAttribute('Background') === '1') continue;
      const info = byId[p.getAttribute('ID')];
      if (!info.path) continue;
      const px = await xml(info.path);
      if (!px) continue;
      const rels = await relsOf(info.path);
      let bg = null;
      const back = p.getAttribute('BackPage');
      if (back != null && byId[back] && byId[back].path) bg = await xml(byId[back].path);
      const r = await renderPage(p, px, rels, bg);
      pages.push({ name: p.getAttribute('Name') || p.getAttribute('NameU') || `Страница ${pages.length + 1}`, ...r, ...layout(r.items) });
    }
    if (!pages.length) throw new Error('В схеме Visio нет страниц с фигурами.');
    const core = await xml('docProps/core.xml');
    const title = core ? norm((core.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0] || {}).textContent || '') : '';
    return { pages, meta: title.length > 3 ? { title } : {} };
  }

  /* ---------- Текст схемы для документа ИСМ ---------- */
  // Дорожки (кто) и шаги внутри них (что делает); остальные надписи — сверху вниз, слева направо
  const LANE = /swimlane|(?<![a-z])lane|дорожк|полос[аы]|pool|(?<![а-я])пул(?![а-я])|функциональн\S* полос|cff container|участник/i;
  const SKIP = /phase|separator|разделител|фаз[аы]|title|заголов|legend|легенд|cff container|container/i;
  function layout(items) {
    const lanes = items.filter((i) => !i.oneD && LANE.test(i.master) && !/cff container|container|phase|фаз/i.test(i.master) && (i.x1 - i.x0) * (i.y1 - i.y0) > 0.5);
    const used = new Set(lanes);
    const laneOf = (it) => lanes.filter((l) => l !== it && it.x >= l.x0 && it.x <= l.x1 && it.y >= l.y0 && it.y <= l.y1).sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
    const steps = new Map(lanes.map((l) => [l, []]));
    const order = (a, b) => (Math.abs(a.y - b.y) > 0.15 ? b.y - a.y : a.x - b.x);
    const rest = [];
    items.slice().sort(order).forEach((it) => {
      if (used.has(it)) return;
      const lane = !it.oneD && !SKIP.test(it.master) && !/\?\s*$/.test(it.text) && it.text.length >= 3 ? laneOf(it) : null;
      if (lane) steps.get(lane).push(it.text);
      else if (!it.oneD && it.text.length >= 2) rest.push(it.text);
    });
    // шаги в дорожке — по ходу процесса: для горизонтальных дорожек слева направо
    lanes.forEach((l) => {
      const horizontal = (l.x1 - l.x0) >= (l.y1 - l.y0);
      const its = items.filter((it) => steps.get(l).includes(it.text) && laneOf(it) === l);
      its.sort((a, b) => (horizontal ? a.x - b.x || b.y - a.y : b.y - a.y || a.x - b.x));
      steps.set(l, [...new Set(its.map((i) => i.text))]);
    });
    return {
      lanes: lanes.sort(order).map((l) => ({ name: l.text, steps: steps.get(l) })).filter((l) => l.steps.length),
      texts: [...new Set(rest)],
    };
  }

  window.ISM = window.ISM || {};
  window.ISM.visio = { parse };
})();
