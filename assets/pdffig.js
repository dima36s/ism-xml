/* ИСМ XML — схемы и рисунки в PDF.
   По списку операций страницы (pdf.js getOperatorList) находит области с графикой: кривые (скруглённые
   прямоугольники, эллипсы, события BPMN), наклонные линии (стрелки, ромбы решений) и картинки. Таблицы из
   прямых горизонтальных и вертикальных линий схемой не считаются. Область отрисовывается в PNG один в один,
   как в файле, а надписи внутри неё разбираются: подписи дорожек (повёрнутый текст) и шаги в дорожках —
   «кто что делает», остальные надписи — отдельно. Координаты — в пространстве страницы PDF (пункты, ось Y вверх). */
(() => {
  'use strict';
  const norm = (s) => String(s ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const hit = (a, b, pad = 0) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
  const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

  /* ---------- Элементы графики страницы ---------- */
  function elements(ops, OPS) {
    const { fnArray, argsArray } = ops;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let fill = [0, 0, 0];
    let pending = null;
    const els = [];
    const white = (c) => {
      if (typeof c === 'string') { const v = parseInt(c.replace('#', ''), 16); return ((v >> 16) & 255) > 240 && ((v >> 8) & 255) > 240 && (v & 255) > 240; }
      return c && c[0] > 240 && c[1] > 240 && c[2] > 240;
    };
    function path(pops, coords) {
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, curve: false, diag: false, rectOnly: true, segs: 0 };
      let k = 0;
      let cur = null, start = null;
      const pt = (x, y) => { const p = apply(ctm, x, y); if (p[0] < b.x0) b.x0 = p[0]; if (p[0] > b.x1) b.x1 = p[0]; if (p[1] < b.y0) b.y0 = p[1]; if (p[1] > b.y1) b.y1 = p[1]; return p; };
      const line = (p) => { if (cur) { const dx = Math.abs(p[0] - cur[0]), dy = Math.abs(p[1] - cur[1]); if (dx > 0.8 && dy > 0.8 && Math.hypot(dx, dy) > 1.5) b.diag = true; b.segs++; } cur = p; };
      for (const op of pops) {
        switch (op) {
          case OPS.moveTo: cur = pt(coords[k], coords[k + 1]); start = cur; k += 2; b.rectOnly = false; break;
          case OPS.lineTo: line(pt(coords[k], coords[k + 1])); k += 2; b.rectOnly = false; break;
          case OPS.curveTo: pt(coords[k], coords[k + 1]); pt(coords[k + 2], coords[k + 3]); cur = pt(coords[k + 4], coords[k + 5]); k += 6; b.curve = true; b.rectOnly = false; b.segs++; break;
          case OPS.curveTo2: case OPS.curveTo3: pt(coords[k], coords[k + 1]); cur = pt(coords[k + 2], coords[k + 3]); k += 4; b.curve = true; b.rectOnly = false; b.segs++; break;
          case OPS.closePath: if (start) line(start); break;
          case OPS.rectangle: {
            const [x, y, w, h] = [coords[k], coords[k + 1], coords[k + 2], coords[k + 3]];
            const p = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
            if (Math.abs(p[0][1] - p[1][1]) > 0.8 && Math.abs(p[0][0] - p[1][0]) > 0.8) b.diag = true; // повёрнутый прямоугольник
            k += 4; b.segs += 4; break;
          }
          default: break;
        }
      }
      return Number.isFinite(b.x0) ? b : null;
    }
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const a = argsArray[i];
      switch (fn) {
        case OPS.save: stack.push(ctm); break;
        case OPS.restore: ctm = stack.pop() || ctm; break;
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.paintFormXObjectBegin: stack.push(ctm); if (a && a[0] && a[0].length === 6) ctm = mul(ctm, a[0]); break;
        case OPS.paintFormXObjectEnd: ctm = stack.pop() || ctm; break;
        case OPS.setFillRGBColor: fill = a; break;
        case OPS.setFillGray: fill = [a[0] * 255, a[0] * 255, a[0] * 255]; break;
        case OPS.constructPath: pending = path(a[0], a[1]); break;
        case OPS.stroke: case OPS.closeStroke:
          if (pending) { pending.stroke = true; els.push(pending); }
          pending = null; break;
        case OPS.fill: case OPS.eoFill:
          if (pending) { pending.fill = true; pending.white = white(fill); els.push(pending); }
          pending = null; break;
        case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke:
          if (pending) { pending.fill = true; pending.stroke = true; els.push(pending); }
          pending = null; break;
        case OPS.endPath: pending = null; break;
        case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageMaskXObject: case OPS.paintImageXObjectRepeat: case OPS.paintImageMaskXObjectGroup: {
          const p = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
          const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
          els.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), image: true });
          break;
        }
        default: break;
      }
    }
    return els;
  }

  /* ---------- Области со схемами ---------- */
  // Все элементы рисунка (кроме фона страницы) объединяются в группы по соседству — соединители связывают фигуры.
  // Группа — схема, если в ней есть хотя бы три фигуры с кривыми или наклонными линиями (или крупная картинка);
  // таблицы из прямых линий и подчёркивания такими группами не становятся.
  function regions(els, page) {
    const pageArea = page.w * page.h;
    const big = (e) => area(e) > pageArea * 0.85 || (e.x1 - e.x0) > page.w * 0.97;
    const E = els.filter((e) => !big(e) && !e.white);
    if (!E.length) return [];
    const picture = (e) => e.image && area(e) > pageArea * 0.0008 && (e.x1 - e.x0) > 12 && (e.y1 - e.y0) > 12; // рисунок или значок нотации, а не точка
    const isCore = (e) => picture(e) || ((e.curve || e.diag) && (e.x1 - e.x0) + (e.y1 - e.y0) > 1.5);
    if (E.filter(isCore).length < 3 && !E.some(picture)) return [];
    // объединение соседей: сетка корзин, чтобы не сравнивать все пары
    const parent = E.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
    const pad = 6, cell = 60;
    const grid = new Map();
    E.forEach((e, i) => {
      for (let gx = Math.floor((e.x0 - pad) / cell); gx <= Math.floor((e.x1 + pad) / cell); gx++) {
        for (let gy = Math.floor((e.y0 - pad) / cell); gy <= Math.floor((e.y1 + pad) / cell); gy++) {
          const k = `${gx},${gy}`;
          const list = grid.get(k);
          if (list) { list.forEach((j) => { if (hit(e, E[j], pad)) join(i, j); }); list.push(i); } else grid.set(k, [i]);
        }
      }
    });
    const groups = new Map();
    E.forEach((e, i) => {
      const r = find(i);
      const g = groups.get(r) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, core: new Set(), img: false };
      g.x0 = Math.min(g.x0, e.x0); g.y0 = Math.min(g.y0, e.y0); g.x1 = Math.max(g.x1, e.x1); g.y1 = Math.max(g.y1, e.y1);
      if (isCore(e)) g.core.add([e.x0, e.y0, e.x1, e.y1].map(Math.round).join(',')); // заливка и обводка одной фигуры — одна фигура
      if (picture(e)) g.img = true;
      groups.set(r, g);
    });
    let regs = [...groups.values()].filter((g) => g.core.size >= 3 || g.img).map((g) => ({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, n: g.core.size, img: g.img }));
    // объединяем перекрывающиеся группы
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < regs.length && !merged; i++) {
        for (let j = i + 1; j < regs.length; j++) if (hit(regs[i], regs[j], 4)) { regs[i] = { ...union(regs[i], regs[j]), n: regs[i].n + regs[j].n, img: regs[i].img || regs[j].img }; regs.splice(j, 1); merged = true; break; }
      }
    }
    return regs.filter((r) => r.img || ((r.y1 - r.y0) > 30 && (r.x1 - r.x0) > 40 && area(r) > pageArea * 0.012));
  }

  /* ---------- Надписи схемы ---------- */
  const rotated = (it) => Math.abs(it.t[1]) > Math.abs(it.t[0]) * 2;
  function labelBlocks(items) {
    const its = items.filter((it) => !rotated(it) && norm(it.s)).map((it) => ({ s: it.s, x: it.t[4], y: it.t[5], h: Math.abs(it.t[3]) || it.h || 8, w: it.w || 0 }));
    its.sort((a, b) => (Math.abs(b.y - a.y) > Math.min(a.h, b.h) * 0.4 ? b.y - a.y : a.x - b.x));
    const lines = [];
    its.forEach((it) => {
      const l = lines.find((x) => Math.abs(x.y - it.y) <= Math.min(x.h, it.h) * 0.45 && it.x - x.x1 < it.h * 1.1 && it.x >= x.x0 - 1);
      if (l) { l.s += (it.x - l.x1 > it.h * 0.15 && !/\s$/.test(l.s) ? ' ' : '') + it.s; l.x1 = Math.max(l.x1, it.x + it.w); }
      else lines.push({ s: it.s, x0: it.x, x1: it.x + it.w, y: it.y, h: it.h });
    });
    const blocks = [];
    lines.forEach((l) => {
      const b = blocks.find((x) => x.yLast - l.y > 0 && x.yLast - l.y < Math.max(x.h, l.h) * 1.75 && l.x0 < x.x1 + 2 && l.x1 > x.x0 - 2);
      if (b) {
        b.s = b.s.endsWith('-') && /^[а-яё]/.test(norm(l.s)) ? b.s.slice(0, -1) + norm(l.s) : `${b.s} ${l.s}`;
        b.yLast = l.y; b.y0 = l.y; b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1);
      } else blocks.push({ s: l.s, x0: l.x0, x1: l.x1, y1: l.y + l.h, y0: l.y, yLast: l.y, h: l.h });
    });
    return blocks.map((b) => ({ text: norm(b.s), x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 })).filter((b) => b.text);
  }
  // Дорожки: повёрнутые подписи у левого края области; шаги — надписи внутри полосы дорожки
  function readDiagram(items, reg, els) {
    const inside = items.filter((it) => { const x = it.t[4], y = it.t[5]; return x >= reg.x0 - 2 && x <= reg.x1 + 2 && y >= reg.y0 - 2 && y <= reg.y1 + 2; });
    const rot = inside.filter(rotated).map((it) => {
      const s = Math.hypot(it.t[0], it.t[1]) || 1;
      const dir = [it.t[0] / s, it.t[1] / s];
      return { text: norm(it.s), x: it.t[4], cy: it.t[5] + dir[1] * (it.w || 0) / 2 };
    }).filter((r) => r.text.length >= 2);
    const cols = [];
    rot.forEach((r) => { const c = cols.find((x) => Math.abs(x.x - r.x) < 14); if (c) c.items.push(r); else cols.push({ x: r.x, items: [r] }); });
    cols.forEach((c) => {
      // части одной подписи (переносы, отдельные слова) — по близости по вертикали
      c.items.sort((a, b) => b.cy - a.cy);
      c.lanes = c.items;
    });
    const col = cols.filter((c) => c.items.length >= 2).sort((a, b) => b.items.length - a.items.length || b.x - a.x)[0];
    const labels = labelBlocks(inside);
    let lanes = [];
    if (col) {
      // границы полос: длинные горизонтальные линии области или середины между подписями
      const width = reg.x1 - reg.x0;
      const seps = els.filter((e) => hit(e, reg, 1) && (e.y1 - e.y0) < 2.5 && (e.x1 - e.x0) > width * 0.55).map((e) => (e.y0 + e.y1) / 2).sort((a, b) => b - a);
      const titles = col.items;
      const bounds = titles.map((t, i) => {
        let top = i ? (titles[i - 1].cy + t.cy) / 2 : reg.y1 + 1;
        let bottom = i < titles.length - 1 ? (t.cy + titles[i + 1].cy) / 2 : reg.y0 - 1;
        const above = seps.filter((y) => y > t.cy).pop();
        const below = seps.find((y) => y < t.cy);
        if (above !== undefined && (!i || above < top + 40)) top = above;
        if (below !== undefined && (i === titles.length - 1 || below > bottom - 40)) bottom = below;
        return { name: t.text, top, bottom, x: col.x };
      });
      lanes = bounds.map((b) => ({ name: b.name, steps: labels.filter((l) => l.x > b.x + 8 && l.y < b.top && l.y > b.bottom && l.text.length >= 3 && !/\?\s*$/.test(l.text) && !/^(да|нет|yes|no|иначе|else)\W*$/i.test(l.text)).sort((a, z) => a.x - z.x || z.y - a.y).map((l) => l.text) }))
        .filter((l) => l.steps.length);
    }
    // Вертикальные дорожки: подписи в верхней строке области, полосы разделены вертикальными линиями
    if (!lanes.length && labels.length >= 3) {
      const height = reg.y1 - reg.y0;
      const vseps = els.filter((e) => hit(e, reg, 1) && (e.x1 - e.x0) < 2.5 && (e.y1 - e.y0) > height * 0.55).map((e) => (e.x0 + e.x1) / 2).sort((a, b) => a - b);
      const top = labels.filter((l) => l.y > reg.y1 - height * 0.12 && l.text.length >= 2).sort((a, b) => a.x - b.x);
      if (top.length >= 2 && vseps.length >= top.length - 1) {
        const cols = top.map((t) => ({ name: t.text, x0: Math.max(reg.x0 - 1, ...vseps.filter((x) => x < t.x)), x1: Math.min(reg.x1 + 1, ...vseps.filter((x) => x > t.x)), title: t }));
        lanes = cols.map((c) => ({ name: c.name, steps: labels.filter((l) => l !== c.title && !top.includes(l) && l.x > c.x0 && l.x < c.x1 && l.text.length >= 3 && !/\?\s*$/.test(l.text) && !/^(да|нет|yes|no|иначе|else)\W*$/i.test(l.text)).sort((a, z) => z.y - a.y || a.x - z.x).map((l) => l.text) }))
          .filter((l) => l.steps.length);
        if (lanes.length) top.forEach((t) => labels.splice(labels.indexOf(t), 1));
      }
    }
    const used = new Set(lanes.flatMap((l) => l.steps));
    const rest = labels.filter((l) => !used.has(l.text) && l.text.length >= 3).sort((a, b) => (Math.abs(a.y - b.y) > 6 ? b.y - a.y : a.x - b.x)).map((l) => l.text);
    return { lanes, labels: [...new Set(rest)], inside };
  }

  // Элементы графики страницы: первый проход — по всем страницам, чтобы найти повторяющиеся логотипы и штампы
  async function pageElements(page, pdfjsLib) {
    return elements(await page.getOperatorList(), pdfjsLib.OPS);
  }
  const imgSig = (e) => [e.x0, e.y0, e.x1, e.y1].map((v) => Math.round(v / 3)).join(',');
  // Картинки, которые стоят в одном месте на многих страницах (логотип в колонтитуле, штамп), — не рисунки документа
  function repeatedImages(pagesEls) {
    const cnt = new Map();
    pagesEls.forEach((els) => new Set(els.filter((e) => e.image).map(imgSig)).forEach((s) => cnt.set(s, (cnt.get(s) || 0) + 1)));
    const min = Math.max(2, Math.ceil(pagesEls.length * 0.4));
    return new Set([...cnt].filter(([, n]) => n >= min).map(([s]) => s));
  }
  function analyze(page, els, textItems, skip) {
    const vb = page.view; // [x0, y0, x1, y1]
    const own = skip && skip.size ? els.filter((e) => !(e.image && skip.has(imgSig(e)))) : els;
    const regs = regions(own, { w: vb[2] - vb[0], h: vb[3] - vb[1] });
    return regs.map((r) => ({ ...r, ...readDiagram(textItems, r, own) }));
  }
  // Область страницы в PNG: страница рисуется pdf.js на холсте и вырезается с полями
  async function renderRegion(page, reg, maxPx = 1800) {
    const pad = 2;
    const w = reg.x1 - reg.x0 + pad * 2;
    const scale = Math.max(1.2, Math.min(2.5, maxPx / w));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const [ax, ay, bx, by] = vp.convertToViewportRectangle([reg.x0 - pad, reg.y0 - pad, reg.x1 + pad, reg.y1 + pad]);
    const cx = Math.max(0, Math.floor(Math.min(ax, bx))), cy = Math.max(0, Math.floor(Math.min(ay, by)));
    const cw = Math.min(canvas.width - cx, Math.ceil(Math.abs(bx - ax))), ch = Math.min(canvas.height - cy, Math.ceil(Math.abs(by - ay)));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
    return { src: out.toDataURL('image/png'), width: cw, height: ch };
  }

  window.ISM = window.ISM || {};
  window.ISM.pdfFigures = { analyze, pageElements, repeatedImages, renderRegion, elements, regions, readDiagram };
})();
