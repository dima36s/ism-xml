/* ИСМ XML — рисунки и схемы из документов Word 97–2003 (.doc).
   В .doc рисунки и фигуры хранятся в структурах OfficeArt (MS-ODRAW):
   — рисунок в строке: символ 0x01, PICF в потоке Data, за ним контейнер фигуры и запись BLIP (EMF, WMF, PNG, JPEG, DIB);
   — плавающие фигуры (блок-схемы из автофигур, надписи, линии со стрелками, группы): символ 0x08, привязка PlcSpa
     (номер фигуры и прямоугольник в твипах), описание фигур — в OfficeArtContent потока таблицы (DggInfo):
     тип формы, заливка, линия, стрелки, поворот, группы с собственными координатами, рисунки из хранилища BLIP;
   — текст надписей — в отдельном подокументе (связь по номеру фигуры в PlcftxbxTxt), его готовит doc.js;
   — встроенные объекты (ObjectPool): схема Visio в формате .vsdx (поток Package) отрисовывается visio.js.
   Фигуры рисуются тем же движком, что фигуры .docx (drawingml.js), поэтому схема выглядит одинаково и даёт
   те же надписи, дорожки «Участник — Действие» и требования. */
(() => {
  'use strict';
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const I = [1, 0, 0, 1, 0, 0];

  /* ---------- Записи OfficeArt ---------- */
  function rec(u8, dv, o, limit) {
    if (o + 8 > limit) return null;
    const vi = dv.getUint16(o, true);
    const len = dv.getUint32(o + 4, true);
    return { ver: vi & 0xF, inst: vi >> 4, type: dv.getUint16(o + 2, true), start: o + 8, end: Math.min(limit, o + 8 + len), len };
  }
  function children(u8, dv, r) {
    const out = [];
    for (let o = r.start; o + 8 <= r.end;) { const c = rec(u8, dv, o, r.end); if (!c) break; out.push(c); if (c.end <= o) break; o = c.start + c.len; }
    return out;
  }
  const ARRAYS = new Set([0x0145, 0x0146, 0x0151, 0x0152, 0x0153, 0x0155, 0x0156, 0x0157, 0x0197, 0x01CF, 0x0383]);
  // FOPT: массив свойств (pid → значение) и сложные данные (массивы вершин, имена) сразу за массивом
  function fopt(u8, dv, r, props) {
    const n = r.inst;
    let cx = r.start + n * 6;
    for (let i = 0; i < n; i++) {
      const o = r.start + i * 6;
      if (o + 6 > r.end) break;
      const id = dv.getUint16(o, true);
      const op = dv.getUint32(o + 2, true);
      const pid = id & 0x3FFF;
      const complex = !!(id & 0x8000);
      let data = null;
      if (complex) {
        let len = op;
        // массивы (IMsoArray): длина в op часто не учитывает 6-байтовый заголовок массива
        if (ARRAYS.has(pid) && cx + 6 <= r.end) {
          const ne = dv.getUint16(cx, true), cb = dv.getUint16(cx + 4, true);
          const es = cb === 0xFFF0 ? 4 : cb;
          if (ne * es === op) len = op + 6;
        }
        data = u8.subarray(cx, Math.min(r.end, cx + len)); cx += len;
      }
      props.set(pid, { op, data, bid: !!(id & 0x4000) });
    }
  }
  function shapeOf(u8, dv, r) {
    const node = { spid: 0, spt: 1, flags: 0, props: new Map(), anchor: null, groupRect: null, children: null };
    children(u8, dv, r).forEach((c) => {
      if (c.type === 0xF00A && c.start + 8 <= c.end) { node.spt = c.inst; node.spid = dv.getInt32(c.start, true); node.flags = dv.getUint32(c.start + 4, true); }
      else if (c.type === 0xF00B || c.type === 0xF121 || c.type === 0xF122) fopt(u8, dv, c, node.props);
      else if (c.type === 0xF00F && c.start + 16 <= c.end) node.anchor = [0, 4, 8, 12].map((k) => dv.getInt32(c.start + k, true));
      else if (c.type === 0xF009 && c.start + 16 <= c.end) node.groupRect = [0, 4, 8, 12].map((k) => dv.getInt32(c.start + k, true));
    });
    return node;
  }
  function groupOf(u8, dv, r, shapes) {
    const kids = children(u8, dv, r);
    if (!kids.length) return null;
    const node = shapeOf(u8, dv, kids[0]);
    node.children = [];
    kids.slice(1).forEach((c) => {
      const k = c.type === 0xF003 ? groupOf(u8, dv, c, shapes) : c.type === 0xF004 ? shapeOf(u8, dv, c) : null;
      if (k) { k.z = shapes.size + 1; node.children.push(k); if (k.spid) shapes.set(k.spid, k); }
    });
    if (node.spid) shapes.set(node.spid, node);
    return node;
  }
  // OfficeArtContent: контейнер DGG (хранилище BLIP) и рисунки основного текста (dgglbl = 0)
  function parseArt(art) {
    const shapes = new Map();
    const bse = [];
    const u8 = art.dgg;
    if (!u8 || u8.length < 16) return { shapes, bse };
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 0;
    const dgg = rec(u8, dv, 0, u8.length);
    if (dgg && dgg.type === 0xF000) {
      children(u8, dv, dgg).forEach((c) => {
        if (c.type !== 0xF001) return;
        children(u8, dv, c).forEach((b) => {
          if (b.type !== 0xF007 || b.start + 36 > b.end) { bse.push(null); return; }
          const cbName = u8[b.start + 33];
          const inner = b.start + 36 + cbName;
          bse.push({ type: u8[b.start], size: dv.getUint32(b.start + 20, true), foDelay: dv.getUint32(b.start + 28, true), embedded: inner + 8 <= b.end ? { u8, off: inner, limit: b.end } : null });
        });
      });
      o = dgg.start + dgg.len;
    }
    while (o + 9 <= u8.length) {
      const lbl = u8[o];
      const dg = rec(u8, dv, o + 1, u8.length);
      if (!dg || dg.type !== 0xF002) break;
      if (lbl === 0) children(u8, dv, dg).forEach((c) => { if (c.type === 0xF003) groupOf(u8, dv, c, shapes); });
      o = dg.start + dg.len;
    }
    return { shapes, bse };
  }

  /* ---------- Рисунки BLIP ---------- */
  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch { return null; }
  }
  // Запись BLIP → {bytes, ext}
  async function blipAt(u8, off, limit) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const r = rec(u8, dv, off, Math.min(limit, u8.length));
    if (!r || r.type < 0xF018 || r.type > 0xF117) return null;
    const two = { 0x3D5: 1, 0x217: 1, 0x543: 1, 0x46B: 1, 0x6E3: 1, 0x6E1: 1, 0x7A9: 1, 0x6E5: 1 }[r.inst] ? 16 : 0;
    if (r.type === 0xF01A || r.type === 0xF01B || r.type === 0xF01C) {
      const h = r.start + 16 + two;
      if (h + 34 > r.end) return null;
      const cbSize = dv.getUint32(h, true);
      const bounds = [0, 4, 8, 12].map((k) => dv.getInt32(h + 4 + k, true));
      const ptX = dv.getInt32(h + 20, true);
      const cbSave = dv.getUint32(h + 28, true);
      const compression = u8[h + 32];
      let data = u8.subarray(h + 34, Math.min(r.end, h + 34 + cbSave));
      if (compression === 0) data = (await inflate(data)) || null;
      if (!data) return null;
      if (r.type === 0xF01C) return null; // PICT (Mac) браузер не показывает
      if (r.type === 0xF01A) return { bytes: data, ext: 'emf' };
      // WMF без заголовка Aldus: добавляем его (границы и масштаб — из заголовка метафайла BLIP)
      if (!(data[0] === 0xD7 && data[1] === 0xCD)) {
        const w = Math.max(1, bounds[2] - bounds[0]), hh = Math.max(1, bounds[3] - bounds[1]);
        const inch = ptX > 0 ? Math.max(1, Math.min(65535, Math.round(w * 914400 / ptX))) : 1440;
        const hd = new Uint8Array(22);
        const hv = new DataView(hd.buffer);
        hv.setUint32(0, 0x9AC6CDD7, true); hv.setInt16(6, bounds[0], true); hv.setInt16(8, bounds[1], true); hv.setInt16(10, bounds[0] + w, true); hv.setInt16(12, bounds[1] + hh, true); hv.setUint16(14, inch, true);
        let x = 0; for (let k = 0; k < 10; k++) x ^= hv.getUint16(k * 2, true); hv.setUint16(20, x, true);
        const full = new Uint8Array(22 + data.length); full.set(hd); full.set(data, 22); data = full;
      }
      void cbSize;
      return { bytes: data, ext: 'wmf' };
    }
    const p = r.start + 16 + two + 1;
    if (p >= r.end) return null;
    const data = u8.subarray(p, r.end);
    if (r.type === 0xF01D || r.type === 0xF02A) return { bytes: data, ext: 'jpeg' };
    if (r.type === 0xF01E) return { bytes: data, ext: 'png' };
    if (r.type === 0xF029) return { bytes: data, ext: 'tiff' };
    if (r.type === 0xF01F) { // DIB → BMP
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const biSize = d.getUint32(0, true), bits = d.getUint16(14, true), comp = d.getUint32(16, true), used = d.getUint32(32, true);
      const pal = (used || (bits <= 8 ? 1 << bits : 0)) * 4 + (comp === 3 ? 12 : 0);
      const bmp = new Uint8Array(14 + data.length);
      const bv = new DataView(bmp.buffer);
      bmp[0] = 0x42; bmp[1] = 0x4D; bv.setUint32(2, bmp.length, true); bv.setUint32(10, 14 + biSize + pal, true);
      bmp.set(data, 14);
      return { bytes: bmp, ext: 'bmp' };
    }
    return null;
  }
  async function blipOf(art, model, index) {
    const e = model.bse[index - 1];
    if (!e) return null;
    if (e.embedded) return blipAt(e.embedded.u8, e.embedded.off, e.embedded.limit);
    if (e.foDelay >= 0 && e.foDelay < art.wd.length) return blipAt(art.wd, e.foDelay, art.wd.length);
    return null;
  }
  // BLIP → data: URL (и надписи схемы из метафайла)
  async function blipSrc(b, ctx) {
    if (!b) return null;
    const DF = window.ISM.docxFigures;
    try { return await DF.picture(b.bytes, b.ext, ctx); } catch { return null; }
  }

  /* ---------- Рисунок в строке: PICF в потоке Data ---------- */
  async function inlinePicture(art, fc, ctx) {
    const d = art.data;
    if (!d || fc === null || fc === undefined || fc + 0x44 > d.length) return null;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const lcb = dv.getUint32(fc, true), cbHeader = dv.getUint16(fc + 4, true), mm = dv.getUint16(fc + 6, true);
    if (lcb < cbHeader || fc + lcb > d.length + 16) return null;
    if (mm !== 0x64 && mm !== 0x66) return null; // старые рисунки Word 6 (метафайл без OfficeArt) встречаются редко
    let o = fc + cbHeader;
    if (mm === 0x66) o += 1 + d[o];
    const end = Math.min(d.length, fc + lcb);
    let pib = 1;
    const blips = [];
    while (o + 8 <= end) {
      const r = rec(d, dv, o, end);
      if (!r) break;
      if (r.type === 0xF004) { const sh = shapeOf(d, dv, r); const p = sh.props.get(0x0104); if (p) pib = p.op || 1; }
      else if (r.type === 0xF007 && r.start + 36 <= r.end) { const cbName = d[r.start + 33]; blips.push({ off: r.start + 36 + cbName, limit: r.end }); }
      else if (r.type >= 0xF018 && r.type <= 0xF117) blips.push({ off: o, limit: r.end });
      o = r.start + r.len;
    }
    const b = blips[pib - 1] || blips[0];
    if (!b) return null;
    return blipSrc(await blipAt(d, b.off, b.limit), ctx);
  }

  /* ---------- Встроенный объект: схема Visio .vsdx (ObjectPool/_N/Package) ---------- */
  async function oleVisio(art, obj, ctx) {
    if (obj === null || obj === undefined || !art.cfb.streamPath) return null;
    const pkg = art.cfb.streamPath(['ObjectPool', `_${obj}`, 'Package']);
    if (!pkg || pkg[0] !== 0x50 || pkg[1] !== 0x4B) return null;
    try {
      await ctx.loadScript(ctx.VENDOR.visio);
      const v = await window.ISM.visio.parse(pkg.buffer.slice(pkg.byteOffset, pkg.byteOffset + pkg.byteLength));
      const pages = v.pages.filter((p) => p.svg);
      return pages.length ? pages : null;
    } catch { return null; }
  }

  /* ---------- Плавающие фигуры OfficeArt → SVG ---------- */
  const color = (op, dflt) => {
    if (op === undefined || op === null) return dflt;
    const f = op >>> 24;
    if (f & 0x18) return dflt; // цвет схемы или системный — по умолчанию
    const r = op & 0xFF, g = (op >> 8) & 0xFF, b = (op >> 16) & 0xFF;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  };
  const ARROW = { 1: 'triangle', 2: 'stealth', 3: 'diamond', 4: 'oval', 5: 'arrow', 6: 'arrow', 7: 'arrow' };
  const DASH = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1], 5: [1, 2], 6: [4, 3], 7: [8, 3], 8: [4, 2, 1, 2], 9: [8, 3, 1, 3], 10: [8, 3, 1, 3, 1, 3] };
  // Формулы фигуры (pGuides, MSOSG): значения нужны, когда вершины ссылаются на них (0x80000000 + номер формулы)
  function guidesOf(props) {
    const pg = props.get(0x0156);
    const out = [];
    if (!pg || !pg.data || pg.data.length < 6) return out;
    const dv = new DataView(pg.data.buffer, pg.data.byteOffset, pg.data.byteLength);
    const n = dv.getUint16(0, true);
    const adjOf = (k) => { const p = props.get(0x0147 + k); return p ? p.op | 0 : 0; };
    const geo = (k, d) => { const p = props.get(0x0140 + k); return p ? p.op | 0 : d; };
    for (let i = 0; i < n && 6 + (i + 1) * 8 <= pg.data.length; i++) {
      const o = 6 + i * 8;
      const sgf = dv.getUint16(o, true);
      const op = sgf & 0x1FFF;
      const prm = [1, 2, 3].map((k) => {
        const raw = dv.getUint16(o + k * 2, true);
        if (!(sgf & (0x1000 << k))) return raw << 16 >> 16;
        if (raw >= 0x400 && raw < 0x480) return out[raw - 0x400] ?? 0;
        if (raw >= 0x147 && raw <= 0x150) return adjOf(raw - 0x147);
        if (raw >= 0x140 && raw <= 0x143) return geo(raw - 0x140, raw >= 0x142 ? 21600 : 0);
        return 0;
      });
      const [a, b, c] = prm;
      const deg = (v) => v / 65536 * Math.PI / 180;
      let v = 0;
      switch (op) {
        case 0: v = a + b - c; break;
        case 1: v = c ? a * b / c : 0; break;
        case 2: v = (a + b) / 2; break;
        case 3: v = Math.abs(a); break;
        case 4: v = Math.min(a, b); break;
        case 5: v = Math.max(a, b); break;
        case 6: v = a > 0 ? b : c; break;
        case 7: v = Math.sqrt(a * a + b * b + c * c); break;
        case 8: v = Math.atan2(b, a) * 180 / Math.PI * 65536; break;
        case 9: v = a * Math.sin(deg(b)); break;
        case 10: v = a * Math.cos(deg(b)); break;
        case 11: v = a * Math.cos(Math.atan2(c, b)); break;
        case 12: v = a * Math.sin(Math.atan2(c, b)); break;
        case 13: v = Math.sqrt(Math.max(0, a)); break;
        case 14: v = a + b * 65536 - c * 65536; break;
        case 15: v = b ? c * Math.sqrt(Math.max(0, 1 - (a / b) * (a / b))) : 0; break;
        case 16: v = a * Math.tan(deg(b)); break;
        default: v = 0;
      }
      out.push(v);
    }
    return out;
  }
  // Свободная фигура: вершины (pVertices) и сегменты (pSegmentInfo) в координатах geoLeft..geoRight
  // (если прямоугольник координат не задан — как у LibreOffice — по границам самих вершин)
  function freeform(props, w, h) {
    const pv = props.get(0x0145), ps = props.get(0x0146);
    if (!pv || !pv.data || pv.data.length < 6) return null;
    const dv = new DataView(pv.data.buffer, pv.data.byteOffset, pv.data.byteLength);
    const n = dv.getUint16(0, true);
    let cb = dv.getUint16(4, true);
    const half = cb === 0xFFF0 || cb === 4;
    cb = half ? 4 : 8;
    const guides = guidesOf(props);
    const val = (raw) => { const u = raw >>> 0; if (u >= 0x80000000 && u - 0x80000000 < guides.length) return guides[u - 0x80000000]; return raw | 0; };
    const pts = [];
    for (let i = 0; i < n && 6 + (i + 1) * cb <= pv.data.length; i++) {
      const o = 6 + i * cb;
      pts.push(half ? [dv.getInt16(o, true), dv.getInt16(o + 2, true)] : [val(dv.getInt32(o, true)), val(dv.getInt32(o + 4, true))]);
    }
    if (pts.length < 2) return null;
    let gl = props.has(0x0140) ? props.get(0x0140).op | 0 : 0, gt = props.has(0x0141) ? props.get(0x0141).op | 0 : 0;
    let gr = props.has(0x0142) ? props.get(0x0142).op | 0 : 21600, gb = props.has(0x0143) ? props.get(0x0143).op | 0 : 21600;
    if (gr <= gl) { gl = Math.min(0, ...pts.map((p) => p[0])); gr = Math.max(...pts.map((p) => p[0])); }
    if (gb <= gt) { gt = Math.min(0, ...pts.map((p) => p[1])); gb = Math.max(...pts.map((p) => p[1])); }
    const sx = w / ((gr - gl) || 1), sy = h / ((gb - gt) || 1);
    const P = (p) => `${Math.round((p[0] - gl) * sx * 100) / 100} ${Math.round((p[1] - gt) * sy * 100) / 100}`;
    let d = '';
    let open = true;
    let k = 0;
    let noFill = false;
    if (ps && ps.data && ps.data.length >= 6) {
      const sv = new DataView(ps.data.buffer, ps.data.byteOffset, ps.data.byteLength);
      const ns = sv.getUint16(0, true);
      const scb = sv.getUint16(4, true) === 0xFFF0 ? 2 : (sv.getUint16(4, true) || 2);
      for (let i = 0; i < ns && 6 + (i + 1) * scb <= ps.data.length; i++) {
        const v = sv.getUint16(6 + i * scb, true);
        const type = v >> 13, cnt = v & 0x1FFF;
        if (type === 0) { for (let j = 0; j < Math.max(1, cnt) && k < pts.length; j++) d += ` L${P(pts[k++])}`; }
        else if (type === 1) { for (let j = 0; j < Math.max(1, cnt) && k + 2 < pts.length; j++) { d += ` C${P(pts[k])} ${P(pts[k + 1])} ${P(pts[k + 2])}`; k += 3; } }
        else if (type === 2) { if (k < pts.length) d += ` M${P(pts[k++])}`; }
        else if (type === 3) { d += ' Z'; open = false; }
        else if (type === 4) { /* конец пути */ }
        else { if (((v >> 8) & 0x1F) === 0x0A) noFill = true; for (let j = 0; j < (v & 0xFF) && k < pts.length; j++) d += ` L${P(pts[k++])}`; }
      }
      // вершины остались неиспользованными — сегменты записаны нестандартно (так LibreOffice пишет дуги): рисуем рамку
      if (k < pts.length) return null;
    } else d = `M${P(pts[0])}${pts.slice(1).map((p) => ` L${P(p)}`).join('')}`;
    d = d.trim();
    if (!d) return null;
    if (!/^M/.test(d)) d = `M${P(pts[0])} ${d}`;
    return { d, open: open || noFill };
  }

  function renderShapes(items, art, model, ctx) {
    const DM = window.ISM.drawingml;
    const S = DM.scene({ theme: DM.THEME_DEFAULT, textDefaults: { size: art.defSize || 12, font: 'Times New Roman' }, images: ctx.images });
    const txbx = new Map(art.txbx.map((t) => [t.spid, t]));
    const prop = (node, pid, d) => { const p = node.props.get(pid); return p ? p.op : d; };
    const boolProp = (node, pid, bit, useBit, d) => { const v = node.props.get(pid); if (!v) return d; return v.op & useBit ? !!(v.op & bit) : d; };
    function drawLeaf(node, m, w, h) {
      const name = DM.SPT[node.spt];
      S.grow(m, w, h);
      const adj = {};
      for (let i = 0; i < 10; i++) { const p = node.props.get(0x0147 + i); if (p) adj[i] = (p.op | 0) / 21600 * 100000; }
      let geo = node.spt === 0 || node.spt === 0xFFF || !name ? freeform(node.props, w, h) : null;
      if (!geo) geo = DM.preset(name || 'rect', w, h, adj);
      const pib = prop(node, 0x0104, 0);
      const isLine = !!geo.open || node.spt === 20 || (node.spt >= 32 && node.spt <= 40) || (w < 1.5 || h < 1.5);
      if (pib && ctx.blips[pib]) {
        S.image(ctx.blips[pib], m, w, h);
        if (boolProp(node, 0x01FF, 0x8, 0x80000, false)) S.path(geo, m, null, { c: color(prop(node, 0x01C0), '#000000'), a: 1 }, Math.max(0.25, prop(node, 0x01CB, 9525) / 12700));
        return;
      }
      const filled = !isLine && boolProp(node, 0x01BF, 0x10, 0x100000, true);
      const fill = filled ? { c: color(prop(node, 0x0181), '#FFFFFF'), a: node.props.has(0x0182) ? Math.max(0, Math.min(1, prop(node, 0x0182) / 65536)) : 1 } : null;
      const stroked = boolProp(node, 0x01FF, 0x8, 0x80000, true);
      const stroke = stroked ? { c: color(prop(node, 0x01C0), '#000000'), a: 1 } : null;
      const sw = Math.max(0.25, prop(node, 0x01CB, 9525) / 12700);
      const end = (pid, lenPid) => { const t = ARROW[prop(node, pid, 0)]; return t ? { type: t, size: ['sm', 'med', 'lg'][prop(node, lenPid, 1)] || 'med' } : null; };
      S.path(geo, m, fill, stroke, sw, DASH[prop(node, 0x01CE, 0)] || null, end(0x01D0, 0x01D3), end(0x01D1, 0x01D5));
      if (isLine) S.segment(m, w, h);
      const tb = txbx.get(node.spid);
      if (tb && tb.paras.length) {
        const trc = DM.textRect(name || 'rect', w, h, adj);
        const flow = prop(node, 0x0088, 0);
        const anc = prop(node, 0x0087, 0);
        const ins = (pid, d) => prop(node, pid, d) / 12700;
        S.text(tb.paras.map((p) => ({ runs: [{ s: p.s, size: p.size, bold: p.bold }], align: p.align || 'left' })), DM.mul(m, DM.tr(trc.x, trc.y)), trc.w, trc.h,
          { L: ins(0x0081, 91440), T: ins(0x0082, 45720), R: ins(0x0083, 91440), B: ins(0x0084, 45720), anchor: [1, 4, 7].includes(anc) ? 'ctr' : [2, 5, 8].includes(anc) ? 'b' : 't', vert: flow === 2 ? 'vert270' : flow === 1 || flow === 5 ? 'vert' : null });
      }
    }
    function drawNode(node, M, box) {
      if (node.flags & 0x8) return; // удалённая
      let rot = ((prop(node, 0x0004, 0) | 0) / 65536) % 360;
      if (rot < 0) rot += 360;
      let { w, h } = box;
      const cx = box.x + w / 2, cy = box.y + h / 2;
      if ((rot >= 45 && rot < 135) || (rot >= 225 && rot < 315)) [w, h] = [h, w];
      let m = DM.mul(M, DM.tr(cx, cy));
      if (rot) m = DM.mul(m, DM.rotM(rot));
      m = DM.mul(m, [node.flags & 0x40 ? -1 : 1, 0, 0, node.flags & 0x80 ? -1 : 1, 0, 0]);
      m = DM.mul(m, DM.tr(-w / 2, -h / 2));
      if (node.children) {
        const g = node.groupRect || [0, 0, 1, 1];
        const gw = (g[2] - g[0]) || 1, gh = (g[3] - g[1]) || 1;
        const mc = DM.mul(m, [w / gw, 0, 0, h / gh, -g[0] * w / gw, -g[1] * h / gh]);
        node.children.forEach((k) => { const a = k.anchor; if (a) drawNode(k, mc, { x: a[0], y: a[1], w: a[2] - a[0], h: a[3] - a[1] }); });
        return;
      }
      drawLeaf(node, m, w, h);
    }
    // порядок наложения — как в контейнере рисунка (позже — выше); фигуры «за текстом» — первыми
    items.slice().sort((a, b) => (a.spa.below === b.spa.below ? 0 : a.spa.below ? -1 : 1) || ((model.shapes.get(a.spa.spid) || {}).z || 0) - ((model.shapes.get(b.spa.spid) || {}).z || 0)).forEach((it) => {
      const node = model.shapes.get(it.spa.spid);
      if (!node) return;
      drawNode(node, I, it.box);
    });
    return S.count() ? S.finish() : null;
  }

  // Рамка привязки (PlcSpa) в координатах «потока текста», как у плавающих фигур .docx
  // Система отсчёта: свойства OfficeArt posrelh/posrelv (Word 2000+), иначе — поля bx/by привязки
  function boxOf(spa, py, page, node) {
    const DM = window.ISM.drawingml;
    const w = spa.x1 - spa.x0, h = spa.y1 - spa.y0;
    const ph = node && node.props.get(0x0390), pv = node && node.props.get(0x0392);
    const rh = ph ? ph.op : spa.bx, rv = pv ? pv.op : spa.by;
    const pos = DM.flowPos(page, py, { h: ['margin', 'page', 'column', 'column'][rh] || 'column', v: ['margin', 'page', 'paragraph', 'paragraph'][rv] || 'paragraph' }, spa.x0, spa.y0, null, null, w, h);
    return { x: pos.x, y: pos.y, w, h };
  }
  function collectPibs(node, out) { if (!node) return; const p = node.props.get(0x0104); if (p && p.op) out.add(p.op); (node.children || []).forEach((k) => collectPibs(k, out)); }

  /* ---------- Все рисунки документа ---------- */
  async function resolveAll(blocks, art, ctx) {
    const DF = window.ISM.docxFigures;
    const DM = window.ISM.drawingml;
    const model = parseArt(art);
    ctx.blips = ctx.blips || {};
    ctx.stats = ctx.stats || { images: 0, visio: 0, visioPreview: 0, shapes: 0, skipped: 0 };
    const spaByCp = new Map(art.spa.map((s) => [s.cp, s]));
    // плавающие фигуры: касающиеся рамки — одна схема
    const cand = [];
    blocks.forEach((b, i) => {
      if (b.type !== 'pending' || b.pic.kind !== 'docshape') return;
      const spa = spaByCp.get(b.pic.cp);
      if (!spa || !model.shapes.has(spa.spid)) return;
      const box = boxOf(spa, b.py, art.page, model.shapes.get(spa.spid));
      cand.push({ i, spa, box, x0: box.x, y0: box.y, x1: box.x + Math.max(1, box.w), y1: box.y + Math.max(1, box.h) });
    });
    const parent = cand.map((_, k) => k);
    const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length && b < a + 400; b++) {
      const p = cand[a], q = cand[b];
      if (q.x0 <= p.x1 + 30 && q.x1 >= p.x0 - 30 && q.y0 <= p.y1 + 30 && q.y1 >= p.y0 - 30) parent[find(b)] = find(a);
    }
    const groups = new Map();
    cand.forEach((c, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
    const lead = new Map();
    const skip = new Set();
    groups.forEach((g) => { g.sort((x, y) => x.i - y.i); lead.set(g[0].i, g); g.slice(1).forEach((c) => skip.add(c.i)); });
    // рисунки фигур (BLIP) — заранее
    const pibs = new Set();
    cand.forEach((c) => collectPibs(model.shapes.get(c.spa.spid), pibs));
    for (const p of pibs) { if (!(p in ctx.blips)) { const r = await blipSrc(await blipOf(art, model, p), ctx); ctx.blips[p] = r ? r.src : null; } }
    ctx.images = ctx.blips;
    const out = [];
    const doneObj = new Set();
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== 'pending') { out.push(b); continue; }
      if (skip.has(i)) continue;
      const pic = b.pic;
      try {
        if (pic.kind === 'docshape') {
          const g = lead.get(i);
          if (!g) continue;
          const r = renderShapes(g, art, model, ctx);
          if (r) {
            n++;
            out.push({ type: 'figure', src: `data:image/svg+xml;base64,${DF.b64text(r.svg)}`, alt: `Схема (рисунок ${n})` });
            ctx.stats.shapes++;
            out.push(...DF.diagramBlocks(r.diagram || { lanes: [], labels: [] }));
          }
          continue;
        }
        if (pic.kind === 'docpic') {
          const hasObj = pic.obj !== null && pic.obj !== undefined;
          // встроенная схема Visio .vsdx: картинка — превью объекта (точная копия), текст и дорожки — из схемы
          if (hasObj && !doneObj.has(pic.obj)) {
            const pages = await oleVisio(art, pic.obj, ctx);
            if (pages) {
              doneObj.add(pic.obj);
              const prevPic = pic.fc !== null && pic.fc !== undefined ? pic : (blocks.slice(i + 1, i + 4).find((x) => x.type === 'pending' && x.pic.obj === pic.obj && x.pic.fc !== null && x.pic.fc !== undefined) || {}).pic;
              const prev = prevPic ? await inlinePicture(art, prevPic.fc, ctx) : null;
              pages.forEach((p, k) => { n++; const src = k === 0 && prev ? prev.src : `data:image/svg+xml;base64,${DF.b64text(p.svg)}`; out.push({ type: 'figure', src, alt: `Схема Visio${pages.length > 1 ? ` «${p.name}»` : ''} (рисунок ${n})` }); out.push(...DF.diagramBlocks({ lanes: p.lanes, labels: p.texts })); });
              ctx.stats.visio++;
              continue;
            }
          }
          if (hasObj && doneObj.has(pic.obj)) continue;
          if (pic.fc === null || pic.fc === undefined) continue;
          const r = await inlinePicture(art, pic.fc, ctx);
          if (r) {
            n++;
            out.push({ type: 'figure', src: r.src, alt: `${pic.obj !== null && pic.obj !== undefined ? 'Встроенный объект' : 'Рисунок'} ${n}` });
            if (r.diagram) out.push(...DF.diagramBlocks(r.diagram));
            if (pic.obj !== null && pic.obj !== undefined) ctx.stats.visioPreview++; else ctx.stats.images++;
          } else ctx.stats.skipped++;
        }
      } catch (err) {
        ctx.stats.skipped++;
        console.warn('Рисунок .doc не перенесён:', err);
      }
    }
    void DM;
    return out;
  }

  window.ISM = window.ISM || {};
  window.ISM.docFigures = { resolveAll, parseArt, blipAt, inlinePicture };
})();
