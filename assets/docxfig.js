/* ИСМ XML — рисунки и схемы из документов Word (.docx).
   Находит в абзацах рисунки (DrawingML и VML), встроенные объекты OLE (схемы Visio) и надписи (текстовые поля фигур).
   Превращает их в блоки документа ИСМ: рисунок — на своём месте в тексте; встроенная схема Visio .vsdx отрисовывается
   по-настоящему (visio.js) и даёт дорожки и шаги; метафайлы EMF/WMF (так Word хранит вставленные схемы и превью
   объектов) переводятся в SVG; текст надписей и схем — в список «Надписи на схеме» и в требования. */
(() => {
  'use strict';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const V = 'urn:schemas-microsoft-com:vml';
  const O = 'urn:schemas-microsoft-com:office:office';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const SVGB = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const inFallback = (el) => { for (let x = el.parentNode; x && x.nodeType === 1; x = x.parentNode) if (x.localName === 'Fallback' && x.namespaceURI === MC) return true; return false; };
  const within = (el, ns, name) => { for (let x = el.parentNode; x && x.nodeType === 1; x = x.parentNode) if (x.localName === name && x.namespaceURI === ns) return true; return false; };
  const rid = (el, ...names) => { for (const n of names) { const v = el && (el.getAttributeNS(R, n) || el.getAttribute(`r:${n}`)); if (v) return v; } return ''; };

  // Текст надписей (текстовых полей фигур) внутри элемента
  function boxTexts(el) {
    const out = [];
    Array.from(el.getElementsByTagNameNS(W, 'txbxContent')).filter((x) => !inFallback(x)).forEach((tb) => {
      Array.from(tb.getElementsByTagNameNS(W, 'p')).forEach((p) => {
        let s = '';
        Array.from(p.getElementsByTagNameNS(W, 't')).forEach((t) => { s += t.textContent; });
        s = norm(s);
        if (s) out.push(s);
      });
    });
    return out;
  }

  const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
  const WPC = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
  const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
  const CH = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const VML_SHAPES = ['group', 'rect', 'roundrect', 'oval', 'line', 'polyline', 'curve', 'arc', 'shape'];
  // Рисунки абзаца: {kind:'image'|'ole'|'shapes'|'smartart'|'chart', rid, ole, prog, alt, texts, el, floating}
  function findPics(p) {
    const out = [];
    const seen = new Set();
    Array.from(p.getElementsByTagNameNS(W, 'drawing')).filter((d) => !inFallback(d)).forEach((d) => {
      const floating = !!d.getElementsByTagNameNS(WP, 'anchor')[0];
      const gd = d.getElementsByTagNameNS(A, 'graphicData')[0];
      const root = gd && Array.from(gd.children)[0];
      const pr = d.getElementsByTagNameNS(WP, 'docPr')[0];
      const alt = pr ? norm(pr.getAttribute('descr') || pr.getAttribute('title') || '') : '';
      const texts = boxTexts(d);
      if (root && root.namespaceURI === DGM && root.localName === 'relIds') { out.push({ kind: 'smartart', dm: rid(root, 'dm'), alt, texts, el: d, floating }); return; }
      if (root && root.namespaceURI === CH && root.localName === 'chart') { out.push({ kind: 'chart', rid: rid(root, 'id'), alt, texts, el: d, floating }); return; }
      const shapes = d.getElementsByTagNameNS(WPS, 'wsp').length || d.getElementsByTagNameNS(WPG, 'wgp').length || d.getElementsByTagNameNS(WPC, 'wpc').length;
      if (shapes) { out.push({ kind: 'shapes', alt, texts, el: d, floating }); return; }
      const svgb = d.getElementsByTagNameNS(SVGB, 'svgBlip')[0];
      const blip = d.getElementsByTagNameNS(A, 'blip')[0];
      const id = rid(svgb, 'embed') || rid(blip, 'embed', 'link');
      if (id && !seen.has(id)) { seen.add(id); out.push({ kind: 'image', rid: id, alt, texts, el: d, floating }); }
    });
    Array.from(p.getElementsByTagNameNS(W, 'object')).filter((o) => !inFallback(o)).forEach((o) => {
      const ole = o.getElementsByTagNameNS(O, 'OLEObject')[0];
      const img = o.getElementsByTagNameNS(V, 'imagedata')[0];
      const id = rid(img, 'id');
      if (id) seen.add(id);
      out.push({ kind: 'ole', rid: id, ole: rid(ole, 'id'), prog: ole ? ole.getAttribute('ProgID') || '' : '', alt: '', texts: [] });
    });
    Array.from(p.getElementsByTagNameNS(W, 'pict')).filter((x) => !inFallback(x) && !within(x, W, 'object')).forEach((pc) => {
      const top = Array.from(pc.children).filter((c) => c.namespaceURI === V && c.localName !== 'shapetype');
      if (!top.length) return;
      const floating = top.some((c) => /position\s*:\s*absolute/i.test(c.getAttribute('style') || ''));
      const texts = boxTexts(pc);
      const imgs = Array.from(pc.getElementsByTagNameNS(V, 'imagedata'));
      // одиночный рисунок VML (v:shape с v:imagedata) — как картинка; группы и автофигуры — отрисовка VML
      const isPicture = top.length === 1 && top[0].localName !== 'group' && imgs.length === 1 && !texts.length;
      const id = imgs.length ? rid(imgs[0], 'id') : '';
      if (isPicture && id && !seen.has(id)) { seen.add(id); out.push({ kind: 'image', rid: id, alt: norm(imgs[0].getAttributeNS(O, 'title') || ''), texts, el: pc, floating }); }
      else if (!isPicture && top.some((c) => VML_SHAPES.includes(c.localName))) out.push({ kind: 'shapes', alt: '', texts, el: pc, floating });
    });
    return out;
  }

  /* ---------- Надписи схемы → дорожки и шаги ---------- */
  // Тексты из EMF/SVG (ось Y вниз) переводятся в координаты «как в PDF» и разбираются тем же способом, что схемы PDF
  function diagramFromTexts(texts, w, h, els = []) {
    const PF = window.ISM.pdfFigures;
    if (!PF || !texts.length) return { lanes: [], labels: texts.map((t) => norm(t.s)).filter((s) => s.length >= 3) };
    const items = texts.map((t) => {
      const a = (-t.angle || 0) * Math.PI / 180; // угол против часовой стрелки при оси Y вверх
      const s = t.size || 10;
      return { s: t.s, t: [Math.cos(a) * s, Math.sin(a) * s, -Math.sin(a) * s, Math.cos(a) * s, t.x, -t.y], w: t.w || t.s.length * s * 0.5, h: s };
    });
    const r = PF.readDiagram(items, { x0: -1, y0: -h - 1, x1: w + 1, y1: 1 }, els || []);
    return { lanes: r.lanes, labels: r.labels };
  }
  function diagramBlocks(d) {
    const out = [];
    if (d.lanes && d.lanes.length) out.push({ type: 'table', rows: [[{ lines: ['Участник'] }, { lines: ['Действие'] }], ...d.lanes.map((l) => [{ lines: [l.name] }, { lines: l.steps }])] });
    if (d.labels && d.labels.length) { out.push({ type: 'p', text: 'Надписи на схеме:' }); d.labels.forEach((x) => out.push({ type: 'p', text: x, bullet: true })); }
    return out;
  }

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const b64text = (str) => b64(new TextEncoder().encode(str));
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
  // Крупные растровые рисунки уменьшаются, чтобы документ в базе не разрастался
  async function rasterSrc(u8, mime) {
    const src = `data:${mime};base64,${b64(u8)}`;
    if (u8.length < 700000 || mime === 'image/svg+xml' || mime === 'image/gif') return src;
    try {
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });
      const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
    } catch { return src; }
  }
  // WMF: WMFJS; текст в старых метафайлах — однобайтовый, WMFJS читает его как Latin-1, перекодируем в cp1251
  function fixWmfText(svgEl) {
    Array.from(svgEl.getElementsByTagName('text')).forEach((t) => {
      const s = t.textContent;
      if (/[À-ÿ]/.test(s) && !/[Ā-￿]/.test(s)) t.textContent = new TextDecoder('windows-1251').decode(Uint8Array.from(s, (c) => c.charCodeAt(0) & 255));
    });
  }

  // Настоящий формат рисунка — по первым байтам (LibreOffice, например, сохраняет EMF под именем .wmf); .emz/.wmz — gzip
  async function gunzip(u8) {
    if (typeof DecompressionStream === 'undefined') return null;
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  function sniff(u8) {
    if (u8.length < 8) return '';
    const b = (i) => u8[i];
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'png';
    if (b(0) === 0xFF && b(1) === 0xD8) return 'jpeg';
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'gif';
    if (b(0) === 0x42 && b(1) === 0x4D) return 'bmp';
    if (b(0) === 0x1F && b(1) === 0x8B) return 'gz';
    if ((b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2A) || (b(0) === 0x4D && b(1) === 0x4D && b(3) === 0x2A)) return 'tiff';
    if (b(0) === 0x3C) return 'svg';
    if (u8.length > 44 && b(0) === 1 && b(1) === 0 && b(2) === 0 && b(3) === 0 && b(40) === 0x20 && b(41) === 0x45 && b(42) === 0x4D && b(43) === 0x46) return 'emf';
    if (b(0) === 0xD7 && b(1) === 0xCD && b(2) === 0xC6 && b(3) === 0x9A) return 'wmf';
    if ((b(0) === 1 || b(0) === 2) && b(1) === 0 && b(2) === 9 && b(3) === 0) return 'wmf';
    return '';
  }
  // Рисунок из архива → {src, diagram} или null
  async function picture(u8, ext, ctx) {
    let kind = sniff(u8) || ext;
    if (kind === 'gz') { const raw = await gunzip(u8); if (!raw) return null; u8 = raw; kind = sniff(u8) || (ext === 'emz' ? 'emf' : ext === 'wmz' ? 'wmf' : ''); }
    if (kind === 'svg' && !MIME[ext]) kind = ext;
    if (MIME[kind]) return { src: await rasterSrc(u8, MIME[kind]), diagram: null };
    return metafile(u8, kind, ctx);
  }

  async function metafile(u8, ext, ctx) {
    if (ext === 'emf' || ext === 'emz') {
      await ctx.loadScript(ctx.VENDOR.emf);
      const r = window.ISM.emf.render(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
      return { src: `data:image/svg+xml;base64,${b64text(r.svg)}`, diagram: diagramFromTexts(r.texts, r.width, r.height) };
    }
    if (ext === 'wmf' || ext === 'wmz') {
      await ctx.loadScript(ctx.VENDOR.wmfjs);
      const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      const dv = new DataView(buf);
      let w = 600, h = 400;
      if (dv.getUint32(0, true) === 0x9AC6CDD7) { const inch = dv.getUint16(14, true) || 1440; w = Math.max(1, Math.round((dv.getInt16(10, true) - dv.getInt16(6, true)) / inch * 96)); h = Math.max(1, Math.round((dv.getInt16(12, true) - dv.getInt16(8, true)) / inch * 96)); }
      const el = new window.WMFJS.Renderer(buf).render({ width: `${w}px`, height: `${h}px`, xExt: w, yExt: h, mapMode: 8 });
      fixWmfText(el);
      const texts = Array.from(el.getElementsByTagName('text')).map((t) => norm(t.textContent)).filter((s) => s.length >= 3);
      return { src: `data:image/svg+xml;base64,${b64text(new XMLSerializer().serializeToString(el))}`, diagram: { lanes: [], labels: [...new Set(texts)] } };
    }
    return null;
  }

  const extOf = (path) => ((path || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const partFile = async (ctx, id) => { const path = id && ctx.rels[id]; const f = path && ctx.zip.file(path); return f ? { path, u8: await f.async('uint8array') } : null; };
  const readXml = async (zip, path) => { const f = path && zip.file(path); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };

  // Картинка по rId → data: URL (растр — как есть или уменьшенный, EMF/WMF — SVG); для рисунков внутри групп и полотен
  async function imageSrc(id, ctx) {
    ctx.images = ctx.images || {};
    if (id in ctx.images) return ctx.images[id];
    let src = null;
    try {
      const f = await partFile(ctx, id);
      if (f) src = ((await picture(f.u8, extOf(f.path), ctx)) || {}).src || null;
    } catch { src = null; }
    ctx.images[id] = src;
    return src;
  }
  async function preloadImages(els, ctx) {
    const ids = new Set();
    els.forEach((el) => {
      Array.from(el.getElementsByTagNameNS(A, 'blip')).forEach((b) => { const id = rid(b, 'embed'); if (id) ids.add(id); });
      Array.from(el.getElementsByTagNameNS(V, 'imagedata')).forEach((b) => { const id = rid(b, 'id'); if (id) ids.add(id); });
    });
    for (const id of ids) await imageSrc(id, ctx);
  }

  // Тема (цвета схем), шрифт и кегль по умолчанию, поля страницы — один раз на документ
  async function prepare(ctx) {
    if (ctx.prepared) return;
    ctx.prepared = true;
    const DM = window.ISM.drawingml;
    ctx.theme = Object.assign({}, DM ? DM.THEME_DEFAULT : {});
    try {
      const tp = Object.values(ctx.rels).find((x) => /theme\/theme\d*\.xml$/i.test(x)) || 'word/theme/theme1.xml';
      const th = await readXml(ctx.zip, tp);
      const cs = th && th.getElementsByTagNameNS(A, 'clrScheme')[0];
      if (cs) Array.from(cs.children).forEach((c) => { const v = c.children[0]; if (!v) return; const hex = v.localName === 'sysClr' ? v.getAttribute('lastClr') : v.getAttribute('val'); if (hex && /^[0-9a-f]{6}$/i.test(hex)) ctx.theme[c.localName] = hex.toUpperCase(); });
      let font = null;
      const fs = th && th.getElementsByTagNameNS(A, 'minorFont')[0];
      const lat = fs && fs.getElementsByTagNameNS(A, 'latin')[0];
      if (lat) font = lat.getAttribute('typeface');
      let size = 11;
      const st = await readXml(ctx.zip, 'word/styles.xml');
      if (st) {
        const dd = st.getElementsByTagNameNS(W, 'rPrDefault')[0];
        const val = (el, name) => { const x = el && el.getElementsByTagNameNS(W, name)[0]; return x; };
        const apply = (rPr) => {
          if (!rPr) return;
          const sz = val(rPr, 'sz'); if (sz) size = (+(sz.getAttributeNS(W, 'val') || sz.getAttribute('w:val')) || 22) / 2;
          const rf = val(rPr, 'rFonts'); const a = rf && (rf.getAttributeNS(W, 'ascii') || rf.getAttribute('w:ascii') || rf.getAttributeNS(W, 'hAnsi')); if (a) font = a;
        };
        apply(dd);
        const normal = Array.from(st.getElementsByTagNameNS(W, 'style')).find((x) => (x.getAttributeNS(W, 'type') || x.getAttribute('w:type')) === 'paragraph' && /^(1|true)$/.test(x.getAttributeNS(W, 'default') || x.getAttribute('w:default') || ''));
        if (normal) apply(Array.from(normal.children).find((c) => c.localName === 'rPr'));
      }
      ctx.textDefaults = { size, font: font || 'Calibri' };
    } catch { ctx.textDefaults = ctx.textDefaults || { size: 11, font: 'Calibri' }; }
    if (!ctx.page) ctx.page = pageOf(ctx.doc);
  }

  // Поля и размер страницы (последний w:sectPr тела документа), в пунктах
  function pageOf(doc) {
    const DM = window.ISM.drawingml;
    const page = Object.assign({}, DM ? DM.PAGE_DEFAULT : { w: 595.3, h: 841.9, left: 85.05, right: 42.55, top: 56.7, bottom: 56.7 });
    try {
      const body = doc && doc.getElementsByTagNameNS(W, 'body')[0];
      const sp = body && Array.from(body.children).reverse().find((c) => c.localName === 'sectPr');
      const tw = (el, a) => { const v = el && (el.getAttributeNS(W, a) || el.getAttribute(`w:${a}`)); return v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v / 20 : null; };
      const sz = sp && Array.from(sp.children).find((c) => c.localName === 'pgSz');
      const mar = sp && Array.from(sp.children).find((c) => c.localName === 'pgMar');
      if (sz) { page.w = tw(sz, 'w') || page.w; page.h = tw(sz, 'h') || page.h; }
      if (mar) ['left', 'right', 'top', 'bottom'].forEach((k) => { const v = tw(mar, k); if (v !== null) page[k] = Math.abs(v); });
    } catch { /* поля по умолчанию */ }
    return page;
  }
  // Оценка вертикального положения абзацев («поток текста» без настоящей вёрстки): нужна, чтобы собрать
  // плавающие фигуры, привязанные к разным абзацам, в одну схему. Разрывы страниц Word (lastRenderedPageBreak) уточняют оценку.
  // Высота строки и интервалы абзаца: sp = {before, after (твипы), line, lineRule, size (pt)}
  function paraHeight(chars, page, sp) {
    const textW = page.w - page.left - page.right;
    const size = (sp && sp.size) || 12;
    const lines = Math.max(1, Math.ceil(chars * size * 0.47 / Math.max(100, textW)));
    const natural = size * 1.15;
    let lh = natural;
    if (sp && sp.line) {
      if (sp.lineRule === 'exact') lh = sp.line / 20;
      else if (sp.lineRule === 'atLeast') lh = Math.max(sp.line / 20, natural);
      else lh = natural * sp.line / 240;
    }
    return lines * lh + ((sp && sp.before) || 0) / 20 + ((sp && sp.after) || 0) / 20;
  }
  function advance(y, p, text, page, sp) {
    const textH = page.h - page.top - page.bottom;
    const nextPage = (v) => Math.ceil((v + 0.01) / textH) * textH;
    let py = y;
    const pPr = Array.from(p.children).find((c) => c.localName === 'pPr');
    if (pPr && Array.from(pPr.children).some((c) => c.localName === 'pageBreakBefore' && !/^(0|false)$/.test(c.getAttributeNS(W, 'val') || ''))) py = nextPage(py);
    let breakAtStart = false, breakInside = false, seenText = false;
    for (const el of p.getElementsByTagNameNS(W, '*')) {
      if (el.localName === 't' && el.textContent.trim()) seenText = true;
      const isBreak = el.localName === 'lastRenderedPageBreak' || (el.localName === 'br' && (el.getAttributeNS(W, 'type') || el.getAttribute('w:type')) === 'page');
      if (isBreak) { if (!seenText) breakAtStart = true; else breakInside = true; }
      if (el.localName === 'txbxContent') break;
    }
    if (breakAtStart && py > 0) py = nextPage(py - 1);
    const size = (sp && sp.size) || 12;
    let h = paraHeight((text || '').length, page, sp || { size: 12, line: 240, lineRule: 'auto', before: 0, after: 80 });
    Array.from(p.getElementsByTagNameNS(WP, 'inline')).forEach((il) => { const ex = il.getElementsByTagNameNS(WP, 'extent')[0]; if (ex) h += (+ex.getAttribute('cy') || 0) / 12700; });
    let next = py + h;
    if (breakInside) next = nextPage(py) + size * 1.2;
    return { py, next };
  }
  function advanceTable(y, rows, page) {
    const textW = page.w - page.left - page.right;
    let h = 0;
    rows.forEach((r) => {
      const cw = textW / Math.max(1, r.length);
      h += Math.max(1, ...r.map((c) => c.lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length * 5.4 / Math.max(30, cw - 10))), 0))) * 13.8 + 4;
    });
    return y + h;
  }

  // SmartArt: готовый рисунок (drawingN.xml) из связи dsp:dataModelExt, иначе — текст узлов
  async function smartArt(pic, ctx, n) {
    const out = [];
    const dataPath = ctx.rels[pic.dm];
    const data = await readXml(ctx.zip, dataPath);
    const texts = [];
    if (data) Array.from(data.getElementsByTagNameNS(DGM, 'pt')).forEach((pt) => {
      const type = pt.getAttribute('type') || 'node';
      if (type !== 'node' && type !== 'asst') return;
      const t = norm(Array.from(pt.getElementsByTagNameNS(A, 't')).map((x) => x.textContent).join(' '));
      if (t) texts.push(t);
    });
    let drawRel = null;
    if (data) { const ext = Array.from(data.getElementsByTagName('*')).find((e) => e.localName === 'dataModelExt'); drawRel = ext && ext.getAttribute('relId'); }
    const drawDoc = drawRel ? await readXml(ctx.zip, ctx.rels[drawRel]) : null;
    if (drawDoc && window.ISM.drawingml) {
      const ex = pic.el.getElementsByTagNameNS(WP, 'extent')[0];
      const ext = ex ? { w: (+ex.getAttribute('cx') || 0) / 12700, h: (+ex.getAttribute('cy') || 0) / 12700 } : null;
      const r = window.ISM.drawingml.render(pic.el, { ...ctx, smartArt: drawDoc, smartArtExt: ext });
      if (r) { out.push({ type: 'figure', src: `data:image/svg+xml;base64,${b64text(r.svg)}`, alt: pic.alt || `Схема SmartArt (рисунок ${n})` }); ctx.stats.shapes++; }
    }
    out.push(...diagramBlocks({ lanes: [], labels: [...new Set(texts)] }));
    return out;
  }
  // Диаграмма Excel в документе: заголовок, ряды и категории — текстом (числа диаграммы требований не содержат)
  async function chart(pic, ctx) {
    const x = await readXml(ctx.zip, ctx.rels[pic.rid]);
    if (!x) return [];
    const title = norm(Array.from((x.getElementsByTagNameNS(CH, 'title')[0] || { getElementsByTagNameNS: () => [] }).getElementsByTagNameNS(A, 't')).map((t) => t.textContent).join(' '));
    const sers = Array.from(x.getElementsByTagNameNS(CH, 'ser')).map((sr) => { const tx = sr.getElementsByTagNameNS(CH, 'tx')[0]; return tx ? norm(Array.from(tx.getElementsByTagNameNS(CH, 'v')).map((v) => v.textContent).join(' ')) : ''; }).filter(Boolean);
    const cat = x.getElementsByTagNameNS(CH, 'cat')[0];
    const cats = cat ? [...new Set(Array.from(cat.getElementsByTagNameNS(CH, 'v')).map((v) => norm(v.textContent)).filter(Boolean))] : [];
    const out = [{ type: 'p', text: `Диаграмма${title ? ` «${title}»` : ''}${sers.length ? `: ${sers.join('; ')}` : ''}.` }];
    if (cats.length) out.push({ type: 'p', text: `Категории диаграммы: ${cats.join('; ')}.` });
    return out;
  }

  // Блоки для одного найденного рисунка
  async function resolve(pic, ctx) {
    const out = [];
    const file = (id) => partFile(ctx, id);
    const n = ++ctx.count;
    try {
      if (pic.kind === 'smartart') return await smartArt(pic, ctx, n);
      if (pic.kind === 'chart') return await chart(pic, ctx);
      if (pic.kind === 'ole') {
        const emb = await file(pic.ole);
        const ext = extOf(emb && emb.path);
        if (emb && (ext === 'vsdx' || ext === 'vsdm')) {
          // Картинка — превью объекта, которое сохранили Word и Visio (точная копия того, что видно в документе:
          // темы и стили Visio переданы как есть); текст, дорожки и шаги — из самой схемы (visio.js).
          // Без превью — отрисовка visio.js. Остальные страницы схемы — отрисовка visio.js.
          await ctx.loadScript(ctx.VENDOR.visio);
          const v = await window.ISM.visio.parse(emb.u8.buffer.slice(emb.u8.byteOffset, emb.u8.byteOffset + emb.u8.byteLength));
          const pages = v.pages.filter((p) => p.svg || (p.texts && p.texts.length));
          let prevSrc = null;
          try { const prev = await file(pic.rid); if (prev) prevSrc = ((await picture(prev.u8, extOf(prev.path), ctx)) || {}).src || null; } catch { prevSrc = null; }
          pages.forEach((p, k) => {
            const src = k === 0 && prevSrc ? prevSrc : p.svg ? `data:image/svg+xml;base64,${b64text(p.svg)}` : null;
            if (src) out.push({ type: 'figure', src, alt: `Схема Visio${pages.length > 1 ? ` «${p.name}»` : ''} (рисунок ${n})` });
            out.push(...diagramBlocks({ lanes: p.lanes, labels: p.texts }));
          });
          ctx.stats.visio++;
          if (out.length) return out;
        }
        // старый объект (.vsd, другие программы): рисуем его превью
        const prev = await file(pic.rid);
        if (prev) {
          const m = await picture(prev.u8, extOf(prev.path), ctx);
          if (m) {
            out.push({ type: 'figure', src: m.src, alt: `${/visio/i.test(pic.prog) ? 'Схема Visio' : 'Встроенный объект'} (рисунок ${n})` });
            if (m.diagram) out.push(...diagramBlocks(m.diagram));
            if (/visio/i.test(pic.prog)) ctx.stats.visioPreview++;
            return out;
          }
        }
        ctx.stats.skipped++;
        return out;
      }
      if (pic.kind === 'image') {
        const f = await file(pic.rid);
        if (f) {
          const m = await picture(f.u8, extOf(f.path), ctx);
          if (m) {
            out.push({ type: 'figure', src: m.src, alt: pic.alt || `Рисунок ${n}` });
            const d = m.diagram || { lanes: [], labels: [] };
            if (pic.texts && pic.texts.length) d.labels = [...new Set([...(d.labels || []), ...pic.texts])];
            out.push(...diagramBlocks(d));
            ctx.stats.images++;
            return out;
          }
          ctx.stats.skipped++;
        }
      }
      // фигуры Word (надписи, блок-схемы из автофигур, VML): рисунок — отрисовка DrawingML/VML, текст — надписи
      if (pic.kind === 'shapes' || (pic.texts && pic.texts.length)) {
        const DM = window.ISM.drawingml;
        if (pic.el && DM) {
          await preloadImages(pic.group ? pic.group.map((g) => g.el) : [pic.el], ctx);
          const r = pic.group ? DM.renderMany(pic.group, ctx) : DM.render(pic.el, ctx);
          if (r) {
            out.push({ type: 'figure', src: `data:image/svg+xml;base64,${b64text(r.svg)}`, alt: pic.alt || `Схема (рисунок ${n})` });
            ctx.stats.shapes++;
            const d = r.diagram || { lanes: [], labels: [] };
            if (!d.labels.length && !d.lanes.length) d.labels = pic.texts || [];
            out.push(...diagramBlocks(d));
            return out;
          }
        }
        out.push(...diagramBlocks({ lanes: [], labels: pic.texts || [] }));
      }
    } catch (err) {
      ctx.stats.skipped++;
      console.warn('Рисунок не перенесён:', err);
    }
    return out;
  }

  // Все рисунки документа: блоки {type:'pending', pic, py} заменяются готовыми блоками.
  // Плавающие фигуры одной схемы (рамки, стрелки, надписи, привязанные к соседним абзацам) собираются в один рисунок.
  async function resolveAll(blocks, ctx) {
    await prepare(ctx);
    const DM = window.ISM.drawingml;
    const clusters = [];
    if (DM) {
      // плавающие фигуры с рамками, которые касаются или перекрываются (с запасом 30 pt), — одна схема (объединение связных групп)
      const cand = [];
      blocks.forEach((b, i) => {
        if (b.type !== 'pending' || !b.pic.floating || !b.pic.el || !['shapes', 'image'].includes(b.pic.kind)) return;
        const pos = DM.placement(b.pic.el, b.py, ctx.page);
        if (pos) cand.push({ i, x0: pos.x, y0: pos.y, x1: pos.x + Math.max(pos.w, 1), y1: pos.y + Math.max(pos.h, 1) });
      });
      const parent = cand.map((_, k) => k);
      const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
      const G = 30;
      for (let a = 0; a < cand.length; a++) {
        for (let b = a + 1; b < cand.length && b < a + 400; b++) {
          const p = cand[a], q = cand[b];
          if (q.i - p.i > 600) break;
          if (q.x0 <= p.x1 + G && q.x1 >= p.x0 - G && q.y0 <= p.y1 + G && q.y1 >= p.y0 - G) parent[find(b)] = find(a);
        }
      }
      const byRoot = new Map();
      cand.forEach((c, k) => { const r = find(k); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(c.i); });
      byRoot.forEach((items) => clusters.push({ items: items.sort((x, y) => x - y) }));
    }
    const skip = new Set();
    const lead = new Map();
    clusters.forEach((c) => {
      const pics = c.items.map((i) => blocks[i].pic);
      if (c.items.length < 2 || !pics.some((p) => p.kind === 'shapes')) return;
      const texts = [...new Set(pics.flatMap((p) => p.texts || []))];
      lead.set(c.items[0], { kind: 'shapes', el: pics[0].el, group: c.items.map((i) => ({ el: blocks[i].pic.el, py: blocks[i].py })), texts, alt: pics.map((p) => p.alt).find(Boolean) || '' });
      c.items.slice(1).forEach((i) => skip.add(i));
    });
    const outBlocks = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== 'pending') { outBlocks.push(b); continue; }
      if (skip.has(i)) continue;
      outBlocks.push(...await resolve(lead.get(i) || b.pic, ctx));
    }
    return outBlocks;
  }

  window.ISM = window.ISM || {};
  window.ISM.docxFigures = { findPics, resolve, resolveAll, prepare, pageOf, advance, advanceTable, paraHeight, boxTexts, diagramFromTexts, diagramBlocks, picture, b64text };
})();
