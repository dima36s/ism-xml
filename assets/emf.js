/* ИСМ XML — отрисовка метафайлов EMF в SVG (рисунки Word, превью встроенных схем Visio).
   Проигрываются записи GDI: перья, кисти, шрифты, многоугольники, кривые Безье, пути, прямоугольники, эллипсы,
   текст (EXTTEXTOUTW, Юникод) с точной шириной строки, растровые вставки (DIB → PNG). Преобразование координат —
   как в GDI: мировое преобразование, затем окно/область вывода по режиму отображения. Записи EMF+ не читаются:
   в файлах «EMF+ dual» (Visio, Office) рядом всегда есть обычные записи EMF, они и рисуются.
   Возвращает {svg, texts:[{s, x, y, size, angle}]} — текст нужен для поиска требований на схеме. */
(() => {
  'use strict';
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[\ud800-\udfff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r2 = (x) => Math.round(x * 100) / 100;
  const hex = (c) => `#${[c & 255, (c >> 8) & 255, (c >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const STOCK = {
    0x80000000: { t: 'brush', color: '#ffffff' }, 0x80000001: { t: 'brush', color: '#c0c0c0' }, 0x80000002: { t: 'brush', color: '#808080' },
    0x80000003: { t: 'brush', color: '#404040' }, 0x80000004: { t: 'brush', color: '#000000' }, 0x80000005: { t: 'brush', color: null },
    0x80000006: { t: 'pen', color: '#ffffff', width: 0, style: 0 }, 0x80000007: { t: 'pen', color: '#000000', width: 0, style: 0 }, 0x80000008: { t: 'pen', color: null, width: 0, style: 5 },
    0x8000000A: { t: 'font', height: -12, face: 'Courier New' }, 0x8000000B: { t: 'font', height: -12, face: 'Courier New' }, 0x8000000C: { t: 'font', height: -12, face: 'Arial' },
    0x8000000D: { t: 'font', height: -12, face: 'Arial' }, 0x8000000E: { t: 'font', height: -12, face: 'Arial' }, 0x80000010: { t: 'font', height: -12, face: 'Courier New' },
    0x80000011: { t: 'font', height: -11, face: 'Segoe UI' }, 0x80000012: { t: 'brush', color: '#ffffff' }, 0x80000013: { t: 'pen', color: '#000000', width: 0, style: 0 },
  };

  // DIB (BITMAPINFOHEADER + пиксели) → PNG data URI через холст
  function dibToPng(u8, offBmi, offBits) {
    try {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const hs = dv.getUint32(offBmi, true);
      const w = dv.getInt32(offBmi + 4, true);
      let h = dv.getInt32(offBmi + 8, true);
      const bpp = dv.getUint16(offBmi + 14, true);
      const comp = dv.getUint32(offBmi + 16, true);
      const sizeImg = dv.getUint32(offBmi + 20, true);
      if (comp === 4 || comp === 5) { // встроенный JPEG или PNG
        const raw = u8.subarray(offBits, offBits + sizeImg);
        let bin = ''; for (let i = 0; i < raw.length; i += 0x8000) bin += String.fromCharCode.apply(null, raw.subarray(i, i + 0x8000));
        return `data:image/${comp === 4 ? 'jpeg' : 'png'};base64,${btoa(bin)}`;
      }
      if (comp !== 0 && comp !== 3) return null;
      const topDown = h < 0; h = Math.abs(h);
      if (!w || !h || w * h > 25e6) return null;
      let nColors = hs >= 36 ? dv.getUint32(offBmi + 32, true) : 0;
      if (!nColors && bpp <= 8) nColors = 1 << bpp;
      const pal = [];
      const palOff = offBmi + hs + (comp === 3 && hs === 40 ? 12 : 0);
      for (let i = 0; i < nColors && bpp <= 8; i++) pal.push([u8[palOff + i * 4 + 2], u8[palOff + i * 4 + 1], u8[palOff + i * 4]]);
      const stride = Math.ceil((w * bpp) / 32) * 4;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const row = offBits + (topDown ? y : h - 1 - y) * stride;
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 255;
          if (bpp === 24) { const p = row + x * 3; b = u8[p]; g = u8[p + 1]; r = u8[p + 2]; }
          else if (bpp === 32) { const p = row + x * 4; b = u8[p]; g = u8[p + 1]; r = u8[p + 2]; }
          else if (bpp === 16) { const v = u8[row + x * 2] | (u8[row + x * 2 + 1] << 8); r = ((v >> 10) & 31) * 8; g = ((v >> 5) & 31) * 8; b = (v & 31) * 8; }
          else { const bitsPer = bpp; const bit = x * bitsPer; const byte = u8[row + (bit >> 3)]; const idx = (byte >> (8 - bitsPer - (bit & 7))) & ((1 << bitsPer) - 1); [r, g, b] = pal[idx] || [0, 0, 0]; }
          const o = (y * w + x) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    } catch { return null; }
  }

  function render(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464D4520) throw new Error('Это не EMF');
    const bounds = [dv.getInt32(8, true), dv.getInt32(12, true), dv.getInt32(16, true), dv.getInt32(20, true)];
    const devPx = [dv.getInt32(72, true), dv.getInt32(76, true)];
    const devMm = [dv.getInt32(80, true), dv.getInt32(84, true)];
    const pxPerMm = [devPx[0] / (devMm[0] || 1), devPx[1] / (devMm[1] || 1)];
    const out = [];
    const texts = [];
    const objs = {};
    let st = {
      world: [1, 0, 0, 1, 0, 0], mapMode: 1, wOrg: [0, 0], wExt: [1, 1], vOrg: [0, 0], vExt: [1, 1],
      pen: STOCK[0x80000007], brush: STOCK[0x80000000], font: STOCK[0x8000000D], textColor: '#000000', bkColor: '#ffffff', bkMode: 2,
      align: 0, fill: 'nonzero', cur: [0, 0],
    };
    const stack = [];
    let path = null; // накопление пути между BEGINPATH и ENDPATH
    let fig = '';
    // логические координаты → устройство
    function scale() {
      switch (st.mapMode) {
        case 2: return [0.1 * pxPerMm[0], -0.1 * pxPerMm[1]];
        case 3: return [0.01 * pxPerMm[0], -0.01 * pxPerMm[1]];
        case 4: return [0.254 * pxPerMm[0], -0.254 * pxPerMm[1]];
        case 5: return [0.0254 * pxPerMm[0], -0.0254 * pxPerMm[1]];
        case 6: return [25.4 / 1440 * pxPerMm[0], -25.4 / 1440 * pxPerMm[1]];
        case 7: case 8: { const sx = st.vExt[0] / (st.wExt[0] || 1), sy = st.vExt[1] / (st.wExt[1] || 1); if (st.mapMode === 7) { const s = Math.min(Math.abs(sx), Math.abs(sy)); return [Math.sign(sx) * s, Math.sign(sy) * s]; } return [sx, sy]; }
        default: return [1, 1];
      }
    }
    function M() {
      const [sx, sy] = scale();
      const page = st.mapMode === 1 ? [1, 0, 0, 1, 0, 0] : [sx, 0, 0, sy, st.vOrg[0] - st.wOrg[0] * sx, st.vOrg[1] - st.wOrg[1] * sy];
      if (st.mapMode === 1) { page[4] = st.vOrg[0] - st.wOrg[0]; page[5] = st.vOrg[1] - st.wOrg[1]; }
      return mul(page, st.world);
    }
    const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const P = (x, y) => {
      const m = M();
      const p = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6) { ext.x0 = Math.min(ext.x0, p[0]); ext.y0 = Math.min(ext.y0, p[1]); ext.x1 = Math.max(ext.x1, p[0]); ext.y1 = Math.max(ext.y1, p[1]); }
      return p;
    };
    const pt = (x, y) => { const p = P(x, y); return `${r2(p[0])} ${r2(p[1])}`; };
    const lenScale = () => { const m = M(); return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };
    function strokeAttr() {
      const p = st.pen;
      if (!p || p.color == null || (p.style & 15) === 5) return 'stroke="none"';
      const w = Math.max(0.6, (p.width || 0) * (p.geometric ? lenScale() : 1) || 1);
      const dash = { 1: [3, 1.5], 2: [1, 1.5], 3: [3, 1.5, 1, 1.5], 4: [3, 1.5, 1, 1.5, 1, 1.5] }[p.style & 15];
      return `stroke="${p.color}" stroke-width="${r2(w)}" stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash.map((d) => r2(d * w)).join(' ')}"` : ''}`;
    }
    const fillAttr = () => (st.brush && st.brush.color != null ? `fill="${st.brush.color}" fill-rule="${st.fill}"` : 'fill="none"');
    const emit = (d, fill, stroke) => { if (!d) return; out.push(`<path d="${d}" ${fill ? fillAttr() : 'fill="none"'} ${stroke ? strokeAttr() : 'stroke="none"'}/>`); };
    const shape = (d, closed) => { if (path) { path.push(d); return; } emit(d, closed, true); };
    function points(off, n, small) {
      const a = [];
      for (let i = 0; i < n; i++) a.push(small ? [dv.getInt16(off + i * 4, true), dv.getInt16(off + i * 4 + 2, true)] : [dv.getInt32(off + i * 8, true), dv.getInt32(off + i * 8 + 4, true)]);
      return a;
    }
    const polyD = (pts, close) => (pts.length ? `M${pt(...pts[0])}${pts.slice(1).map((p) => ` L${pt(...p)}`).join('')}${close ? ' Z' : ''}` : '');
    const bezD = (pts, from) => {
      let d = from ? '' : `M${pt(...pts[0])}`;
      for (let i = from ? 0 : 1; i + 2 < pts.length; i += 3) d += ` C${pt(...pts[i])} ${pt(...pts[i + 1])} ${pt(...pts[i + 2])}`;
      return d;
    };
    function ellipseD(l, t, r, b) {
      const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
      const k = 0.5523;
      return `M${pt(cx + rx, cy)} C${pt(cx + rx, cy + ry * k)} ${pt(cx + rx * k, cy + ry)} ${pt(cx, cy + ry)} C${pt(cx - rx * k, cy + ry)} ${pt(cx - rx, cy + ry * k)} ${pt(cx - rx, cy)} C${pt(cx - rx, cy - ry * k)} ${pt(cx - rx * k, cy - ry)} ${pt(cx, cy - ry)} C${pt(cx + rx * k, cy - ry)} ${pt(cx + rx, cy - ry * k)} ${pt(cx + rx, cy)} Z`;
    }
    function arcPts(l, t, r, b, sx, sy, ex, ey) {
      const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
      let a0 = Math.atan2((sy - cy) / (ry || 1), (sx - cx) / (rx || 1)), a1 = Math.atan2((ey - cy) / (ry || 1), (ex - cx) / (rx || 1));
      while (a1 >= a0) a1 -= 2 * Math.PI; // против часовой стрелки на экране — убывание угла при оси Y вниз
      const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.2));
      const pts = [];
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
      return { pts, c: [cx, cy] };
    }
    const n = u8.length;
    let off = 0;
    for (let guard = 0; off + 8 <= n && guard < 2e6; guard++) {
      const type = dv.getUint32(off, true);
      const size = dv.getUint32(off + 4, true);
      if (size < 8 || off + size > n) break;
      const at = (k) => off + k;
      const i32 = (k) => dv.getInt32(off + k, true);
      const u32 = (k) => dv.getUint32(off + k, true);
      switch (type) {
        case 14: off = n; continue; // EOF
        case 9: st.wExt = [i32(8), i32(12)]; break;
        case 10: st.wOrg = [i32(8), i32(12)]; break;
        case 11: st.vExt = [i32(8), i32(12)]; break;
        case 12: st.vOrg = [i32(8), i32(12)]; break;
        case 17: st.mapMode = u32(8); break;
        case 18: st.bkMode = u32(8); break;
        case 19: st.fill = u32(8) === 1 ? 'evenodd' : 'nonzero'; break;
        case 22: st.align = u32(8); break;
        case 24: st.textColor = hex(u32(8)); break;
        case 25: st.bkColor = hex(u32(8)); break;
        case 27: st.cur = [i32(8), i32(12)]; if (path) { fig = `M${pt(...st.cur)}`; path.push(fig); } break;
        case 33: stack.push({ ...st, world: st.world.slice() }); break;
        case 34: { let k = i32(8); if (k < 0) { while (k++ < 0 && stack.length) st = stack.pop(); } break; }
        case 35: st.world = [dv.getFloat32(at(8), true), dv.getFloat32(at(12), true), dv.getFloat32(at(16), true), dv.getFloat32(at(20), true), dv.getFloat32(at(24), true), dv.getFloat32(at(28), true)]; break;
        case 36: {
          const x = [dv.getFloat32(at(8), true), dv.getFloat32(at(12), true), dv.getFloat32(at(16), true), dv.getFloat32(at(20), true), dv.getFloat32(at(24), true), dv.getFloat32(at(28), true)];
          const mode = u32(32);
          if (mode === 1) st.world = [1, 0, 0, 1, 0, 0]; else if (mode === 2) st.world = mul(st.world, x); else if (mode === 3) st.world = mul(x, st.world); else if (mode === 4) st.world = x;
          break;
        }
        case 37: { const h = u32(8); const o = h >= 0x80000000 ? STOCK[h] : objs[h]; if (o) st[o.t] = o; break; }
        case 38: objs[u32(8)] = { t: 'pen', style: u32(12), width: i32(16), color: (u32(12) & 15) === 5 ? null : hex(u32(24)), geometric: true }; break;
        case 95: { const style = u32(28); objs[u32(8)] = { t: 'pen', style, width: u32(32), color: (style & 15) === 5 ? null : hex(u32(40)), geometric: !!(style & 0x10000) }; break; }
        case 39: { const style = u32(12); objs[u32(8)] = { t: 'brush', color: style === 1 ? null : hex(u32(16)) }; break; }
        case 93: case 94: objs[u32(8)] = { t: 'brush', color: '#c0c0c0' }; break;
        case 82: {
          let face = ''; for (let k = 0; k < 32; k++) { const ch = dv.getUint16(at(40 + k * 2), true); if (!ch) break; face += String.fromCharCode(ch); }
          objs[u32(8)] = { t: 'font', height: i32(12), esc: i32(20), weight: i32(28), italic: u8[at(32)], underline: u8[at(33)], face: face || 'Arial' };
          break;
        }
        case 40: delete objs[u32(8)]; break;
        case 2: case 3: case 4: case 5: case 6: case 85: case 86: case 87: case 88: case 89: {
          const small = type >= 85;
          const cnt = u32(24);
          const pts = points(at(28), cnt, small);
          const kind = small ? type - 83 : type; // 2 Безье, 3 многоугольник, 4 ломаная, 5 Безье от текущей, 6 ломаная от текущей
          if (kind === 2) shape(bezD(pts), false);
          else if (kind === 3) shape(polyD(pts, true), true);
          else if (kind === 4) shape(polyD(pts, false), false);
          else if (kind === 5) { const d = `${path ? '' : `M${pt(...st.cur)}`}${bezD(pts, true)}`; shape(d, false); }
          else { const d = `${path ? '' : `M${pt(...st.cur)}`}${pts.map((p) => ` L${pt(...p)}`).join('')}`; shape(d, false); }
          if (pts.length) st.cur = pts[pts.length - 1];
          break;
        }
        case 7: case 8: case 90: case 91: {
          const small = type >= 90;
          const polys = u32(24);
          const counts = []; for (let k = 0; k < polys; k++) counts.push(u32(32 + k * 4));
          let p = at(32 + polys * 4);
          let d = '';
          counts.forEach((c) => { const pts = points(p, c, small); p += c * (small ? 4 : 8); d += ` ${polyD(pts, type === 8 || type === 91)}`; });
          shape(d.trim(), type === 8 || type === 91);
          break;
        }
        case 54: { const to = [i32(8), i32(12)]; if (path) path.push(` L${pt(...to)}`); else emit(`M${pt(...st.cur)} L${pt(...to)}`, false, true); st.cur = to; break; }
        case 42: shape(ellipseD(i32(8), i32(12), i32(16), i32(20)), true); break;
        case 43: { const [l, t, r, b] = [i32(8), i32(12), i32(16), i32(20)]; shape(polyD([[l, t], [r, t], [r, b], [l, b]], true), true); break; }
        case 44: {
          const [l, t, r, b] = [i32(8), i32(12), i32(16), i32(20)];
          const rx = Math.min(i32(24) / 2, (r - l) / 2), ry = Math.min(i32(28) / 2, (b - t) / 2), k = 0.5523;
          const d = `M${pt(l + rx, t)} L${pt(r - rx, t)} C${pt(r - rx + rx * k, t)} ${pt(r, t + ry - ry * k)} ${pt(r, t + ry)} L${pt(r, b - ry)} C${pt(r, b - ry + ry * k)} ${pt(r - rx + rx * k, b)} ${pt(r - rx, b)} L${pt(l + rx, b)} C${pt(l + rx - rx * k, b)} ${pt(l, b - ry + ry * k)} ${pt(l, b - ry)} L${pt(l, t + ry)} C${pt(l, t + ry - ry * k)} ${pt(l + rx - rx * k, t)} ${pt(l + rx, t)} Z`;
          shape(d, true); break;
        }
        case 45: case 46: case 47: case 55: {
          const { pts, c } = arcPts(i32(8), i32(12), i32(16), i32(20), i32(24), i32(28), i32(32), i32(36));
          if (type === 45) shape(polyD(pts, false), false);
          else if (type === 46) shape(polyD(pts, true), true);
          else if (type === 47) shape(polyD([c, ...pts], true), true);
          else { shape(`${path ? '' : `M${pt(...st.cur)}`} L${pt(...pts[0])}${pts.slice(1).map((p) => ` L${pt(...p)}`).join('')}`, false); st.cur = pts[pts.length - 1]; }
          break;
        }
        case 59: path = []; break;
        case 60: break;
        case 61: if (path) path.push(' Z'); break;
        case 62: case 63: case 64: {
          if (path) { const d = path.join(' ').replace(/\s+/g, ' ').trim(); emit(d, type !== 64, type !== 62); }
          path = null; break;
        }
        case 68: path = null; break;
        case 84: case 83: {
          const ref = [i32(36), i32(40)];
          const chars = u32(44), offStr = u32(48), opts = u32(52);
          const offDx = u32(opts & 0x100 ? 56 : 72);
          const rb = [i32(8), i32(12), i32(16), i32(20)]; // рамка текста в единицах устройства
          let s = '';
          if (type === 84) for (let k = 0; k < chars; k++) s += String.fromCharCode(dv.getUint16(at(offStr + k * 2), true));
          else s = new TextDecoder('windows-1251').decode(u8.subarray(at(offStr), at(offStr + chars)));
          s = s.replace(/[\u0000-\u001f]/g, '');
          if (!s.trim()) break;
          const f = st.font || STOCK[0x8000000D];
          const ls = lenScale();
          const sizeDev = Math.max(1, Math.abs(f.height || 12) * (f.height > 0 ? 0.87 : 1) * ls);
          let pos = st.align & 1 ? P(...st.cur) : P(...ref);
          const ang0 = (f.esc || 0) / 10;
          // некоторые программы (LibreOffice) пишут в опорную точку мусор — берём рамку текста из записи
          const far = (v, a, b) => v < a - (b - a) - 50 || v > b + (b - a) + 50;
          if ((far(pos[0], bounds[0], bounds[2]) || far(pos[1], bounds[1], bounds[3])) && rb[2] > rb[0] && rb[3] > rb[1]) {
            if (Math.abs(ang0 - 90) < 1) pos = [rb[2] - sizeDev * 0.22, rb[3]];
            else if (Math.abs(ang0 - 270) < 1 || Math.abs(ang0 + 90) < 1) pos = [rb[0] + sizeDev * 0.22, rb[1]];
            else pos = [(st.align & 6) === 6 ? (rb[0] + rb[2]) / 2 : (st.align & 6) === 2 ? rb[2] : rb[0], rb[3] - sizeDev * 0.22];
            st.align = (st.align & ~24) | 24;
          }
          let width = 0;
          if (offDx && chars) { for (let k = 0; k < chars; k++) width += dv.getInt32(at(offDx + k * 4), true); width *= ls; }
          const anchor = (st.align & 6) === 6 ? 'middle' : (st.align & 6) === 2 ? 'end' : 'start';
          const vert = st.align & 24; // 0 верх, 8 низ, 24 базовая линия
          const dy = vert === 0 ? sizeDev * 0.88 : vert === 8 ? -sizeDev * 0.2 : 0;
          const ang = -ang0;
          const tf = ang ? ` transform="rotate(${r2(ang)} ${r2(pos[0])} ${r2(pos[1])})"` : '';
          out.push(`<text x="${r2(pos[0])}" y="${r2(pos[1] + dy)}" font-family="${esc(f.face)}, Arial, sans-serif" font-size="${r2(sizeDev)}" fill="${st.textColor}"${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}${f.underline ? ' text-decoration="underline"' : ''} text-anchor="${anchor}"${width > 0 && s.length > 1 ? ` textLength="${r2(width)}" lengthAdjust="spacingAndGlyphs"` : ''}${tf} xml:space="preserve">${esc(s)}</text>`);
          texts.push({ s, x: pos[0], y: pos[1] + dy, size: sizeDev, angle: ang, w: width || s.length * sizeDev * 0.5 });
          break;
        }
        case 81: case 76: case 77: case 114: {
          let x, y, cx, cy, offBmi, cbBmi, offBits;
          if (type === 81) { x = i32(24); y = i32(28); offBmi = u32(48); cbBmi = u32(52); offBits = u32(56); cx = i32(72); cy = i32(76); }
          else { x = i32(24); y = i32(28); cx = i32(32); cy = i32(36); offBmi = u32(84); cbBmi = u32(88); offBits = u32(92); }
          if (!cbBmi) { // без картинки: растровая операция над прямоугольником (кисть, белый, чёрный; NOP и прочие — пропуск)
            const rop = type === 81 ? u32(68) : u32(40);
            const col = rop === 0x00F00021 ? (st.brush && st.brush.color) : rop === 0x00FF0062 ? '#ffffff' : rop === 0x00000042 ? '#000000' : null;
            if (col) out.push(`<path d="${polyD([[x, y], [x + cx, y], [x + cx, y + cy], [x, y + cy]], true)}" fill="${col}" stroke="none"/>`);
            break;
          }
          const src = dibToPng(u8, at(offBmi), at(offBits));
          if (!src) break;
          const p0 = P(x, y), p1 = P(x + cx, y + cy);
          const X = Math.min(p0[0], p1[0]), Y = Math.min(p0[1], p1[1]), Wd = Math.abs(p1[0] - p0[0]), Hd = Math.abs(p1[1] - p0[1]);
          out.push(`<image href="${src}" x="${r2(X)}" y="${r2(Y)}" width="${r2(Wd)}" height="${r2(Hd)}" preserveAspectRatio="none"/>`);
          break;
        }
        case 118: { // GRADIENTFILL — средний цвет вершин прямоугольника
          const nVer = u32(24);
          let rr = 0, gg = 0, bb = 0;
          const xs = [], ys = [];
          for (let k = 0; k < nVer; k++) { const b0 = at(36 + k * 16); xs.push(dv.getInt32(b0, true)); ys.push(dv.getInt32(b0 + 4, true)); rr += dv.getUint16(b0 + 8, true) >> 8; gg += dv.getUint16(b0 + 10, true) >> 8; bb += dv.getUint16(b0 + 12, true) >> 8; }
          if (nVer >= 2) {
            const col = `#${[rr, gg, bb].map((v) => Math.round(v / nVer).toString(16).padStart(2, '0')).join('')}`;
            const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
            out.push(`<path d="${polyD([[l, t], [r, t], [r, b], [l, b]], true)}" fill="${col}" stroke="none"/>`);
          }
          break;
        }
        default: break;
      }
      off += size;
    }
    // рамка: заголовок файла, расширенная до нарисованного (рамку заголовка иногда пишут меньше рисунка),
    // но без белого фона-подложки, если он гораздо больше рисунка
    let [x0, y0, x1, y1] = [bounds[0], bounds[1], bounds[2] + 1, bounds[3] + 1];
    if (Number.isFinite(ext.x0)) {
      const bw = x1 - x0, bh = y1 - y0;
      x0 = Math.max(Math.min(x0, ext.x0), x0 - bw * 0.15); y0 = Math.max(Math.min(y0, ext.y0), y0 - bh * 0.15);
      x1 = Math.min(Math.max(x1, ext.x1), x1 + bw * 0.15); y1 = Math.min(Math.max(y1, ext.y1), y1 + bh * 0.15);
    }
    const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(x0)} ${r2(y0)} ${w} ${h}" width="${w}" height="${h}"><rect x="${r2(x0)}" y="${r2(y0)}" width="${w}" height="${h}" fill="#ffffff"/>${out.join('')}</svg>`;
    return { svg, texts, width: w, height: h, bounds: [x0, y0, x1, y1] };
  }

  window.ISM = window.ISM || {};
  window.ISM.emf = { render };
})();
