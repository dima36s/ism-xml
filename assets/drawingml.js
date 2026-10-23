/* ИСМ XML — отрисовка фигур Word в SVG: DrawingML (автофигуры, группы, полотно, надписи, SmartArt) и VML
   (фигуры старых документов: v:rect, v:oval, v:line, v:shape, v:group, v:textbox).
   Блок-схемы, нарисованные прямо в Word, — это не картинки, а фигуры: прямоугольники, ромбы, скругления,
   соединители со стрелками, надписи. Здесь они переводятся в SVG: положение и поворот (a:xfrm, группы с chOff/chExt),
   готовые формы (prstGeom, o:spt) и свои контуры (custGeom, путь VML), заливка и линия с цветами темы, наконечники
   стрелок, текст надписей с переносом по ширине. Плавающие фигуры одной схемы, привязанные к разным абзацам,
   собираются в один рисунок (renderMany). Единица SVG — пункт (1 pt = 12700 EMU). */
(() => {
  'use strict';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const V = 'urn:schemas-microsoft-com:vml';
  const O = 'urn:schemas-microsoft-com:office:office';
  const EMU = 12700;
  const r2 = (x) => Math.round(x * 100) / 100;
  const esc = (s) => String(s).replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const kids = (el, name, ns) => (el ? Array.from(el.children).filter((c) => c.localName === name && (!ns || c.namespaceURI === ns)) : []);
  const kid = (el, name, ns) => kids(el, name, ns)[0] || null;
  const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const wv = (el) => (el ? el.getAttributeNS(W, 'val') || el.getAttribute('w:val') : null);
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const I = [1, 0, 0, 1, 0, 0];
  const tr = (x, y) => [1, 0, 0, 1, x, y];
  const rotM = (deg) => { const a = deg * Math.PI / 180; return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]; };
  const mtx = (m) => `matrix(${m.map((v) => Math.round(v * 10000) / 10000).join(' ')})`;
  const THEME_DEFAULT = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };
  const PAGE_DEFAULT = { w: 595.3, h: 841.9, left: 85.05, right: 42.55, top: 56.7, bottom: 56.7 };

  let measure = null;
  function textWidth(s, size, bold, italic, font) {
    try {
      if (!measure) measure = document.createElement('canvas').getContext('2d');
      measure.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}100px "${font || 'Calibri'}", Arial, sans-serif`;
      return measure.measureText(s).width * size / 100;
    } catch { return s.length * size * 0.5; }
  }

  /* ---------- Цвета ---------- */
  function hsl(hex) {
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    let r, g, b;
    if (!s) r = g = b = l; else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
    return [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const NAMED = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', lime: '00FF00', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', silver: 'C0C0C0', maroon: '800000', navy: '000080', olive: '808000', purple: '800080', teal: '008080', aqua: '00FFFF', fuchsia: 'FF00FF', orange: 'FFA500', window: 'FFFFFF', windowtext: '000000', buttonface: 'F0F0F0', infobackground: 'FFFFE1' };
  // a:solidFill/a:srgbClr|a:schemeClr|a:sysClr|a:prstClr с модификаторами lumMod, lumOff, shade, tint, alpha
  function colorOf(el, theme) {
    if (!el) return null;
    const c = Array.from(el.children).find((x) => /Clr$/.test(x.localName));
    if (!c) return null;
    let hex = null;
    if (c.localName === 'srgbClr') hex = c.getAttribute('val');
    else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000');
    else if (c.localName === 'schemeClr') { const v = c.getAttribute('val'); hex = theme[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', phClr: 'accent1' }[v] || v]; }
    else if (c.localName === 'prstClr') hex = NAMED[(c.getAttribute('val') || '').toLowerCase()] || '000000';
    else if (c.localName === 'scrgbClr') hex = ['r', 'g', 'b'].map((k) => Math.round(num(c.getAttribute(k)) / 100000 * 255).toString(16).padStart(2, '0')).join('');
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
    let [h, s, l] = hsl(hex);
    let alpha = 1;
    Array.from(c.children).forEach((m) => {
      const v = num(m.getAttribute('val')) / 100000;
      if (m.localName === 'lumMod') l *= v;
      else if (m.localName === 'lumOff') l += v;
      else if (m.localName === 'shade') l *= v;
      else if (m.localName === 'tint') l = l + (1 - l) * (1 - v);
      else if (m.localName === 'alpha') alpha = v;
    });
    return { c: `#${fromHsl(h, s, Math.max(0, Math.min(1, l)))}`, a: alpha };
  }
  // Цвет VML: "#RRGGBB", "#RGB", "red", "#4f81bd [3204]", "black [3213]"
  function vmlColor(v, dflt) {
    if (!v) return dflt;
    const s = String(v).trim().split(/\s+/)[0].toLowerCase();
    let m = s.match(/^#?([0-9a-f]{6})$/);
    if (m) return `#${m[1].toUpperCase()}`;
    m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
    if (NAMED[s]) return `#${NAMED[s]}`;
    return dflt;
  }

  /* ---------- Готовые формы: контур в рамке w×h ---------- */
  function preset(name, w, h, adj = {}) {
    const ss = Math.min(w, h);
    const a = (i, d) => (adj[i] !== undefined ? adj[i] : d) / 100000;
    const P = (x, y) => `${r2(x)} ${r2(y)}`;
    const poly = (pts) => `M${pts.map((p) => P(p[0], p[1])).join(' L')} Z`;
    const ell = (cx, cy, rx, ry) => `M${P(cx - rx, cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${P(cx + rx, cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${P(cx - rx, cy)} Z`;
    const round = (rr) => { const r = Math.max(0, Math.min(rr, w / 2, h / 2)); return `M${P(r, 0)} L${P(w - r, 0)} A${r2(r)} ${r2(r)} 0 0 1 ${P(w, r)} L${P(w, h - r)} A${r2(r)} ${r2(r)} 0 0 1 ${P(w - r, h)} L${P(r, h)} A${r2(r)} ${r2(r)} 0 0 1 ${P(0, h - r)} L${P(0, r)} A${r2(r)} ${r2(r)} 0 0 1 ${P(r, 0)} Z`; };
    switch (name) {
      case 'rect': case 'flowChartProcess': case 'textBox': case 'flowChartInternalStorage': case 'frame': return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]) };
      case 'roundRect': case 'flowChartAlternateProcess': return { d: round(ss * a(0, 16667)) };
      case 'flowChartTerminator': return { d: round(ss / 2) };
      case 'ellipse': case 'flowChartConnector': case 'flowChartOr': case 'flowChartSummingJunction': return { d: ell(w / 2, h / 2, w / 2, h / 2) };
      case 'diamond': case 'flowChartDecision': return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) };
      case 'flowChartSort': return { d: `${poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])} M0 ${r2(h / 2)} L${P(w, h / 2)}` };
      case 'triangle': case 'flowChartExtract': return { d: poly([[w * a(0, 50000), 0], [w, h], [0, h]]) };
      case 'flowChartMerge': return { d: poly([[0, 0], [w, 0], [w / 2, h]]) };
      case 'flowChartCollate': return { d: poly([[0, 0], [w, 0], [0, h], [w, h]]) };
      case 'rtTriangle': return { d: poly([[0, 0], [w, h], [0, h]]) };
      case 'parallelogram': case 'flowChartInputOutput': { const k = name === 'parallelogram' ? ss * a(0, 25000) : w / 5; return { d: poly([[k, 0], [w, 0], [w - k, h], [0, h]]) }; }
      case 'trapezoid': case 'flowChartManualOperation': { const k = name === 'trapezoid' ? ss * a(0, 25000) : w / 5; return { d: poly([[0, 0], [w, 0], [w - k, h], [k, h]]) }; }
      case 'hexagon': case 'flowChartPreparation': { const k = name === 'hexagon' ? ss * a(0, 25000) : w / 5; return { d: poly([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]) }; }
      case 'octagon': { const k = ss * a(0, 29289); return { d: poly([[k, 0], [w - k, 0], [w, k], [w, h - k], [w - k, h], [k, h], [0, h - k], [0, k]]) }; }
      case 'pentagon': case 'homePlate': { const k = ss * a(0, 50000); return { d: poly([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h]]) }; }
      case 'chevron': { const k = ss * a(0, 50000); return { d: poly([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h], [k, h / 2]]) }; }
      case 'flowChartOffpageConnector': return { d: poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]) };
      case 'flowChartManualInput': return { d: poly([[0, h / 5], [w, 0], [w, h], [0, h]]) };
      case 'flowChartPunchedCard': return { d: poly([[w / 5, 0], [w, 0], [w, h], [0, h], [0, h / 5]]) };
      case 'flowChartPredefinedProcess': return { d: `${poly([[0, 0], [w, 0], [w, h], [0, h]])} M${P(w / 8, 0)} L${P(w / 8, h)} M${P(w * 7 / 8, 0)} L${P(w * 7 / 8, h)}` };
      case 'flowChartDocument': return { d: `M0 0 L${P(w, 0)} L${P(w, h * 0.83)} C${P(w * 0.75, h * 0.7)} ${P(w * 0.5, h * 1.05)} ${P(w * 0.25, h)} C${P(w * 0.12, h * 0.97)} ${P(w * 0.05, h * 0.92)} ${P(0, h * 0.88)} Z` };
      case 'flowChartMultidocument': return { d: `M0 ${r2(h * 0.15)} L${P(w * 0.85, h * 0.15)} L${P(w * 0.85, h * 0.85)} C${P(w * 0.6, h * 0.75)} ${P(w * 0.35, h * 1.02)} ${P(0, h * 0.9)} Z M${P(w * 0.08, h * 0.15)} L${P(w * 0.08, h * 0.07)} L${P(w * 0.93, h * 0.07)} L${P(w * 0.93, h * 0.77)} L${P(w * 0.85, h * 0.77)} M${P(w * 0.15, h * 0.07)} L${P(w * 0.15, 0)} L${P(w, 0)} L${P(w, h * 0.7)} L${P(w * 0.93, h * 0.7)}` };
      case 'can': case 'flowChartMagneticDisk': { const ry = Math.min(h / 2, name === 'can' ? ss * a(0, 25000) / 2 : h / 6); return { d: `M0 ${r2(ry)} A${r2(w / 2)} ${r2(ry)} 0 0 1 ${P(w, ry)} L${P(w, h - ry)} A${r2(w / 2)} ${r2(ry)} 0 0 1 ${P(0, h - ry)} Z M0 ${r2(ry)} A${r2(w / 2)} ${r2(ry)} 0 0 0 ${P(w, ry)}` }; }
      case 'flowChartMagneticDrum': { const rx = w / 6; return { d: `M${P(rx, 0)} L${P(w - rx, 0)} A${r2(rx)} ${r2(h / 2)} 0 0 1 ${P(w - rx, h)} L${P(rx, h)} A${r2(rx)} ${r2(h / 2)} 0 0 1 ${P(rx, 0)} Z M${P(w - rx, 0)} A${r2(rx)} ${r2(h / 2)} 0 0 0 ${P(w - rx, h)}` }; }
      case 'flowChartOnlineStorage': return { d: `M${P(w / 6, 0)} L${P(w, 0)} A${r2(w / 6)} ${r2(h / 2)} 0 0 0 ${P(w, h)} L${P(w / 6, h)} A${r2(w / 6)} ${r2(h / 2)} 0 0 1 ${P(w / 6, 0)} Z` };
      case 'flowChartDisplay': return { d: `M0 ${r2(h / 2)} L${P(w / 6, 0)} L${P(w * 5 / 6, 0)} A${r2(w / 6)} ${r2(h / 2)} 0 0 1 ${P(w * 5 / 6, h)} L${P(w / 6, h)} Z` };
      case 'flowChartMagneticTape': return { d: `${ell(w / 2, h / 2, w / 2, h / 2)} M${P(w / 2, h)} L${P(w, h)}` };
      case 'flowChartDelay': return { d: `M0 0 L${P(w / 2, 0)} A${r2(w / 2)} ${r2(h / 2)} 0 0 1 ${P(w / 2, h)} L${P(0, h)} Z` };
      case 'plus': { const k = ss * a(0, 25000); return { d: poly([[k, 0], [w - k, 0], [w - k, k], [w, k], [w, h - k], [w - k, h - k], [w - k, h], [k, h], [k, h - k], [0, h - k], [0, k], [k, k]]) }; }
      case 'rightArrow': { const t = h * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[0, h / 2 - t], [w - k, h / 2 - t], [w - k, 0], [w, h / 2], [w - k, h], [w - k, h / 2 + t], [0, h / 2 + t]]) }; }
      case 'leftArrow': { const t = h * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[w, h / 2 - t], [k, h / 2 - t], [k, 0], [0, h / 2], [k, h], [k, h / 2 + t], [w, h / 2 + t]]) }; }
      case 'downArrow': { const t = w * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[w / 2 - t, 0], [w / 2 + t, 0], [w / 2 + t, h - k], [w, h - k], [w / 2, h], [0, h - k], [w / 2 - t, h - k]]) }; }
      case 'upArrow': { const t = w * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[w / 2 - t, h], [w / 2 + t, h], [w / 2 + t, k], [w, k], [w / 2, 0], [0, k], [w / 2 - t, k]]) }; }
      case 'leftRightArrow': { const t = h * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[0, h / 2], [k, 0], [k, h / 2 - t], [w - k, h / 2 - t], [w - k, 0], [w, h / 2], [w - k, h], [w - k, h / 2 + t], [k, h / 2 + t], [k, h]]) }; }
      case 'upDownArrow': { const t = w * a(0, 50000) / 2, k = ss * a(1, 50000); return { d: poly([[w / 2, 0], [w, k], [w / 2 + t, k], [w / 2 + t, h - k], [w, h - k], [w / 2, h], [0, h - k], [w / 2 - t, h - k], [w / 2 - t, k], [0, k]]) }; }
      case 'line': case 'straightConnector1': return { d: `M0 0 L${P(w, h)}`, open: true };
      case 'bentConnector2': return { d: `M0 0 L${P(w, 0)} L${P(w, h)}`, open: true };
      case 'bentConnector3': { const x = w * a(0, 50000); return { d: `M0 0 L${P(x, 0)} L${P(x, h)} L${P(w, h)}`, open: true }; }
      case 'bentConnector4': { const x = w * a(0, 50000), y = h * a(1, 50000); return { d: `M0 0 L${P(x, 0)} L${P(x, y)} L${P(w, y)} L${P(w, h)}`, open: true }; }
      case 'bentConnector5': { const x = w * a(0, 50000), y = h * a(1, 50000), x2 = w * a(2, 50000); return { d: `M0 0 L${P(x, 0)} L${P(x, y)} L${P(x2, y)} L${P(x2, h)} L${P(w, h)}`, open: true }; }
      case 'curvedConnector2': return { d: `M0 0 C${P(w, 0)} ${P(w, 0)} ${P(w, h)}`, open: true };
      case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5': { const x = w * a(0, 50000); return { d: `M0 0 C${P(x, 0)} ${P(x, h)} ${P(w, h)}`, open: true }; }
      case 'star4': case 'star5': case 'star6': case 'star8': { const n = { star4: 4, star5: 5, star6: 6, star8: 8 }[name]; const pts = []; for (let i = 0; i < n * 2; i++) { const ang = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? (n === 4 ? 0.12 : 0.19) : 0.5; pts.push([w / 2 + Math.cos(ang) * w * rr, h / 2 + Math.sin(ang) * h * rr]); } return { d: poly(pts) }; }
      case 'leftBracket': return { d: `M${P(w, 0)} L0 0 L${P(0, h)} L${P(w, h)}`, open: true };
      case 'rightBracket': return { d: `M0 0 L${P(w, 0)} L${P(w, h)} L${P(0, h)}`, open: true };
      case 'leftBrace': return { d: `M${P(w, 0)} Q${P(w / 2, 0)} ${P(w / 2, h / 4)} L${P(w / 2, h * 0.4)} Q${P(w / 2, h / 2)} ${P(0, h / 2)} Q${P(w / 2, h / 2)} ${P(w / 2, h * 0.6)} L${P(w / 2, h * 0.75)} Q${P(w / 2, h)} ${P(w, h)}`, open: true };
      case 'rightBrace': return { d: `M0 0 Q${P(w / 2, 0)} ${P(w / 2, h / 4)} L${P(w / 2, h * 0.4)} Q${P(w / 2, h / 2)} ${P(w, h / 2)} Q${P(w / 2, h / 2)} ${P(w / 2, h * 0.6)} L${P(w / 2, h * 0.75)} Q${P(w / 2, h)} ${P(0, h)}`, open: true };
      case 'wedgeRectCallout': return { d: poly([[0, 0], [w, 0], [w, h], [w * 0.4, h], [w * 0.2, h * 1.25], [w * 0.25, h], [0, h]]) };
      case 'wedgeRoundRectCallout': return { d: round(ss * 0.16667) };
      case 'wedgeEllipseCallout': case 'cloud': case 'cloudCallout': return { d: ell(w / 2, h / 2, w / 2, h / 2) };
      case 'snip1Rect': case 'snip2SameRect': case 'snipRoundRect': { const k = ss * a(0, 16667); return { d: poly([[0, 0], [w - k, 0], [w, k], [w, h], [0, h]]) }; }
      case 'round1Rect': case 'round2SameRect': return { d: round(ss * a(0, 16667)) };
      case 'foldedCorner': { const k = ss * 0.125; return { d: `${poly([[0, 0], [w, 0], [w, h - k], [w - k, h], [0, h]])} M${P(w - k, h)} L${P(w - k * 0.8, h - k * 0.8)} L${P(w, h - k)}` }; }
      case 'cube': { const k = ss * a(0, 25000); return { d: `${poly([[0, k], [k, 0], [w, 0], [w, h - k], [w - k, h], [0, h]])} M0 ${r2(k)} L${P(w - k, k)} L${P(w, 0)} M${P(w - k, k)} L${P(w - k, h)}` }; }
      case 'donut': case 'noSmoking': return { d: `${ell(w / 2, h / 2, w / 2, h / 2)} ${ell(w / 2, h / 2, w / 4, h / 4)}` };
      case 'arc': return { d: `M${P(w / 2, 0)} A${r2(w / 2)} ${r2(h / 2)} 0 0 1 ${P(w, h / 2)}`, open: true };
      default: return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]) };
    }
  }
  // Номер формы VML (o:spt) → имя готовой формы
  const SPT = { 0: 'rect', 1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon', 11: 'plus', 12: 'star5', 13: 'rightArrow', 15: 'homePlate', 16: 'cube', 19: 'arc', 20: 'line', 22: 'can', 23: 'donut', 32: 'straightConnector1', 33: 'bentConnector2', 34: 'bentConnector3', 35: 'bentConnector4', 36: 'bentConnector5', 37: 'curvedConnector2', 38: 'curvedConnector3', 55: 'chevron', 58: 'star8', 61: 'wedgeRectCallout', 62: 'wedgeRoundRectCallout', 63: 'wedgeEllipseCallout', 65: 'foldedCorner', 66: 'leftArrow', 67: 'downArrow', 68: 'upArrow', 69: 'leftRightArrow', 70: 'upDownArrow', 75: 'rect', 85: 'leftBracket', 86: 'rightBracket', 87: 'leftBrace', 88: 'rightBrace', 109: 'flowChartProcess', 110: 'flowChartDecision', 111: 'flowChartInputOutput', 112: 'flowChartPredefinedProcess', 113: 'flowChartInternalStorage', 114: 'flowChartDocument', 115: 'flowChartMultidocument', 116: 'flowChartTerminator', 117: 'flowChartPreparation', 118: 'flowChartManualInput', 119: 'flowChartManualOperation', 120: 'flowChartConnector', 121: 'flowChartPunchedCard', 122: 'flowChartPunchedCard', 123: 'flowChartSummingJunction', 124: 'flowChartOr', 125: 'flowChartCollate', 126: 'flowChartSort', 127: 'flowChartExtract', 128: 'flowChartMerge', 130: 'flowChartOnlineStorage', 131: 'flowChartMagneticTape', 132: 'flowChartMagneticDisk', 133: 'flowChartMagneticDrum', 134: 'flowChartDisplay', 135: 'flowChartDelay', 176: 'flowChartAlternateProcess', 177: 'flowChartOffpageConnector', 183: 'star4', 187: 'star6', 202: 'textBox' };

  // Прямоугольник текста готовой формы (как в Word: в ромбе и эллипсе текст переносится по внутренней области)
  function textRect(name, w, h, adj = {}) {
    const ss = Math.min(w, h);
    const R4 = (l, t, r, b) => ({ x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) });
    switch (name) {
      case 'diamond': case 'flowChartDecision': case 'flowChartSort': return R4(w / 4, h / 4, w * 3 / 4, h * 3 / 4);
      case 'ellipse': case 'flowChartConnector': case 'flowChartOr': case 'flowChartSummingJunction': case 'wedgeEllipseCallout': return R4(w * 0.1464, h * 0.1464, w * 0.8536, h * 0.8536);
      case 'triangle': case 'flowChartExtract': return R4(w / 4, h / 2, w * 3 / 4, h);
      case 'flowChartMerge': return R4(w / 4, 0, w * 3 / 4, h / 2);
      case 'flowChartInputOutput': return R4(w / 5, 0, w * 4 / 5, h);
      case 'parallelogram': case 'trapezoid': { const k = ss * ((adj[0] ?? 25000) / 100000); return R4(k * 0.67, 0, w - k * 0.67, h); }
      case 'flowChartManualOperation': return R4(w / 5, 0, w * 4 / 5, h);
      case 'hexagon': case 'flowChartPreparation': return R4(w / 5, 0, w * 4 / 5, h);
      case 'flowChartTerminator': return R4(w * 1018 / 21600, h * 3163 / 21600, w * 20582 / 21600, h * 18437 / 21600);
      case 'flowChartDocument': return R4(0, 0, w, h * 17322 / 21600);
      case 'flowChartMultidocument': return R4(0, h * 3675 / 21600, w * 18595 / 21600, h * 17400 / 21600);
      case 'flowChartPredefinedProcess': return R4(w / 8, 0, w * 7 / 8, h);
      case 'flowChartAlternateProcess': case 'roundRect': { const r = ss * ((adj[0] ?? 16667) / 100000) * 0.29289; return R4(r, r, w - r, h - r); }
      case 'can': case 'flowChartMagneticDisk': return R4(0, h / 3, w, h * 5 / 6);
      case 'flowChartOffpageConnector': return R4(0, 0, w, h * 0.8);
      case 'flowChartManualInput': return R4(0, h / 5, w, h);
      case 'flowChartPunchedCard': return R4(0, h / 5, w, h);
      case 'flowChartDelay': return R4(0, h * 0.1464, w * 0.8536, h * 0.8536);
      case 'flowChartDisplay': return R4(w / 6, 0, w * 5 / 6, h);
      case 'homePlate': case 'pentagon': case 'chevron': { const k = ss * ((adj[0] ?? 50000) / 100000); return R4(name === 'chevron' ? k : 0, 0, w - k / 2, h); }
      case 'octagon': { const k = ss * ((adj[0] ?? 29289) / 100000) / 2; return R4(k, k, w - k, h - k); }
      default: return R4(0, 0, w, h);
    }
  }

  // Свой контур a:custGeom: пути в собственных координатах (w×h пути)
  function custom(geom, w, h) {
    let d = '';
    let open = true;
    kids(kid(geom, 'pathLst', A), 'path', A).forEach((p) => {
      const pw = num(p.getAttribute('w'), 0) || w * EMU, ph = num(p.getAttribute('h'), 0) || h * EMU;
      const sx = w / pw, sy = h / ph;
      let cur = [0, 0];
      const pt = (e) => [num(e.getAttribute('x')) * sx, num(e.getAttribute('y')) * sy];
      Array.from(p.children).forEach((c) => {
        const pts = kids(c, 'pt', A).map(pt);
        switch (c.localName) {
          case 'moveTo': if (pts[0]) { cur = pts[0]; d += ` M${r2(cur[0])} ${r2(cur[1])}`; } break;
          case 'lnTo': if (pts[0]) { cur = pts[0]; d += ` L${r2(cur[0])} ${r2(cur[1])}`; } break;
          case 'cubicBezTo': if (pts.length === 3) { d += ` C${pts.map((q) => `${r2(q[0])} ${r2(q[1])}`).join(' ')}`; cur = pts[2]; } break;
          case 'quadBezTo': if (pts.length === 2) { d += ` Q${pts.map((q) => `${r2(q[0])} ${r2(q[1])}`).join(' ')}`; cur = pts[1]; } break;
          case 'arcTo': {
            const wR = num(c.getAttribute('wR')) * sx, hR = num(c.getAttribute('hR')) * sy;
            const st = num(c.getAttribute('stAng')) / 60000 * Math.PI / 180, sw = num(c.getAttribute('swAng')) / 60000 * Math.PI / 180;
            const cx = cur[0] - wR * Math.cos(st), cy = cur[1] - hR * Math.sin(st);
            const ex = cx + wR * Math.cos(st + sw), ey = cy + hR * Math.sin(st + sw);
            d += ` A${r2(wR)} ${r2(hR)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r2(ex)} ${r2(ey)}`;
            cur = [ex, ey]; break;
          }
          case 'close': d += ' Z'; open = false; break;
          default: break;
        }
      });
    });
    return { d: d.trim() || `M0 0 L${r2(w)} 0 L${r2(w)} ${r2(h)} L0 ${r2(h)} Z`, open };
  }
  // Путь VML: m l c x e t r v qx qy nf ns wa wr at ar; числа в координатах coordsize. С формулами (@) — null.
  function vmlPath(path, cw, ch, cx0, cy0, w, h) {
    if (!path || /@/.test(path)) return null;
    const sx = w / (cw || 1), sy = h / (ch || 1);
    const X = (v) => r2((v - cx0) * sx), Y = (v) => r2((v - cy0) * sy);
    const toks = path.match(/[a-z]+|-?\d*\.?\d+/gi) || [];
    let i = 0, d = '', cur = [0, 0], cmd = '', open = true;
    const nums = () => { const out = []; while (i < toks.length && /^-?\d*\.?\d+$/.test(toks[i])) out.push(+toks[i++]); return out; };
    while (i < toks.length) {
      if (/^[a-z]+$/i.test(toks[i])) cmd = toks[i++].toLowerCase();
      const n = nums();
      switch (cmd) {
        case 'm': for (let k = 0; k + 1 < n.length; k += 2) { cur = [n[k], n[k + 1]]; d += `${k ? ' L' : ' M'}${X(cur[0])} ${Y(cur[1])}`; } break;
        case 't': for (let k = 0; k + 1 < n.length; k += 2) { cur = [cur[0] + n[k], cur[1] + n[k + 1]]; d += ` M${X(cur[0])} ${Y(cur[1])}`; } break;
        case 'l': for (let k = 0; k + 1 < n.length; k += 2) { cur = [n[k], n[k + 1]]; d += ` L${X(cur[0])} ${Y(cur[1])}`; } break;
        case 'r': for (let k = 0; k + 1 < n.length; k += 2) { cur = [cur[0] + n[k], cur[1] + n[k + 1]]; d += ` L${X(cur[0])} ${Y(cur[1])}`; } break;
        case 'c': for (let k = 0; k + 5 < n.length; k += 6) { d += ` C${X(n[k])} ${Y(n[k + 1])} ${X(n[k + 2])} ${Y(n[k + 3])} ${X(n[k + 4])} ${Y(n[k + 5])}`; cur = [n[k + 4], n[k + 5]]; } break;
        case 'v': for (let k = 0; k + 5 < n.length; k += 6) { const b = cur; d += ` C${X(b[0] + n[k])} ${Y(b[1] + n[k + 1])} ${X(b[0] + n[k + 2])} ${Y(b[1] + n[k + 3])} ${X(b[0] + n[k + 4])} ${Y(b[1] + n[k + 5])}`; cur = [b[0] + n[k + 4], b[1] + n[k + 5]]; } break;
        case 'qx': case 'qy': {
          let ax = cmd === 'qx';
          for (let k = 0; k + 1 < n.length; k += 2) { const nx = n[k], ny = n[k + 1]; const c1 = ax ? [nx, cur[1]] : [cur[0], ny]; d += ` Q${X(c1[0])} ${Y(c1[1])} ${X(nx)} ${Y(ny)}`; cur = [nx, ny]; ax = !ax; }
          break;
        }
        case 'wa': case 'wr': case 'at': case 'ar': {
          for (let k = 0; k + 7 < n.length; k += 8) {
            const [l, t, rr, b, x1, y1, x2, y2] = n.slice(k, k + 8);
            const ecx = (l + rr) / 2, ecy = (t + b) / 2, rx = Math.abs(rr - l) / 2, ry = Math.abs(b - t) / 2;
            const ang = (x, y) => Math.atan2((y - ecy) / (ry || 1), (x - ecx) / (rx || 1));
            const a1 = ang(x1, y1), a2 = ang(x2, y2);
            const p1 = [ecx + rx * Math.cos(a1), ecy + ry * Math.sin(a1)], p2 = [ecx + rx * Math.cos(a2), ecy + ry * Math.sin(a2)];
            const clockwise = cmd === 'wr' || cmd === 'ar';
            let sweep = clockwise ? a2 - a1 : a1 - a2;
            while (sweep < 0) sweep += 2 * Math.PI;
            d += ` ${cmd === 'at' || cmd === 'wa' ? 'M' : 'L'}${X(p1[0])} ${Y(p1[1])} A${r2(rx * sx)} ${r2(ry * sy)} 0 ${sweep > Math.PI ? 1 : 0} ${clockwise ? 1 : 0} ${X(p2[0])} ${Y(p2[1])}`;
            cur = p2;
          }
          break;
        }
        case 'x': d += ' Z'; open = false; break;
        default: if (!n.length && i < toks.length && !/^[a-z]+$/i.test(toks[i])) i++; break;
      }
    }
    d = d.trim();
    return d ? { d, open } : null;
  }

  // Длина CSS/VML: 12pt, 1.5in, 2cm, 10mm, 20px, 3pc, 100 (без единиц — px или координаты группы)
  function len(v, unitless = 0.75) {
    if (v === null || v === undefined || v === '') return null;
    const m = String(v).trim().match(/^(-?\d*\.?\d+)\s*(pt|in|cm|mm|px|pc|emu|em)?$/i);
    if (!m) return null;
    const x = +m[1];
    switch ((m[2] || '').toLowerCase()) {
      case 'pt': return x; case 'in': return x * 72; case 'cm': return x * 72 / 2.54; case 'mm': return x * 72 / 25.4;
      case 'px': return x * 0.75; case 'pc': return x * 12; case 'emu': return x / EMU; case 'em': return x * 12;
      default: return x * unitless;
    }
  }
  const cssOf = (s) => { const o = {}; String(s || '').split(';').forEach((kv) => { const i = kv.indexOf(':'); if (i > 0) o[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim(); }); return o; };
  const isTrue = (v, d) => (v === null || v === undefined || v === '' ? d : !/^(f|false|0|off)$/i.test(String(v).trim()));

  /* ---------- Сцена: всё, что нарисовано, и подписи для разбора схемы ---------- */
  function scene(ctx) {
    const theme = (ctx && ctx.theme) || THEME_DEFAULT;
    const defs = (ctx && ctx.textDefaults) || { size: 11, font: 'Calibri' };
    const out = [];
    const texts = [];
    const boxLabels = [];
    const lines = [];
    const markers = new Map();
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); };
    const growBox = (m, w, h) => [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y]) => { const p = apply(m, x, y); grow(p[0], p[1]); });
    const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const marker = (col, type, start, size) => {
      const key = `${col}|${type}|${start}|${size}`;
      if (!markers.has(key)) {
        const id = `dm${markers.size + 1}`;
        const t = String(type).toLowerCase();
        const shape = t === 'oval' ? '<circle cx="5" cy="5" r="4"/>' : t === 'diamond' ? '<path d="M0 5L5 0L10 5L5 10z"/>' : t === 'arrow' || t === 'open' ? '<path d="M1 1L9 5L1 9" fill="none" stroke-width="1.4"/>' : t === 'stealth' || t === 'classic' ? '<path d="M0 0L10 5L0 10L3 5z"/>' : '<path d="M0 0L10 5L0 10z"/>';
        const k = { sm: 3, med: 4.2, lg: 6 }[size] || 4.2;
        markers.set(key, { id, svg: `<marker id="${id}" viewBox="0 0 10 10" refX="${t === 'oval' || t === 'diamond' ? 5 : 9}" refY="5" markerWidth="${k}" markerHeight="${k}" orient="${start ? 'auto-start-reverse' : 'auto'}" fill="${col}" stroke="${col}">${shape}</marker>` });
      }
      return markers.get(key).id;
    };
    // Контур с заливкой/линией; sw — толщина линии в пунктах страницы
    let solid = 0; // фигуры с площадью, картинки и текст: рисунок из одних линий (разделитель, рамка-черта) — не схема
    function drawPath(geo, m, fill, stroke, sw, dash, head, tail) {
      if (!fill && !stroke) return;
      if (!geo.open) solid++;
      const k = scaleOf(m);
      let a = `d="${geo.d}" transform="${mtx(m)}" fill="${fill ? fill.c : 'none'}"${fill && fill.a < 1 ? ` fill-opacity="${r2(fill.a)}"` : ''}`;
      if (stroke) {
        const lw = sw / k;
        a += ` stroke="${stroke.c}" stroke-width="${Math.round(lw * 1000) / 1000}" stroke-linejoin="round"${stroke.a < 1 ? ` stroke-opacity="${r2(stroke.a)}"` : ''}${dash ? ` stroke-dasharray="${dash.map((v) => r2(v * lw)).join(' ')}"` : ''}`;
        if (head) a += ` marker-start="url(#${marker(stroke.c, head.type, true, head.size)})"`;
        if (tail) a += ` marker-end="url(#${marker(stroke.c, tail.type, false, tail.size)})"`;
      } else a += ' stroke="none"';
      out.push(`<path ${a}/>`);
    }
    // Абзацы надписи → строки с переносом по ширине → <text>; подписи — в texts (для разбора схемы)
    // paras: [{runs:[{s,size,bold,italic,color,font}], align}]
    function drawText(paras, m, w, h, o) {
      const sx = Math.hypot(m[0], m[1]) || 1, sy = Math.hypot(m[2], m[3]) || 1;
      let tm = [m[0] / sx, m[1] / sx, m[2] / sy, m[3] / sy, m[4], m[5]];
      let bw = w * sx, bh = h * sy;
      if (o.vert === 'vert270') { tm = mul(tm, [0, -1, 1, 0, 0, bh]); [bw, bh] = [bh, bw]; }
      else if (o.vert === 'vert' || o.vert === 'eaVert') { tm = mul(tm, [0, 1, -1, 0, bw, 0]); [bw, bh] = [bh, bw]; }
      const L = o.L ?? 7.2, T = o.T ?? 3.6, Rr = o.R ?? 7.2, B = o.B ?? 3.6;
      const max = Math.max(6, bw - L - Rr);
      const rows = [];
      paras.forEach((p) => {
        const s = norm(p.runs.map((r) => r.s).join(''));
        if (!s) return;
        const f = p.runs.find((r) => norm(r.s)) || p.runs[0] || {};
        const st = { size: (f.size || defs.size) * (o.scale || 1), bold: !!f.bold, italic: !!f.italic, color: f.color || o.color || '#000000', font: f.font || defs.font, align: p.align || 'left' };
        let line = '';
        (o.wrap === false ? [s] : s.split(' ')).forEach((wd) => {
          const cand = line ? `${line} ${wd}` : wd;
          if (!line || textWidth(cand, st.size, st.bold, st.italic, st.font) <= max) line = cand;
          else { rows.push({ ...st, s: line }); line = wd; }
        });
        if (line) rows.push({ ...st, s: line });
      });
      if (!rows.length) return;
      const lh = (r) => r.size * 1.2;
      const total = rows.reduce((a, r) => a + lh(r), 0);
      let y = o.anchor === 'ctr' || o.anchor === 'middle' ? (bh - total) / 2 : o.anchor === 'b' || o.anchor === 'bottom' ? bh - B - total : T;
      const ang = Math.atan2(tm[1], tm[0]) * 180 / Math.PI;
      const c = apply(tm, bw / 2, bh / 2);
      boxLabels.push({ s: norm(paras.map((p) => norm(p.runs.map((r) => r.s).join(''))).filter(Boolean).join(' ')), x: c[0], y: c[1], rot: Math.abs(Math.abs(ang) - 90) < 30 });
      const spans = rows.map((r) => {
        y += lh(r);
        const base = y - r.size * 0.25;
        const x = r.align === 'center' ? bw / 2 : r.align === 'right' ? bw - Rr : L;
        const an = r.align === 'center' ? 'middle' : r.align === 'right' ? 'end' : 'start';
        const tw = textWidth(r.s, r.size, r.bold, r.italic, r.font);
        const lx = an === 'middle' ? x - tw / 2 : an === 'end' ? x - tw : x;
        const g = apply(tm, lx, base);
        texts.push({ s: r.s, x: g[0], y: g[1], size: r.size, angle: ang, w: tw });
        return `<tspan x="${r2(x)}" y="${r2(base)}" font-size="${r2(r.size)}" fill="${r.color}" text-anchor="${an}"${r.font !== defs.font ? ` font-family="${esc(r.font)}, Arial, sans-serif"` : ''}${r.bold ? ' font-weight="bold"' : ''}${r.italic ? ' font-style="italic"' : ''}>${esc(r.s)}</tspan>`;
      }).join('');
      out.push(`<text transform="${mtx(tm)}" font-family="${esc(defs.font)}, Arial, sans-serif">${spans}</text>`);
      solid++;
    }
    // w:txbxContent → абзацы
    function wordParas(tc, fallbackColor) {
      return Array.from(tc.getElementsByTagNameNS(W, 'p')).map((p) => {
        const pPr = kid(p, 'pPr', W);
        const jc = wv(pPr && kid(pPr, 'jc', W));
        const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
        const runs = Array.from(p.getElementsByTagNameNS(W, 'r')).filter((r) => r.parentNode === p || ['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdtContent'].includes(r.parentNode.localName)).map((r) => {
          const rPr = kid(r, 'rPr', W);
          const sz = rPr && kid(rPr, 'sz', W);
          const b = rPr && kid(rPr, 'b', W), i = rPr && kid(rPr, 'i', W);
          const c = wv(rPr && kid(rPr, 'color', W));
          const rf = rPr && kid(rPr, 'rFonts', W);
          let s = '';
          Array.from(r.children).forEach((x) => { if (x.localName === 't') s += x.textContent; else if (x.localName === 'tab' || x.localName === 'br' || x.localName === 'cr') s += ' '; });
          return { s, size: sz ? num(wv(sz), 22) / 2 : null, bold: !!b && !/^(0|false)$/.test(wv(b) || ''), italic: !!i && !/^(0|false)$/.test(wv(i) || ''), color: c && c !== 'auto' ? `#${c}` : fallbackColor, font: rf ? rf.getAttributeNS(W, 'ascii') || rf.getAttribute('w:ascii') || rf.getAttributeNS(W, 'hAnsi') || null : null };
        });
        return { runs, align };
      });
    }
    // a:txBody → абзацы (SmartArt, фигуры с текстом DrawingML)
    function dmlParas(txBody, fallbackColor) {
      const lst = kid(txBody, 'lstStyle', A);
      const lvl1 = lst && kid(lst, 'lvl1pPr', A);
      const defR = lvl1 && kid(lvl1, 'defRPr', A);
      return kids(txBody, 'p', A).map((p) => {
        const pPr = kid(p, 'pPr', A);
        const al = (pPr && pPr.getAttribute('algn')) || (lvl1 && lvl1.getAttribute('algn')) || 'l';
        const runs = [];
        Array.from(p.children).forEach((r) => {
          if (r.localName === 'br') { runs.push({ s: ' ' }); return; }
          if (r.localName !== 'r' && r.localName !== 'fld') return;
          const rPr = kid(r, 'rPr', A) || defR;
          const t = kid(r, 't', A);
          const fill = rPr && kid(rPr, 'solidFill', A);
          const lat = rPr && kid(rPr, 'latin', A);
          const sz = (rPr && rPr.getAttribute('sz')) || (defR && defR.getAttribute('sz'));
          runs.push({ s: t ? t.textContent : '', size: sz ? num(sz) / 100 : null, bold: !!rPr && rPr.getAttribute('b') === '1', italic: !!rPr && rPr.getAttribute('i') === '1', color: ((fill && colorOf(fill, theme)) || {}).c || fallbackColor, font: lat && !/^\+/.test(lat.getAttribute('typeface') || '') ? lat.getAttribute('typeface') : null });
        });
        return { runs, align: al === 'ctr' ? 'center' : al === 'r' ? 'right' : 'left' };
      });
    }

    /* --- DrawingML --- */
    function xfrmOf(x) {
      if (!x) return null;
      const off = kid(x, 'off', A), ex = kid(x, 'ext', A);
      const ox = num(off && off.getAttribute('x')) / EMU, oy = num(off && off.getAttribute('y')) / EMU;
      const w = num(ex && ex.getAttribute('cx')) / EMU, h = num(ex && ex.getAttribute('cy')) / EMU;
      const rot = num(x.getAttribute('rot')) / 60000;
      const fh = x.getAttribute('flipH') === '1', fv = x.getAttribute('flipV') === '1';
      let m = tr(ox + w / 2, oy + h / 2);
      if (rot) m = mul(m, rotM(rot));
      m = mul(m, [fh ? -1 : 1, 0, 0, fv ? -1 : 1, 0, 0]);
      m = mul(m, tr(-w / 2, -h / 2));
      return { m, w, h, x: ox, y: oy, rot, fh, fv };
    }
    const anyKid = (el, name) => kids(el, name)[0] || null;
    function dmlShape(sp, parentM, ext) {
      const spPr = anyKid(sp, 'spPr');
      let xf = xfrmOf(kid(spPr, 'xfrm', A));
      if (!xf && ext) xf = { m: I, w: ext.w, h: ext.h };
      if (!xf) return;
      const m = mul(parentM, xf.m);
      growBox(m, xf.w, xf.h);
      const st = anyKid(sp, 'style');
      const ref = (name) => st && kid(st, name, A);
      const prst = kid(spPr, 'prstGeom', A), cust = kid(spPr, 'custGeom', A);
      const adj = {};
      if (prst) kids(kid(prst, 'avLst', A), 'gd', A).forEach((g, i) => { const v = (g.getAttribute('fmla') || '').match(/val\s+(-?\d+)/); if (v) adj[i] = +v[1]; });
      const geo = cust ? custom(cust, xf.w, xf.h) : preset(prst ? prst.getAttribute('prst') : 'rect', xf.w, xf.h, adj);
      let fill = null;
      const noFill = kid(spPr, 'noFill', A);
      const sf = kid(spPr, 'solidFill', A), gf = kid(spPr, 'gradFill', A), pf = kid(spPr, 'pattFill', A), bf = kid(spPr, 'blipFill', A);
      if (sf) fill = colorOf(sf, theme);
      else if (gf) { const gs = kids(kid(gf, 'gsLst', A), 'gs', A); fill = colorOf(gs[Math.floor(gs.length / 2)] || gs[0], theme); }
      else if (pf) fill = colorOf(kid(pf, 'bgClr', A), theme) || colorOf(kid(pf, 'fgClr', A), theme);
      else if (!noFill && !bf) { const fr = ref('fillRef'); if (fr && num(fr.getAttribute('idx')) > 0) fill = colorOf(fr, theme); }
      if (geo.open || noFill) fill = null;
      const ln = kid(spPr, 'ln', A);
      let stroke = null;
      if (!(ln && kid(ln, 'noFill', A))) {
        const lf = ln && (kid(ln, 'solidFill', A) || (kid(ln, 'gradFill', A) && kid(kid(kid(ln, 'gradFill', A), 'gsLst', A), 'gs', A)));
        if (lf) stroke = colorOf(lf, theme);
        else { const lr = ref('lnRef'); stroke = lr && num(lr.getAttribute('idx')) > 0 ? colorOf(lr, theme) : (ln ? { c: '#000000', a: 1 } : null); }
      }
      const sw = ln && ln.getAttribute('w') ? Math.max(0.25, num(ln.getAttribute('w')) / EMU) : (ref('lnRef') ? [0.75, 0.75, 1.5, 2.25][Math.min(3, num(ref('lnRef').getAttribute('idx')))] : 0.75);
      const pd = ln && kid(ln, 'prstDash', A);
      const dash = pd ? { dash: [4, 3], sysDash: [3, 1], dot: [1, 2], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 2, 1, 2], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] }[pd.getAttribute('val')] || null : null;
      const end = (e) => (e && e.getAttribute('type') && e.getAttribute('type') !== 'none' ? { type: e.getAttribute('type'), size: e.getAttribute('len') || e.getAttribute('w') || 'med' } : null);
      drawPath(geo, m, fill, stroke, sw, dash, end(ln && kid(ln, 'headEnd', A)), end(ln && kid(ln, 'tailEnd', A)));
      // рисунок-заливка фигуры
      if (bf && ctx && ctx.images) {
        const blip = kid(bf, 'blip', A);
        const id = blip && (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'));
        if (id && ctx.images[id]) out.push(`<image href="${ctx.images[id]}" x="0" y="0" width="${r2(xf.w)}" height="${r2(xf.h)}" preserveAspectRatio="none" transform="${mtx(m)}"/>`);
      }
      // линии — для поиска разделителей дорожек
      if (geo.open || xf.w < 3 || xf.h < 3) { const p0 = apply(m, 0, 0), p1 = apply(m, xf.w, xf.h); lines.push({ x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) }); }
      // текст: надпись Word (w:txbxContent) или тело DrawingML (a:txBody)
      const fr = ref('fontRef');
      const fcol = fr ? ((colorOf(fr, theme) || {}).c || null) : null;
      const body = anyKid(sp, 'bodyPr');
      const bo = (b) => ({ L: num(b && b.getAttribute('lIns'), 91440) / EMU, T: num(b && b.getAttribute('tIns'), 45720) / EMU, R: num(b && b.getAttribute('rIns'), 91440) / EMU, B: num(b && b.getAttribute('bIns'), 45720) / EMU, anchor: b && b.getAttribute('anchor'), vert: b && b.getAttribute('vert'), wrap: !(b && b.getAttribute('wrap') === 'none') });
      const txbx = anyKid(sp, 'txbx');
      const tc = txbx && txbx.getElementsByTagNameNS(W, 'txbxContent')[0];
      const trc = cust ? { x: 0, y: 0, w: xf.w, h: xf.h } : textRect(prst ? prst.getAttribute('prst') : 'rect', xf.w, xf.h, adj);
      const tmr = mul(m, tr(trc.x, trc.y));
      if (tc) drawText(wordParas(tc, fcol), tmr, trc.w, trc.h, { ...bo(body), color: fcol });
      const txBody = anyKid(sp, 'txBody');
      if (txBody) {
        const b = kid(txBody, 'bodyPr', A);
        const fa = b && kid(b, 'normAutofit', A);
        const txx = anyKid(sp, 'txXfrm');
        const tx = txx ? xfrmOf(txx) : null;
        drawText(dmlParas(txBody, fcol), tx ? mul(parentM, tx.m) : tmr, tx ? tx.w : trc.w, tx ? tx.h : trc.h, { ...bo(b), color: fcol, scale: fa && fa.getAttribute('fontScale') ? num(fa.getAttribute('fontScale')) / 100000 : 1 });
      }
    }
    function dmlPicture(pic, parentM, ext) {
      const spPr = anyKid(pic, 'spPr');
      let xf = xfrmOf(kid(spPr, 'xfrm', A));
      if ((!xf || (!xf.w && !xf.h)) && ext) xf = { m: I, w: ext.w, h: ext.h };
      const blip = pic.getElementsByTagNameNS(A, 'blip')[0];
      const id = blip && (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'));
      if (!xf) return;
      const m = mul(parentM, xf.m);
      growBox(m, xf.w, xf.h);
      solid++;
      if (id && ctx && ctx.images && ctx.images[id]) out.push(`<image href="${ctx.images[id]}" x="0" y="0" width="${r2(xf.w)}" height="${r2(xf.h)}" preserveAspectRatio="none" transform="${mtx(m)}"/>`);
      else out.push(`<rect x="0" y="0" width="${r2(xf.w)}" height="${r2(xf.h)}" fill="#f2f2f2" stroke="#bbbbbb" stroke-width="${r2(0.75 / scaleOf(m))}" transform="${mtx(m)}"/>`);
    }
    function dmlGroup(g, parentM) {
      const gp = anyKid(g, 'grpSpPr');
      const x = kid(gp, 'xfrm', A);
      let m = parentM;
      if (x) {
        const off = kid(x, 'off', A), ex = kid(x, 'ext', A), co = kid(x, 'chOff', A), ce = kid(x, 'chExt', A);
        const ox = num(off && off.getAttribute('x')) / EMU, oy = num(off && off.getAttribute('y')) / EMU;
        const w = num(ex && ex.getAttribute('cx')) / EMU, h = num(ex && ex.getAttribute('cy')) / EMU;
        const cx = num(co && co.getAttribute('x')) / EMU, cy = num(co && co.getAttribute('y')) / EMU;
        const cw = num(ce && ce.getAttribute('cx')) / EMU || w || 1, ch = num(ce && ce.getAttribute('cy')) / EMU || h || 1;
        const rot = num(x.getAttribute('rot')) / 60000;
        let gm = tr(ox + w / 2, oy + h / 2);
        if (rot) gm = mul(gm, rotM(rot));
        gm = mul(gm, [x.getAttribute('flipH') === '1' ? -1 : 1, 0, 0, x.getAttribute('flipV') === '1' ? -1 : 1, 0, 0]);
        gm = mul(gm, tr(-w / 2, -h / 2));
        gm = mul(gm, [(w || cw) / cw, 0, 0, (h || ch) / ch, -cx * (w || cw) / cw, -cy * (h || ch) / ch]);
        m = mul(parentM, gm);
      }
      Array.from(g.children).forEach((c) => dmlNode(c, m, null));
    }
    function dmlNode(c, m, ext) {
      const n = c.localName;
      if (n === 'wsp' || n === 'sp' || n === 'cxnSp') dmlShape(c, m, ext);
      else if (n === 'grpSp' || n === 'wgp') dmlGroup(c, m);
      else if (n === 'wpc') { if (ext) growBox(m, ext.w, ext.h); Array.from(c.children).forEach((k) => dmlNode(k, m, null)); }
      else if (n === 'spTree') Array.from(c.children).forEach((k) => dmlNode(k, m, null));
      else if (n === 'pic') dmlPicture(c, m, ext);
      else if (n === 'AlternateContent') { const ch = kid(c, 'Choice') || kid(c, 'Fallback'); if (ch) Array.from(ch.children).forEach((k) => dmlNode(k, m, ext)); }
    }
    // Корень рисунка w:drawing (wp:inline / wp:anchor → a:graphic → a:graphicData → wps:wsp | wpg:wgp | wpc:wpc | pic:pic)
    function drawing(d, baseM) {
      const ex = d.getElementsByTagNameNS(WP, 'extent')[0];
      const ext = ex ? { w: num(ex.getAttribute('cx')) / EMU, h: num(ex.getAttribute('cy')) / EMU } : null;
      const gd = d.getElementsByTagNameNS(A, 'graphicData')[0];
      const root = gd && Array.from(gd.children)[0];
      if (!root) return false;
      const before = out.length;
      dmlNode(root, baseM, ext);
      return out.length > before;
    }
    // SmartArt: готовый рисунок dsp:drawing (word/diagrams/drawingN.xml), координаты — внутри рамки wp:extent
    function smartArt(drawDoc, baseM, ext) {
      const tree = Array.from(drawDoc.getElementsByTagName('*')).find((e) => e.localName === 'spTree');
      if (!tree) return false;
      const before = out.length;
      if (ext) growBox(baseM, ext.w, ext.h);
      Array.from(tree.children).forEach((k) => dmlNode(k, baseM, null));
      return out.length > before;
    }

    /* --- VML --- */
    function vmlStroke(el) {
      const sk = kid(el, 'stroke', V);
      const on = isTrue(el.getAttribute('stroked'), true) && isTrue(sk && sk.getAttribute('on'), true);
      if (!on) return { stroke: null };
      const col = vmlColor((sk && sk.getAttribute('color')) || el.getAttribute('strokecolor'), '#000000');
      const wRaw = (sk && sk.getAttribute('weight')) || el.getAttribute('strokeweight');
      let sw = wRaw ? len(wRaw, 0.75) : 0.75;
      if (wRaw && /^\d+$/.test(wRaw) && +wRaw > 500) sw = +wRaw / EMU;
      const ds = ((sk && sk.getAttribute('dashstyle')) || '').trim();
      const dash = { dash: [4, 3], shortdash: [3, 1], dot: [1, 2], shortdot: [1, 1], longdash: [8, 3], dashdot: [4, 2, 1, 2], shortdashdot: [3, 1, 1, 1], longdashdot: [8, 3, 1, 3], longdashdotdot: [8, 3, 1, 3, 1, 3] }[ds.toLowerCase()] || (/^\d+(\s+\d+)+$/.test(ds) ? ds.split(/\s+/).map(Number) : null);
      const arrow = (k) => { const t = sk && sk.getAttribute(`${k}arrow`); return t && t !== 'none' ? { type: t, size: { short: 'sm', long: 'lg' }[sk.getAttribute(`${k}arrowlength`)] || 'med' } : null; };
      return { stroke: { c: col, a: 1 }, sw: Math.max(0.25, sw || 0.75), dash, head: arrow('start'), tail: arrow('end') };
    }
    function vmlFill(el) {
      const fl = kid(el, 'fill', V);
      const on = isTrue(el.getAttribute('filled'), true) && isTrue(fl && fl.getAttribute('on'), true);
      if (!on) return null;
      const op = fl && fl.getAttribute('opacity');
      let a = 1;
      if (op) a = /f$/.test(op) ? num(op) / 65536 : num(op, 1);
      return { c: vmlColor((fl && fl.getAttribute('color')) || el.getAttribute('fillcolor'), '#FFFFFF'), a };
    }
    function vmlText(el, m, w, h, trc) {
      const tb = kid(el, 'textbox', V);
      const tc = tb && tb.getElementsByTagNameNS(W, 'txbxContent')[0];
      if (!tc) return;
      if (trc) { m = mul(m, tr(trc.x, trc.y)); w = trc.w; h = trc.h; }
      const ins = String(tb.getAttribute('inset') || '').split(',').map((s) => len(s.trim(), 0.75));
      const css = cssOf(tb.getAttribute('style'));
      const vert = /vertical/.test(css['layout-flow'] || '') ? (/bottom-to-top/.test(css['mso-layout-flow-alt'] || '') ? 'vert270' : 'vert') : null;
      drawText(wordParas(tc, null), m, w, h, { L: ins[0] ?? 7.2, T: ins[1] ?? 3.6, R: ins[2] ?? 7.2, B: ins[3] ?? 3.6, vert, anchor: css['v-text-anchor'] });
    }
    // Положение фигуры VML: в группе — left/top/width/height в координатах группы; вне группы — margin-left/top в pt
    function vmlBox(el, inGroup) {
      const css = cssOf(el.getAttribute('style'));
      const u = inGroup ? 1 : 0.75;
      const x = len(inGroup ? css.left : (css['margin-left'] ?? css.left), u) || 0;
      const y = len(inGroup ? css.top : (css['margin-top'] ?? css.top), u) || 0;
      const w = len(css.width, u) || 0, h = len(css.height, u) || 0;
      return { x, y, w, h, rot: num(css.rotation), flip: css.flip || '', css };
    }
    function vmlMatrix(b) {
      let m = tr(b.x + b.w / 2, b.y + b.h / 2);
      if (b.rot) m = mul(m, rotM(b.rot));
      m = mul(m, [/x/.test(b.flip) ? -1 : 1, 0, 0, /y/.test(b.flip) ? -1 : 1, 0, 0]);
      return mul(m, tr(-b.w / 2, -b.h / 2));
    }
    function vmlNode(el, parentM, inGroup, types) {
      if (el.namespaceURI !== V) return;
      const n = el.localName;
      if (['shapetype', 'fill', 'stroke', 'textbox', 'imagedata', 'path', 'formulas', 'handles', 'shadow', 'textpath'].includes(n)) return;
      if (n === 'group') {
        const b = vmlBox(el, inGroup);
        const cs = String(el.getAttribute('coordsize') || '1000,1000').split(',').map(Number);
        const co = String(el.getAttribute('coordorigin') || '0,0').split(',').map(Number);
        const cw = cs[0] || 1000, ch = cs[1] || cw;
        const m = mul(mul(parentM, vmlMatrix(b)), [b.w / cw, 0, 0, b.h / ch, -(co[0] || 0) * b.w / cw, -(co[1] || 0) * b.h / ch]);
        Array.from(el.children).forEach((c) => vmlNode(c, m, true, types));
        return;
      }
      const st = vmlStroke(el);
      const fill = vmlFill(el);
      if (n === 'line' || n === 'polyline' || n === 'curve') {
        const u = inGroup ? 1 : 0.75;
        const P = (s) => { const v = String(s || '0,0').split(',').map((t) => len(t.trim(), u) || 0); return [v[0] || 0, v[1] || 0]; };
        let d;
        let pts;
        if (n === 'line') { pts = [P(el.getAttribute('from')), P(el.getAttribute('to'))]; d = `M${r2(pts[0][0])} ${r2(pts[0][1])} L${r2(pts[1][0])} ${r2(pts[1][1])}`; }
        else if (n === 'curve') { pts = ['from', 'control1', 'control2', 'to'].map((k) => P(el.getAttribute(k))); d = `M${r2(pts[0][0])} ${r2(pts[0][1])} C${pts.slice(1).map((p) => `${r2(p[0])} ${r2(p[1])}`).join(' ')}`; }
        else { const raw = String(el.getAttribute('points') || '').split(/[\s,]+/).filter(Boolean).map((t) => len(t, u) || 0); pts = []; for (let i = 0; i + 1 < raw.length; i += 2) pts.push([raw[i], raw[i + 1]]); if (pts.length < 2) return; d = `M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join(' L')}`; }
        // вне группы координаты линии — от точки привязки (margin-left/top)
        const b = inGroup ? null : vmlBox(el, false);
        const m = b ? mul(parentM, tr(b.x, b.y)) : parentM;
        pts.forEach((p) => { const g = apply(m, p[0], p[1]); grow(g[0], g[1]); });
        const closed = n === 'polyline' && fill && pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
        drawPath({ d: closed ? `${d} Z` : d }, m, closed ? fill : null, st.stroke, st.sw, st.dash, st.head, st.tail);
        if (n === 'line') { const g0 = apply(m, pts[0][0], pts[0][1]), g1 = apply(m, pts[1][0], pts[1][1]); lines.push({ x0: Math.min(g0[0], g1[0]), y0: Math.min(g0[1], g1[1]), x1: Math.max(g0[0], g1[0]), y1: Math.max(g0[1], g1[1]) }); }
        return;
      }
      const b = vmlBox(el, inGroup);
      if (!b.w && !b.h) return;
      const m = mul(parentM, vmlMatrix(b));
      growBox(m, b.w, b.h);
      let geo = null;
      let trc = null;
      if (n === 'rect') geo = preset('rect', b.w, b.h);
      else if (n === 'roundrect') { const as = el.getAttribute('arcsize') || '0.2'; const k = /f$/.test(as) ? num(as) / 65536 : num(as, 0.2); geo = preset('roundRect', b.w, b.h, { 0: k * 50000 }); }
      else if (n === 'oval') { geo = preset('ellipse', b.w, b.h); trc = textRect('ellipse', b.w, b.h); }
      else if (n === 'arc') geo = preset('arc', b.w, b.h);
      else if (n === 'shape' || n === 'image') {
        const tref = (el.getAttribute('type') || '').replace(/^#/, '');
        const t = tref && types ? types[tref] : null;
        const spt = el.getAttributeNS(O, 'spt') || el.getAttribute('o:spt') || (t && (t.getAttributeNS(O, 'spt') || t.getAttribute('o:spt'))) || (tref.match(/_x0000_t(\d+)/) || [])[1];
        const own = el.getAttribute('path');
        const cs = String(el.getAttribute('coordsize') || (t && t.getAttribute('coordsize')) || (own ? '1000,1000' : '21600,21600')).split(',').map(Number);
        const co = String(el.getAttribute('coordorigin') || '0,0').split(',').map(Number);
        geo = own ? vmlPath(own, cs[0], cs[1] || cs[0], co[0] || 0, co[1] || 0, b.w, b.h) : null;
        const adjRaw = String(el.getAttribute('adj') || (t && t.getAttribute('adj')) || '').split(',').filter((s) => s.trim() !== '').map(Number);
        const adj = {};
        adjRaw.forEach((v, i) => { adj[i] = v / 21600 * 100000; });
        if (!geo && spt !== undefined && spt !== null && SPT[+spt]) geo = preset(SPT[+spt], b.w, b.h, adj);
        // область текста: textboxrect у v:path фигуры или её типа, иначе — как у готовой формы
        const vp = kid(el, 'path', V) || (t && kid(t, 'path', V));
        const tbr = vp && vp.getAttribute('textboxrect');
        if (tbr && !/@/.test(tbr)) {
          const q = tbr.split(';')[0].split(',').map(Number);
          if (q.length === 4 && q.every(Number.isFinite)) { const kx = b.w / (cs[0] || 21600), ky = b.h / ((cs[1] || cs[0]) || 21600); trc = { x: q[0] * kx, y: q[1] * ky, w: Math.max(1, (q[2] - q[0]) * kx), h: Math.max(1, (q[3] - q[1]) * ky) }; }
        }
        if (!trc && spt !== undefined && spt !== null && SPT[+spt]) trc = textRect(SPT[+spt], b.w, b.h, adj);
        if (!geo && t && t.getAttribute('path')) { const tcs = String(t.getAttribute('coordsize') || '21600,21600').split(',').map(Number); geo = vmlPath(t.getAttribute('path'), tcs[0], tcs[1] || tcs[0], 0, 0, b.w, b.h); }
        if (!geo) geo = preset('rect', b.w, b.h);
      }
      if (!geo) return;
      const img = kid(el, 'imagedata', V);
      if (img) {
        const imgId = img.getAttributeNS(R, 'id') || img.getAttribute('r:id') || img.getAttributeNS(R, 'pict');
        if (imgId && ctx && ctx.images && ctx.images[imgId]) solid++;
        if (imgId && ctx && ctx.images && ctx.images[imgId]) out.push(`<image href="${ctx.images[imgId]}" x="0" y="0" width="${r2(b.w)}" height="${r2(b.h)}" preserveAspectRatio="none" transform="${mtx(m)}"/>`);
        // у рисунка VML рамка — только если задана явно
        if (el.getAttribute('stroked') === 't' || kid(el, 'stroke', V)) drawPath(geo, m, null, st.stroke, st.sw, st.dash, null, null);
        return;
      }
      drawPath(geo, m, geo.open ? null : fill, st.stroke, st.sw, st.dash, st.head, st.tail);
      if (geo.open) { const p0 = apply(m, 0, 0), p1 = apply(m, b.w, b.h); lines.push({ x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) }); }
      vmlText(el, m, b.w, b.h, trc);
    }
    // w:pict: фигуры VML (группа или отдельные фигуры); baseM — сдвиг (положение на холсте)
    function pict(p, baseM, types) {
      const before = out.length;
      Array.from(p.children).forEach((c) => { if (c.namespaceURI === V && c.localName !== 'shapetype') vmlNode(c, baseM, false, types); });
      return out.length > before;
    }

    function finish(pad = 4) {
      if (!out.length || !solid || !Number.isFinite(box.x0)) return null;
      const x0 = box.x0 - pad, y0 = box.y0 - pad;
      const w = r2(box.x1 - box.x0 + pad * 2), h = r2(box.y1 - box.y0 + pad * 2);
      if (w < 2 || h < 2) return null;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(x0)} ${r2(y0)} ${w} ${h}" width="${w}" height="${h}"><rect x="${r2(x0)}" y="${r2(y0)}" width="${w}" height="${h}" fill="#ffffff"/>${markers.size ? `<defs>${[...markers.values()].map((x) => x.svg).join('')}</defs>` : ''}${out.join('')}</svg>`;
      const DF = window.ISM.docxFigures;
      const loc = texts.map((t) => ({ ...t, x: t.x - x0, y: t.y - y0 }));
      const els = lines.map((l) => ({ x0: l.x0 - x0, x1: l.x1 - x0, y0: -(l.y1 - y0), y1: -(l.y0 - y0) }));
      const diagram = DF && loc.length ? DF.diagramFromTexts(loc, w, h, els) : null;
      if (diagram) {
        // надписи — по фигурам (один блок текста = одна надпись), сверху вниз и слева направо
        const lanes = diagram.lanes && diagram.lanes.length;
        const ordered = boxLabels.filter((b) => b.s.length >= 2 && !(lanes && b.rot)).sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x)).map((b) => b.s);
        if (ordered.length) diagram.labels = [...new Set(ordered)];
      }
      return { svg, diagram, width: w, height: h, texts: loc };
    }
    // Для других источников фигур (OfficeArt старых .doc): примитивы сцены
    const image = (src, m, w, h) => { growBox(m, w, h); solid++; out.push(`<image href="${src}" x="0" y="0" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="none" transform="${mtx(m)}"/>`); };
    const segment = (m, w, h) => { const p0 = apply(m, 0, 0), p1 = apply(m, w, h); lines.push({ x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) }); };
    return { drawing, smartArt, pict, finish, path: drawPath, text: drawText, grow: growBox, image, segment, count: () => out.length };
  }

  /* ---------- Положение плавающих фигур ---------- */
  // Координаты «потока текста»: x — от левого поля, y — от верха текста первой страницы; страницы идут подряд (по высоте текста)
  function flowPos(page, py, rel, offX, offY, alignH, alignV, w, h) {
    const textW = page.w - page.left - page.right, textH = page.h - page.top - page.bottom;
    const pageIdx = Math.max(0, Math.floor((py || 0) / textH));
    const fx = (frame) => {
      if (frame === 'page') return { x0: -page.left, w: page.w };
      if (frame === 'leftMargin' || frame === 'left-margin-area') return { x0: -page.left, w: page.left };
      if (frame === 'rightMargin' || frame === 'right-margin-area') return { x0: textW, w: page.right };
      return { x0: 0, w: textW }; // margin, column, character, text
    };
    const hf = fx(rel.h);
    const x = alignH ? hf.x0 + (alignH === 'center' ? (hf.w - w) / 2 : alignH === 'right' || alignH === 'outside' ? hf.w - w : 0) : hf.x0 + (offX || 0);
    const fy = (frame) => {
      if (frame === 'page') return { y0: pageIdx * textH - page.top, h: page.h };
      if (frame === 'margin' || frame === 'topMargin' || frame === 'top-margin-area') return { y0: pageIdx * textH, h: textH };
      if (frame === 'bottomMargin' || frame === 'bottom-margin-area') return { y0: pageIdx * textH + textH, h: page.bottom };
      return { y0: py || 0, h: 0 }; // paragraph, line, text
    };
    const vf = fy(rel.v);
    const y = alignV && vf.h ? vf.y0 + (alignV === 'center' ? (vf.h - h) / 2 : alignV === 'bottom' || alignV === 'outside' ? vf.h - h : 0) : vf.y0 + (offY || 0);
    return { x, y };
  }
  // Положение и размер плавающего рисунка w:drawing / w:pict в «потоке»; null — рисунок в строке текста
  function placement(el, py, page) {
    page = page || PAGE_DEFAULT;
    if (el.localName === 'drawing') {
      const an = el.getElementsByTagNameNS(WP, 'anchor')[0];
      if (!an) return null;
      const ex = kid(an, 'extent', WP);
      const w = num(ex && ex.getAttribute('cx')) / EMU, h = num(ex && ex.getAttribute('cy')) / EMU;
      const z = num(an.getAttribute('relativeHeight')), behind = an.getAttribute('behindDoc') === '1';
      if (an.getAttribute('simplePos') === '1') {
        const sp = kid(an, 'simplePos', WP);
        const pos = flowPos(page, py, { h: 'page', v: 'page' }, num(sp && sp.getAttribute('x')) / EMU, num(sp && sp.getAttribute('y')) / EMU, null, null, w, h);
        return { ...pos, w, h, z, behind };
      }
      const ph = kid(an, 'positionH', WP), pv = kid(an, 'positionV', WP);
      const offOf = (p) => { const o = kid(p, 'posOffset', WP); return o ? num(o.textContent) / EMU : null; };
      const alOf = (p) => { const o = kid(p, 'align', WP); return o ? norm(o.textContent) : null; };
      const pos = flowPos(page, py, { h: ph && ph.getAttribute('relativeFrom'), v: pv && pv.getAttribute('relativeFrom') }, offOf(ph), offOf(pv), alOf(ph), alOf(pv), w, h);
      return { ...pos, w, h, z, behind };
    }
    if (el.localName === 'pict') {
      const top = Array.from(el.children).find((c) => c.namespaceURI === V && c.localName !== 'shapetype');
      if (!top) return null;
      const css = cssOf(top.getAttribute('style'));
      if (!/absolute/.test(css.position || '')) return null;
      let w = len(css.width) || 0, h = len(css.height) || 0;
      const dx = len(css['margin-left'] ?? css.left) || 0, dy = len(css['margin-top'] ?? css.top) || 0;
      let offX = dx, offY = dy;
      if (top.localName === 'line') {
        const P = (s) => String(s || '0,0').split(',').map((t) => len(t.trim()) || 0);
        const f = P(top.getAttribute('from')), t = P(top.getAttribute('to'));
        offX += Math.min(f[0], t[0]); offY += Math.min(f[1], t[1]); w = Math.abs(t[0] - f[0]); h = Math.abs(t[1] - f[1]);
      }
      const relH = css['mso-position-horizontal-relative'] || 'text', relV = css['mso-position-vertical-relative'] || 'text';
      const al = (v) => (v && v !== 'absolute' ? v : null);
      const pos = flowPos(page, py, { h: relH === 'text' || relH === 'char' ? 'column' : relH, v: relV === 'text' || relV === 'line' ? 'paragraph' : relV }, offX, offY, al(css['mso-position-horizontal']), al(css['mso-position-vertical']), w, h);
      const z = num(css['z-index']);
      // сдвиг холста: фигура рисуется со своим margin-left/top, поэтому вычитаем его
      return { x: pos.x, y: pos.y, w, h, z: z + 1e9, behind: z < 0, vml: true, shiftX: pos.x - offX, shiftY: pos.y - offY };
    }
    return null;
  }

  // Типы фигур VML (v:shapetype) документа — один раз на документ
  const typesCache = new WeakMap();
  function vmlTypes(docNode) {
    if (!docNode) return {};
    if (typesCache.has(docNode)) return typesCache.get(docNode);
    const t = {};
    Array.from(docNode.getElementsByTagNameNS(V, 'shapetype')).forEach((s) => { if (s.getAttribute('id')) t[s.getAttribute('id')] = s; });
    typesCache.set(docNode, t);
    return t;
  }

  /* ---------- Отрисовка ---------- */
  // Один рисунок: w:drawing (DrawingML), w:pict (VML) или SmartArt (ctx.smartArt — разобранный drawingN.xml)
  function render(el, ctx) {
    const S = scene(ctx);
    let ok;
    if (ctx && ctx.smartArt) ok = S.smartArt(ctx.smartArt, I, ctx.smartArtExt);
    else if (el.localName === 'pict') ok = S.pict(el, I, vmlTypes(el.ownerDocument));
    else ok = S.drawing(el, I);
    return ok ? S.finish() : null;
  }
  // Несколько плавающих фигур одной схемы: items = [{el, py}] — общий холст по положению каждой
  function renderMany(items, ctx) {
    const page = (ctx && ctx.page) || PAGE_DEFAULT;
    const S = scene(ctx);
    const placed = items.map((it, i) => ({ ...it, i, pos: placement(it.el, it.py, page) })).filter((it) => it.pos);
    placed.sort((a, b) => (a.pos.behind === b.pos.behind ? 0 : a.pos.behind ? -1 : 1) || a.pos.z - b.pos.z || a.i - b.i);
    let any = false;
    placed.forEach((it) => {
      if (it.el.localName === 'pict') any = S.pict(it.el, tr(it.pos.shiftX, it.pos.shiftY), vmlTypes(it.el.ownerDocument)) || any;
      else any = S.drawing(it.el, tr(it.pos.x, it.pos.y)) || any;
    });
    return any ? S.finish() : null;
  }

  window.ISM = window.ISM || {};
  window.ISM.drawingml = { render, renderMany, placement, scene, flowPos, preset, textRect, SPT, colorOf, vmlPath, vmlColor, mul, tr, rotM, THEME_DEFAULT, PAGE_DEFAULT };
})();
