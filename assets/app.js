/* ИСМ XML — веб-приложение для машиночитаемых регламентов ИСМ.
   Источник истины — XML по схеме urn:protech:ism:regulation:1.0 (data/ism-regulation-v1.xsd).
   Приложение читает XML в браузере и строит из него все представления; на сервер ничего не отправляется. */
(() => {
  'use strict';

  const NS = 'urn:protech:ism:regulation:1.0';
  const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const DEFAULT_XML = 'data/C2.4.1.MTH.01.machine-readable.xml';
  const KIT = {
    xsd: 'data/ism-regulation-v1.xsd',
    xsl: 'data/ism-regulation-view.xsl',
    ps1: 'data/build.ps1',
    bat: 'data/build.bat',
  };
  const JSZIP_URL = 'assets/vendor/jszip.min.js'; // JSZip 3.10.1, MIT; лежит в репозитории, внешних запросов нет
  const EXCELJS_URL = 'assets/vendor/exceljs.min.js'; // ExcelJS 4.4.0, MIT; загружается только при выгрузке в Excel

  // Корпоративный реестр требований: столбцы A–R шаблона пилота V0.1
  const REG_HEAD = ['ID', 'Наименование', 'Объект требования', 'Атомарная формулировка', 'Источник / документ', 'Пункт / ссылка', 'Уровень',
    'Владелец требования', 'Область / условия применения', 'Критичность', 'Метод верификации', 'Критерий приёмки', 'Статус', 'Версия',
    'Дата вступления', 'Ссылка на подтверждение', 'Разногласия / примечание', 'Комплектность'];
  const REG_WIDTHS = [18, 24, 13, 48, 34, 20, 12, 25, 36, 13, 27, 32, 23, 10, 15, 31, 34, 17];
  const REG_REQUIRED = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]; // B C D E G H I J K L M — как в формуле «Комплектность» шаблона
  const REG_METHOD = { 'document-review': 'Экспертиза документа', 'expert-review': 'Экспертная оценка BPMN-схемы', 'record-check': 'Проверка листа согласования / истории изменений ФМ' };

  /* ---------- Утилиты ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const txt = (el) => (el ? norm(el.textContent) : '');
  const attr = (el, a) => (el ? el.getAttribute(a) || '' : '');
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const textOf = (el) => {
    if (!el) return '';
    const parts = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) parts.push(w.currentNode.nodeValue);
    return norm(parts.join(' '));
  };

  const L = {
    modality: { shall: 'Обязательно', should: 'Рекомендуется', may: 'Допускается', 'shall-not': 'Запрещено' },
    status: { draft: 'Проект', effective: 'Действует', superseded: 'Заменён', withdrawn: 'Отменён' },
    kind: {
      responsibility: 'ответственность', structure: 'состав ФМ', content: 'содержание раздела', method: 'метод',
      notation: 'нотация', 'modeling-rule': 'правило моделирования', 'process-rule': 'правило процесса',
      'document-control': 'управление документом', scope: 'область применения',
    },
    verification: { 'document-review': 'экспертиза документа', 'model-validation': 'проверка BPMN-модели', 'expert-review': 'экспертная оценка', 'record-check': 'проверка записей: лист согласования, история изменений' },
    criticality: {
      C1: 'критические, корпоративно неприемлемые последствия невыполнения', C2: 'высокие существенные последствия невыполнения',
      C3: 'средние локальные управляемые последствия невыполнения', C4: 'низкие ограниченные обратимые последствия невыполнения',
    },
    level: {
      L1: 'внешние обязательные НТД и законодательство', L2: 'корпоративные стандарты, ЛНА и техническая политика',
      L3: 'проектные, площадочные и договорные ограничения', L4: 'неявные требования и допущения', L5: 'границы и интерфейсы', L6: 'явные исключения',
    },
    regStatus: {
      draft: 'Черновик', 'operator-review': 'На проверке оператора', approval: 'На согласовании', approved: 'Утверждено',
      effective: 'Действует', revision: 'На пересмотре', superseded: 'Заменено', archived: 'Архив',
    },
    relation: {
      constrainedBy: 'ограничивается', references: 'ссылается на', partOf: 'входит в', definedBy: 'определяется',
      usedBy: 'используется', requires: 'требует', implements: 'реализует', supersedes: 'заменяет',
      conflictsWith: 'противоречит', clarifies: 'уточняет', appliesTo: 'применяется к', performedBy: 'выполняется',
      verifiedBy: 'проверяется', inputOf: 'вход для', outputOf: 'выход из',
    },
    noteType: {
      duplicate: 'Дублирование', inconsistency: 'Несогласованность', gap: 'Пробел', wording: 'Формулировка',
      formatting: 'Оформление', interpretation: 'Трактовка при разметке', question: 'Вопрос к методологу',
    },
    objectType: {
      document: 'Документ', 'document-part': 'Части ФМ', 'document-section': 'Разделы текстовой части ФМ',
      diagram: 'Диаграммы', model: 'Описательные модели', concept: 'Понятия', 'notation-element': 'Элементы нотации BPMN',
      'system-component': 'Компоненты системы',
    },
    roleType: { 'org-unit': 'подразделение', 'business-role': 'бизнес-роль', 'user-group': 'группа пользователей' },
    bpmn: {
      process: 'процесс', task: 'задача', userTask: 'пользовательская задача', serviceTask: 'сервисная задача',
      sendTask: 'задача отправки', receiveTask: 'задача получения', manualTask: 'ручная задача',
      businessRuleTask: 'задача бизнес-правила', scriptTask: 'задача-скрипт', subProcess: 'подпроцесс',
      callActivity: 'вызов процесса', exclusiveGateway: 'исключающий шлюз', parallelGateway: 'параллельный шлюз',
      inclusiveGateway: 'включающий шлюз', eventBasedGateway: 'событийный шлюз', complexGateway: 'сложный шлюз',
      startEvent: 'начальное событие', endEvent: 'завершающее событие',
      intermediateCatchEvent: 'промежуточное событие', intermediateThrowEvent: 'промежуточное событие',
    },
  };

  /* ---------- Состояние ---------- */
  const S = {
    m: null,
    xmlText: '',
    xmlName: '',
    xmlUrl: '',
    custom: false,
    openAtoms: new Set(),
    allAtoms: false,
    openRows: new Set(),
    f: { q: '', modality: 'all', basis: 'all', check: 'all', role: '', object: '', kind: '', section: '', crit: 'all', owner: '' },
    rf: { crit: 'all', owner: '', done: 'all', q: '' },
    openReg: new Set(),
    linkRel: '',
    bpmn: null,
  };

  /* ---------- Разбор XML ---------- */
  function parseModel(xmlText, baseUrl) {
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    const perr = dom.getElementsByTagName('parsererror')[0];
    if (perr) throw new Error('Файл не является корректным XML. ' + norm(perr.textContent).slice(0, 180));
    const root = dom.documentElement;
    if (root.localName !== 'ismDocument') throw new Error(`Корневой элемент файла — <${root.localName}>, а у документа ИСМ должен быть <ismDocument>.`);
    if (root.namespaceURI !== NS) throw new Error(`У элемента <ismDocument> нет пространства имён ${NS}. Добавьте в него атрибут xmlns="${NS}".`);

    const m = {
      id: attr(root, 'id'), version: attr(root, 'version'), status: attr(root, 'status'), base: baseUrl,
      byId: new Map(), reqs: [], clauses: [], sections: [],
    };
    const reg = (o) => { if (o.id) m.byId.set(o.id, o); return o; };
    m.byId.set(m.id, { kind: 'doc', id: m.id });

    const md = kid(root, 'metadata');
    const party = (el) => (el ? { text: txt(el), person: attr(el, 'person') } : null);
    const dt = kid(md, 'documentType');
    m.meta = {
      title: txt(kid(md, 'title')),
      docType: txt(dt), docTypeCode: attr(dt, 'code'),
      org: txt(kid(md, 'organization')),
      processRef: { id: attr(kid(md, 'processRef'), 'id'), text: txt(kid(md, 'processRef')) },
      processPath: kids(kid(md, 'processPath'), 'process').map((p) => ({ id: attr(p, 'id'), text: txt(p) })),
      owner: party(kid(md, 'owner')),
      manager: party(kid(md, 'manager')),
      developers: kids(md, 'developer').map(party),
      methodologist: party(kid(md, 'methodologist')),
    };

    const sc = kid(root, 'scope');
    m.scope = {
      conditions: kids(kid(sc, 'applicability'), 'condition').map((c) => ({ text: txt(c), clause: attr(c, 'clause') })),
      audience: kids(sc, 'audience').map((a) => ({ ref: attr(a, 'ref'), clause: attr(a, 'clause') })),
    };
    m.changes = kids(kid(root, 'changeHistory'), 'change').map((c) => ({
      version: attr(c, 'version'), date: attr(c, 'date'), basis: txt(kid(c, 'basis')), description: txt(kid(c, 'description')),
    }));

    const terms = kid(root, 'terms');
    m.termsNote = txt(kid(terms, 'note'));
    m.terms = kids(terms, 'term').map((t) => reg({
      kind: 'term', id: attr(t, 'id'), name: txt(kid(t, 'name')), abbr: txt(kid(t, 'abbreviation')),
      def: txt(kid(t, 'definition')), notes: kids(t, 'note').map(txt),
    }));
    m.roles = kids(kid(root, 'roles'), 'role').map((r) => reg({
      kind: 'role', id: attr(r, 'id'), type: attr(r, 'type'), name: txt(kid(r, 'name')),
      aliases: kids(r, 'alias').map(txt), description: txt(kid(r, 'description')),
    }));
    m.objects = kids(kid(root, 'objects'), 'object').map((o) => reg({
      kind: 'object', id: attr(o, 'id'), type: attr(o, 'type'), name: txt(kid(o, 'name')),
      aliases: kids(o, 'alias').map(txt), description: txt(kid(o, 'description')),
      codes: kids(o, 'externalCode').map((c) => ({ scheme: attr(c, 'scheme'), code: txt(c) })),
    }));
    m.refs = kids(kid(root, 'references'), 'reference').map((r) => reg({
      kind: 'reference', id: attr(r, 'id'), type: attr(r, 'type'), origin: attr(r, 'origin') || 'source',
      identifier: txt(kid(r, 'identifier')), title: txt(kid(r, 'title')),
    }));

    const parseReq = (el, clause, section) => {
      const v = kid(el, 'verification');
      const act = kid(el, 'action');
      const ow = kid(el, 'owner');
      const cb = kid(el, 'criticalityBasis');
      const rg = kid(el, 'registry');
      const r = reg({
        kind: 'requirement', id: attr(el, 'id'), number: attr(el, 'number'),
        modality: attr(el, 'modality'), basis: attr(el, 'modalityBasis'), rkind: attr(el, 'kind'),
        criticality: attr(el, 'criticality'), source: attr(el, 'source'),
        title: txt(kid(el, 'title')),
        statement: txt(kid(el, 'statement')), quote: txt(kid(el, 'quote')),
        owner: ow ? { ref: attr(ow, 'ref'), status: attr(ow, 'status') || 'preliminary' } : null,
        critBasis: cb ? { text: txt(cb), status: attr(cb, 'status') || 'preliminary' } : null,
        registry: rg ? {
          id: attr(rg, 'id'), level: attr(rg, 'level'), status: attr(rg, 'status'), version: attr(rg, 'version'),
          effective: attr(rg, 'effective'), evidence: attr(rg, 'evidence'), remark: txt(kid(rg, 'remark')),
        } : null,
        subject: attr(kid(el, 'subject'), 'ref'),
        action: act ? { code: attr(act, 'code'), label: txt(act) } : null,
        objects: kids(el, 'object').map((o) => attr(o, 'ref')),
        counterparts: kids(el, 'counterpart').map((o) => attr(o, 'ref')),
        conditions: kids(kid(el, 'applicability'), 'condition').map(txt),
        verification: v ? {
          method: attr(v, 'method'),
          criterion: txt(kid(v, 'criterion')),
          checks: kids(v, 'check').map((ch) => ({ language: attr(ch, 'language'), target: attr(ch, 'target'), status: attr(ch, 'status'), expr: norm(ch.textContent) })),
        } : null,
        ext: kids(el, 'externalReference').map((e) => attr(e, 'ref')),
        tags: kids(kid(el, 'tags'), 'tag').map(txt),
        clause, section,
      });
      m.reqs.push(r);
      return r;
    };

    const parseClause = (el, section, parent) => {
      const c = reg({
        kind: 'clause', id: attr(el, 'id'), number: attr(el, 'number'), label: attr(el, 'label'), type: attr(el, 'type'),
        section, parent, textEl: kid(el, 'text'), reqs: [], clauses: [],
      });
      c.text = textOf(c.textEl);
      m.clauses.push(c);
      kids(el, 'requirement').forEach((r) => c.reqs.push(parseReq(r, c, section)));
      kids(el, 'clause').forEach((sub) => c.clauses.push(parseClause(sub, section, c)));
      return c;
    };

    const parseSection = (el, parent) => {
      const s = reg({ kind: 'section', id: attr(el, 'id'), number: attr(el, 'number'), title: attr(el, 'title'), skind: attr(el, 'kind'), parent, items: [] });
      m.sections.push(s);
      for (const c of el.children) {
        switch (c.localName) {
          case 'section': s.items.push(parseSection(c, s)); break;
          case 'clause': s.items.push(parseClause(c, s, null)); break;
          case 'paragraph': s.items.push({ kind: 'paragraph', text: txt(c) }); break;
          case 'requirement': {
            // модель 1.0: требование прямо в разделе — оборачиваем в пункт без текста
            const pseudo = { kind: 'clause', id: attr(c, 'id') + '-clause', number: attr(c, 'number'), label: '', type: 'normative', section: s, parent: null, textEl: null, text: '', reqs: [], clauses: [] };
            pseudo.reqs.push(parseReq(c, pseudo, s));
            m.clauses.push(pseudo);
            s.items.push(pseudo);
            break;
          }
          case 'termList': s.items.push({ kind: 'termList' }); break;
          case 'referenceList': s.items.push({ kind: 'referenceList' }); break;
          default: break;
        }
      }
      return s;
    };
    m.body = kids(kid(root, 'body'), 'section').map((s) => parseSection(s, null));

    m.links = kids(kid(root, 'semanticLinks'), 'link').map((l) => ({ from: attr(l, 'from'), to: attr(l, 'to'), relation: attr(l, 'relation'), clause: attr(l, 'clause') }));
    m.notes = kids(kid(root, 'editorialNotes'), 'note').map((n) => reg({ kind: 'note', id: attr(n, 'id'), type: attr(n, 'type'), target: attr(n, 'target'), text: txt(n) }));
    m.notesByTarget = new Map();
    m.notes.forEach((n) => { if (n.target) { if (!m.notesByTarget.has(n.target)) m.notesByTarget.set(n.target, []); m.notesByTarget.get(n.target).push(n); } });

    // Пилотная модель 1.0: термины и ссылки вне тела документа
    if (m.terms.length && !m.sections.some((s) => s.items.some((i) => i.kind === 'termList'))) m.termsStandalone = true;
    if (m.refs.length && !m.sections.some((s) => s.items.some((i) => i.kind === 'referenceList'))) m.refsStandalone = true;

    m.integrity = checkIntegrity(m);
    m.figures = Array.from(dom.getElementsByTagNameNS(NS, 'figure')).map((f) => attr(f, 'src'));
    return m;
  }

  function checkIntegrity(m) {
    const dangling = [];
    const ref = (id, where) => { if (id && !m.byId.has(id)) dangling.push({ id, where }); };
    m.reqs.forEach((r) => {
      ref(r.subject, r.id);
      if (r.owner) ref(r.owner.ref, r.id);
      r.objects.forEach((o) => ref(o, r.id));
      r.counterparts.forEach((o) => ref(o, r.id));
      r.ext.forEach((o) => ref(o, r.id));
    });
    m.links.forEach((l) => { ref(l.from, 'семантическая связь'); ref(l.to, 'семантическая связь'); });
    m.scope.audience.forEach((a) => ref(a.ref, 'область применения'));
    const badQuotes = m.reqs.filter((r) => r.quote && r.clause && r.clause.textEl && !r.clause.text.includes(r.quote));
    return { dangling, badQuotes, quoted: m.reqs.filter((r) => r.quote).length };
  }

  /* ---------- Подписи и ссылки ---------- */
  const M = () => S.m;
  function cite(c) {
    if (!c) return '';
    if (c.label) return `п. ${c.parent ? c.parent.number : ''} ${c.label}`.replace(/\s+/g, ' ');
    if (c.number) return `п. ${c.number}`;
    if (c.section && c.section.skind === 'appendix') return c.section.number;
    return `раздел ${c.section ? c.section.number : ''}, вводный абзац`;
  }
  const reqCite = (r) => (r.number ? (/^\d/.test(r.number) ? `п. ${r.number}` : r.number) : cite(r.clause));
  const nameOf = (id) => { const o = M().byId.get(id); return o ? o.name || o.identifier || id : id; };
  const shortOf = (id) => { const o = M().byId.get(id); const a = o && o.aliases ? o.aliases.find((x) => x.length <= 12) : null; return a || nameOf(id); };

  function refLink(id) {
    const o = M().byId.get(id);
    if (!o) return `<span class="bad-ref">${esc(id)} (не найден)</span>`;
    switch (o.kind) {
      case 'role': return `<a href="#/roles/${esc(id)}">${esc(o.name)}</a>`;
      case 'object': return `<a href="#/objects/${esc(id)}">${esc(o.name)}</a>`;
      case 'term': return `<a href="#/doc/${esc(id)}">${esc(o.name)}${o.abbr ? ` (${esc(o.abbr)})` : ''}</a>`;
      case 'reference': return `<a href="#/doc/${esc(id)}">${esc(o.identifier)}</a> ${esc(o.title)}`;
      case 'clause': return `<a href="#/doc/${esc(id)}">${esc(cite(o))}</a>`;
      case 'section': return `<a href="#/doc/${esc(id)}">раздел ${esc(o.number)}. ${esc(o.title)}</a>`;
      case 'requirement': return `<a href="#/req/${esc(id)}">${esc(reqCite(o))}</a>`;
      case 'note': return `<a href="#/notes/${esc(id)}">замечание ${esc(id)}</a>`;
      case 'doc': return `документ ${esc(id)}`;
      default: return esc(id);
    }
  }
  function flags(id) {
    const list = M().notesByTarget.get(id);
    if (!list) return '';
    return list.map((n) => `<a class="flag" href="#/notes/${esc(n.id)}" title="${esc(L.noteType[n.type] || n.type)}">замечание ${esc(n.id)}</a>`).join('');
  }
  const resolveSrc = (src) => { try { return new URL(src, S.xmlUrl || location.href).href; } catch { return src; } };

  /* ---------- Документ: блоки текста ---------- */
  function blocks(el) {
    let h = '';
    for (const c of el.children) h += block(c);
    return h;
  }
  function block(c) {
    switch (c.localName) {
      case 'p': return `<p>${esc(norm(c.textContent))}</p>`;
      case 'list': {
        const cls = c.getAttribute('style') === 'dash' ? ' class="dash"' : '';
        return `<ul${cls}>${kids(c, 'item').map((i) => `<li>${mixed(i)}</li>`).join('')}</ul>`;
      }
      case 'table': {
        const head = kid(c, 'head');
        let h = '<div class="table-wrap"><table class="grid">';
        if (head) h += `<thead><tr>${kids(head, 'cell').map((x) => `<th>${mixed(x)}</th>`).join('')}</tr></thead>`;
        h += `<tbody>${kids(c, 'row').map((r) => `<tr>${kids(r, 'cell').map((x) => `<td>${mixed(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        return h;
      }
      case 'figure': return figure(c);
      default: return '';
    }
  }
  function mixed(el) {
    let h = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' '); if (t.trim()) h += esc(t); }
      else if (n.nodeType === 1) h += block(n);
    }
    return h.trim();
  }
  function figure(f) {
    return `<figure><img src="${esc(resolveSrc(f.getAttribute('src')))}" alt="${esc(f.getAttribute('alt'))}" loading="lazy" onerror="this.parentNode.classList.add('missing');this.replaceWith(document.createTextNode('[рисунок: ' + this.alt + ']'))"></figure>`;
  }

  /* ---------- Требование ---------- */
  function chips(r, { withKind = true, withId = false } = {}) {
    let h = r.criticality ? `<span class="chip crit ${esc(r.criticality.toLowerCase())}" title="Критичность ${esc(r.criticality)}: ${esc(L.criticality[r.criticality] || '')}">${esc(r.criticality)}</span>` : '';
    h += `<span class="chip ${esc(r.modality)}">${esc(L.modality[r.modality] || r.modality)}</span>`;
    if (r.basis === 'implicit') h += '<span class="chip implicit" title="В тексте нет слов «должен» или «не допускается»; модальность выведена из формулировки">модальность выведена</span>';
    if (r.source === 'authoritative') h += '<span class="chip verbatim" title="Формулировка совпадает с текстом пункта">дословно</span>';
    if (withKind && r.rkind) h += `<span class="chip kind">${esc(L.kind[r.rkind] || r.rkind)}</span>`;
    if (r.verification && r.verification.checks.length) h += '<span class="chip auto" title="Есть машинная проверка BPMN-схемы">автопроверка</span>';
    if (withId) h += `<span class="req-id">${esc(r.id)}</span>`;
    return h;
  }
  function reqLine(r) {
    const parts = [];
    if (r.subject) parts.push(`кто: ${esc(nameOf(r.subject))}`);
    if (r.action) parts.push(`действие: ${esc(r.action.label)}`);
    if (r.objects.length) parts.push(`объект: ${r.objects.map((o) => esc(nameOf(o))).join(', ')}`);
    if (r.owner) parts.push(`владелец: ${esc(nameOf(r.owner.ref))}`);
    return parts.join('; ');
  }
  function reqMeta(r) {
    let h = '<dl class="req-meta">';
    if (r.subject) h += `<dt>Кто</dt><dd>${refLink(r.subject)}</dd>`;
    if (r.action) h += `<dt>Действие</dt><dd>${esc(r.action.label)}</dd>`;
    if (r.objects.length) h += `<dt>Объект</dt><dd>${r.objects.map(refLink).join('; ')}</dd>`;
    if (r.counterparts.length) h += `<dt>Совместно с</dt><dd>${r.counterparts.map(refLink).join('; ')}</dd>`;
    if (r.owner) h += `<dt>Владелец</dt><dd>${refLink(r.owner.ref)}${r.owner.status !== 'confirmed' ? ' <span class="muted">(предварительно)</span>' : ''}</dd>`;
    if (r.criticality) h += `<dt>Критичность</dt><dd><b>${esc(r.criticality)}</b>, ${esc(L.criticality[r.criticality] || '')}${r.critBasis ? `. ${esc(r.critBasis.text)}` : ''}${r.critBasis && r.critBasis.status !== 'confirmed' ? ' <span class="muted">(предварительно)</span>' : ''}</dd>`;
    if (r.conditions.length) h += `<dt>Условие</dt><dd>${r.conditions.map(esc).join('; ')}</dd>`;
    if (r.verification) {
      if (r.verification.criterion) h += `<dt>Критерий приёмки</dt><dd>${esc(r.verification.criterion)}</dd>`;
      h += `<dt>Проверка</dt><dd>${esc(L.verification[r.verification.method] || r.verification.method)}`;
      r.verification.checks.forEach((ch) => {
        h += `<details class="xpath"><summary>XPath-проверка по ${esc(ch.target)}${ch.status === 'proposed' ? ', предложена' : ''}</summary><code>${esc(ch.expr)}</code></details>`;
      });
      h += '</dd>';
    }
    if (r.ext.length) h += `<dt>Источник</dt><dd>${r.ext.map(refLink).join('; ')}</dd>`;
    const ln = M().links.filter((l) => l.from === r.id || l.to === r.id);
    if (ln.length) h += `<dt>Связи</dt><dd>${ln.map((l) => (l.from === r.id ? `${esc(L.relation[l.relation] || l.relation)}: ${refLink(l.to)}` : `${refLink(l.from)} ${esc(L.relation[l.relation] || l.relation)}`)).join('<br>')}</dd>`;
    if (r.tags.length) h += `<dt>Теги</dt><dd>${r.tags.map((t) => `<code>${esc(t)}</code>`).join(' ')}</dd>`;
    if (r.registry) {
      const g = r.registry;
      h += `<dt>Карточка реестра</dt><dd><span class="req-id">${esc(g.id)}</span>${g.level ? `, уровень ${esc(g.level)}` : ''}${g.status ? `, ${esc((L.regStatus[g.status] || g.status).toLowerCase())}` : ''}${g.version ? `, версия ${esc(g.version)}` : ''}${g.remark ? `<div class="muted">${esc(g.remark)}</div>` : ''}</dd>`;
    }
    h += `<dt>Идентификатор</dt><dd><span class="req-id">${esc(r.id)}</span></dd>`;
    return h + '</dl>';
  }
  function reqCard(r, { quote = false, toList = true } = {}) {
    const bad = M().integrity.badQuotes.includes(r);
    return `<article class="req ${esc(r.modality)}" id="${esc(r.id)}">
      <div class="req-top">${chips(r)}${flags(r.id)}</div>
      <div class="req-stmt">${esc(r.statement)}</div>
      ${quote && r.quote ? `<blockquote class="quote">«${esc(r.quote)}»</blockquote>` : ''}
      ${bad ? '<p class="integrity-list">Цитата требования не найдена в тексте пункта.</p>' : ''}
      ${reqMeta(r)}
      <div class="req-actions">
        <button type="button" data-copy="#/req/${esc(r.id)}">Скопировать ссылку</button>
        ${toList ? `<a href="#/req/${esc(r.id)}">Открыть в списке требований</a>` : `<a href="#/doc/${esc(r.clause ? r.clause.id : '')}">Показать в тексте</a>`}
      </div>
    </article>`;
  }

  /* ---------- Вид: документ ---------- */
  function viewDoc() {
    const m = M();
    const meta = m.meta;
    const ch = m.changes[0];
    const impl = m.reqs.filter((r) => r.basis === 'implicit').length;
    const statusCls = m.status === 'effective' ? 'status-effective' : 'status-draft';
    const approved = ch && ch.basis && !/_{2,}/.test(ch.basis);
    const signRow = (role, p, last) => `<div class="role${last ? ' last' : ''}">${esc(role)}</div><div class="${last ? 'last' : ''}">${p ? esc(p.text) + (p.person ? ', ' + esc(p.person) : '') : '<span class="void">—</span>'}</div><div class="${last ? 'last' : ''}"></div><div class="${last ? 'last' : ''}"></div>`;

    let h = '<header class="doc-head">';
    if (meta.processPath.length) h += `<ol class="process-path" aria-label="Процесс">${meta.processPath.map((p) => `<li>${esc(p.id)} ${esc(p.text)}</li>`).join('')}</ol>`;
    else if (meta.processRef.id) h += `<ol class="process-path"><li>${esc(meta.processRef.id)} ${esc(meta.processRef.text)}</li></ol>`;
    h += `<h1 class="doc-title">${esc(meta.title)}</h1>`;

    h += '<div class="stamp" role="group" aria-label="Карточка документа">';
    h += '<div class="stamp-sign"><div class="h">Роль</div><div class="h">Должность</div><div class="h">Подп.</div><div class="h">Дата</div>';
    meta.developers.forEach((d) => { h += signRow('Разраб.', d); });
    if (meta.manager) h += signRow('Менеджер', meta.manager);
    h += signRow('Владелец', meta.owner);
    if (meta.methodologist) h += signRow('Методолог', meta.methodologist);
    h += `<div class="role last">Утв.</div><div class="last">${approved ? esc(ch.basis) : '<span class="void">приказ не издан</span>'}</div><div class="last"></div><div class="last">${ch && ch.date ? esc(ch.date) : '<span class="void">—</span>'}</div>`;
    h += '</div>';
    h += `<div class="stamp-main">
        <div class="code"><span class="lbl">Обозначение</span>${esc(m.id)}</div>
        <div class="cell" style="grid-column: span 2"><span class="lbl">Вид документа</span><span class="val">${esc(meta.docType)}${meta.docTypeCode ? ` <span class="muted">${esc(meta.docTypeCode)}</span>` : ''}</span></div>
        <div class="cell"><span class="lbl">Процесс</span><span class="val">${esc(meta.processRef.id)}</span></div>
        <div class="cell"><span class="lbl">Статус</span><span class="val ${statusCls}">${esc(L.status[m.status] || m.status)}</span></div>
        <div class="cell"><span class="lbl">Версия</span><span class="val">${esc(m.version)}</span></div>
        <div class="cell"><span class="lbl">Требований</span><span class="val">${m.reqs.length}</span></div>
        <div class="scope">${scopeHtml(m)}</div>
        ${meta.org ? `<div class="org">${esc(meta.org)}</div>` : ''}
      </div>`;
    h += '</div>';

    if (m.reqs.length) {
      h += `<p class="summary">Документ разложен на <a href="#/req">${m.reqs.length} ${plural(m.reqs.length, 'атомарное требование', 'атомарных требования', 'атомарных требований')}</a>.`;
      if (impl) h += ` У <a href="#/req?basis=implicit">${impl}</a> из них модальность выведена из формулировки: в тексте нет слов «должен» или «не допускается».`;
      if (m.reqs.some((r) => r.registry)) {
        const done = m.reqs.map(registryRow).filter((x) => x[17] === 'Готово').length;
        const cc = ['C1', 'C2', 'C3', 'C4'].map((c) => [c, m.reqs.filter((r) => r.criticality === c).length]).filter(([, n]) => n);
        h += ` В <a href="#/registry">реестре</a> комплектны ${done} ${plural(done, 'карточка', 'карточки', 'карточек')} из ${m.reqs.length}; критичность ${cc.map(([c, n]) => `${c} — ${n}`).join(', ')}.`;
      }
      if (m.notes.length) h += ` К исходному тексту <a href="#/notes">${m.notes.length} ${plural(m.notes.length, 'замечание', 'замечания', 'замечаний')}</a>.`;
      h += '</p>';
    }
    const ig = m.integrity;
    if (!ig.dangling.length && !ig.badQuotes.length) {
      h += `<div class="integrity"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Ссылки разрешены, цитаты ${ig.quoted} ${plural(ig.quoted, 'требования', 'требований', 'требований')} найдены в тексте пунктов</div>`;
    } else {
      h += `<div class="integrity bad"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>Найдены проблемы целостности</div><ul class="integrity-list">${ig.dangling.map((d) => `<li>Ссылка ${esc(d.id)} не определена в документе (${esc(d.where)})</li>`).join('')}${ig.badQuotes.map((r) => `<li>Цитата требования ${refLink(r.id)} не найдена в тексте пункта</li>`).join('')}</ul>`;
    }

    h += '</header>';

    if (m.reqs.length) {
      h += `<div class="read" style="margin-bottom:8px"><button type="button" class="btn btn-sm" id="toggleAll">${S.allAtoms ? 'Свернуть требования в тексте' : 'Показать все требования в тексте'}</button></div>`;
    }

    if (m.changes.length) {
      h += '<section class="doc-section" id="changes"><h2><span class="n"></span><span>Регистрация изменений</span></h2><div class="table-wrap"><table class="grid"><thead><tr><th>Версия</th><th>Дата введения</th><th>Основание</th><th>Описание изменения</th></tr></thead><tbody>';
      m.changes.forEach((c) => { h += `<tr><td>${esc(c.version)}</td><td>${c.date ? esc(c.date) : '<span class="muted">не заполнена</span>'}</td><td>${esc(c.basis)}</td><td>${esc(c.description)}</td></tr>`; });
      h += '</tbody></table></div></section>';
    }
    if (m.termsStandalone) h += `<section class="doc-section" id="terms"><h2><span class="n"></span><span>Термины, сокращения и определения</span></h2>${termsTable()}</section>`;
    m.body.forEach((s) => { h += section(s, 1); });
    if (m.refsStandalone) h += `<section class="doc-section" id="references"><h2><span class="n"></span><span>Нормативные ссылки</span></h2>${refsTable()}</section>`;
    return h;
  }

  function scopeHtml(m) {
    let h = '';
    m.scope.conditions.forEach((c) => { h += `<p><span class="lbl">Область применения</span>${esc(c.text)}${c.clause ? ` (${refLink(c.clause)})` : ''}</p>`; });
    m.scope.audience.forEach((a) => { h += `<p><span class="lbl">Руководствуется</span>${refLink(a.ref)}${a.clause ? ` (${refLink(a.clause)})` : ''}</p>`; });
    return h;
  }

  function section(s, level) {
    const H = level === 1 ? 'h2' : 'h3';
    const isApp = s.skind === 'appendix';
    const n = !isApp && s.number ? `${s.number}.` : '';
    const title = isApp && s.number ? `${s.number}. ${s.title}` : s.title;
    let h = `<section${level === 1 ? ' class="doc-section"' : ''} id="${esc(s.id)}" data-sec="${esc(s.id)}">`;
    h += `<${H}><span class="n">${esc(n)}</span><span>${esc(title)}${flags(s.id)}</span></${H}>`;
    s.items.forEach((it) => {
      if (it.kind === 'section') h += section(it, level + 1);
      else if (it.kind === 'clause') h += clause(it);
      else if (it.kind === 'termList') h += termsTable();
      else if (it.kind === 'referenceList') h += refsTable();
      else if (it.kind === 'paragraph') h += `<p>${esc(it.text)}</p>`;
    });
    return h + '</section>';
  }

  function clause(c) {
    const n = c.label || (c.number && !(c.section && c.number === c.section.number) ? `${c.number}.` : '');
    let h = `<div class="clause" id="${esc(c.id)}"><div class="cl-num">${n ? `<a href="#/doc/${esc(c.id)}" title="Ссылка на ${esc(cite(c))}">${esc(n)}</a>` : ''}</div><div class="cl-body">`;
    if (c.textEl) h += `<div class="txt">${blocks(c.textEl)}</div>`;
    h += flags(c.id);
    if (c.reqs.length) {
      const open = S.allAtoms || S.openAtoms.has(c.id);
      const dots = c.reqs.map((r) => `<span class="dot ${esc(r.modality)}${r.basis === 'implicit' ? ' implicit' : ''}"></span>`).join('');
      h += `<div class="atoms"><button type="button" class="atoms-toggle" data-atoms="${esc(c.id)}" aria-expanded="${open}" aria-controls="atoms-${esc(c.id)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          ${c.reqs.length} ${plural(c.reqs.length, 'требование', 'требования', 'требований')}<span class="dots" aria-hidden="true">${dots}</span></button>
        <div class="atoms-list" id="atoms-${esc(c.id)}"${open ? '' : ' hidden'}>${c.reqs.map((r) => reqCard(r)).join('')}</div></div>`;
    }
    h += c.clauses.map(clause).join('');
    return h + '</div></div>';
  }

  function termsTable() {
    const m = M();
    let h = m.termsNote ? `<p class="muted"><em>${esc(m.termsNote)}</em></p>` : '';
    h += '<div class="table-wrap"><table class="grid"><thead><tr><th style="width:34%">Термин (сокращение)</th><th>Определение</th></tr></thead><tbody>';
    m.terms.forEach((t) => {
      h += `<tr id="${esc(t.id)}"><td>${esc(t.name)}${t.abbr ? ` (${esc(t.abbr)})` : ''}<div>${flags(t.id)}</div></td><td>${esc(t.def)}${t.notes.map((x) => `<p style="margin:6px 0 0">${esc(x)}</p>`).join('')}</td></tr>`;
    });
    return h + '</tbody></table></div>';
  }
  function refsTable() {
    const m = M();
    const src = m.refs.filter((r) => r.origin !== 'derived');
    const der = m.refs.filter((r) => r.origin === 'derived');
    let h = '<div class="table-wrap"><table class="grid"><thead><tr><th style="width:9%">№</th><th style="width:24%">ID</th><th>Наименование источника</th></tr></thead><tbody>';
    src.forEach((r, i) => { h += `<tr id="${esc(r.id)}"><td>${i + 1}.</td><td>${esc(r.identifier)}</td><td>${esc(r.title)}${flags(r.id)}</td></tr>`; });
    h += '</tbody></table></div>';
    if (der.length) h += `<p class="muted">Используются в тексте, но отсутствуют в перечне: ${der.map((r) => `<span id="${esc(r.id)}"><b>${esc(r.identifier)}</b> (${esc(r.title)})</span>${flags(r.id)}`).join('; ')}</p>`;
    return h;
  }

  /* ---------- Вид: требования ---------- */
  function filteredReqs() {
    const f = S.f;
    const words = norm(f.q).toLowerCase().split(' ').filter(Boolean);
    return M().reqs.filter((r) => {
      if (f.modality !== 'all' && r.modality !== f.modality) return false;
      if (f.basis !== 'all' && (r.basis || 'explicit') !== f.basis) return false;
      if (f.crit !== 'all' && r.criticality !== f.crit) return false;
      if (f.owner && (!r.owner || r.owner.ref !== f.owner)) return false;
      const auto = !!(r.verification && r.verification.checks.length);
      if (f.check === 'auto' && !auto) return false;
      if (f.check === 'manual' && auto) return false;
      if (f.role && r.subject !== f.role && !r.counterparts.includes(f.role)) return false;
      if (f.object && !r.objects.includes(f.object)) return false;
      if (f.kind && r.rkind !== f.kind) return false;
      if (f.section && topSection(r.section).id !== f.section) return false;
      if (words.length) {
        const hay = `${r.title} ${r.statement} ${r.quote} ${r.id} ${r.registry ? r.registry.id : ''} ${reqCite(r)} ${r.tags.join(' ')} ${nameOf(r.subject)} ${r.objects.map(nameOf).join(' ')}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }
  const topSection = (s) => { let x = s; while (x && x.parent) x = x.parent; return x || {}; };

  function viewReqs() {
    const m = M();
    const f = S.f;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-f="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${t}</button>`).join('')}</div>`;
    const roles = m.roles.filter((r) => m.reqs.some((q) => q.subject === r.id || q.counterparts.includes(r.id)));
    const owners = m.roles.filter((r) => m.reqs.some((q) => q.owner && q.owner.ref === r.id));
    const objs = m.objects.filter((o) => m.reqs.some((q) => q.objects.includes(o.id)));
    const kinds = [...new Set(m.reqs.map((r) => r.rkind).filter(Boolean))];
    const secs = m.body.filter((s) => m.reqs.some((r) => topSection(r.section) === s));
    const sel = (key, label, items) => `<label class="f-group"><span class="f-label">${label}</span><select data-fsel="${key}"><option value="">все</option>${items.map(([v, t]) => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

    let h = `<div class="page-head"><div><h1>Атомарные требования</h1><p>Каждое требование ссылается на свой пункт и хранит дословную цитату из него. Отберите нужные фильтрами и выгрузите в Excel в формате корпоративного реестра.</p></div></div>`;
    h += `<div class="filters">
      <div class="f-row"><input type="search" id="fq" placeholder="Слова из формулировки, номер пункта или ID" value="${esc(f.q)}" aria-label="Поиск по требованиям"></div>
      <div class="f-row">
        <div class="f-group"><span class="f-label">Модальность</span>${seg('modality', [['all', 'все'], ['shall', 'обязательно'], ['should', 'рекомендуется'], ['shall-not', 'запрещено']])}</div>
        <div class="f-group"><span class="f-label">Основание</span>${seg('basis', [['all', 'все'], ['explicit', 'есть в тексте'], ['implicit', 'выведена']])}</div>
        <div class="f-group"><span class="f-label">Проверка</span>${seg('check', [['all', 'все'], ['auto', 'автоматическая'], ['manual', 'экспертиза']])}</div>
        ${m.reqs.some((r) => r.criticality) ? `<div class="f-group"><span class="f-label">Критичность</span>${seg('crit', [['all', 'все'], ...['C1', 'C2', 'C3', 'C4'].filter((c) => m.reqs.some((r) => r.criticality === c)).map((c) => [c, c])])}</div>` : ''}
      </div>
      <div class="f-row">
        ${sel('section', 'Раздел', secs.map((s) => [s.id, `${s.skind === 'appendix' ? '' : s.number + '. '}${s.skind === 'appendix' ? s.number + '. ' : ''}${s.title}`]))}
        ${owners.length ? sel('owner', 'Владелец', owners.map((r) => [r.id, r.name])) : ''}
        ${sel('role', 'Роль', roles.map((r) => [r.id, r.name]))}
        ${sel('object', 'Объект', objs.map((o) => [o.id, o.name]))}
        ${sel('kind', 'Вид', kinds.map((k) => [k, L.kind[k] || k]))}
      </div>
    </div>`;
    h += '<div id="reqResults"></div>';
    return h;
  }
  function renderReqResults() {
    const box = $('#reqResults');
    if (!box) return;
    const list = filteredReqs();
    const total = M().reqs.length;
    const filtered = list.length !== total;
    let h = `<div class="result-line"><span>${filtered ? `Найдено ${list.length} из ${total}` : `Всего ${total}`}${filtered ? ' <button type="button" class="link-btn" id="resetF">Сбросить фильтры</button>' : ''}</span>
      <button type="button" class="btn btn-sm" id="csvFiltered"${list.length ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>${filtered ? 'Выгрузить найденные в Excel' : 'Выгрузить в Excel'}</button></div>`;
    if (!list.length) {
      h += '<div class="empty">По этим условиям требований нет. Ослабьте фильтры или сбросьте их.</div>';
    } else {
      h += '<div class="req-table">';
      list.forEach((r) => {
        const open = S.openRows.has(r.id);
        h += `<div class="req-row ${esc(r.modality)}${open ? ' open' : ''}" id="row-${esc(r.id)}">
          <div class="where"><a href="#/doc/${esc(r.clause ? r.clause.id : '')}" title="Показать в тексте">${esc(reqCite(r))}</a></div>
          <div><div class="chips">${chips(r)}</div>${r.title ? `<div class="req-title">${esc(r.title)}</div>` : ''}<div class="req-stmt">${esc(r.statement)}</div>${reqLine(r) ? `<div class="line">${reqLine(r)}</div>` : ''}
            <button type="button" class="link-btn" data-row="${esc(r.id)}" aria-expanded="${open}">${open ? 'Скрыть подробности' : 'Подробнее'}</button></div>
          ${open ? `<div class="more">${r.quote ? `<blockquote class="quote">«${esc(r.quote)}»</blockquote>` : ''}${reqMeta(r)}<div class="req-actions"><button type="button" data-copy="#/req/${esc(r.id)}">Скопировать ссылку</button><a href="#/doc/${esc(r.clause ? r.clause.id : '')}">Показать в тексте</a></div></div>` : ''}
        </div>`;
      });
      h += '</div>';
    }
    box.innerHTML = h;
  }

  /* ---------- Корпоративный реестр требований ---------- */
  function registryRow(r) {
    const m = M();
    const g = r.registry || {};
    const sc = m.scope.conditions[0];
    const scClause = sc && sc.clause ? m.byId.get(sc.clause) : null;
    const scope = sc ? sc.text + (scClause && scClause.number ? ` (п. ${scClause.number})` : '') : '';
    const conds = r.conditions.map((c) => c.charAt(0).toLowerCase() + c.slice(1));
    const v = r.verification;
    let method = '';
    if (v) method = v.method === 'model-validation' ? (v.checks.length ? 'Автоматическая проверка BPMN-схемы (XPath) / экспертиза' : 'Экспертиза BPMN-схемы') : (REG_METHOD[v.method] || v.method);
    const notes = [];
    if (g.remark) notes.push(g.remark);
    if (r.basis === 'implicit') notes.push('Модальность выведена из формулировки: в тексте нет «должен».');
    if (r.critBasis) notes.push(`Обоснование ${r.criticality}: ${r.critBasis.text}`);
    if ((r.owner && r.owner.status !== 'confirmed') || (r.critBasis && r.critBasis.status !== 'confirmed')) notes.push('Критичность и владелец — предварительно, подтвердить владельцем.');
    const row = [
      g.id || r.id, r.title, r.objects.length ? nameOf(r.objects[0]) : '', r.statement,
      `${m.id} «${m.meta.title}», версия ${m.version}`, `${reqCite(r)}; ${r.id}`, g.level || '',
      r.owner ? nameOf(r.owner.ref) : '', [scope, ...conds].filter(Boolean).join('; '), r.criticality || '', method,
      v ? v.criterion : '', g.status ? L.regStatus[g.status] || g.status : '', g.version || '', g.effective || '', g.evidence || '', notes.join(' '),
    ];
    row.push(regComplete(row) ? 'Готово' : 'Заполнить');
    return row;
  }
  const regComplete = (row) => !!row[0] && REG_REQUIRED.every((i) => String(row[i] || '').trim() !== '');

  function filteredRegistry() {
    const f = S.rf;
    const words = norm(f.q).toLowerCase().split(' ').filter(Boolean);
    return M().reqs.filter((r) => {
      if (f.crit !== 'all' && r.criticality !== f.crit) return false;
      if (f.owner && (!r.owner || r.owner.ref !== f.owner)) return false;
      if (f.done !== 'all') { const ok = regComplete(registryRow(r)); if ((f.done === 'ok') !== ok) return false; }
      if (words.length) { const hay = registryRow(r).join(' ').toLowerCase(); if (!words.every((w) => hay.includes(w))) return false; }
      return true;
    });
  }

  function viewRegistry() {
    const m = M();
    const rows = m.reqs.map(registryRow);
    const done = rows.filter((x) => x[17] === 'Готово').length;
    const classes = ['C1', 'C2', 'C3', 'C4'];
    const byCrit = classes.map((c) => [c, m.reqs.filter((r) => r.criticality === c).length]);
    const noCrit = m.reqs.filter((r) => !r.criticality).length;
    const owners = m.roles.filter((ro) => m.reqs.some((r) => r.owner && r.owner.ref === ro.id));
    const prelim = m.reqs.some((r) => (r.owner && r.owner.status !== 'confirmed') || (r.critBasis && r.critBasis.status !== 'confirmed'));
    const statuses = [...new Set(rows.map((x) => x[12]).filter(Boolean))];
    const f = S.rf;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-rf="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${t}</button>`).join('')}</div>`;

    let h = `<div class="page-head"><div><h1>Реестр требований</h1><p>Карточки в формате корпоративного мастер-реестра: одна строка — одно атомарное требование. Столбцы выгрузки A–R совпадают с шаблоном пилота V0.1, поэтому строки можно вставить в мастер-реестр без перестановки.</p></div>
      <button type="button" class="btn btn-primary" data-dl="xlsx"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Скачать реестр (Excel)</span></button></div>`;

    h += '<section class="reg-summary">';
    h += `<div class="reg-fact"><span class="lbl">Карточек</span><b>${rows.length}</b></div>`;
    h += `<div class="reg-fact"><span class="lbl">Комплектных</span><b class="${done === rows.length ? 'ok' : 'bad'}">${done}</b></div>`;
    h += `<div class="reg-fact"><span class="lbl">Статус</span><b>${statuses.map(esc).join(', ') || '—'}</b></div>`;
    h += `<div class="reg-crit"><span class="lbl">Критичность</span><div class="crit-bar" role="img" aria-label="${byCrit.map(([c, n]) => `${c}: ${n}`).join(', ')}">${byCrit.filter(([, n]) => n).map(([c, n]) => `<span class="${c.toLowerCase()}" style="flex:${n}" title="${c}: ${n} — ${esc(L.criticality[c])}">${c} ${n}</span>`).join('')}${noCrit ? `<span class="none" style="flex:${noCrit}">без класса ${noCrit}</span>` : ''}</div>
      <div class="crit-legend">${byCrit.map(([c, n]) => `<span><i class="${c.toLowerCase()}"></i>${c}: ${n}, ${esc(L.criticality[c].replace(' невыполнения', ''))}</span>`).join('')}</div></div>`;
    h += '</section>';

    if (owners.length) {
      h += '<div class="reg-owners">';
      owners.forEach((ro) => {
        const list = m.reqs.filter((r) => r.owner && r.owner.ref === ro.id);
        const cc = classes.map((c) => [c, list.filter((r) => r.criticality === c).length]).filter(([, n]) => n);
        h += `<button type="button" class="owner-pill${f.owner === ro.id ? ' on' : ''}" data-rowner="${esc(ro.id)}" aria-pressed="${f.owner === ro.id}"><b>${esc(ro.name)}</b><span>${list.length} ${plural(list.length, 'карточка', 'карточки', 'карточек')}: ${cc.map(([c, n]) => `${c} ${n}`).join(', ')}</span></button>`;
      });
      h += '</div>';
    }
    if (prelim) {
      const en = m.notes.find((n) => /владел/i.test(n.text) && /критичност/i.test(n.text));
      h += `<p class="prelim">Владельцы и классы критичности назначены предварительно и ждут подтверждения владельцами требований${en ? `, правила назначения — в <a href="#/notes/${esc(en.id)}">замечании ${esc(en.id)}</a>` : ''}. Постоянные CR-ID присваивает оператор реестра после проверки карточек.</p>`;
    }

    h += `<div class="filters">
      <div class="f-row"><input type="search" id="rq" placeholder="ID карточки, наименование, слова формулировки" value="${esc(f.q)}" aria-label="Поиск по реестру"></div>
      <div class="f-row">
        <div class="f-group"><span class="f-label">Критичность</span>${seg('crit', [['all', 'все'], ...classes.filter((c) => m.reqs.some((r) => r.criticality === c)).map((c) => [c, c])])}</div>
        <div class="f-group"><span class="f-label">Комплектность</span>${seg('done', [['all', 'все'], ['ok', 'готово'], ['todo', 'заполнить']])}</div>
      </div></div>`;
    h += '<div id="regResults"></div>';
    return h;
  }

  function renderRegistryResults() {
    const box = $('#regResults');
    if (!box) return;
    const list = filteredRegistry();
    const total = M().reqs.length;
    const filtered = list.length !== total;
    let h = `<div class="result-line"><span>${filtered ? `Найдено ${list.length} из ${total}` : `Всего ${total}`}${filtered ? ' <button type="button" class="link-btn" id="resetRF">Сбросить фильтры</button>' : ''}</span>
      <button type="button" class="btn btn-sm" data-dl="xlsx-registry"${list.length ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>${filtered ? 'Скачать найденные (Excel)' : 'Скачать (Excel)'}</button></div>`;
    if (!list.length) { box.innerHTML = h + '<div class="empty">По этим условиям карточек нет.</div>'; return; }
    h += '<div class="reg-table"><div class="reg-head" aria-hidden="true"><span>ID карточки</span><span>Наименование и формулировка</span><span>Владелец</span><span>Класс</span><span>Комплектность</span></div>';
    list.forEach((r) => {
      const row = registryRow(r);
      const open = S.openReg.has(r.id);
      h += `<div class="reg-row${open ? ' open' : ''}" id="reg-${esc(r.id)}">
        <div class="rid"><span class="req-id">${esc(row[0])}</span><a href="#/doc/${esc(r.clause ? r.clause.id : '')}">${esc(reqCite(r))}</a></div>
        <div><div class="req-title">${esc(row[1] || 'без наименования')}</div><div class="line">${esc(row[3])}</div>
          <button type="button" class="link-btn" data-reg="${esc(r.id)}" aria-expanded="${open}">${open ? 'Скрыть карточку' : 'Вся карточка'}</button></div>
        <div class="owner">${row[7] ? esc(row[7]) : '<span class="bad-ref">не назначен</span>'}</div>
        <div>${row[9] ? `<span class="chip crit ${esc(row[9].toLowerCase())}" title="${esc(L.criticality[row[9]] || '')}">${esc(row[9])}</span>` : '<span class="bad-ref">—</span>'}</div>
        <div>${row[17] === 'Готово' ? '<span class="chip shall">Готово</span>' : '<span class="chip shall-not">Заполнить</span>'}</div>
        ${open ? `<dl class="reg-card">${REG_HEAD.map((t, i) => `<dt><span class="col">${String.fromCharCode(65 + i)}</span>${esc(t)}</dt><dd>${row[i] ? esc(row[i]) : `<span class="muted">${REG_REQUIRED.includes(i) ? 'не заполнено' : '—'}</span>`}</dd>`).join('')}</dl>` : ''}
      </div>`;
    });
    box.innerHTML = h + '</div>';
  }

  async function exportXlsx(list, fileName) {
    toast('Готовлю файл Excel…', 6000);
    if (!window.ExcelJS) await loadScript(EXCELJS_URL);
    const m = M();
    const rows = list.map(registryRow);
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'ИСМ XML';
    wb.created = new Date();
    const ws = wb.addWorksheet('Реестр', { views: [{ state: 'frozen', ySplit: 5 }] });
    ws.columns = REG_WIDTHS.map((w) => ({ width: w }));
    const last = 5 + rows.length;
    const lastV = Math.max(105, last);
    const arial = (o = {}) => ({ name: 'Arial', size: 9, ...o });
    const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    ws.mergeCells('A1:R1');
    Object.assign(ws.getCell('A1'), { value: 'КОРПОРАТИВНЫЙ МАСТЕР-РЕЕСТР ТРЕБОВАНИЙ' });
    ws.getCell('A1').font = arial({ size: 18, bold: true, color: { argb: 'FFFFFFFF' } });
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
    ws.getCell('A1').alignment = { vertical: 'middle' };
    ws.getRow(1).height = 30;
    ws.mergeCells('A2:R2');
    const today = new Date().toLocaleDateString('ru-RU');
    ws.getCell('A2').value = `Одна строка = одна карточка = одно атомарное требование. Выгрузка из ${m.id}, версия ${m.version}, ${today}. Столбцы A–R совпадают с шаблоном пилота V0.1.`;
    ws.getCell('A2').font = arial({ italic: true, color: { argb: 'FF595959' } });
    const cnt = (a, b) => rows.filter((x) => x[a] === b).length;
    const counters = [
      ['A3', 'Всего карточек', 'C3', `COUNTIF(A6:A${lastV},"<>")`, rows.length],
      ['D3', 'Комплектных', 'F3', `COUNTIF(R6:R${lastV},"Готово")`, cnt(17, 'Готово')],
      ['G3', 'Требуют заполнения', 'I3', `COUNTIF(R6:R${lastV},"Заполнить")`, cnt(17, 'Заполнить')],
      ['J3', 'Действующих', 'L3', `COUNTIF(M6:M${lastV},"Действует")`, cnt(12, 'Действует')],
    ];
    counters.forEach(([lc, lt, vc, fx, res]) => {
      ws.getCell(lc).value = lt; ws.getCell(lc).font = arial({ bold: true });
      ws.getCell(lc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      ws.getCell(vc).value = { formula: fx, result: res }; ws.getCell(vc).font = arial({ bold: true, size: 11 });
    });

    const head = ws.getRow(5);
    REG_HEAD.forEach((t, i) => {
      const c = head.getCell(i + 1);
      c.value = t;
      c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } });
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F75B5' } };
      c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      c.border = border;
    });
    head.height = 44;

    rows.forEach((row, k) => {
      const rn = 6 + k;
      const xr = ws.getRow(rn);
      let lines = 1;
      row.forEach((val, i) => {
        const c = xr.getCell(i + 1);
        if (i === 17) {
          c.value = { formula: `IF(A${rn}="","",IF(OR(B${rn}="",C${rn}="",D${rn}="",E${rn}="",G${rn}="",H${rn}="",I${rn}="",J${rn}="",K${rn}="",L${rn}="",M${rn}=""),"Заполнить","Готово"))`, result: val };
        } else {
          c.value = val === '' ? null : val;
          if (val) lines = Math.max(lines, Math.ceil(String(val).length / (REG_WIDTHS[i] * 1.15)));
        }
        c.font = arial({ color: { argb: 'FF1F1F1F' } });
        c.alignment = { wrapText: true, vertical: 'top' };
        c.border = border;
      });
      xr.height = Math.max(36, Math.min(409, lines * 12 + 8));
    });

    const list1 = (vals) => ({ type: 'list', allowBlank: true, formulae: [`"${vals.join(',')}"`] });
    ws.dataValidations.add(`G6:G${lastV}`, list1(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']));
    ws.dataValidations.add(`J6:J${lastV}`, list1(['C1', 'C2', 'C3', 'C4']));
    ws.dataValidations.add(`M6:M${lastV}`, list1(Object.values(L.regStatus)));
    const fill = (argb) => ({ type: 'pattern', pattern: 'solid', bgColor: { argb } });
    ws.addConditionalFormatting({ ref: `J6:J${lastV}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'C1', priority: 1, style: { fill: fill('FFFFC7CE'), font: { color: { argb: 'FF9C0006' }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'C2', priority: 2, style: { fill: fill('FFFCE4D6'), font: { color: { argb: 'FF833C0B' } } } },
    ] });
    ws.addConditionalFormatting({ ref: `R6:R${lastV}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'Готово', priority: 3, style: { fill: fill('FFC6EFCE'), font: { color: { argb: 'FF006100' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Заполнить', priority: 4, style: { fill: fill('FFFFEB9C'), font: { color: { argb: 'FF9C5700' } } } },
    ] });
    ws.autoFilter = `A5:R${Math.max(last, 6)}`;

    const ref = wb.addWorksheet('Справочники');
    ref.columns = [{ width: 10 }, { width: 52 }, { width: 4 }, { width: 10 }, { width: 52 }, { width: 4 }, { width: 24 }, { width: 50 }];
    ref.getCell('A1').value = 'СПРАВОЧНИКИ И ПРАВИЛА КОДИРОВАНИЯ';
    ref.getCell('A1').font = arial({ size: 14, bold: true });
    ref.getCell('A2').value = 'Значения соответствуют листу «Справочники» шаблона пилота V0.1. Изменение допустимых значений выполняет оператор реестра.';
    ref.getCell('A2').font = arial({ italic: true, color: { argb: 'FF595959' } });
    const hdr = ['Уровень', 'Содержание', '', 'Класс', 'Последствие невыполнения', '', 'Статус карточки', 'Когда используется'];
    hdr.forEach((t, i) => { if (!t) return; const c = ref.getRow(4).getCell(i + 1); c.value = t; c.font = arial({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F75B5' } }; });
    const lv = Object.entries(L.level);
    const cr = [['C1', 'Критические / корпоративно неприемлемые последствия'], ['C2', 'Высокие существенные последствия'], ['C3', 'Средние локальные управляемые последствия'], ['C4', 'Низкие ограниченные обратимые последствия']];
    const st = [['Черновик', 'Потребность зарегистрирована, карточка заполняется'], ['На проверке оператора', 'Владелец завершил первичное заполнение'], ['На согласовании', 'Карточка направлена участникам'], ['Утверждено', 'Решение принято, готовится публикация'], ['Действует', 'Требование обязательно в установленной области'], ['На пересмотре', 'Действующая версия анализируется; не отменена'], ['Заменено', 'Есть новая версия или новое требование'], ['Архив', 'Не применяется; история и связи сохранены']];
    for (let i = 0; i < 8; i++) {
      const r = ref.getRow(5 + i);
      if (lv[i]) { r.getCell(1).value = lv[i][0]; r.getCell(2).value = lv[i][1].charAt(0).toUpperCase() + lv[i][1].slice(1); }
      if (cr[i]) { r.getCell(4).value = cr[i][0]; r.getCell(5).value = cr[i][1]; }
      if (st[i]) { r.getCell(7).value = st[i][0]; r.getCell(8).value = st[i][1]; }
      r.eachCell((c) => { c.font = arial(); c.alignment = { wrapText: true, vertical: 'top' }; });
    }
    const idr = ref.getRow(15);
    [['A15', 'Правило ID'], ['B15', 'Постоянный: CR-[ДОМЕН]-[ОБЪЕКТ]-[NNNN], присваивает оператор после проверки карточки; рабочий: TEMP-[дата]-[номер]. ID не изменяется и не используется повторно.']]
      .forEach(([a, t]) => { ref.getCell(a).value = t; ref.getCell(a).font = arial({ bold: a === 'A15' }); ref.getCell(a).alignment = { wrapText: true, vertical: 'top' }; });
    ref.mergeCells('B15:H15'); idr.height = 28;
    ref.getCell('A16').value = 'Версия'; ref.getCell('A16').font = arial({ bold: true });
    ref.getCell('B16').value = '0.x — проект; 1.0 — первая действующая; смысловое изменение — новая версия и повторное решение.'; ref.getCell('B16').font = arial();
    ref.mergeCells('B16:H16');

    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
    toast('Файл Excel готов');
  }

  /* ---------- Вид: роли ---------- */
  function viewRoles() {
    const m = M();
    const resp = m.reqs.filter((r) => r.subject && r.action);
    const actions = [];
    resp.forEach((r) => { if (!actions.some((a) => a.code === r.action.code)) actions.push(r.action); });
    const actors = m.roles.filter((ro) => resp.some((r) => r.subject === ro.id));

    let h = '<div class="page-head"><div><h1>Роли</h1><p>Кто что делает по документу. Собрано из атомарных требований и связей.</p></div></div>';
    if (actors.length) {
      h += '<section class="block"><h2>Кто что делает с ФМ</h2><div class="table-wrap"><table class="grid matrix"><thead><tr><th>Роль</th>';
      actions.forEach((a) => { h += `<th>${esc(a.label.charAt(0).toUpperCase() + a.label.slice(1))}<div class="muted" style="font-weight:400">${esc(a.code)}</div></th>`; });
      h += '</tr></thead><tbody>';
      actors.forEach((ro) => {
        h += `<tr><th class="rowh"><a href="#/roles/${esc(ro.id)}">${esc(ro.name)}</a></th>`;
        actions.forEach((a) => {
          const cell = resp.filter((r) => r.subject === ro.id && r.action.code === a.code);
          h += `<td class="mark">${cell.length ? cell.map((r) => `<b>${r.objects.map((o) => esc(shortOf(o))).join(', ')}</b> <a href="#/req/${esc(r.id)}">${esc(reqCite(r))}</a>`).join('<br>') : '<span class="muted">—</span>'}</td>`;
        });
        h += '</tr>';
      });
      h += '</tbody></table></div></section>';
    }

    h += '<section class="block"><h2>Реестр ролей</h2><div class="cards">';
    m.roles.forEach((ro) => {
      const own = m.reqs.filter((r) => r.subject === ro.id);
      const with_ = m.reqs.filter((r) => r.counterparts.includes(ro.id));
      const used = m.links.filter((l) => l.to === ro.id && l.relation === 'usedBy');
      const aud = m.scope.audience.filter((a) => a.ref === ro.id);
      const def = m.links.filter((l) => l.from === ro.id && l.relation === 'definedBy').map((l) => m.byId.get(l.to)).filter(Boolean);
      const owns = m.reqs.filter((r) => r.owner && r.owner.ref === ro.id);
      h += `<div class="card" id="${esc(ro.id)}"><h3>${esc(ro.name)}</h3>
        <p class="alias">${esc(L.roleType[ro.type] || ro.type || '')}${ro.aliases.length ? `${ro.type ? '. ' : ''}В тексте: ${ro.aliases.map(esc).join('; ')}` : ''}</p>`;
      if (owns.length) {
        const cc = ['C1', 'C2', 'C3', 'C4'].map((c) => [c, owns.filter((r) => r.criticality === c).length]).filter(([, n]) => n);
        h += `<p style="margin:0 0 6px"><b>Владелец ${owns.length} ${plural(owns.length, 'требования', 'требований', 'требований')}</b> (${cc.map(([c, n]) => `${c}: ${n}`).join(', ')}). <a href="#/registry?owner=${esc(ro.id)}">Открыть в реестре</a></p>`;
      }
      if (own.length) h += `<ul>${own.map((r) => `<li>${esc(r.action ? r.action.label : r.statement)}${r.objects.length ? `: ${r.objects.map((o) => esc(nameOf(o))).join(', ')}` : ''} <a href="#/req/${esc(r.id)}">${esc(reqCite(r))}</a></li>`).join('')}</ul>`;
      const extra = [];
      with_.forEach((r) => extra.push(`сторона согласования: ${r.objects.map((o) => esc(nameOf(o))).join(', ')} (${refLink(r.id)})`));
      used.forEach((l) => extra.push(`ключевой пользователь: ${esc(nameOf(l.from))}${l.clause ? ` (${refLink(l.clause)})` : ''}`));
      aud.forEach((a) => extra.push(`руководствуется документом${a.clause ? ` (${refLink(a.clause)})` : ''}`));
      if (extra.length) h += `<ul>${extra.map((x) => `<li>${x}</li>`).join('')}</ul>`;
      def.forEach((t) => { h += `<p class="muted" style="margin:8px 0 0">Определение из раздела терминов: ${esc(t.def)}</p>`; });
      if (!own.length && !extra.length && !def.length && !owns.length) h += '<p class="muted">В требованиях не участвует.</p>';
      h += '</div>';
    });
    return h + '</div></section>';
  }

  /* ---------- Вид: объекты ---------- */
  function viewObjects() {
    const m = M();
    const types = [];
    m.objects.forEach((o) => { if (!types.includes(o.type)) types.push(o.type); });
    let h = '<div class="page-head"><div><h1>Объекты</h1><p>Над чем выполняются требования: документы, разделы ФМ, диаграммы и элементы нотации BPMN.</p></div></div>';
    types.forEach((t) => {
      h += `<section class="block"><h2>${esc(L.objectType[t] || t || 'Прочее')}</h2><div class="cards">`;
      m.objects.filter((o) => o.type === t).forEach((o) => {
        const using = m.reqs.filter((r) => r.objects.includes(o.id));
        const cites = [...new Map(using.map((r) => [reqCite(r), r])).values()];
        const out = m.links.filter((l) => l.from === o.id);
        const inc = m.links.filter((l) => l.to === o.id && l.relation === 'partOf');
        h += `<div class="card" id="${esc(o.id)}"><h3>${esc(o.name)}</h3>`;
        if (o.aliases.length) h += `<p class="alias">${o.aliases.map(esc).join('; ')}</p>`;
        if (o.description) h += `<p style="margin:0 0 6px;font-size:14.5px">${esc(o.description)}</p>`;
        if (o.codes.length) h += `<div class="codes">${o.codes.map((c) => `<code title="${esc(c.scheme)}">${esc(c.code)}</code>`).join('')}</div>`;
        const lines = [];
        if (using.length) lines.push(`<a href="#/req?object=${esc(o.id)}">${using.length} ${plural(using.length, 'требование', 'требования', 'требований')}</a>: ${cites.map((r) => `<a href="#/req/${esc(r.id)}">${esc(reqCite(r))}</a>`).join(', ')}`);
        out.forEach((l) => lines.push(`${esc(L.relation[l.relation] || l.relation)}: ${refLink(l.to)}`));
        inc.forEach((l) => lines.push(`включает: ${refLink(l.from)}`));
        if (lines.length) h += `<ul>${lines.map((x) => `<li>${x}</li>`).join('')}</ul>`;
        h += '</div>';
      });
      h += '</div></section>';
    });
    return h;
  }

  /* ---------- Вид: связи ---------- */
  function viewLinks() {
    const m = M();
    const rels = [...new Set(m.links.map((l) => l.relation))];
    const list = S.linkRel ? m.links.filter((l) => l.relation === S.linkRel) : m.links;
    let h = `<div class="page-head"><div><h1>Семантические связи</h1><p>Граф документа: что из чего состоит, что чем определяется и на что ссылается. У каждой связи указан пункт-основание.</p></div>
      <label class="f-group"><span class="f-label">Тип связи</span><select id="relSel" class="btn btn-sm"><option value="">все (${m.links.length})</option>${rels.map((r) => `<option value="${esc(r)}"${S.linkRel === r ? ' selected' : ''}>${esc(L.relation[r] || r)} (${m.links.filter((l) => l.relation === r).length})</option>`).join('')}</select></label></div>`;
    h += '<div class="table-wrap wide"><table class="grid"><thead><tr><th>От</th><th style="width:18%">Связь</th><th>К</th><th style="width:16%">Основание</th></tr></thead><tbody>';
    list.forEach((l) => {
      h += `<tr><td>${refLink(l.from)}</td><td>${esc(L.relation[l.relation] || l.relation)}<div class="muted"><code>${esc(l.relation)}</code></div></td><td>${refLink(l.to)}</td><td>${l.clause ? refLink(l.clause) : '<span class="muted">—</span>'}</td></tr>`;
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- Вид: замечания ---------- */
  function viewNotes() {
    const m = M();
    let h = `<div class="page-head"><div><h1>Замечания к исходному документу</h1><p>Выявлены при переводе документа в XML. Это не часть нормативного текста, а вопросы к разработчикам и методологу ИСМ.</p></div></div>`;
    if (!m.notes.length) return h + '<div class="empty">Замечаний нет.</div>';
    m.notes.forEach((n) => {
      h += `<div class="note" id="${esc(n.id)}"><div class="note-head"><b>${esc(L.noteType[n.type] || n.type)}</b><span>${esc(n.id)}</span>${n.target ? `<span>к объекту: ${refLink(n.target)}</span>` : ''}</div><p>${esc(n.text)}</p></div>`;
    });
    return h;
  }

  /* ---------- Вид: проверка ФМ ---------- */
  const CL_KEY = () => `ism-checklist:${M().id}:${M().version}`;
  function loadChecks() { try { return JSON.parse(localStorage.getItem(CL_KEY()) || '{}'); } catch { return {}; } }
  function saveChecks(o) { try { localStorage.setItem(CL_KEY(), JSON.stringify(o)); } catch { /* хранилище недоступно */ } }

  function viewCheck() {
    const m = M();
    const auto = m.reqs.filter((r) => r.verification && r.verification.checks.length);
    const manual = m.reqs.filter((r) => !(r.verification && r.verification.checks.length) && r.rkind !== 'document-control');
    let h = '<div class="page-head"><div><h1>Проверка функциональной модели</h1><p>Автоматическая проверка BPMN-схемы из графической части ФМ и чек-лист для остальных требований.</p></div></div>';

    h += `<section class="block"><h2>Схема процесса в BPMN</h2>
      <p class="lead">Загрузите файл .bpmn (BPMN 2.0 XML из Camunda Modeler, bpmn.io и других редакторов). Проверяются ${auto.length} ${plural(auto.length, 'требование', 'требования', 'требований')} ${[...new Set(auto.map(reqCite))].join(', ')}. Файл обрабатывается в браузере и никуда не отправляется.</p>
      <label class="drop" id="drop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4h14v-4"/></svg>
        <b>Перетащите файл .bpmn сюда или выберите на компьютере</b><span class="muted">Можно и .xml, если внутри BPMN 2.0</span>
        <input type="file" id="bpmnFile" accept=".bpmn,.xml,application/xml,text/xml"></label>
      <p class="samples">Нет схемы под рукой? Попробуйте пример: <button type="button" class="link-btn" data-sample="examples/fm-process-errors.bpmn">схема с ошибками</button> или <button type="button" class="link-btn" data-sample="examples/fm-process-ok.bpmn">схема без ошибок</button>.</p>
      <div class="check-res" id="checkRes">${S.bpmn ? bpmnResults(S.bpmn) : ''}</div></section>`;

    const done = loadChecks();
    const n = manual.filter((r) => done[r.id]).length;
    h += `<section class="block"><h2>Чек-лист экспертизы</h2>
      <p class="lead">Эти требования машиной не проверяются. Отмечайте выполненные, когда проверяете конкретную ФМ. Отметки хранятся только в этом браузере.</p>
      <div class="progress" aria-hidden="true"><span style="width:${manual.length ? Math.round((n / manual.length) * 100) : 0}%"></span></div>
      <div class="result-line" style="margin-top:4px;max-width:860px"><span id="clCount">Отмечено ${n} из ${manual.length}</span>
        <span style="display:flex;gap:8px"><button type="button" class="btn btn-sm" id="clCopy">Скопировать отчёт</button><button type="button" class="btn btn-sm" id="clReset">Сбросить отметки</button></span></div>
      <div class="checklist">`;
    let lastSec = null;
    manual.forEach((r) => {
      const top = topSection(r.section);
      if (top !== lastSec) { h += `<div class="cl-group">${esc(top.skind === 'appendix' ? top.number : top.number + '.')} ${esc(top.title)}</div>`; lastSec = top; }
      h += `<label class="cl-item${done[r.id] ? ' done' : ''}"><input type="checkbox" data-cl="${esc(r.id)}"${done[r.id] ? ' checked' : ''}><span class="t">${esc(r.statement)}<small>${esc(reqCite(r))}${r.modality !== 'shall' ? ', ' + esc((L.modality[r.modality] || '').toLowerCase()) : ''}</small></span></label>`;
    });
    return h + '</div></section>';
  }

  function runBpmn(text, name) {
    const res = { name, error: '', items: [], stats: {} };
    const d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror')[0]) { res.error = 'Файл не является корректным XML.'; return res; }
    if (!d.getElementsByTagNameNS(BPMN_NS, 'definitions')[0]) { res.error = 'Это не BPMN 2.0 XML: в файле нет элемента definitions в пространстве имён OMG BPMN. Сохраните схему в редакторе в формате BPMN 2.0.'; return res; }
    res.stats.processes = d.getElementsByTagNameNS(BPMN_NS, 'process').length;
    res.stats.flows = d.getElementsByTagNameNS(BPMN_NS, 'sequenceFlow').length;
    res.stats.lanes = d.getElementsByTagNameNS(BPMN_NS, 'lane').length;
    const resolver = (p) => (p === 'bpmn' ? BPMN_NS : null);
    M().reqs.filter((r) => r.verification && r.verification.checks.length).forEach((r) => {
      const item = { req: r, violations: [], error: '' };
      r.verification.checks.forEach((ch) => {
        try {
          const snap = d.evaluate(ch.expr, d, resolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < snap.snapshotLength; i++) {
            const n = snap.snapshotItem(i);
            item.violations.push({ id: n.getAttribute && n.getAttribute('id'), type: n.localName, name: n.getAttribute && n.getAttribute('name') });
          }
        } catch (e) { item.error = 'Не удалось выполнить проверку: ' + e.message; }
      });
      res.items.push(item);
    });
    return res;
  }
  function bpmnResults(res) {
    if (res.error) return `<div class="note" style="border-left-color:var(--bad)"><div class="note-head"><b style="color:var(--bad)">${esc(res.name)}</b></div><p>${esc(res.error)}</p></div>`;
    const fails = res.items.filter((i) => i.violations.length || i.error);
    let h = `<div class="check-sum">${esc(res.name)}: ${fails.length ? `нарушения по ${fails.length} из ${res.items.length} ${plural(res.items.length, 'требования', 'требований', 'требований')}` : `все ${res.items.length} ${plural(res.items.length, 'проверка пройдена', 'проверки пройдены', 'проверок пройдены')}`}</div>
      <p class="muted" style="margin:0 0 6px">Процессов: ${res.stats.processes}, потоков управления: ${res.stats.flows}, дорожек: ${res.stats.lanes}.</p>`;
    res.items.forEach((it) => {
      const ok = !it.violations.length && !it.error;
      h += `<div class="check-item ${ok ? 'pass' : 'fail'}"><span class="ico">${ok ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'}</span>
        <div><div><b>${esc(reqCite(it.req))}.</b> ${esc(it.req.statement)}</div>`;
      if (it.error) h += `<p class="integrity-list">${esc(it.error)}</p>`;
      if (it.violations.length) {
        h += `<ul>${it.violations.map((v) => `<li>${esc(L.bpmn[v.type] || v.type)} <code>${esc(v.id || '')}</code>${v.name ? ` «${esc(v.name)}»` : ''}</li>`).join('')}</ul>`;
      }
      h += `<div class="req-actions"><a href="#/req/${esc(it.req.id)}">Требование целиком</a></div></div></div>`;
    });
    return h;
  }

  /* ---------- Оглавление, вкладки, поиск ---------- */
  function renderToc(view) {
    const m = M();
    const li = (s, lvl) => {
      const isApp = s.skind === 'appendix';
      const n = isApp ? '' : s.number;
      const t = isApp ? `${s.number}. ${s.title}` : s.title;
      const subs = s.items.filter((i) => i.kind === 'section');
      return `<li><a href="#/doc/${esc(s.id)}" data-toc="${esc(s.id)}"${isApp ? ' style="grid-template-columns:1fr"' : ''}>${n ? `<span class="n">${esc(n)}</span>` : ''}<span>${esc(t)}</span></a>${subs.length && lvl < 2 ? `<ol>${subs.map((x) => li(x, lvl + 1)).join('')}</ol>` : ''}</li>`;
    };
    let h = '<p class="toc-title">Содержание документа</p><ol>';
    if (m.changes.length) h += '<li><a href="#/doc/changes" data-toc="changes" style="grid-template-columns:1fr"><span>Регистрация изменений</span></a></li>';
    h += m.body.map((s) => li(s, 1)).join('') + '</ol>';
    $('#toc').innerHTML = h;
  }

  function renderTabs(view) {
    const m = M();
    const tabs = [
      ['doc', 'Документ', ''],
      ['req', 'Требования', m.reqs.length],
      ['registry', 'Реестр', m.reqs.length],
      ['roles', 'Роли', m.roles.length],
      ['objects', 'Объекты', m.objects.length],
      ['links', 'Связи', m.links.length],
      ['check', 'Проверка ФМ', ''],
      ['notes', 'Замечания', m.notes.length],
    ];
    $('#tabs').innerHTML = tabs.map(([k, t, c]) => `<a class="tab" href="#/${k}"${view === k ? ' aria-current="page"' : ''}>${t}${c !== '' ? `<span class="count">${c}</span>` : ''}</a>`).join('');
  }

  let searchIndex = [];
  function buildIndex() {
    const m = M();
    searchIndex = [];
    m.clauses.forEach((c) => { if (c.text) searchIndex.push({ g: 'Пункты', t: cite(c), body: c.text, href: `#/doc/${c.id}` }); });
    m.reqs.forEach((r) => searchIndex.push({ g: 'Требования', t: `${reqCite(r)}: ${r.title || r.statement}`, body: `${r.title} ${r.statement} ${r.quote} ${r.id} ${r.registry ? r.registry.id : ''}`, href: `#/req/${r.id}` }));
    m.terms.forEach((t) => searchIndex.push({ g: 'Термины', t: t.name + (t.abbr ? ` (${t.abbr})` : ''), body: `${t.name} ${t.abbr} ${t.def}`, href: `#/doc/${t.id}` }));
    m.roles.forEach((r) => searchIndex.push({ g: 'Роли и объекты', t: r.name, body: `${r.name} ${r.aliases.join(' ')}`, href: `#/roles/${r.id}` }));
    m.objects.forEach((o) => searchIndex.push({ g: 'Роли и объекты', t: o.name, body: `${o.name} ${o.aliases.join(' ')} ${o.description} ${o.codes.map((c) => c.code).join(' ')}`, href: `#/objects/${o.id}` }));
    m.notes.forEach((n) => searchIndex.push({ g: 'Замечания', t: `${n.id}: ${L.noteType[n.type] || n.type}`, body: n.text, href: `#/notes/${n.id}` }));
  }
  function snippet(body, w) {
    const i = body.toLowerCase().indexOf(w);
    if (i < 0) return esc(body.slice(0, 110));
    const s = Math.max(0, i - 50);
    const piece = body.slice(s, i + w.length + 70);
    const j = i - s;
    return (s > 0 ? '…' : '') + esc(piece.slice(0, j)) + '<mark>' + esc(piece.slice(j, j + w.length)) + '</mark>' + esc(piece.slice(j + w.length)) + '…';
  }
  function doSearch(q) {
    const box = $('#searchResults');
    const words = norm(q).toLowerCase().split(' ').filter((w) => w.length > 1);
    if (!words.length) { box.hidden = true; return; }
    const hits = searchIndex.filter((e) => { const hay = e.body.toLowerCase(); return words.every((w) => hay.includes(w)); });
    if (!hits.length) { box.innerHTML = `<div class="sr-empty">Ничего не найдено по запросу «${esc(q)}».</div>`; box.hidden = false; return; }
    const groups = new Map();
    hits.forEach((h) => { if (!groups.has(h.g)) groups.set(h.g, []); groups.get(h.g).push(h); });
    let h = '';
    groups.forEach((list, g) => {
      h += `<div class="sr-group">${esc(g)}: ${list.length}</div>`;
      list.slice(0, 6).forEach((e) => { h += `<a class="sr-item" role="option" href="${esc(e.href)}">${esc(e.t.length > 120 ? e.t.slice(0, 118) + '…' : e.t)}<small>${snippet(e.body, words[0])}</small></a>`; });
    });
    box.innerHTML = h;
    box.hidden = false;
  }

  /* ---------- Роутинг ---------- */
  function parseHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [path, query] = raw.split('?');
    const [view, id] = path.split('/');
    const params = new URLSearchParams(query || '');
    return { view: view || 'doc', id: id || '', params };
  }

  function render() {
    if (!S.m) return;
    const { view, id, params } = parseHash();
    const views = { doc: viewDoc, req: viewReqs, registry: viewRegistry, roles: viewRoles, objects: viewObjects, links: viewLinks, check: viewCheck, notes: viewNotes };
    const v = views[view] ? view : 'doc';
    if (v === 'req') {
      ['modality', 'basis', 'check', 'role', 'object', 'kind', 'section', 'crit', 'owner'].forEach((k) => { if (params.has(k)) S.f[k] = params.get(k); });
      if (params.has('q')) S.f.q = params.get('q');
      if (id) S.openRows.add(id);
    }
    if (v === 'registry') {
      ['crit', 'owner', 'done', 'q'].forEach((k) => { if (params.has(k)) S.rf[k] = params.get(k); });
      if (id) S.openReg.add(id);
    }
    if (v === 'doc' && id) {
      const o = S.m.byId.get(id);
      if (o && o.kind === 'requirement' && o.clause) S.openAtoms.add(o.clause.id);
    }
    renderTabs(v);
    const el = $('#view');
    el.innerHTML = views[v]();
    el.className = 'view' + (v === 'doc' ? '' : ' wide');
    if (v === 'req') renderReqResults();
    if (v === 'registry') renderRegistryResults();
    document.title = `${S.m.id} — ${S.m.meta.title}`;
    closeNav();

    const targetId = v === 'req' && id ? `row-${id}` : v === 'registry' && id ? `reg-${id}` : id;
    if (targetId) {
      const t = document.getElementById(targetId);
      if (t) {
        requestAnimationFrame(() => {
          t.scrollIntoView({ block: 'start' });
          const fl = t.classList.contains('clause') ? t : t;
          fl.classList.remove('flash'); void fl.offsetWidth; fl.classList.add('flash');
        });
      }
    } else {
      window.scrollTo(0, 0);
    }
    if (v === 'doc') observeSections();
  }

  let io = null;
  function observeSections() {
    if (io) io.disconnect();
    if (!('IntersectionObserver' in window)) return;
    const links = new Map($$('#toc a[data-toc]').map((a) => [a.dataset.toc, a]));
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          $$('#toc a.active').forEach((a) => a.classList.remove('active'));
          const a = links.get(e.target.id);
          if (a) a.classList.add('active');
        }
      });
    }, { rootMargin: '-120px 0px -65% 0px' });
    $$('#view section[id]').forEach((s) => io.observe(s));
  }

  /* ---------- Выгрузки ---------- */
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  }
  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('не удалось загрузить ' + src)); document.head.appendChild(s); });
  }
  async function download(kind) {
    try {
      if (kind === 'xml') return saveBlob(new Blob([S.xmlText], { type: 'application/xml' }), S.xmlName);
      if (kind === 'xsd') return saveBlob(new Blob([await fetchText(KIT.xsd)], { type: 'application/xml' }), 'ism-regulation-v1.xsd');
      if (kind === 'xsl') return saveBlob(new Blob([await fetchText(KIT.xsl)], { type: 'application/xml' }), 'ism-regulation-view.xsl');
      if (kind === 'xlsx') return await exportXlsx(M().reqs, `${M().id} — реестр требований.xlsx`);
      if (kind === 'xlsx-filtered') return await exportXlsx(filteredReqs(), `${M().id} — реестр требований (выборка).xlsx`);
      if (kind === 'xlsx-registry') return await exportXlsx(filteredRegistry(), `${M().id} — реестр требований${filteredRegistry().length !== M().reqs.length ? ' (выборка)' : ''}.xlsx`);
      if (kind === 'zip') {
        toast('Собираю архив…');
        if (!window.JSZip) await loadScript(JSZIP_URL);
        const zip = new window.JSZip();
        const dir = zip.folder(`ИСМ XML ${M().id}`);
        dir.file(S.xmlName, S.xmlText);
        for (const [k, name] of [['xsd', 'ism-regulation-v1.xsd'], ['xsl', 'ism-regulation-view.xsl'], ['ps1', 'build.ps1'], ['bat', 'build.bat']]) {
          dir.file(name, await (await fetch(KIT[k])).arrayBuffer());
        }
        if (!S.custom) {
          for (const src of [...new Set(M().figures)]) {
            const r = await fetch(resolveSrc(src));
            if (r.ok) dir.file(src, await r.arrayBuffer());
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        saveBlob(blob, `ИСМ-XML-${M().id}.zip`);
        toast('Архив готов');
      }
    } catch (e) {
      toast('Не удалось выгрузить: ' + e.message, 5000);
    }
  }

  /* ---------- Мелочи интерфейса ---------- */
  let toastTimer = null;
  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  async function copyLink(hash) {
    const url = location.href.split('#')[0] + hash;
    try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
    catch { window.prompt('Скопируйте ссылку:', url); }
  }
  function closeNav() {
    document.body.classList.remove('nav-open');
    $('.nav-toggle').setAttribute('aria-expanded', 'false');
    $('#scrim').hidden = true;
  }

  function bindGlobal() {
    window.addEventListener('hashchange', render);

    document.addEventListener('click', (e) => {
      const t = e.target;
      const atoms = t.closest('[data-atoms]');
      if (atoms) {
        const id = atoms.dataset.atoms;
        const list = document.getElementById('atoms-' + id);
        const open = atoms.getAttribute('aria-expanded') !== 'true';
        atoms.setAttribute('aria-expanded', String(open));
        list.hidden = !open;
        if (open) S.openAtoms.add(id); else S.openAtoms.delete(id);
        return;
      }
      if (t.closest('#toggleAll')) {
        S.allAtoms = !S.allAtoms;
        if (!S.allAtoms) S.openAtoms.clear();
        $$('[data-atoms]').forEach((b) => { b.setAttribute('aria-expanded', String(S.allAtoms)); document.getElementById('atoms-' + b.dataset.atoms).hidden = !S.allAtoms; });
        t.closest('#toggleAll').textContent = S.allAtoms ? 'Свернуть требования в тексте' : 'Показать все требования в тексте';
        return;
      }
      const cp = t.closest('[data-copy]');
      if (cp) { copyLink(cp.dataset.copy); return; }
      const row = t.closest('[data-row]');
      if (row) {
        const id = row.dataset.row;
        if (S.openRows.has(id)) S.openRows.delete(id); else S.openRows.add(id);
        renderReqResults();
        const r = document.getElementById('row-' + id);
        if (r) r.querySelector('[data-row]').focus();
        return;
      }
      const fb = t.closest('[data-f]');
      if (fb) {
        S.f[fb.dataset.f] = fb.dataset.v;
        $$(`[data-f="${fb.dataset.f}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === fb)));
        renderReqResults();
        return;
      }
      if (t.closest('#resetF')) {
        S.f = { q: '', modality: 'all', basis: 'all', check: 'all', role: '', object: '', kind: '', section: '', crit: 'all', owner: '' };
        if (location.hash.includes('?')) location.hash = '#/req'; else render();
        return;
      }
      if (t.closest('#csvFiltered')) { download('xlsx-filtered'); return; }
      const dl = t.closest('[data-dl]');
      if (dl) { $('#downloadMenu').open = false; download(dl.dataset.dl); return; }
      const rfb = t.closest('[data-rf]');
      if (rfb) {
        S.rf[rfb.dataset.rf] = rfb.dataset.v;
        $$(`[data-rf="${rfb.dataset.rf}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === rfb)));
        renderRegistryResults();
        return;
      }
      const ob = t.closest('[data-rowner]');
      if (ob) {
        S.rf.owner = S.rf.owner === ob.dataset.rowner ? '' : ob.dataset.rowner;
        $$('[data-rowner]').forEach((b) => { const on = b.dataset.rowner === S.rf.owner; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
        renderRegistryResults();
        return;
      }
      const rg = t.closest('[data-reg]');
      if (rg) {
        const id = rg.dataset.reg;
        if (S.openReg.has(id)) S.openReg.delete(id); else S.openReg.add(id);
        renderRegistryResults();
        const r = document.getElementById('reg-' + id);
        if (r) r.querySelector('[data-reg]').focus();
        return;
      }
      if (t.closest('#resetRF')) {
        S.rf = { crit: 'all', owner: '', done: 'all', q: '' };
        if (location.hash.includes('?')) location.hash = '#/registry'; else render();
        return;
      }
      const sample = t.closest('[data-sample]');
      if (sample) {
        fetchText(sample.dataset.sample).then((x) => { S.bpmn = runBpmn(x, sample.dataset.sample.split('/').pop()); $('#checkRes').innerHTML = bpmnResults(S.bpmn); $('#checkRes').scrollIntoView({ block: 'nearest' }); })
          .catch((err) => toast('Не удалось открыть пример: ' + err.message, 5000));
        return;
      }
      if (t.closest('#clReset')) { saveChecks({}); render(); toast('Отметки сброшены'); return; }
      if (t.closest('#clCopy')) {
        const done = loadChecks();
        const manual = M().reqs.filter((r) => !(r.verification && r.verification.checks.length) && r.rkind !== 'document-control');
        const text = `Проверка ФМ по ${M().id} (версия ${M().version})\n` + manual.map((r) => `${done[r.id] ? '[x]' : '[ ]'} ${reqCite(r)}: ${r.statement}`).join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Отчёт скопирован')).catch(() => window.prompt('Скопируйте отчёт:', text));
        return;
      }
      if (t.closest('.nav-toggle')) {
        const open = !document.body.classList.contains('nav-open');
        document.body.classList.toggle('nav-open', open);
        $('.nav-toggle').setAttribute('aria-expanded', String(open));
        $('#scrim').hidden = !open;
        return;
      }
      if (t.closest('#scrim')) { closeNav(); return; }
      if (t.closest('.sr-item')) { $('#searchResults').hidden = true; $('#searchInput').blur(); }
      if (t.closest('#banner [data-reset]')) { loadDefault(); return; }
      const menu = $('#downloadMenu');
      if (menu.open && !t.closest('#downloadMenu')) menu.open = false;
      if (!t.closest('.search')) $('#searchResults').hidden = true;
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'fq') { S.f.q = e.target.value; renderReqResults(); }
      if (e.target.id === 'rq') { S.rf.q = e.target.value; renderRegistryResults(); }
      if (e.target.id === 'searchInput') doSearch(e.target.value);
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.fsel) { S.f[t.dataset.fsel] = t.value; renderReqResults(); }
      if (t.id === 'relSel') { S.linkRel = t.value; render(); }
      if (t.dataset.cl) {
        const o = loadChecks(); if (t.checked) o[t.dataset.cl] = 1; else delete o[t.dataset.cl]; saveChecks(o);
        t.closest('.cl-item').classList.toggle('done', t.checked);
        const manual = M().reqs.filter((r) => !(r.verification && r.verification.checks.length) && r.rkind !== 'document-control');
        const n = manual.filter((r) => o[r.id]).length;
        $('#clCount').textContent = `Отмечено ${n} из ${manual.length}`;
        $('.progress span').style.width = Math.round((n / manual.length) * 100) + '%';
      }
      if (t.id === 'bpmnFile' && t.files[0]) readBpmn(t.files[0]);
      if (t.id === 'openXml' && t.files[0]) { $('#downloadMenu').open = false; openCustom(t.files[0]); t.value = ''; }
    });

    document.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
    document.addEventListener('drop', (e) => {
      const d = e.target.closest && e.target.closest('#drop');
      if (d) { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) readBpmn(e.dataTransfer.files[0]); }
    });

    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !inField) { e.preventDefault(); $('#searchInput').focus(); return; }
      if (e.key === 'Escape') {
        $('#searchResults').hidden = true; $('#downloadMenu').open = false; closeNav();
        if (document.activeElement.id === 'searchInput') document.activeElement.blur();
      }
      if (document.activeElement.id === 'searchInput' && (e.key === 'ArrowDown' || e.key === 'Enter')) {
        const first = $('#searchResults .sr-item');
        if (first && e.key === 'ArrowDown') { e.preventDefault(); first.focus(); }
        if (first && e.key === 'Enter') { e.preventDefault(); location.hash = first.getAttribute('href'); $('#searchResults').hidden = true; document.activeElement.blur(); }
      } else if (document.activeElement.classList.contains('sr-item') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = $$('#searchResults .sr-item');
        const i = items.indexOf(document.activeElement);
        const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus(); else if (e.key === 'ArrowUp') $('#searchInput').focus();
      }
    });
  }

  function readBpmn(file) {
    const fr = new FileReader();
    fr.onload = () => { S.bpmn = runBpmn(String(fr.result), file.name); const box = $('#checkRes'); if (box) { box.innerHTML = bpmnResults(S.bpmn); box.scrollIntoView({ block: 'nearest' }); } };
    fr.onerror = () => toast('Не удалось прочитать файл', 4000);
    fr.readAsText(file);
  }

  /* ---------- Загрузка ---------- */
  function setModel(text, name, url, custom) {
    S.m = parseModel(text, url);
    S.xmlText = text; S.xmlName = name; S.xmlUrl = url; S.custom = custom;
    S.openAtoms.clear(); S.openRows.clear(); S.openReg.clear(); S.bpmn = null;
    $('#brandDoc').textContent = `${S.m.id}, версия ${S.m.version}`;
    $('#dlXmlName').textContent = name;
    const b = $('#banner');
    if (custom) { b.innerHTML = `Открыт файл «${esc(name)}» с вашего компьютера. Он не сохраняется и никуда не отправляется. <button type="button" data-reset>Вернуться к опубликованному регламенту</button>`; b.hidden = false; }
    else b.hidden = true;
    buildIndex();
    renderToc();
    render();
  }
  function openCustom(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try { setModel(String(fr.result), file.name, location.href, true); location.hash = '#/doc'; toast('Документ открыт'); }
      catch (e) { toast(e.message, 7000); }
    };
    fr.readAsText(file);
  }
  async function loadDefault() {
    try {
      const url = new URL(DEFAULT_XML, location.href).href;
      const text = await fetchText(url);
      setModel(text, DEFAULT_XML.split('/').pop(), url, false);
    } catch (e) {
      $('#view').innerHTML = `<div class="empty"><p><b>Не удалось загрузить регламент.</b> ${esc(e.message)}</p>
        <p>Если вы открыли index.html двойным щелчком, браузер не даёт странице читать соседние файлы. Откройте опубликованную ссылку на GitHub Pages или выберите XML вручную в меню «Выгрузить», пункт «Открыть другой XML».</p></div>`;
    }
  }

  bindGlobal();
  loadDefault();
})();
