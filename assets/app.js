/* ИСМ XML — веб-приложение для машиночитаемых регламентов ИСМ.
   Источник истины — XML по схеме urn:protech:ism:regulation:1.0 (data/ism-regulation-v1.xsd).
   Рабочее пространство: опубликованный регламент и документы пользователя (Word, PDF, Excel-реестры, XML ИСМ).
   Всё обрабатывается и хранится в браузере пользователя (IndexedDB); на сервер ничего не отправляется. */
(() => {
  'use strict';

  const NS = 'urn:protech:ism:regulation:1.0';
  const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const DEFAULT_XML = 'data/C2.4.1.MTH.01.machine-readable.xml';
  const BUILTIN = 'builtin';
  const KIT = {
    xsd: 'data/ism-regulation-v1.xsd',
    xsl: 'data/ism-regulation-view.xsl',
    ps1: 'data/build.ps1',
    bat: 'data/build.bat',
  };
  const JSZIP_URL = 'assets/vendor/jszip.min.js'; // JSZip 3.10.1, MIT; лежит в репозитории, внешних запросов нет
  const EXCELJS_URL = 'assets/vendor/exceljs.min.js'; // ExcelJS 4.4.0, MIT; загружается только при выгрузке в Excel
  const ACCEPT = '.docx,.docm,.pdf,.xlsx,.xlsm,.xml';

  // Корпоративный реестр требований: столбцы A–R шаблона пилота V0.1
  const REG_HEAD = ['ID', 'Наименование', 'Объект требования', 'Атомарная формулировка', 'Источник / документ', 'Пункт / ссылка', 'Уровень',
    'Владелец требования', 'Область / условия применения', 'Критичность', 'Метод верификации', 'Критерий приёмки', 'Статус', 'Версия',
    'Дата вступления', 'Ссылка на подтверждение', 'Разногласия / примечание', 'Комплектность',
    'Тип требования', 'Основание (вышестоящее требование)']; // S и T — дополнительные столбцы приложения
  const REG_WIDTHS = [18, 24, 13, 48, 34, 20, 12, 25, 36, 13, 27, 32, 23, 10, 15, 31, 34, 17, 20, 38];
  const REG_REQUIRED = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]; // B C D E G H I J K L M — как в формуле «Комплектность» шаблона
  const REG_METHOD = { 'document-review': 'Экспертиза документа', 'expert-review': 'Экспертная оценка BPMN-схемы', 'record-check': 'Проверка листа согласования / истории изменений ФМ' };
  const CAT = { business: 'Бизнес-требование', system: 'Системное требование' };
  const CAT_SHORT = { business: 'бизнес', system: 'системное' };
  // Виды и уровни документов ИСМ — справочник из convert.js (та же таблица, что в базе данных)
  const typeList = () => window.ISM.convert.DOC_TYPE_LIST;
  const typeByCode = (c) => typeList().find((t) => t.code === c) || null;
  const levelInfo = (lvl) => window.ISM.convert.DOC_LEVELS.find((l) => l.level === lvl) || null;
  const levelLabel = (lvl) => (lvl ? `${lvl} уровень` : 'Внешняя документация');
  const levelOf = (m) => (m && m.type ? m.type.level : undefined);
  const METHOD_HINTS = ['Экспертиза документа', 'Экспертная оценка', 'Проверка записей', 'Аудит', 'Испытания', 'Расчёт', 'Измерение', 'Осмотр', 'Анализ отчётности'];

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
  const pl = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
  const textOf = (el) => {
    if (!el) return '';
    const parts = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) parts.push(w.currentNode.nodeValue);
    return norm(parts.join(' '));
  };
  const pad = (n, k = 2) => String(n).padStart(k, '0');
  const ymd = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const fmtDate = (t) => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const safeName = (s) => String(s || 'документ').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const ICON = {
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4h14v-4"/></svg>',
    docs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/></svg>',
    reg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 10h16M4 14.5h16M9 5v14"/></svg>',
    ov: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg>',
    graph: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="5"/><rect x="3" y="16" width="6" height="5"/><rect x="15" y="16" width="6" height="5"/><path d="M12 8v4M6 16v-4h12v4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
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
      'system-component': 'Компоненты системы', object: 'Объекты требований',
    },
    roleType: { 'org-unit': 'подразделение', 'business-role': 'бизнес-роль', 'user-group': 'группа пользователей' },
    src: { builtin: 'опубл.', docx: 'docx', pdf: 'pdf', xlsx: 'xlsx', xml: 'xml' },
    srcLong: { builtin: 'опубликованный регламент', docx: 'Word', pdf: 'PDF', xlsx: 'Excel-реестр', xml: 'XML ИСМ' },
    ovKind: { dup: 'почти совпадают', overlap: 'пересекаются', conflict: 'противоречат по модальности' },
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
  // Рабочее пространство: все документы пользователя
  const W = {
    ready: false,
    docs: [],              // {key, name, kind, xml, addedAt, included, report, builtin, overridden, level}
    models: new Map(),     // key → разобранная модель (кэш)
    version: 0,            // растёт при любом изменении документов; по нему сбрасываются кэши
    dismissed: new Set(),  // пары «не дубль»
    links: [],             // связи между требованиями разных документов: {from, to, relation}; from/to — «ключ документа|id требования»
    tempSeq: {},           // {ГГГГММДД: следующий номер TEMP}
    ov: null,              // кэш пересечений
    storage: true,
    cloud: false,          // вход и база данных Supabase включены (assets/config.js)
    user: null,            // текущий пользователь Supabase Auth
    builtinUrl: '',
  };
  const freshF = () => ({ q: '', modality: 'all', basis: 'all', check: 'all', role: '', object: '', kind: '', section: '', crit: 'all', owner: '', cat: 'all' });
  const freshRF = () => ({ crit: 'all', owner: '', done: 'all', q: '', ov: 'all', cat: 'all' });
  const freshCF = () => ({ crit: 'all', owner: '', done: 'all', q: '', ov: 'all', doc: '', cat: 'all', level: '' });
  // Текущий документ и состояние интерфейса
  const S = {
    key: '',
    m: null,
    openAtoms: new Set(),
    allAtoms: false,
    markup: false,
    openRows: new Set(),
    f: freshF(),
    rf: freshRF(),
    cf: freshCF(),
    of: { min: 0.55, kind: 'all', where: 'all', hidden: false, req: '', doc: '', limit: 60 },
    openReg: new Set(),
    linkRel: '',
    bpmn: null,
    upload: null,          // отчёт о последней загрузке
    edit: null,            // открытая карточка в редакторе
    confirmDel: '',
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

    m.typeCode = window.ISM.convert.typeOf(m.meta.docTypeCode, m.meta.docType, m.meta.title);
    m.type = typeByCode(m.typeCode);

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
        category: attr(el, 'category'), categoryStatus: attr(el, 'categoryStatus') || 'preliminary',
        title: txt(kid(el, 'title')),
        statement: txt(kid(el, 'statement')), quote: txt(kid(el, 'quote')),
        owner: ow ? { ref: attr(ow, 'ref'), status: attr(ow, 'status') || 'preliminary' } : null,
        critBasis: cb ? { text: txt(cb), status: attr(cb, 'status') || 'preliminary' } : null,
        registry: rg ? {
          id: attr(rg, 'id'), level: attr(rg, 'level'), status: attr(rg, 'status'), version: attr(rg, 'version'),
          effective: attr(rg, 'effective'), evidence: attr(rg, 'evidence'), remark: txt(kid(rg, 'remark')),
          sourceDocument: attr(rg, 'sourceDocument'), sourceClause: attr(rg, 'sourceClause'),
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
        clause, section, m,
      });
      if (!r.category) { r.category = window.ISM.convert.categoryOf(r.statement); r.catAuto = true; }
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
            const pseudo = { kind: 'clause', id: attr(c, 'id') + '-clause', number: attr(c, 'number'), label: '', type: 'normative', section: s, parent: null, textEl: null, text: '', reqs: [], clauses: [], pseudo: true };
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

  /* ---------- Рабочее пространство ---------- */
  const store = () => (W.cloud ? window.ISM.cloud.store : window.ISM.store);
  const entry = (key) => W.docs.find((d) => d.key === key) || null;
  function modelOf(e) {
    if (!e) return null;
    if (W.models.has(e.key)) return W.models.get(e.key);
    let m = null;
    try {
      m = parseModel(e.xml, e.builtin ? W.builtinUrl : location.href);
      m.key = e.key; m.entry = e;
      e.error = '';
    } catch (err) { e.error = err.message; }
    W.models.set(e.key, m);
    return m;
  }
  const models = () => W.docs.map(modelOf).filter(Boolean);
  const includedModels = () => W.docs.filter((d) => d.included).map(modelOf).filter(Boolean);
  const uk = (r) => `${r.m.key}|${r.id}`;
  function reqByUk(u) {
    const i = u.indexOf('|');
    const m = modelOf(entry(u.slice(0, i)));
    const r = m && m.byId.get(u.slice(i + 1));
    return r && r.kind === 'requirement' ? r : null;
  }
  function bump() { W.version++; W.ov = null; }

  // Связи между требованиями (основания) — хранятся отдельно от XML, потому что связывают разные документы
  const sameLink = (a, b) => a.from === b.from && a.to === b.to && a.relation === b.relation;
  const linksOf = (r) => { const k = uk(r); return W.links.filter((l) => l.from === k || l.to === k); };
  async function addLink(l) {
    if (l.from === l.to || W.links.some((x) => sameLink(x, l))) return;
    const rec = { from: l.from, to: l.to, relation: l.relation || 'derives' };
    W.links.push(rec);
    try { await store().addLink(rec); } catch (err) { toast('Связь не сохранилась: ' + err.message, 5000); }
    W.version++;
  }
  async function removeLink(l) {
    const before = W.links.length;
    W.links = W.links.filter((x) => !sameLink(x, l));
    if (W.links.length !== before) { try { await store().removeLink(l); } catch (err) { toast('Связь не удалилась: ' + err.message, 5000); } W.version++; }
  }

  async function persist(e) {
    if (!W.storage) return;
    const rec = e.builtin
      ? { key: e.key, builtin: true, included: e.included, overridden: !!e.overridden, xml: e.overridden ? e.xml : null, addedAt: 0 }
      : { key: e.key, name: e.name, kind: e.kind, xml: e.xml, addedAt: e.addedAt, included: e.included, report: e.report, level: e.level };
    try { await store().putDoc(rec, syncPayload(e)); } catch (err) { toast(`Не удалось сохранить ${store().mode === 'cloud' ? 'в базе' : 'в браузере'}: ${err.message}`, 6000); }
  }
  // Строки для базы данных: документ и его требования (таблицы documents и requirements)
  function syncPayload(e) {
    const m = modelOf(e);
    return {
      doc: {
        key: e.key, type_code: m ? m.typeCode : '', ism_id: m ? m.id : '', title: m ? docTitle(m) : e.name, version: m ? m.version : '', status: m ? m.status : '',
        source_kind: e.kind, file_name: e.builtin ? null : e.name, xml: e.builtin && !e.overridden ? null : e.xml,
        included: e.included, overridden: !!e.overridden, report: e.report || {}, added_at: new Date(e.addedAt || Date.now()).toISOString(),
      },
      reqs: m ? m.reqs.map((r) => {
        const row = registryRow(r);
        const g = r.registry || {};
        return {
          req_id: r.id, clause_id: r.clause ? r.clause.id : '', clause_cite: reqCite(r), card_id: g.id || '', title: r.title, statement: r.statement, quote: r.quote,
          modality: r.modality, category: r.category, category_status: r.catAuto ? 'preliminary' : r.categoryStatus, criticality: r.criticality,
          owner_name: row[7], object_name: row[2], conditions: r.conditions.join('; '), verification_method: row[10], acceptance_criterion: row[11],
          reg_level: g.level || '', reg_status: g.status || '', reg_version: g.version || '', effective_date: g.effective || '', evidence: g.evidence || '', remark: g.remark || '',
          complete: row[17] === 'Готово',
        };
      }) : null,
    };
  }
  const saveMeta = (k, v) => { if (W.storage) store().setMeta(k, v).catch(() => {}); };

  async function initWorkspace() {
    W.storage = await store().available();
    let saved = [];
    try { saved = await store().allDocs(); } catch (err) { saved = []; W.loadError = err.message; }
    W.builtinUrl = new URL(DEFAULT_XML, location.href).href;
    let text = '';
    try { text = await fetchText(W.builtinUrl); } catch (e) { W.builtinError = e.message; }
    const rec = saved.find((d) => d.key === BUILTIN) || { key: BUILTIN, included: true };
    const b = { key: BUILTIN, builtin: true, kind: 'builtin', name: DEFAULT_XML.split('/').pop(), addedAt: 0, included: rec.included !== false, overridden: !!(rec.overridden && rec.xml), xml: rec.overridden && rec.xml ? rec.xml : text };
    W.docs = [];
    if (b.xml) W.docs.push(b);
    saved.filter((d) => d.key !== BUILTIN && d.xml).sort((a, z) => a.addedAt - z.addedAt).forEach((d) => W.docs.push({ ...d, included: d.included !== false }));
    try {
      W.dismissed = new Set(await store().getMeta('dismissed', []));
      W.links = await store().allLinks();
      W.tempSeq = await store().getMeta('tempSeq', {});
      S.key = await store().getMeta('current', BUILTIN);
    } catch { S.key = BUILTIN; }
    if (!entry(S.key)) S.key = W.docs[0] ? W.docs[0].key : '';
    // В базе у каждого пользователя есть строка опубликованного регламента: на неё ссылаются связи и реестр
    if (W.cloud && !W.loadError && !saved.some((d) => d.key === BUILTIN) && entry(BUILTIN)) await persist(entry(BUILTIN));
    W.ready = true;
  }

  // Следующий свободный номер TEMP на сегодня: с учётом счётчика и уже существующих карточек всех документов
  function tempStart(today) {
    let n = W.tempSeq[today] || 1;
    const rx = new RegExp(`^TEMP-${today}-(\\d+)$`);
    models().forEach((m) => m.reqs.forEach((r) => { const mm = r.registry && rx.exec(r.registry.id); if (mm) n = Math.max(n, +mm[1] + 1); }));
    return n;
  }
  function nextTemp() {
    const today = ymd();
    const n = tempStart(today);
    W.tempSeq = { [today]: n + 1 };
    saveMeta('tempSeq', W.tempSeq);
    return `TEMP-${today}-${pad(n, 3)}`;
  }

  // Переключение текущего документа
  function useDoc(key) {
    const e = entry(key);
    if (!e) return false;
    const m = modelOf(e);
    if (!m) return false;
    const changed = S.key !== key || S.m !== m;
    if (S.key !== key) {
      S.openAtoms.clear(); S.openRows.clear(); S.openReg.clear(); S.bpmn = null; S.allAtoms = false;
      S.f = freshF(); S.rf = freshRF(); S.linkRel = '';
      S.key = key; saveMeta('current', key);
    }
    S.m = m;
    if (changed) renderToc();
    return true;
  }
  function findDocWith(id) {
    const order = [entry(S.key), entry(BUILTIN), ...W.docs].filter(Boolean);
    for (const e of order) { const m = modelOf(e); if (m && m.byId.has(id)) return e; }
    return null;
  }
  function openDoc(key, hash = '#/doc') {
    if (!useDoc(key)) { toast('Документ не найден', 4000); if (location.hash.startsWith('#/open/')) history.replaceState(null, '', '#/'); render(); return; }
    // переход по ссылке #/open/… заменяем, чтобы кнопка «Назад» не возвращала на перенаправление
    if (location.hash.startsWith('#/open/')) { history.replaceState(null, '', hash); render(); }
    else if (location.hash === hash) render();
    else location.hash = hash;
  }
  const docName = (m) => (m ? `${m.id || 'без обозначения'}` : '');
  const docTitle = (m) => (m ? m.meta.title || m.entry.name : '');
  const xmlFileName = (e) => {
    const m = modelOf(e);
    if (e.builtin) return e.name;
    return `${safeName(m && m.id ? m.id : e.name.replace(/\.[^.]+$/, ''))}.machine-readable.xml`;
  };
  const srcBadge = (e) => `<span class="src src-${esc(e.kind)}" title="${esc(L.srcLong[e.kind] || e.kind)}">${esc(L.src[e.kind] || e.kind)}</span>`;

  /* ---------- Подписи и ссылки ---------- */
  const M = () => S.m;
  function cite(c) {
    if (!c) return '';
    if (c.label) return `п. ${c.parent ? c.parent.number : ''} ${c.label}`.replace(/\s+/g, ' ');
    if (c.number) return /^\d/.test(c.number) ? `п. ${c.number}` : c.number;
    if (c.section && c.section.skind === 'appendix') return c.section.number;
    return `раздел ${c.section ? c.section.number : ''}, вводный абзац`;
  }
  const reqCite = (r) => (r.number ? (/^\d/.test(r.number) ? `п. ${r.number}` : r.number) : cite(r.clause));
  const nameOf = (id, m = M()) => { const o = m && m.byId.get(id); return o ? o.name || o.identifier || id : id; };
  const shortOf = (id) => { const o = M().byId.get(id); const a = o && o.aliases ? o.aliases.find((x) => x.length <= 12) : null; return a || nameOf(id); };
  // Ссылка на требование другого документа рабочего пространства
  const reqHref = (r) => (r.m === S.m ? `#/req/${r.id}` : `#/open/${r.m.key}/req/${r.id}`);
  const docHref = (r) => (r.m === S.m ? `#/doc/${r.clause ? r.clause.id : ''}` : `#/open/${r.m.key}/doc/${r.clause ? r.clause.id : ''}`);

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
  const resolveSrc = (src) => { try { return new URL(src, (S.m && S.m.base) || location.href).href; } catch { return src; } };

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
    h += catChip(r);
    if (r.basis === 'implicit') h += '<span class="chip implicit" title="В тексте нет слов «должен» или «не допускается»; модальность выведена из формулировки">модальность выведена</span>';
    if (r.source === 'authoritative') h += '<span class="chip verbatim" title="Формулировка совпадает с текстом пункта">дословно</span>';
    if (withKind && r.rkind) h += `<span class="chip kind">${esc(L.kind[r.rkind] || r.rkind)}</span>`;
    if (r.verification && r.verification.checks.length) h += '<span class="chip auto" title="Есть машинная проверка BPMN-схемы">автопроверка</span>';
    h += ovBadge(r);
    if (withId) h += `<span class="req-id">${esc(r.id)}</span>`;
    return h;
  }
  function catChip(r) {
    const sure = !r.catAuto && r.categoryStatus === 'confirmed';
    return `<span class="chip cat ${esc(r.category)}${sure ? '' : ' auto'}" title="${esc(CAT[r.category])}${sure ? ', подтверждено' : ': определено автоматически по формулировке, проверьте в карточке'}">${esc(CAT_SHORT[r.category])}</span>`;
  }
  function reqLine(r) {
    const parts = [];
    if (r.subject) parts.push(`кто: ${esc(nameOf(r.subject, r.m))}`);
    if (r.action) parts.push(`действие: ${esc(r.action.label)}`);
    if (r.objects.length) parts.push(`объект: ${r.objects.map((o) => esc(nameOf(o, r.m))).join(', ')}`);
    if (r.owner) parts.push(`владелец: ${esc(nameOf(r.owner.ref, r.m))}`);
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
      if (r.verification.method || r.verification.checks.length) {
        h += `<dt>Проверка</dt><dd>${esc(L.verification[r.verification.method] || r.verification.method)}`;
        r.verification.checks.forEach((ch) => {
          h += `<details class="xpath"><summary>XPath-проверка по ${esc(ch.target)}${ch.status === 'proposed' ? ', предложена' : ''}</summary><code>${esc(ch.expr)}</code></details>`;
        });
        h += '</dd>';
      }
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
  const editBtn = (r, label = 'Изменить карточку') => `<button type="button" class="edit-btn" data-edit="${esc(uk(r))}">${ICON.edit}${esc(label)}</button>`;
  function reqCard(r, { quote = false, toList = true } = {}) {
    const bad = M().integrity.badQuotes.includes(r);
    return `<article class="req ${esc(r.modality)}" id="${esc(r.id)}">
      <div class="req-top">${chips(r)}${flags(r.id)}</div>
      <div class="req-stmt">${esc(r.statement)}</div>
      ${quote && r.quote ? `<blockquote class="quote">«${esc(r.quote)}»</blockquote>` : ''}
      ${bad ? '<p class="integrity-list">Цитата требования не найдена в тексте пункта.</p>' : ''}
      ${reqMeta(r)}
      <div class="req-actions">
        ${editBtn(r)}
        <button type="button" data-copy="#/req/${esc(r.id)}">Скопировать ссылку</button>
        ${toList ? `<a href="#/req/${esc(r.id)}">Открыть в списке требований</a>` : `<a href="#/doc/${esc(r.clause ? r.clause.id : '')}">Показать в тексте</a>`}
      </div>
    </article>`;
  }

  /* ---------- Вид: документ ---------- */
  function viewDoc() {
    const m = M();
    const e = m.entry;
    const meta = m.meta;
    const ch = m.changes[0];
    const impl = m.reqs.filter((r) => r.basis === 'implicit').length;
    const statusCls = m.status === 'effective' ? 'status-effective' : 'status-draft';
    const approved = ch && ch.basis && !/_{2,}/.test(ch.basis);
    const signRow = (role, p, last) => `<div class="role${last ? ' last' : ''}">${esc(role)}</div><div class="${last ? 'last' : ''}">${p ? esc(p.text) + (p.person ? ', ' + esc(p.person) : '') : '<span class="void">—</span>'}</div><div class="${last ? 'last' : ''}"></div><div class="${last ? 'last' : ''}"></div>`;

    let h = '<header class="doc-head">';
    if (!e.builtin) h += autoNote(e, m);
    if (meta.processPath.length) h += `<ol class="process-path" aria-label="Процесс">${meta.processPath.map((p) => `<li>${esc(p.id)} ${esc(p.text)}</li>`).join('')}</ol>`;
    else if (meta.processRef.id) h += `<ol class="process-path"><li>${esc(meta.processRef.id)} ${esc(meta.processRef.text)}</li></ol>`;
    h += `<h1 class="doc-title">${esc(meta.title || e.name)}</h1>`;

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
        <div class="cell" style="grid-column: span 2"><span class="lbl">Вид документа</span><span class="val">${esc(m.type ? m.type.name : meta.docType)}${m.typeCode || meta.docTypeCode ? ` <span class="muted">${esc(m.typeCode || meta.docTypeCode)}</span>` : ''}</span>${m.type ? `<span class="lvl-note">${m.type.level ? `${m.type.level} уровень — ${esc(levelInfo(m.type.level).purpose)}` : 'внешняя документация'}</span>` : ''}</div>
        <div class="cell"><span class="lbl">Процесс</span><span class="val">${esc(meta.processRef.id) || '—'}</span></div>
        <div class="cell"><span class="lbl">Статус</span><span class="val ${statusCls}">${esc(L.status[m.status] || m.status)}</span></div>
        <div class="cell"><span class="lbl">Версия</span><span class="val">${esc(m.version)}</span></div>
        <div class="cell"><span class="lbl">Требований</span><span class="val">${m.reqs.length}</span></div>
        <div class="scope">${scopeHtml(m)}</div>
        ${meta.org ? `<div class="org">${esc(meta.org)}</div>` : ''}
      </div>`;
    h += '</div>';

    if (m.reqs.length) {
      h += `<p class="summary">Документ разложен на <a href="#/req">${pl(m.reqs.length, 'атомарное требование', 'атомарных требования', 'атомарных требований')}</a>.`;
      if (impl) h += ` У <a href="#/req?basis=implicit">${impl}</a> из них модальность выведена из формулировки: в тексте нет слов «должен» или «не допускается».`;
      if (m.reqs.some((r) => r.registry)) {
        const done = m.reqs.map(registryRow).filter((x) => x[17] === 'Готово').length;
        const cc = ['C1', 'C2', 'C3', 'C4'].map((c) => [c, m.reqs.filter((r) => r.criticality === c).length]).filter(([, n]) => n);
        h += ` В <a href="#/registry">реестре</a> комплектны ${done} ${plural(done, 'карточка', 'карточки', 'карточек')} из ${m.reqs.length}${cc.length ? `; критичность ${cc.map(([c, n]) => `${c} — ${n}`).join(', ')}` : '; критичность не назначена'}.`;
      }
      if (m.notes.length) h += ` К исходному тексту <a href="#/notes">${pl(m.notes.length, 'замечание', 'замечания', 'замечаний')}</a>.`;
      h += '</p>';
    } else {
      h += '<p class="summary">Требований в документе не найдено. Включите разметку и добавьте их к нужным пунктам вручную.</p>';
    }
    const ig = m.integrity;
    if (!ig.dangling.length && !ig.badQuotes.length) {
      h += `<div class="integrity"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Ссылки разрешены, цитаты ${ig.quoted} ${plural(ig.quoted, 'требования', 'требований', 'требований')} найдены в тексте пунктов</div>`;
    } else {
      h += `<div class="integrity bad"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>Найдены проблемы целостности</div><ul class="integrity-list">${ig.dangling.map((d) => `<li>Ссылка ${esc(d.id)} не определена в документе (${esc(d.where)})</li>`).join('')}${ig.badQuotes.map((r) => `<li>Цитата требования ${refLink(r.id)} не найдена в тексте пункта</li>`).join('')}</ul>`;
    }

    h += '</header>';

    h += '<div class="read doc-tools">';
    if (m.reqs.length) h += `<button type="button" class="btn btn-sm" id="toggleAll">${S.allAtoms ? 'Свернуть требования в тексте' : 'Показать все требования в тексте'}</button>`;
    h += `<button type="button" class="btn btn-sm${S.markup ? ' on' : ''}" id="toggleMarkup" aria-pressed="${S.markup}">${ICON.plus}${S.markup ? 'Закончить разметку' : 'Разметка: добавить требование'}</button>`;
    h += `<a class="btn btn-sm" href="#/graph?doc=${esc(m.key)}">${ICON.graph}На графе требований</a>`;
    if (S.markup) h += '<span class="muted">У каждого пункта появилась кнопка «Требование». Формулировку и цитату можно поправить в карточке.</span>';
    h += '</div>';

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

  // Плашка для загруженного документа: откуда он и что сделала автоматическая разметка
  function autoNote(e, m) {
    const rep = e.report || {};
    const how = e.kind === 'xml' ? 'Открыт как есть: XML ИСМ не размечается повторно.'
      : e.kind === 'xlsx' ? `Каждая строка реестра стала карточкой: ${pl(m.reqs.length, 'карточка', 'карточки', 'карточек')}.`
        : `Пункты и требования размечены автоматически правилами: ${pl(m.reqs.length, 'требование', 'требования', 'требований')}${rep.derived ? `, из них ${rep.derived} из перечней` : ''}. Проверьте их в тексте, лишние удалите, пропущенные добавьте через разметку.`;
    const warn = (rep.warnings || []).filter(Boolean);
    return `<div class="auto-note">
      <div class="an-head">${srcBadge(e)}<span>Загружен ${esc(fmtDate(e.addedAt))} из файла «${esc(e.name)}»</span></div>
      <p>${esc(how)}${e.included ? ' Карточки входят в <a href="#/common">общий реестр</a>.' : ' Документ не входит в общий реестр.'}</p>
      ${warn.length ? `<ul class="an-warn">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    </div>`;
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
    const n = c.label || (c.number && !(c.section && c.number === c.section.number) ? (/^\d/.test(c.number) ? `${c.number}.` : c.number) : '');
    let h = `<div class="clause" id="${esc(c.id)}"><div class="cl-num">${n ? `<a href="#/doc/${esc(c.id)}" title="Ссылка на ${esc(cite(c))}">${esc(n)}</a>` : ''}</div><div class="cl-body">`;
    if (c.textEl) h += `<div class="txt">${blocks(c.textEl)}</div>`;
    h += flags(c.id);
    if (c.reqs.length) {
      const open = S.allAtoms || S.openAtoms.has(c.id);
      const dots = c.reqs.map((r) => `<span class="dot ${esc(r.modality)}${r.basis === 'implicit' ? ' implicit' : ''}"></span>`).join('');
      h += `<div class="atoms"><button type="button" class="atoms-toggle" data-atoms="${esc(c.id)}" aria-expanded="${open}" aria-controls="atoms-${esc(c.id)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          ${pl(c.reqs.length, 'требование', 'требования', 'требований')}<span class="dots" aria-hidden="true">${dots}</span></button>
        <div class="atoms-list" id="atoms-${esc(c.id)}"${open ? '' : ' hidden'}>${c.reqs.map((r) => reqCard(r)).join('')}</div></div>`;
    }
    if (S.markup && !c.pseudo) h += `<button type="button" class="add-req" data-add="${esc(c.id)}">${ICON.plus}Требование к ${esc(cite(c))}</button>`;
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
      if (f.cat !== 'all' && r.category !== f.cat) return false;
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
        const hay = `${r.title} ${r.statement} ${r.quote} ${r.id} ${r.registry ? r.registry.id : ''} ${reqCite(r)} ${r.tags.join(' ')} ${nameOf(r.subject)} ${r.objects.map((o) => nameOf(o)).join(' ')}`.toLowerCase();
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
    const sel = (key, label, items) => (items.length ? `<label class="f-group"><span class="f-label">${label}</span><select data-fsel="${key}"><option value="">все</option>${items.map(([v, t]) => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : '');
    const hasAuto = m.reqs.some((r) => r.verification && r.verification.checks.length);

    let h = `<div class="page-head"><div><h1>Атомарные требования</h1><p>Каждое требование ссылается на свой пункт и хранит дословную цитату из него. Отберите нужные фильтрами и выгрузите в Excel в формате корпоративного реестра.</p></div></div>`;
    h += `<div class="filters">
      <div class="f-row"><input type="search" id="fq" placeholder="Слова из формулировки, номер пункта или ID" value="${esc(f.q)}" aria-label="Поиск по требованиям"></div>
      <div class="f-row">
        <div class="f-group"><span class="f-label">Тип</span>${seg('cat', [['all', 'все'], ['business', 'бизнес'], ['system', 'системные']])}</div>
        <div class="f-group"><span class="f-label">Модальность</span>${seg('modality', [['all', 'все'], ['shall', 'обязательно'], ['should', 'рекомендуется'], ['shall-not', 'запрещено']])}</div>
        <div class="f-group"><span class="f-label">Основание</span>${seg('basis', [['all', 'все'], ['explicit', 'есть в тексте'], ['implicit', 'выведена']])}</div>
        ${hasAuto ? `<div class="f-group"><span class="f-label">Проверка</span>${seg('check', [['all', 'все'], ['auto', 'автоматическая'], ['manual', 'экспертиза']])}</div>` : ''}
        ${m.reqs.some((r) => r.criticality) ? `<div class="f-group"><span class="f-label">Критичность</span>${seg('crit', [['all', 'все'], ...['C1', 'C2', 'C3', 'C4'].filter((c) => m.reqs.some((r) => r.criticality === c)).map((c) => [c, c])])}</div>` : ''}
      </div>
      <div class="f-row">
        ${sel('section', 'Раздел', secs.map((s) => [s.id, `${s.skind === 'appendix' ? '' : s.number ? s.number + '. ' : ''}${s.skind === 'appendix' ? s.number + '. ' : ''}${s.title}`]))}
        ${sel('owner', 'Владелец', owners.map((r) => [r.id, r.name]))}
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
      <button type="button" class="btn btn-sm" id="csvFiltered"${list.length ? '' : ' disabled'}>${ICON.down}${filtered ? 'Выгрузить найденные в Excel' : 'Выгрузить в Excel'}</button></div>`;
    if (!list.length) {
      h += `<div class="empty">${total ? 'По этим условиям требований нет. Ослабьте фильтры или сбросьте их.' : 'В документе пока нет требований. Добавьте их в тексте: кнопка «Разметка» на вкладке «Документ».'}</div>`;
    } else {
      h += '<div class="req-table">';
      list.forEach((r) => {
        const open = S.openRows.has(r.id);
        h += `<div class="req-row ${esc(r.modality)}${open ? ' open' : ''}" id="row-${esc(r.id)}">
          <div class="where"><a href="#/doc/${esc(r.clause ? r.clause.id : '')}" title="Показать в тексте">${esc(reqCite(r))}</a></div>
          <div><div class="chips">${chips(r)}</div>${r.title ? `<div class="req-title">${esc(r.title)}</div>` : ''}<div class="req-stmt">${esc(r.statement)}</div>${reqLine(r) ? `<div class="line">${reqLine(r)}</div>` : ''}
            <button type="button" class="link-btn" data-row="${esc(r.id)}" aria-expanded="${open}">${open ? 'Скрыть подробности' : 'Подробнее'}</button></div>
          ${open ? `<div class="more">${r.quote ? `<blockquote class="quote">«${esc(r.quote)}»</blockquote>` : ''}${reqMeta(r)}<div class="req-actions">${editBtn(r)}<button type="button" data-copy="#/req/${esc(r.id)}">Скопировать ссылку</button><a href="#/doc/${esc(r.clause ? r.clause.id : '')}">Показать в тексте</a></div></div>` : ''}
        </div>`;
      });
      h += '</div>';
    }
    box.innerHTML = h;
  }

  /* ---------- Корпоративный реестр требований ---------- */
  const methodText = (v) => {
    if (!v) return '';
    if (v.method === 'model-validation') return v.checks.length ? 'Автоматическая проверка BPMN-схемы (XPath) / экспертиза' : 'Экспертиза BPMN-схемы';
    return REG_METHOD[v.method] || v.method;
  };
  function registryRow(r) {
    const m = r.m;
    const g = r.registry || {};
    const sc = m.scope.conditions[0];
    const scClause = sc && sc.clause ? m.byId.get(sc.clause) : null;
    const scope = sc ? sc.text + (scClause && scClause.number ? ` (п. ${scClause.number})` : '') : '';
    const conds = r.conditions.map((c) => c.charAt(0).toLowerCase() + c.slice(1));
    const v = r.verification;
    const notes = [];
    if (g.remark) notes.push(g.remark);
    if (r.basis === 'implicit') notes.push('Модальность выведена из формулировки: в тексте нет «должен».');
    if (r.critBasis && r.critBasis.text) notes.push(`Обоснование ${r.criticality}: ${r.critBasis.text}`);
    if ((r.owner && r.owner.status !== 'confirmed') || (r.critBasis && r.critBasis.status !== 'confirmed')) notes.push('Критичность и владелец — предварительно, подтвердить владельцем.');
    const row = [
      g.id || r.id, r.title, r.objects.length ? nameOf(r.objects[0], m) : '', r.statement,
      g.sourceDocument || `${m.id} «${m.meta.title}», версия ${m.version}`, g.sourceClause || `${reqCite(r)}; ${r.id}`, g.level || '',
      r.owner ? nameOf(r.owner.ref, m) : '', [scope, ...conds].filter(Boolean).join('; '), r.criticality || '', methodText(v),
      v ? v.criterion : '', g.status ? L.regStatus[g.status] || g.status : '', g.version || '', g.effective || '', g.evidence || '', notes.join(' '),
    ];
    row.push(regComplete(row) ? 'Готово' : 'Заполнить');
    row.push(CAT[r.category] || '', basisOf(r));
    return row;
  }
  // Основания требования: требования вышестоящих документов, из которых оно выведено
  function basisOf(r) {
    return linksOf(r).filter((l) => l.from === uk(r) && l.relation === 'derives').map((l) => {
      const t = reqByUk(l.to);
      return t ? `${(t.registry && t.registry.id) || t.id} (${docName(t.m)}, ${reqCite(t)})` : '';
    }).filter(Boolean).join('; ');
  }
  const regComplete = (row) => !!row[0] && REG_REQUIRED.every((i) => String(row[i] || '').trim() !== '');
  const regMissing = (row) => REG_REQUIRED.filter((i) => String(row[i] || '').trim() === '').map((i) => REG_HEAD[i]);

  // Общий фильтр реестра: doc — по документу, owner — по роли (id) или по имени владельца
  function filterRegistry(list, f, { ownerByName = false } = {}) {
    const words = norm(f.q).toLowerCase().split(' ').filter(Boolean);
    return list.filter((r) => {
      if (f.doc && r.m.key !== f.doc) return false;
      if (f.cat && f.cat !== 'all' && r.category !== f.cat) return false;
      if (f.level && String(levelOf(r.m) ?? 'ext') !== f.level) return false;
      if (f.crit !== 'all' && (f.crit === 'none' ? !!r.criticality : r.criticality !== f.crit)) return false;
      if (f.owner) {
        if (ownerByName) { if ((r.owner ? nameOf(r.owner.ref, r.m) : '') !== f.owner) return false; }
        else if (!r.owner || r.owner.ref !== f.owner) return false;
      }
      if (f.done !== 'all') { const ok = regComplete(registryRow(r)); if ((f.done === 'ok') !== ok) return false; }
      if (f.ov && f.ov !== 'all' && !ovFor(r).length) return false;
      if (words.length) { const hay = (registryRow(r).join(' ') + ' ' + r.id).toLowerCase(); if (!words.every((w) => hay.includes(w))) return false; }
      return true;
    });
  }
  const filteredRegistry = () => filterRegistry(M().reqs, S.rf);
  const commonList = () => includedModels().flatMap((m) => m.reqs);
  const filteredCommon = () => filterRegistry(commonList(), S.cf, { ownerByName: true });

  function regSummary(list, { docs = 0 } = {}) {
    const rows = list.map(registryRow);
    const done = rows.filter((x) => x[17] === 'Готово').length;
    const classes = ['C1', 'C2', 'C3', 'C4'];
    const byCrit = classes.map((c) => [c, list.filter((r) => r.criticality === c).length]);
    const noCrit = list.filter((r) => !r.criticality).length;
    const statuses = [...new Set(rows.map((x) => x[12]).filter(Boolean))];
    let h = '<section class="reg-summary">';
    if (docs) h += `<div class="reg-fact"><span class="lbl">Документов</span><b>${docs}</b></div>`;
    h += `<div class="reg-fact"><span class="lbl">Карточек</span><b>${rows.length}</b></div>`;
    h += `<div class="reg-fact"><span class="lbl">Комплектных</span><b class="${done === rows.length && rows.length ? 'ok' : 'bad'}">${done}</b></div>`;
    if (!docs) h += `<div class="reg-fact st"><span class="lbl">Статус</span><b>${statuses.map(esc).join(', ') || '—'}</b></div>`;
    const nb = list.filter((r) => r.category === 'business').length;
    h += `<div class="reg-fact cat"><span class="lbl">Бизнес / системные</span><b><span class="cb">${nb}</span> / <span class="cs">${list.length - nb}</span></b></div>`;
    h += `<div class="reg-crit"><span class="lbl">Критичность</span><div class="crit-bar" role="img" aria-label="${byCrit.map(([c, n]) => `${c}: ${n}`).join(', ')}">${byCrit.filter(([, n]) => n).map(([c, n]) => `<span class="${c.toLowerCase()}" style="flex:${n}" title="${c}: ${n} — ${esc(L.criticality[c])}">${c} ${n}</span>`).join('')}${noCrit ? `<span class="none" style="flex:${noCrit}">без класса ${noCrit}</span>` : ''}</div>
      <div class="crit-legend">${byCrit.map(([c, n]) => `<span><i class="${c.toLowerCase()}"></i>${c}: ${n}, ${esc(L.criticality[c].replace(' невыполнения', ''))}</span>`).join('')}</div></div>`;
    return h + '</section>';
  }

  function viewRegistry() {
    const m = M();
    const classes = ['C1', 'C2', 'C3', 'C4'];
    const owners = m.roles.filter((ro) => m.reqs.some((r) => r.owner && r.owner.ref === ro.id));
    const prelim = m.reqs.some((r) => (r.owner && r.owner.status !== 'confirmed') || (r.critBasis && r.critBasis.status !== 'confirmed'));
    const f = S.rf;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-rf="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${t}</button>`).join('')}</div>`;

    let h = `<div class="page-head"><div><h1>Реестр требований документа</h1><p>Карточки в формате корпоративного мастер-реестра: одна строка — одно атомарное требование. Столбцы выгрузки A–R совпадают с шаблоном пилота V0.1. Заполнить карточку можно прямо здесь: кнопка «Изменить».</p></div>
      <div class="head-actions"><button type="button" class="btn" data-dl="xml">${ICON.down}<span>XML</span></button><button type="button" class="btn btn-primary" data-dl="xlsx">${ICON.down}<span>Реестр в Excel</span></button></div></div>`;
    if (!m.reqs.length) return h + '<div class="empty">В документе нет требований — карточек пока нет. Добавьте требования в тексте документа через «Разметку».</div>';
    h += regSummary(m.reqs);

    if (owners.length) {
      h += '<div class="reg-owners">';
      owners.forEach((ro) => {
        const list = m.reqs.filter((r) => r.owner && r.owner.ref === ro.id);
        const cc = classes.map((c) => [c, list.filter((r) => r.criticality === c).length]).filter(([, n]) => n);
        h += `<button type="button" class="owner-pill${f.owner === ro.id ? ' on' : ''}" data-rowner="${esc(ro.id)}" aria-pressed="${f.owner === ro.id}"><b>${esc(ro.name)}</b><span>${pl(list.length, 'карточка', 'карточки', 'карточек')}${cc.length ? ': ' + cc.map(([c, n]) => `${c} ${n}`).join(', ') : ''}</span></button>`;
      });
      h += '</div>';
    }
    if (prelim) {
      const en = m.notes.find((n) => /владел/i.test(n.text) && /критичност/i.test(n.text));
      h += `<p class="prelim">Владельцы и классы критичности назначены предварительно и ждут подтверждения владельцами требований${en ? `, правила назначения — в <a href="#/notes/${esc(en.id)}">замечании ${esc(en.id)}</a>` : ''}. Постоянные CR-ID присваивает оператор реестра после проверки карточек.</p>`;
    }
    const inCommon = m.entry.included;
    h += `<div class="filters">
      <div class="f-row"><input type="search" id="rq" placeholder="ID карточки, наименование, слова формулировки" value="${esc(f.q)}" aria-label="Поиск по реестру"></div>
      <div class="f-row">
        <div class="f-group"><span class="f-label">Тип</span>${seg('cat', [['all', 'все'], ['business', 'бизнес'], ['system', 'системные']])}</div>
        <div class="f-group"><span class="f-label">Критичность</span>${seg('crit', [['all', 'все'], ...classes.filter((c) => m.reqs.some((r) => r.criticality === c)).map((c) => [c, c]), ...(m.reqs.some((r) => !r.criticality) ? [['none', 'без класса']] : [])])}</div>
        <div class="f-group"><span class="f-label">Комплектность</span>${seg('done', [['all', 'все'], ['ok', 'готово'], ['todo', 'заполнить']])}</div>
        ${inCommon ? `<div class="f-group"><span class="f-label">Пересечения</span>${seg('ov', [['all', 'все'], ['yes', 'есть']])}</div>` : ''}
      </div></div>`;
    h += '<div id="regResults"></div>';
    return h;
  }

  function regRowHtml(r, { common = false } = {}) {
    const row = registryRow(r);
    const u = uk(r);
    const open = S.openReg.has(u);
    const miss = regMissing(row);
    return `<div class="reg-row${open ? ' open' : ''}" id="reg-${esc(common ? u : r.id)}">
        <div class="rid"><span class="req-id">${esc(row[0])}</span>${common ? `<span class="doc-tag">${srcBadge(r.m.entry)}${esc(docName(r.m))}</span>` : ''}<a href="${esc(docHref(r))}">${esc(reqCite(r))}</a></div>
        <div><div class="req-title">${esc(row[1] || 'без наименования')}</div><div class="line">${esc(row[3])}</div>
          <div class="row-acts"><button type="button" class="link-btn" data-reg="${esc(u)}" aria-expanded="${open}">${open ? 'Скрыть карточку' : 'Вся карточка'}</button>${editBtn(r, 'Изменить')}${ovBadge(r)}</div></div>
        <div class="owner">${row[7] ? esc(row[7]) : '<span class="bad-ref">не назначен</span>'}</div>
        <div>${row[9] ? `<span class="chip crit ${esc(row[9].toLowerCase())}" title="${esc(L.criticality[row[9]] || '')}">${esc(row[9])}</span>` : '<span class="bad-ref">—</span>'}</div>
        <div>${row[17] === 'Готово' ? '<span class="chip shall">Готово</span>' : `<span class="chip shall-not" title="Не заполнено: ${esc(miss.join(', '))}">Заполнить</span>`}</div>
        ${open ? `<dl class="reg-card">${REG_HEAD.map((t, i) => `<dt><span class="col">${String.fromCharCode(65 + i)}</span>${esc(t)}</dt><dd>${row[i] ? esc(row[i]) : `<span class="muted">${REG_REQUIRED.includes(i) ? 'не заполнено' : '—'}</span>`}</dd>`).join('')}</dl>` : ''}
      </div>`;
  }
  function regTable(list, opts) {
    return `<div class="reg-table"><div class="reg-head" aria-hidden="true"><span>ID карточки</span><span>Наименование и формулировка</span><span>Владелец</span><span>Класс</span><span>Комплектность</span></div>${list.map((r) => regRowHtml(r, opts)).join('')}</div>`;
  }

  function renderRegistryResults() {
    const box = $('#regResults');
    if (!box) return;
    const list = filteredRegistry();
    const total = M().reqs.length;
    const filtered = list.length !== total;
    let h = `<div class="result-line"><span>${filtered ? `Найдено ${list.length} из ${total}` : `Всего ${total}`}${filtered ? ' <button type="button" class="link-btn" id="resetRF">Сбросить фильтры</button>' : ''}</span>
      <button type="button" class="btn btn-sm" data-dl="xlsx-registry"${list.length ? '' : ' disabled'}>${ICON.down}${filtered ? 'Скачать найденные (Excel)' : 'Скачать (Excel)'}</button></div>`;
    if (!list.length) { box.innerHTML = h + '<div class="empty">По этим условиям карточек нет.</div>'; return; }
    box.innerHTML = h + regTable(list);
  }

  /* ---------- Общий реестр всех документов ---------- */
  function viewCommon() {
    const inc = includedModels();
    const all = commonList();
    const f = S.cf;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-cf="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${t}</button>`).join('')}</div>`;
    const excluded = W.docs.filter((d) => !d.included);
    let h = `<div class="page-head"><div><h1>Общий реестр требований</h1><p>Карточки всех документов, отмеченных «в общем реестре», в одной таблице. Выгрузка в Excel повторяет столбцы A–R мастер-реестра; XML — один документ ИСМ с разделом на каждый источник и замечаниями о пересечениях.</p></div>
      <div class="head-actions"><button type="button" class="btn" data-dl="cxml"${all.length ? '' : ' disabled'}>${ICON.down}<span>XML</span></button><button type="button" class="btn btn-primary" data-dl="cxlsx"${all.length ? '' : ' disabled'}>${ICON.down}<span>Реестр в Excel</span></button></div></div>`;
    if (!inc.length) return h + `<div class="empty">В общем реестре нет документов. <a href="#/">Загрузите документы</a> или включите переключатель «в общем реестре» у уже загруженных.</div>`;
    h += regSummary(all, { docs: inc.length });
    const ovs = overlapPairs().length;
    const tail = [];
    if (ovs) tail.push(`Похожих пар требований: <a href="#/overlaps">${ovs}</a>.`);
    if (excluded.length) tail.push(`Не входят в реестр: ${excluded.map((d) => esc(docName(modelOf(d)) || d.name)).join(', ')}.`);
    if (tail.length) h += `<p class="reg-note">${tail.join(' ')}</p>`;
    const owners = [...new Set(all.map((r) => (r.owner ? nameOf(r.owner.ref, r.m) : '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    h += `<div class="filters">
      <div class="f-row"><input type="search" id="cq" placeholder="ID карточки, наименование, слова формулировки, документ" value="${esc(f.q)}" aria-label="Поиск по общему реестру"></div>
      <div class="f-row">
        <label class="f-group"><span class="f-label">Документ</span><select data-csel="doc"><option value="">все (${inc.length})</option>${inc.map((m) => `<option value="${esc(m.key)}"${f.doc === m.key ? ' selected' : ''}>${esc(docName(m))} — ${esc(docTitle(m).slice(0, 60))} (${m.reqs.length})</option>`).join('')}</select></label>
        ${owners.length ? `<label class="f-group"><span class="f-label">Владелец</span><select data-csel="owner"><option value="">все</option>${owners.map((o) => `<option${f.owner === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : ''}
        <label class="f-group"><span class="f-label">Уровень</span><select data-csel="level"><option value="">все</option>${[1, 2, 3, 4, 'ext'].filter((l) => inc.some((m) => String(levelOf(m) ?? 'ext') === String(l))).map((l) => `<option value="${l}"${f.level === String(l) ? ' selected' : ''}>${l === 'ext' ? 'внешняя документация' : `${l} уровень — ${esc(levelInfo(l).purpose)}`}</option>`).join('')}</select></label>
      </div>
      <div class="f-row">
        <div class="f-group"><span class="f-label">Тип</span>${seg('cat', [['all', 'все'], ['business', 'бизнес'], ['system', 'системные']])}</div>
        <div class="f-group"><span class="f-label">Критичность</span>${seg('crit', [['all', 'все'], ['C1', 'C1'], ['C2', 'C2'], ['C3', 'C3'], ['C4', 'C4'], ['none', 'без класса']])}</div>
        <div class="f-group"><span class="f-label">Комплектность</span>${seg('done', [['all', 'все'], ['ok', 'готово'], ['todo', 'заполнить']])}</div>
        <div class="f-group"><span class="f-label">Пересечения</span>${seg('ov', [['all', 'все'], ['yes', 'есть']])}</div>
      </div></div>`;
    h += '<div id="comResults"></div>';
    return h;
  }
  function renderCommonResults() {
    const box = $('#comResults');
    if (!box) return;
    const list = filteredCommon();
    const total = commonList().length;
    const filtered = list.length !== total;
    let h = `<div class="result-line"><span>${filtered ? `Найдено ${list.length} из ${total}` : `Всего ${total}`}${filtered ? ' <button type="button" class="link-btn" id="resetCF">Сбросить фильтры</button>' : ''}</span>
      <span class="rl-actions"><button type="button" class="btn btn-sm" data-dl="cxlsx-f"${list.length ? '' : ' disabled'}>${ICON.down}${filtered ? 'Найденные в Excel' : 'Excel'}</button><button type="button" class="btn btn-sm" data-dl="cxml-f"${list.length ? '' : ' disabled'}>${ICON.down}${filtered ? 'Найденные в XML' : 'XML'}</button></span></div>`;
    if (!list.length) { box.innerHTML = h + '<div class="empty">По этим условиям карточек нет.</div>'; return; }
    const shown = list.slice(0, S.cf.limit || 300);
    h += regTable(shown, { common: true });
    if (shown.length < list.length) h += `<div class="more-line"><button type="button" class="btn btn-sm" id="moreCommon">Показать ещё ${Math.min(300, list.length - shown.length)} из ${list.length - shown.length}</button></div>`;
    box.innerHTML = h;
  }

  /* ---------- Выгрузка реестра в Excel ---------- */
  async function exportXlsx(list, fileName, origin) {
    toast('Готовлю файл Excel…', 6000);
    if (!window.ExcelJS) await loadScript(EXCELJS_URL);
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

    ws.mergeCells('A1:T1');
    Object.assign(ws.getCell('A1'), { value: 'КОРПОРАТИВНЫЙ МАСТЕР-РЕЕСТР ТРЕБОВАНИЙ' });
    ws.getCell('A1').font = arial({ size: 18, bold: true, color: { argb: 'FFFFFFFF' } });
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
    ws.getCell('A1').alignment = { vertical: 'middle' };
    ws.getRow(1).height = 30;
    ws.mergeCells('A2:T2');
    const today = new Date().toLocaleDateString('ru-RU');
    ws.getCell('A2').value = `Одна строка = одна карточка = одно атомарное требование. Выгрузка: ${origin}, ${today}. Столбцы A–R совпадают с шаблоном пилота V0.1; S–T — дополнительные: тип требования и основание.`;
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
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i >= 18 ? 'FF3D6B6B' : 'FF2F75B5' } };
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
    ws.dataValidations.add(`S6:S${lastV}`, list1(Object.values(CAT)));
    const fill = (argb) => ({ type: 'pattern', pattern: 'solid', bgColor: { argb } });
    ws.addConditionalFormatting({ ref: `J6:J${lastV}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'C1', priority: 1, style: { fill: fill('FFFFC7CE'), font: { color: { argb: 'FF9C0006' }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'C2', priority: 2, style: { fill: fill('FFFCE4D6'), font: { color: { argb: 'FF833C0B' } } } },
    ] });
    ws.addConditionalFormatting({ ref: `R6:R${lastV}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'Готово', priority: 3, style: { fill: fill('FFC6EFCE'), font: { color: { argb: 'FF006100' } } } },
      { type: 'containsText', operator: 'containsText', text: 'Заполнить', priority: 4, style: { fill: fill('FFFFEB9C'), font: { color: { argb: 'FF9C5700' } } } },
    ] });
    ws.autoFilter = `A5:T${Math.max(last, 6)}`;

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

  /* ---------- Выгрузка реестра в XML (один документ ИСМ) ---------- */
  function registryXml(list, { title, note } = {}) {
    const idx = new Map(list.map((r, i) => [uk(r), i]));
    const cards = list.map((r) => {
      const row = registryRow(r);
      const g = r.registry || {};
      return {
        id: row[0], title: r.title, object: row[2], statement: r.statement, source: row[4], clause: row[5],
        level: g.level || '', owner: row[7], scope: row[8], crit: r.criticality || '', method: row[10], criterion: row[11],
        status: g.status || '', version: g.version || '', effective: g.effective || '', evidence: g.evidence || '', remark: g.remark || '',
        modality: r.modality, ownerConfirmed: r.owner ? r.owner.status === 'confirmed' : false,
        category: r.category, categoryStatus: r.catAuto ? 'preliminary' : r.categoryStatus,
        critBasis: r.critBasis, group: `${docName(r.m)} — ${docTitle(r.m)}${r.m.entry.builtin ? '' : ` (файл «${r.m.entry.name}»)`}`,
      };
    });
    const pairs = overlapPairs().filter((p) => idx.has(p.ka) && idx.has(p.kb)).map((p) => ({
      a: idx.get(p.ka), b: idx.get(p.kb), kind: p.kind,
      text: `${L.ovKind[p.kind].charAt(0).toUpperCase() + L.ovKind[p.kind].slice(1)} с карточкой ${cards[idx.get(p.kb)].id} (${docName(p.b.m)}, ${reqCite(p.b)}): сходство формулировок ${Math.round(p.score * 100)} %. Решите, объединять ли требования.`,
    }));
    const today = new Date();
    const res = window.ISM.convert.fromCards(cards, {
      fileStem: 'common-registry', code: 'CR', docId: `REG-COMMON-${ymd(today)}`, version: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      title: title || 'Общий реестр требований', pairs,
      links: W.links.filter((l) => l.relation === 'derives' && idx.has(l.from) && idx.has(l.to)).map((l) => ({ a: idx.get(l.from), b: idx.get(l.to), relation: 'implements' })),
      note: note || `Общий реестр собран в приложении ИСМ XML ${today.toLocaleDateString('ru-RU')}: ${pl(cards.length, 'карточка', 'карточки', 'карточек')} из ${pl(new Set(list.map((r) => r.m.key)).size, 'документа', 'документов', 'документов')}. Пункт каждой карточки содержит её формулировку; источник и пункт исходного документа — в атрибутах registry/@sourceDocument и @sourceClause.`,
    });
    return res.xml;
  }

  /* ---------- Пересекающиеся требования ---------- */
  const pairKey = (ka, kb) => (ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`);
  function overlapsAll() {
    if (W.ov && W.ov.ver === W.version) return W.ov;
    const items = [];
    includedModels().forEach((m) => m.reqs.forEach((r) => items.push({ key: uk(r), text: r.statement, polarity: r.modality === 'shall-not' ? 'neg' : 'pos', r })));
    const byKey = new Map(items.map((i) => [i.key, i]));
    const raw = window.ISM.overlap.findPairs(items, {
      minScore: 0.4, dupScore: 0.8,
      skip: (a, b) => a.r.m === b.r.m && a.r.clause === b.r.clause, // перечень одного пункта — не пересечение
    });
    const pairs = raw.map((p) => ({ ...p, ka: p.a, kb: p.b, a: byKey.get(p.a).r, b: byKey.get(p.b).r, id: pairKey(p.a, p.b) }));
    W.ov = { ver: W.version, pairs };
    return W.ov;
  }
  // Пары выше текущего порога, кроме отмеченных «не дубль»; индекс по требованиям для значков в таблицах
  function ovIndex() {
    const key = `${W.version}|${S.of.min}|${W.disVer || 0}`;
    if (W.ovIdx && W.ovIdx.key === key) return W.ovIdx;
    const pairs = overlapsAll().pairs.filter((p) => p.score >= S.of.min && !W.dismissed.has(p.id));
    const by = new Map();
    pairs.forEach((p) => [p.ka, p.kb].forEach((k) => { if (!by.has(k)) by.set(k, []); by.get(k).push(p); }));
    W.ovIdx = { key, pairs, by };
    return W.ovIdx;
  }
  const overlapPairs = () => ovIndex().pairs;
  function ovFor(r) {
    if (!r.m.entry.included) return [];
    return ovIndex().by.get(uk(r)) || [];
  }
  function ovBadge(r) {
    const list = ovFor(r);
    if (!list.length) return '';
    const conflict = list.some((p) => p.kind === 'conflict');
    return `<a class="chip ov${conflict ? ' conflict' : ''}" href="#/overlaps?req=${encodeURIComponent(uk(r))}" title="Похожие требования в общем реестре">${ICON.ov}${conflict ? 'противоречие' : 'пересечения'}: ${list.length}</a>`;
  }

  function viewOverlaps() {
    const f = S.of;
    const inc = includedModels();
    let h = `<div class="page-head"><div><h1>Пересекающиеся требования</h1><p>Похожие формулировки среди требований общего реестра. Слова сравниваются без учёта окончаний, редкие слова весят больше частых. Общие слова подсвечены. Требования одного пункта (перечень после «должен включать:») между собой не сравниваются.</p></div></div>`;
    if (!inc.length) return h + '<div class="empty">В общем реестре нет документов. <a href="#/">Загрузите документы</a>.</div>';
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-of="${key}" data-v="${v}" aria-pressed="${String(f[key]) === v}">${t}</button>`).join('')}</div>`;
    h += `<div class="filters ov-filters">
      <div class="f-row">
        <label class="f-group range"><span class="f-label">Порог сходства</span><input type="range" id="ovMin" min="40" max="95" step="5" value="${Math.round(f.min * 100)}"><b id="ovMinVal">${Math.round(f.min * 100)} %</b></label>
        <div class="f-group"><span class="f-label">Вид</span>${seg('kind', [['all', 'все'], ['dup', 'почти совпадают'], ['overlap', 'пересекаются'], ['conflict', 'противоречат']])}</div>
      </div>
      <div class="f-row">
        ${inc.length > 1 ? `<div class="f-group"><span class="f-label">Где</span>${seg('where', [['all', 'везде'], ['cross', 'между документами'], ['inner', 'внутри документа']])}</div>` : ''}
        ${inc.length > 1 ? `<label class="f-group"><span class="f-label">Документ</span><select id="ovDoc"><option value="">все</option>${inc.map((m) => `<option value="${esc(m.key)}"${f.doc === m.key ? ' selected' : ''}>${esc(docName(m))} — ${esc(docTitle(m).slice(0, 50))}</option>`).join('')}</select></label>` : ''}
        <label class="f-group chk"><input type="checkbox" id="ovHidden"${f.hidden ? ' checked' : ''}> показать отмеченные «не дубль» (${W.dismissed.size})</label>
      </div></div>`;
    h += '<div id="ovResults"></div>';
    return h;
  }
  function filteredPairs() {
    const f = S.of;
    let list = overlapsAll().pairs.filter((p) => p.score >= f.min);
    if (!f.hidden) list = list.filter((p) => !W.dismissed.has(p.id));
    if (f.kind !== 'all') list = list.filter((p) => p.kind === f.kind);
    if (f.where === 'cross') list = list.filter((p) => p.a.m !== p.b.m);
    if (f.where === 'inner') list = list.filter((p) => p.a.m === p.b.m);
    if (f.doc) list = list.filter((p) => p.a.m.key === f.doc || p.b.m.key === f.doc);
    if (f.req) list = list.filter((p) => p.ka === f.req || p.kb === f.req);
    return list;
  }
  function ovSide(r, shared, same) {
    const g = r.registry || {};
    return `<div class="ov-side ${esc(r.modality)}">
      <div class="ov-doc">${srcBadge(r.m.entry)}<b>${esc(docName(r.m))}</b><a href="${esc(docHref(r))}">${esc(reqCite(r))}</a>${g.id ? `<span class="req-id">${esc(g.id)}</span>` : ''}</div>
      <p class="ov-text">${same ? esc(r.statement) : window.ISM.overlap.highlight(r.statement, shared, esc)}</p>
      <div class="ov-meta"><span class="chip ${esc(r.modality)}">${esc(L.modality[r.modality] || r.modality)}</span>${r.criticality ? `<span class="chip crit ${esc(r.criticality.toLowerCase())}">${esc(r.criticality)}</span>` : ''}${r.owner ? `<span class="muted">${esc(nameOf(r.owner.ref, r.m))}</span>` : ''}</div>
      <div class="req-actions"><a href="${esc(reqHref(r))}">Открыть</a>${editBtn(r, 'Изменить')}</div>
    </div>`;
  }
  function renderOverlapResults() {
    const box = $('#ovResults');
    if (!box) return;
    const f = S.of;
    const list = filteredPairs();
    const req = f.req ? reqByUk(f.req) : null;
    const nDup = list.filter((p) => p.kind === 'dup').length, nConf = list.filter((p) => p.kind === 'conflict').length;
    let h = `<div class="result-line"><span>${list.length ? `${pl(list.length, 'пара', 'пары', 'пар')}${nDup ? `, почти совпадают ${nDup}` : ''}${nConf ? `, противоречат ${nConf}` : ''}` : 'Пар нет'}${req ? ` для требования <b>${esc(reqCite(req))}</b> из ${esc(docName(req.m))} <button type="button" class="link-btn" id="ovAll">показать все</button>` : ''}</span></div>`;
    if (!list.length) {
      h += `<div class="empty">${f.min > 0.45 ? 'При этом пороге похожих требований нет. Сдвиньте порог влево, чтобы увидеть более слабые совпадения.' : 'Похожих требований не найдено.'}</div>`;
      box.innerHTML = h; return;
    }
    const shown = list.slice(0, f.limit);
    shown.forEach((p) => {
      const pct = Math.round(p.score * 100);
      const hidden = W.dismissed.has(p.id);
      const same = norm(p.a.statement).toLowerCase() === norm(p.b.statement).toLowerCase();
      h += `<article class="ov-pair ${esc(p.kind)}${hidden ? ' dismissed' : ''}">
        <header><span class="ov-score" title="Сходство формулировок"><b>${pct} %</b><i><s style="width:${pct}%"></s></i></span>
          <span class="chip ovk ${esc(p.kind)}">${same ? 'совпадают дословно' : esc(L.ovKind[p.kind])}</span>
          <span class="muted">${p.a.m === p.b.m ? 'внутри документа' : 'между документами'}</span>
          <span class="sp"></span>
          <button type="button" class="btn btn-sm" data-ovdismiss="${esc(p.id)}">${hidden ? 'Вернуть в список' : 'Не дубль'}</button></header>
        <div class="ov-sides">${ovSide(p.a, p.shared, same)}${ovSide(p.b, p.shared, same)}</div>
      </article>`;
    });
    if (shown.length < list.length) h += `<div class="more-line"><button type="button" class="btn btn-sm" id="moreOv">Показать ещё ${Math.min(60, list.length - shown.length)} из ${list.length - shown.length}</button></div>`;
    box.innerHTML = h;
  }

  /* ---------- Граф требований по уровням документов ---------- */
  // Полосы как в классификаторе документов ИСМ: 1–4 уровень и внешняя документация.
  // Узлы — требования внутри документов; рёбра — основания (нижестоящее требование выведено из вышестоящего),
  // предложенные основания по сходству формулировок, пересечения и ссылки между документами.
  const G = { vb: null, size: null, sel: '', drag: null, f: { mode: 'network', cat: 'all', basis: true, sug: true, ov: false, refs: true, onlyInc: false } };
  const GL = { label: 214, pad: 18, docW: 268, gapX: 22, gapY: 18, head: 66, node: 13, ngap: 5, cols: 13, maxNodes: 156, bandPad: 16 };
  const levelKey = (m) => (!m || !m.type ? 'none' : m.type.level ?? 'ext');
  const above = (up, low) => { // up выше low по иерархии
    if (!up.type || !low.type || up === low) return false;
    if (low.typeCode === 'EXT') return false;
    if (up.typeCode === 'EXT') return true;
    return up.type.level < low.type.level;
  };
  function graphSuggestions() {
    if (W.gsug && W.gsug.ver === W.version) return W.gsug.list;
    const ms = models().filter((m) => m.type);
    const items = ms.flatMap((m) => m.reqs.map((r) => ({ key: uk(r), text: r.statement, r })));
    const byKey = new Map(items.map((i) => [i.key, i.r]));
    const best = new Map();
    window.ISM.overlap.findPairs(items, { minScore: 0.3, skip: (a, b) => a.r.m === b.r.m || (!above(a.r.m, b.r.m) && !above(b.r.m, a.r.m)) }).forEach((p) => {
      const a = byKey.get(p.a), b = byKey.get(p.b);
      const [low, up] = above(a.m, b.m) ? [b, a] : [a, b];
      const k = uk(low);
      if (!best.has(k) || best.get(k).score < p.score) best.set(k, { from: k, to: uk(up), score: p.score });
    });
    const linked = new Set(W.links.map((l) => `${l.from}>${l.to}`));
    const list = [...best.values()].filter((s) => !linked.has(`${s.from}>${s.to}`));
    W.gsug = { ver: W.version, list };
    return list;
  }
  function docRefEdges(ms) {
    const nid = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
    const byId = new Map(ms.filter((m) => m.id).map((m) => [nid(m.id), m]));
    const out = [];
    ms.forEach((m) => m.refs.forEach((rf) => { const t = byId.get(nid(rf.identifier)); if (t && t !== m) out.push({ from: m, to: t }); }));
    return out;
  }

  function graphLayout() {
    const ms = models().filter((m) => !G.f.onlyInc || m.entry.included);
    const bands = [1, 2, 3, 4, 'ext'].map((k) => ({ k, docs: ms.filter((m) => levelKey(m) === k) }));
    const none = ms.filter((m) => levelKey(m) === 'none');
    if (none.length) bands.push({ k: 'none', docs: none });
    const perRow = Math.min(4, Math.max(2, ...bands.map((b) => b.docs.length)));
    const contentW = GL.label + GL.pad + perRow * (GL.docW + GL.gapX);
    const pos = new Map();    // uk → {x, y, r, m}
    const docs = new Map();   // key → {x, y, w, h, m}
    let y = 0;
    bands.forEach((band) => {
      band.y = y;
      let rowY = y + GL.bandPad;
      let rowH = 0;
      band.docs.forEach((m, i) => {
        if (i && i % perRow === 0) { rowY += rowH + GL.gapY; rowH = 0; }
        const x = GL.label + GL.pad + (i % perRow) * (GL.docW + GL.gapX);
        const shown = m.reqs.slice(0, GL.maxNodes);
        const rows = Math.max(1, Math.ceil(shown.length / GL.cols));
        const h = GL.head + rows * (GL.node + GL.ngap) + 12 + (m.reqs.length > shown.length ? 16 : 0);
        docs.set(m.key, { x, y: rowY, w: GL.docW, h, m, hidden: m.reqs.length - shown.length });
        shown.forEach((r, j) => {
          pos.set(uk(r), { x: x + 12 + (j % GL.cols) * (GL.node + GL.ngap) + GL.node / 2, y: rowY + GL.head + Math.floor(j / GL.cols) * (GL.node + GL.ngap) + GL.node / 2, r, m });
        });
        rowH = Math.max(rowH, h);
      });
      band.h = Math.max(112, (band.docs.length ? rowY - y + rowH : 0) + GL.bandPad * 2);
      y += band.h;
    });
    return { bands, pos, docs, W: contentW + GL.pad, H: y, ms };
  }

  /* ---------- Граф: вид «Сеть» ---------- */
  // Документы — крупные узлы на высоте своего уровня иерархии, разделы — средние, требования — точки вокруг разделов.
  // Раскладка силовая (отталкивание, пружины, притяжение к полосе уровня), считается один раз и кэшируется.
  const NET = { bandOcc: 400, bandEmpty: 76, left: 230, width: 1180 };
  function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function netLayout() {
    // Раскладка зависит только от состава документов: новые связи и перетаскивание её не сбрасывают
    const key = W.docs.map((d) => `${d.key}:${(d.xml || '').length}:${G.f.onlyInc ? d.included : ''}`).join('|');
    if (G.net && G.net.key === key) return G.net;
    const ms = models().filter((m) => !G.f.onlyInc || m.entry.included);
    const ks = [1, 2, 3, 4, 'ext'];
    if (ms.some((m) => levelKey(m) === 'none')) ks.push('none');
    let y = 0;
    const bands = ks.map((k) => { const docs = ms.filter((m) => levelKey(m) === k); const b = { k, docs, y, h: docs.length ? NET.bandOcc : NET.bandEmpty }; y += b.h; return b; });
    const nodes = [], links = [], byId = new Map();
    const rnd = seeded(20261021);
    const add = (n) => { n.vx = 0; n.vy = 0; nodes.push(n); byId.set(n.id, n); return n; };
    bands.forEach((b) => {
      const cy = b.y + b.h / 2;
      b.docs.forEach((m, i) => {
        const x0 = NET.left + ((i + 1) / (b.docs.length + 1)) * NET.width;
        const dn = add({ id: 'doc:' + m.key, kind: 'doc', m, x: x0, y: cy, ax: x0, band: b, r: 30, q: 1300 });
        const groups = new Map();
        m.reqs.forEach((r) => { const s = topSection(r.section); const k = s && s.id ? s.id : '_'; if (!groups.has(k)) groups.set(k, { s, reqs: [] }); groups.get(k).reqs.push(r); });
        const gl = [...groups.values()];
        gl.forEach((g, j) => {
          const ang = (j / Math.max(1, gl.length)) * Math.PI * 2 + rnd() * 0.5;
          let parent = dn;
          if (gl.length > 1) {
            parent = add({ id: `sec:${m.key}:${g.s && g.s.id ? g.s.id : '_'}`, kind: 'sec', m, s: g.s, x: x0 + Math.cos(ang) * 105, y: cy + Math.sin(ang) * 80, band: b, r: 9, q: 260 });
            links.push({ a: dn, b: parent, len: 85 + Math.min(70, g.reqs.length * 4), k: 0.3, kind: 'struct' });
          }
          g.reqs.forEach((r) => {
            const a2 = rnd() * Math.PI * 2;
            const rn = add({ id: uk(r), kind: 'req', req: r, m, x: parent.x + Math.cos(a2) * 34, y: parent.y + Math.sin(a2) * 34, band: b, r: 7, q: 60 });
            links.push({ a: parent, b: rn, len: parent.kind === 'doc' ? 66 : 36, k: 0.4, kind: 'struct' });
          });
        });
      });
    });
    simulate(nodes, links);
    // Полосы ужимаются по фактическому размеру кластеров, подписи уровней — слева от содержимого
    let cur = 0;
    bands.forEach((b) => {
      const ns = nodes.filter((nd) => nd.band === b);
      if (!ns.length) { b.y = cur; b.h = 64; cur += b.h; return; }
      const minY = Math.min(...ns.map((nd) => nd.y - nd.r));
      const maxY = Math.max(...ns.map((nd) => nd.y + nd.r + (nd.kind === 'doc' ? 40 : 0)));
      const h = Math.max(190, maxY - minY + 70);
      const shift = cur + (h - (maxY - minY)) / 2 - minY;
      ns.forEach((nd) => { nd.y += shift; });
      b.y = cur; b.h = h; cur += h;
    });
    const xs = nodes.flatMap((nd) => (nd.kind === 'doc' ? [nd.x - 120, nd.x + 120] : [nd.x - nd.r, nd.x + nd.r]));
    const minX = xs.length ? Math.min(...xs) : NET.left, maxX = xs.length ? Math.max(...xs) : NET.left + 400;
    const labelX = minX - 250;
    G.net = { key, nodes, links, byId, bands, H: cur, x0: labelX - 16, W: maxX + 30 - (labelX - 16), labelX };
    return G.net;
  }
  function simulate(nodes, links) {
    const n = nodes.length;
    const iters = n < 160 ? 340 : n < 450 ? 230 : 130;
    const cx = NET.left + NET.width / 2;
    for (let it = 0; it < iters; it++) {
      const alpha = 1 - it / iters;
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const c = nodes[j];
          let dx = c.x - a.x, dy = c.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 90000) continue;
          if (d2 < 0.01) { dx = (i % 2 ? 1 : -1) * 0.5; dy = 0.3; d2 = 0.34; }
          const d = Math.sqrt(d2);
          const f = (Math.sqrt(a.q * c.q) * alpha) / d2;
          a.vx -= dx * f; a.vy -= dy * f; c.vx += dx * f; c.vy += dy * f;
          const min = a.r + c.r + 3;
          if (d < min) { const p = ((min - d) / d) * 0.5; a.x -= dx * p; a.y -= dy * p; c.x += dx * p; c.y += dy * p; }
        }
      }
      links.forEach((l) => {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const p = ((d - l.len) / d) * l.k * alpha;
        l.a.vx += dx * p; l.a.vy += dy * p; l.b.vx -= dx * p; l.b.vy -= dy * p;
      });
      nodes.forEach((nd) => {
        const cy = nd.band.y + nd.band.h / 2;
        nd.vy += (cy - nd.y) * (nd.kind === 'doc' ? 0.25 : 0.035) * alpha;
        if (nd.kind === 'doc') nd.vx += (nd.ax - nd.x) * 0.12 * alpha;
        nd.vx += (cx - nd.x) * 0.002 * alpha;
        nd.vx *= 0.58; nd.vy *= 0.58;
        nd.x += nd.vx; nd.y += nd.vy;
        const top = nd.band.y + 24, bot = nd.band.y + nd.band.h - 24;
        nd.y = Math.min(bot, Math.max(top, nd.y));
        nd.x = Math.min(NET.left + NET.width + 40, Math.max(NET.left - 10, nd.x));
      });
    }
  }
  function graphChain(sel) {
    const set = new Set();
    if (!sel || sel.startsWith('doc:')) return set;
    const walk = (k, dir) => W.links.filter((l) => l.relation === 'derives' && (dir === 'up' ? l.from === k : l.to === k)).forEach((l) => { const nk = dir === 'up' ? l.to : l.from; if (!set.has(nk)) { set.add(nk); walk(nk, dir); } });
    set.add(sel); walk(sel, 'up'); walk(sel, 'down');
    return set;
  }
  function renderNetwork(keepView) {
    const svg = $('#graphSvg');
    const N = netLayout();
    const f = G.f, sel = G.sel;
    const chain = graphChain(sel);
    const selDoc = sel.startsWith('doc:') ? sel.slice(4) : '';
    const t = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const curve = (a, b, cls, title, data = '') => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const bend = Math.abs(a.y - b.y) < 30 ? -60 : 0;
      return `<path class="edge ${cls}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx + bend * 0.3).toFixed(1)} ${(my + bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"${data}><title>${esc(title)}</title></path>`;
    };
    let g = '';
    N.bands.forEach((b, i) => {
      const name = b.k === 'ext' ? 'Внешняя документация' : b.k === 'none' ? 'Вид не задан' : `${b.k} уровень`;
      const sub = b.k === 'ext' ? 'законы, ГОСТы, СНиПы, ТУ' : b.k === 'none' ? 'выберите вид документа на главной' : levelInfo(b.k).purpose;
      const codes = typeList().filter((x) => (b.k === 'ext' ? x.level === null : x.level === b.k)).map((x) => x.code).join(' · ');
      const LX = N.labelX;
      g += `<g class="band${i % 2 ? ' alt' : ''}"><rect x="${N.x0 - 4000}" y="${b.y}" width="${N.W + 9000}" height="${b.h}"/><line x1="${N.x0 - 4000}" y1="${b.y + b.h}" x2="${N.x0 + N.W + 5000}" y2="${b.y + b.h}"/>`;
      g += `<line class="band-sep" x1="${LX + 226}" y1="${b.y}" x2="${LX + 226}" y2="${b.y + b.h}"/>`;
      g += `<text class="band-n" x="${LX}" y="${b.y + (b.docs.length ? 34 : 30)}">${esc(name)}</text>`;
      if (b.docs.length) {
        const words = sub.split(' '); const lines = ['']; words.forEach((w) => { if ((lines[lines.length - 1] + ' ' + w).trim().length > 26 && lines.length < 3) lines.push(w); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim(); });
        lines.forEach((l, j) => { g += `<text class="band-sub" x="${LX}" y="${b.y + 54 + j * 16}">${esc(l)}</text>`; });
        if (codes) g += `<text class="band-codes" x="${LX}" y="${b.y + 62 + lines.length * 16}">${esc(t(codes, 30))}</text>`;
      } else {
        g += `<text class="band-sub" x="${LX}" y="${b.y + 48}">${esc(t(sub, 30))}</text><text class="band-empty" x="${LX + 246}" y="${b.y + b.h / 2 + 5}">документов этого уровня нет</text>`;
      }
      g += '</g>';
    });
    let e = '';
    N.links.filter((l) => l.kind === 'struct').forEach((l) => {
      const dim = (selDoc && l.a.m.key !== selDoc) || (chain.size && !(l.b.kind === 'req' && chain.has(l.b.id)));
      e += `<line class="nedge${dim && (selDoc || chain.size) ? ' dim' : ''}" x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}"/>`;
    });
    const at = (id) => N.byId.get(id);
    if (f.refs) docRefEdges(N.nodes.filter((x) => x.kind === 'doc').map((x) => x.m)).forEach((r) => { const a = at('doc:' + r.from.key), b = at('doc:' + r.to.key); if (a && b) e += curve(a, b, 'ref', `${docName(r.from)} ссылается на ${docName(r.to)}`); });
    if (f.ov) overlapPairs().forEach((p) => { const a = at(p.ka), b = at(p.kb); if (a && b) e += curve(a, b, `ov ${p.kind}${sel && !(p.ka === sel || p.kb === sel) ? ' dim' : ''}`, `${L.ovKind[p.kind]}: ${Math.round(p.score * 100)} %`); });
    if (f.sug) graphSuggestions().forEach((s) => { const a = at(s.from), b = at(s.to); if (a && b) e += curve(a, b, `sug${sel && !(s.from === sel || s.to === sel) ? ' dim' : ''}`, `Предложено основание (сходство ${Math.round(s.score * 100)} %)`, ` data-sug="${esc(s.from)}>${esc(s.to)}"`); });
    if (f.basis) W.links.forEach((l) => { const a = at(l.from), b = at(l.to); if (a && b) e += curve(a, b, `basis${chain.size ? (chain.has(l.from) && chain.has(l.to) ? ' hot' : ' dim') : ''}`, 'Основание: требование выведено из вышестоящего'); });
    g += `<g class="edges">${e}</g>`;
    N.nodes.filter((x) => x.kind === 'sec').forEach((s) => {
      const dim = selDoc ? s.m.key !== selDoc : chain.size > 0;
      const num = s.s ? (s.s.skind === 'appendix' ? 'Пр' : s.s.number || '') : '';
      g += `<g class="nsec${dim ? ' dim' : ''}"><circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.r}" data-gnet="${esc(s.id)}"><title>${esc(s.s ? `${s.s.number ? s.s.number + '. ' : ''}${s.s.title}` : 'Без раздела')}</title></circle>${num ? `<text x="${(s.x + 9).toFixed(1)}" y="${(s.y - 7).toFixed(1)}">${esc(num)}</text>` : ''}</g>`;
    });
    N.nodes.filter((x) => x.kind === 'req').forEach((n) => {
      const r = n.req;
      const k = n.id;
      const dim = (f.cat !== 'all' && r.category !== f.cat) || (chain.size && !chain.has(k)) || (selDoc && n.m.key !== selDoc);
      const linked = W.links.some((l) => l.from === k);
      g += `<circle class="gnode ${r.category}${dim ? ' dim' : ''}${k === sel ? ' on' : ''}${linked ? ' linked' : ''}" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${k === sel ? 8 : n.r}" data-guk="${esc(k)}" data-gnet="${esc(k)}"><title>${esc(`${docName(r.m)}, ${reqCite(r)} · ${CAT[r.category]}\n${r.statement}`)}</title></circle>`;
    });
    N.nodes.filter((x) => x.kind === 'doc').forEach((d) => {
      const m = d.m;
      const code = m.typeCode || '—';
      g += `<g class="gdoc ndoc${m.entry.included ? '' : ' excluded'}${selDoc === m.key ? ' on' : ''}${chain.size && ![...chain].some((k) => k.startsWith(m.key + '|')) ? ' dim' : ''}" data-gdoc="${esc(m.key)}" data-gnet="doc:${esc(m.key)}">
        <circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r}"/>
        <text class="ndoc-type" x="${d.x.toFixed(1)}" y="${(d.y + 4).toFixed(1)}">${esc(code)}</text>
        <text class="ndoc-id" x="${d.x.toFixed(1)}" y="${(d.y + d.r + 16).toFixed(1)}">${esc(t(docName(m), 24))}</text>
        <text class="ndoc-title" x="${d.x.toFixed(1)}" y="${(d.y + d.r + 31).toFixed(1)}">${esc(t(docTitle(m), 34))}</text>
        <title>${esc(`${m.type ? m.type.name : 'Вид не задан'} ${docName(m)} — ${docTitle(m)}. Требований: ${m.reqs.length}`)}</title></g>`;
    });
    svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arr"/></marker></defs>${g}`;
    G.size = { w: N.W, h: N.H };
    if (!keepView || !G.vb) graphFit(); else setVB(G.vb);
  }

  function viewGraph() {
    const f = G.f;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-gf="${key}" data-v="${v}" aria-pressed="${f[key] === v}">${t}</button>`).join('')}</div>`;
    const tog = (key, label, cls) => `<label class="g-tog ${cls}"><input type="checkbox" data-gt="${key}"${f[key] ? ' checked' : ''}><i aria-hidden="true"></i>${label}</label>`;
    let h = `<div class="page-head"><div><h1>Граф требований</h1><p>Документы стоят на высоте своего уровня иерархии ИСМ — от политик до записей и внешней документации. ${f.mode === 'network' ? 'Крупные узлы — документы, средние — разделы, точки — требования' : 'Квадратики — требования'}: фиолетовые бизнес, бирюзовые системные. Стрелки показывают, из какого требования вышестоящего документа выведено требование нижестоящего.</p></div></div>`;
    h += `<div class="filters g-filters"><div class="f-row">
        <div class="f-group"><span class="f-label">Вид</span>${seg('mode', [['network', 'сеть'], ['levels', 'таблица уровней']])}</div>
        <div class="f-group"><span class="f-label">Требования</span>${seg('cat', [['all', 'все'], ['business', 'бизнес'], ['system', 'системные']])}</div>
        ${tog('basis', 'основания', 'basis')}${tog('sug', 'предложенные по сходству', 'sug')}${tog('ov', 'пересечения', 'ov')}${tog('refs', 'ссылки между документами', 'refs')}
        <label class="f-group chk"><input type="checkbox" data-gt="onlyInc"${f.onlyInc ? ' checked' : ''}> только общий реестр</label>
      </div></div>`;
    h += `<div class="graph-box"><div class="graph-wrap" id="graphWrap"><div class="g-zoom"><button type="button" class="btn btn-sm" data-gz="in" aria-label="Крупнее">+</button><button type="button" class="btn btn-sm" data-gz="out" aria-label="Мельче">−</button><button type="button" class="btn btn-sm" data-gz="fit">Вписать</button></div><svg id="graphSvg" role="img" aria-label="Граф требований по уровням документов"></svg></div>
      <aside class="g-panel" id="graphPanel"></aside></div>`;
    h += '<section class="block"><h2>Связи списком</h2><div id="graphList"></div></section>';
    return h;
  }

  function renderGraph(keepView) {
    const svg = $('#graphSvg');
    if (!svg) return;
    if (G.f.mode === 'network') {
      G.layout = graphLayout();
      renderNetwork(keepView);
      renderGraphPanel();
      renderGraphList();
      return;
    }
    const L0 = graphLayout();
    G.layout = L0;
    const f = G.f;
    const t = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const wrapN = (s, n, max = 2) => { const w = s.split(/\s+/); const lines = ['']; w.forEach((x) => { if ((lines[lines.length - 1] + ' ' + x).trim().length > n && lines.length < max) lines.push(x); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + x).trim(); }); return lines.map((l, i) => (i === max - 1 ? t(l, n) : l)); };
    const wrap2 = (s, n) => wrapN(s, n, 2);
    let g = '';
    // полосы уровней
    L0.bands.forEach((b, i) => {
      const info = typeof b.k === 'number' ? levelInfo(b.k) : null;
      const codes = typeList().filter((x) => (b.k === 'ext' ? x.level === null : x.level === b.k)).map((x) => x.code).join(' · ');
      g += `<g class="band${i % 2 ? ' alt' : ''}"><rect x="-2000" y="${b.y}" width="${L0.W + 6000}" height="${b.h}"/><line x1="-2000" y1="${b.y + b.h}" x2="${L0.W + 6000}" y2="${b.y + b.h}"/>`;
      g += `<line class="band-sep" x1="${GL.label}" y1="${b.y}" x2="${GL.label}" y2="${b.y + b.h}"/>`;
      g += `<text class="band-n" x="16" y="${b.y + 30}">${b.k === 'ext' ? 'Внешняя' : b.k === 'none' ? 'Вид не задан' : `${b.k} уровень`}</text>`;
      const sub = b.k === 'ext' ? 'документация, созданная за пределами Предприятия' : b.k === 'none' ? 'выберите вид документа на главной' : info.purpose;
      const subLines = wrapN(sub, 27, 3);
      subLines.forEach((l, j) => { g += `<text class="band-sub" x="16" y="${b.y + 50 + j * 16}">${esc(l)}</text>`; });
      if (codes) wrapN(codes, 22, 2).forEach((l, j) => { g += `<text class="band-codes" x="16" y="${b.y + 58 + subLines.length * 16 + j * 14}">${esc(l)}</text>`; });
      if (!b.docs.length) g += `<text class="band-empty" x="${GL.label + GL.pad}" y="${b.y + b.h / 2 + 5}">Документов этого уровня нет${b.k === 1 ? ' — загрузите политику, цели или руководство' : b.k === 2 ? ' — положения, процедуры, стандарты, регламенты' : b.k === 3 ? ' — методики и инструкции' : b.k === 4 ? ' — записи и отчёты: реестры, журналы, чек-листы' : ' — законы, ГОСТы, СНиПы, ТУ'}</text>`;
      g += '</g>';
    });
    // рёбра
    const sel = G.sel;
    const linkedTo = new Set();
    if (sel) {
      const walk = (k, dir) => W.links.filter((l) => l.relation === 'derives' && (dir === 'up' ? l.from === k : l.to === k)).forEach((l) => { const n = dir === 'up' ? l.to : l.from; if (!linkedTo.has(n)) { linkedTo.add(n); walk(n, dir); } });
      linkedTo.add(sel); walk(sel, 'up'); walk(sel, 'down');
    }
    const curve = (a, b, cls, title, data = '') => {
      const my = (a.y + b.y) / 2;
      const d = Math.abs(a.y - b.y) < 8 ? `M${a.x} ${a.y} C${a.x} ${a.y - 40},${b.x} ${b.y - 40},${b.x} ${b.y}` : `M${a.x} ${a.y} C${a.x} ${my},${b.x} ${my},${b.x} ${b.y}`;
      return `<path class="edge ${cls}" d="${d}"${data}><title>${esc(title)}</title></path>`;
    };
    let edges = '';
    if (f.refs) docRefEdges(L0.ms).forEach((e) => {
      const a = L0.docs.get(e.from.key), b = L0.docs.get(e.to.key);
      if (a && b) edges += curve({ x: a.x + a.w / 2, y: a.y + 2 }, { x: b.x + b.w / 2, y: b.y + b.h - 2 }, 'ref', `${docName(e.from)} ссылается на ${docName(e.to)}`);
    });
    if (f.ov) overlapPairs().forEach((p) => {
      const a = L0.pos.get(p.ka), b = L0.pos.get(p.kb);
      if (a && b) edges += curve(a, b, `ov ${p.kind}${sel && !(p.ka === sel || p.kb === sel) ? ' dim' : ''}`, `${L.ovKind[p.kind]}: ${Math.round(p.score * 100)} %`);
    });
    if (f.sug) graphSuggestions().forEach((s) => {
      const a = L0.pos.get(s.from), b = L0.pos.get(s.to);
      if (a && b) edges += curve(a, b, `sug${sel && !(s.from === sel || s.to === sel) ? ' dim' : ''}`, `Предложено основание (сходство ${Math.round(s.score * 100)} %)`, ` data-sug="${esc(s.from)}>${esc(s.to)}"`);
    });
    if (f.basis) W.links.forEach((l) => {
      const a = L0.pos.get(l.from), b = L0.pos.get(l.to);
      if (a && b) edges += curve(a, b, `basis${sel ? (linkedTo.has(l.from) && linkedTo.has(l.to) ? ' hot' : ' dim') : ''}`, 'Основание: требование выведено из вышестоящего');
    });
    g += `<g class="edges">${edges}</g>`;
    // документы и требования
    L0.docs.forEach((d) => {
      const m = d.m;
      const lines = wrap2(docTitle(m), 36);
      const nSys = m.reqs.filter((r) => r.category === 'system').length;
      g += `<g class="gdoc${m.entry.included ? '' : ' excluded'}${G.sel === 'doc:' + m.key ? ' on' : ''}" data-gdoc="${esc(m.key)}">
        <rect class="gdoc-box" x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}"/>
        <rect class="gdoc-code" x="${d.x + 10}" y="${d.y + 9}" width="${(m.typeCode || '—').length * 8 + 12}" height="17"/>
        <text class="gdoc-type" x="${d.x + 16}" y="${d.y + 21}">${esc(m.typeCode || '—')}</text>
        <text class="gdoc-id" x="${d.x + 22 + (m.typeCode || '—').length * 8 + 8}" y="${d.y + 22}">${esc(t(docName(m), 22))}</text>
        ${lines.map((l, j) => `<text class="gdoc-title" x="${d.x + 10}" y="${d.y + 42 + j * 14}">${esc(l)}</text>`).join('')}
        <title>${esc(`${m.type ? m.type.name : 'Вид не задан'} ${docName(m)} — ${docTitle(m)}. Требований: ${m.reqs.length}, системных: ${nSys}`)}</title>
      </g>`;
      if (d.hidden) g += `<text class="gdoc-more" x="${d.x + 12}" y="${d.y + d.h - 8}">и ещё ${d.hidden} — откройте документ</text>`;
    });
    L0.pos.forEach((p, k) => {
      const r = p.r;
      const dim = (f.cat !== 'all' && r.category !== f.cat) || (sel && !sel.startsWith('doc:') && !linkedTo.has(k));
      const hasBasis = W.links.some((l) => l.from === k);
      g += `<rect class="gnode ${r.category}${dim ? ' dim' : ''}${k === sel ? ' on' : ''}${hasBasis ? ' linked' : ''}" x="${p.x - GL.node / 2}" y="${p.y - GL.node / 2}" width="${GL.node}" height="${GL.node}" rx="2" data-guk="${esc(k)}"><title>${esc(`${reqCite(r)} · ${CAT[r.category]}\n${r.statement}`)}</title></rect>`;
    });
    svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arr"/></marker></defs>${g}`;
    G.size = { w: L0.W, h: L0.H };
    if (!keepView || !G.vb) graphFit(); else setVB(G.vb);
    renderGraphPanel();
    renderGraphList();
  }
  function setVB(vb) { G.vb = vb; const svg = $('#graphSvg'); if (svg) svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`); }
  function graphFit() {
    const wrap = $('#graphWrap');
    if (!wrap || !G.size) return;
    const ratio = wrap.clientHeight / Math.max(1, wrap.clientWidth);
    if (G.f.mode === 'network' && G.net) { // по ширине содержимого, не крупнее 125 %; по высоте — прокрутка
      const W0 = G.net.W;
      const w = Math.max(W0, wrap.clientWidth / 1.25);
      setVB({ x: G.net.x0 - (w - W0) / 2, y: 0, w, h: w * ratio });
      return;
    }
    // По ширине: весь граф виден целиком, но не крупнее натурального размера; по высоте — прокрутка колесом
    const w = Math.max(wrap.clientWidth, Math.min(G.size.w, wrap.clientWidth / 0.6)); // на телефоне не мельче 60 %, остальное — перетаскиванием
    setVB({ x: 0, y: 0, w, h: w * ratio });
  }
  function graphZoom(k, cx, cy) {
    const vb = G.vb; if (!vb) return;
    const nw = Math.min(Math.max(vb.w * k, 200), G.size.w * 4);
    const f = nw / vb.w;
    const px = cx ?? vb.x + vb.w / 2, py = cy ?? vb.y + vb.h / 2;
    setVB({ x: px - (px - vb.x) * f, y: py - (py - vb.y) * f, w: nw, h: vb.h * f });
  }

  function renderGraphPanel() {
    const box = $('#graphPanel');
    if (!box) return;
    const sel = G.sel;
    if (!sel) {
      const L0 = G.layout;
      const nReq = [...L0.docs.values()].reduce((a, d) => a + d.m.reqs.length, 0);
      box.innerHTML = `<h3>Как читать граф</h3>
        <ul class="g-legend">
          <li><i class="lg-node business"></i>бизнес-требование</li><li><i class="lg-node system"></i>системное требование</li>
          <li><i class="lg-node linked"></i>есть основание</li>
          <li><i class="lg-line basis"></i>основание: требование выведено из вышестоящего</li>
          <li><i class="lg-line sug"></i>предложено по сходству формулировок</li>
          <li><i class="lg-line ov"></i>пересечение или противоречие</li><li><i class="lg-line ref"></i>документ ссылается на документ</li>
        </ul>
        <p class="muted">Документов: ${L0.docs.size}, требований: ${nReq}, оснований: ${W.links.length}, предложений: ${graphSuggestions().length}. Нажмите на требование, чтобы увидеть его цепочку оснований, или на документ.</p>
        <p class="muted">Перетаскивайте граф мышью, колесо — прокрутка, Ctrl + колесо — масштаб.</p>`;
      return;
    }
    if (sel.startsWith('doc:')) {
      const m = modelOf(entry(sel.slice(4)));
      if (!m) { G.sel = ''; return renderGraphPanel(); }
      const nSys = m.reqs.filter((r) => r.category === 'system').length;
      const ups = new Set(W.links.filter((l) => l.from.startsWith(m.key + '|')).map((l) => l.to.split('|')[0]));
      const downs = new Set(W.links.filter((l) => l.to.startsWith(m.key + '|')).map((l) => l.from.split('|')[0]));
      const nm = (k) => { const x = modelOf(entry(k)); return x ? `${x.typeCode || '—'} ${docName(x)}` : k; };
      box.innerHTML = `<p class="g-kicker">${srcBadge(m.entry)} ${esc(m.type ? `${m.type.name}, ${m.type.level ? m.type.level + ' уровень' : 'внешняя документация'}` : 'вид не задан')}</p>
        <h3>${esc(docName(m))}</h3><p>${esc(docTitle(m))}</p>
        <p class="muted">Требований ${m.reqs.length}: бизнес ${m.reqs.length - nSys}, системных ${nSys}.</p>
        ${ups.size ? `<p><b>Основания из:</b> ${[...ups].map((k) => esc(nm(k))).join(', ')}</p>` : ''}
        ${downs.size ? `<p><b>Детализируется в:</b> ${[...downs].map((k) => esc(nm(k))).join(', ')}</p>` : ''}
        <div class="req-actions"><a href="#/open/${esc(m.key)}">Открыть документ</a><a href="#/open/${esc(m.key)}/registry">Реестр документа</a><button type="button" data-gsel="">Снять выделение</button></div>`;
      return;
    }
    const r = reqByUk(sel);
    if (!r) { G.sel = ''; return renderGraphPanel(); }
    const ups = W.links.filter((l) => l.from === sel && l.relation === 'derives').map((l) => reqByUk(l.to)).filter(Boolean);
    const downs = W.links.filter((l) => l.to === sel && l.relation === 'derives').map((l) => reqByUk(l.from)).filter(Boolean);
    const sug = graphSuggestions().filter((s) => s.from === sel).map((s) => ({ ...s, t: reqByUk(s.to) })).filter((s) => s.t);
    const item = (x, extra = '') => `<li><button type="button" class="g-jump" data-gsel="${esc(uk(x))}">${esc(x.m.typeCode || '—')} ${esc(docName(x.m))}, ${esc(reqCite(x))}</button><span>${esc(x.statement.length > 140 ? x.statement.slice(0, 138) + '…' : x.statement)}</span>${extra}</li>`;
    box.innerHTML = `<p class="g-kicker">${catChip(r)} ${esc(r.m.typeCode || '—')} ${esc(docName(r.m))} · ${esc(reqCite(r))}${r.registry && r.registry.id ? ` · <span class="req-id">${esc(r.registry.id)}</span>` : ''}</p>
      <p class="g-stmt">${esc(r.statement)}</p>
      <h4>Основания ${ups.length ? `(${ups.length})` : ''}</h4>${ups.length ? `<ul class="g-list">${ups.map((x) => item(x, `<button type="button" class="link-btn" data-gunlink="${esc(sel)}>${esc(uk(x))}">убрать</button>`)).join('')}</ul>` : `<p class="muted">${basisDocs(r.m).length ? 'Не указаны.' : 'Выше по иерархии документов нет.'}</p>`}
      ${sug.length ? `<h4>Предложено</h4><ul class="g-list">${sug.map((s) => item(s.t, `<button type="button" class="btn btn-sm" data-gaccept="${esc(s.from)}>${esc(s.to)}">Связать · ${Math.round(s.score * 100)} %</button>`)).join('')}</ul>` : ''}
      <h4>Выведены из него ${downs.length ? `(${downs.length})` : ''}</h4>${downs.length ? `<ul class="g-list">${downs.map((x) => item(x)).join('')}</ul>` : '<p class="muted">Нет.</p>'}
      <div class="req-actions"><a href="${esc(`#/open/${r.m.key}/req/${r.id}`)}">Открыть</a>${editBtn(r, 'Изменить и связать')}<button type="button" data-gsel="">Снять выделение</button></div>`;
    return undefined;
  }
  function renderGraphList() {
    const box = $('#graphList');
    if (!box) return;
    const rows = W.links.filter((l) => l.relation === 'derives').map((l) => [reqByUk(l.from), reqByUk(l.to)]).filter(([a, b]) => a && b);
    if (!rows.length) {
      box.innerHTML = `<div class="empty">Оснований пока нет. ${graphSuggestions().length ? `Есть ${pl(graphSuggestions().length, 'предложение', 'предложения', 'предложений')} по сходству формулировок: выберите требование на графе и нажмите «Связать».` : 'Загрузите документы разных уровней (например, положение и методику) — приложение предложит связи по сходству формулировок.'}</div>`;
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="grid g-table"><thead><tr><th>Требование</th><th>Основание (вышестоящее)</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><td><b>${esc(a.m.typeCode || '—')} ${esc(docName(a.m))}, ${esc(reqCite(a))}</b> ${catChip(a)}<div>${esc(a.statement)}</div></td><td><b>${esc(b.m.typeCode || '—')} ${esc(docName(b.m))}, ${esc(reqCite(b))}</b> ${catChip(b)}<div>${esc(b.statement)}</div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function bindGraph() {
    const wrap = $('#graphWrap');
    if (!wrap || wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    const svg = $('#graphSvg');
    const toSvg = (ev) => { const r = svg.getBoundingClientRect(); return { x: G.vb.x + (ev.clientX - r.left) / r.width * G.vb.w, y: G.vb.y + (ev.clientY - r.top) / r.height * G.vb.h }; };
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) { const p = toSvg(ev); graphZoom(ev.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y); return; }
      const k = G.vb.w / svg.getBoundingClientRect().width;
      setVB({ ...G.vb, x: G.vb.x + ev.deltaX * k, y: G.vb.y + ev.deltaY * k });
    }, { passive: false });
    svg.addEventListener('pointerdown', (ev) => {
      const hit = G.f.mode === 'network' && G.net && ev.target.closest && ev.target.closest('[data-gnet]');
      const node = hit ? G.net.byId.get(hit.dataset.gnet) : null;
      // документ тянет за собой свои разделы и требования
      const group = node ? (node.kind === 'doc' ? G.net.nodes.filter((x) => x.m === node.m) : [node]).map((x) => ({ n: x, x: x.x, y: x.y })) : null;
      G.drag = { x: ev.clientX, y: ev.clientY, vb: { ...G.vb }, moved: false, group };
    });
    let raf = 0;
    svg.addEventListener('pointermove', (ev) => {
      const d = G.drag; if (!d) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      if (!d.moved) { d.moved = true; try { svg.setPointerCapture(ev.pointerId); } catch { /* нет захвата */ } svg.classList.add('grabbing'); }
      const k = G.vb.w / svg.getBoundingClientRect().width;
      if (d.group) {
        d.group.forEach((p) => { p.n.x = p.x + dx * k; p.n.y = p.y + dy * k; });
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderNetwork(true); });
        return;
      }
      setVB({ ...d.vb, x: d.vb.x - dx * k, y: d.vb.y - dy * k });
    });
    const end = (ev) => {
      const d = G.drag; G.drag = null; svg.classList.remove('grabbing');
      if (d && d.moved) return;
      const node = ev.target.closest && ev.target.closest('[data-guk]');
      const doc = ev.target.closest && ev.target.closest('[data-gdoc]');
      const sug = ev.target.closest && ev.target.closest('[data-sug]');
      if (node) G.sel = G.sel === node.dataset.guk ? '' : node.dataset.guk;
      else if (sug) G.sel = sug.dataset.sug.split('>')[0];
      else if (doc) G.sel = G.sel === 'doc:' + doc.dataset.gdoc ? '' : 'doc:' + doc.dataset.gdoc;
      else if (ev.type === 'pointerup') G.sel = '';
      renderGraph(true);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { G.drag = null; svg.classList.remove('grabbing'); });
  }

  /* ---------- Главная: загрузка и список документов ---------- */
  function viewHome() {
    const docs = W.docs;
    const nReq = commonList().length;
    const nOv = docs.length ? overlapPairs().length : 0;
    let h = `<div class="page-head"><div><h1>Документы</h1><p>Загрузите регламенты, методики или реестры — приложение разметит пункты, найдёт требования по словам «должен», «не допускается», «рекомендуется» и заведёт на каждое карточку реестра. Файлы обрабатываются в этом браузере и никуда не отправляются.</p></div></div>`;
    h += `<section class="upload">
      <label class="drop big" id="upDrop">
        <span class="drop-ico">${ICON.up}</span>
        <b>Перетащите файлы сюда или выберите на компьютере</b>
        <span class="drop-formats"><span>Word .docx</span><span>PDF</span><span>Excel-реестр .xlsx</span><span>XML ИСМ</span></span>
        <span class="muted">Можно несколько файлов сразу. Старые .doc и .xls пересохраните в новом формате.</span>
        <input type="file" id="upFiles" multiple accept="${ACCEPT}">
      </label>
      <div class="up-opts">
        <label class="f-group"><span class="f-label">Уровень требований</span><select id="upLevel">${Object.entries(L.level).map(([k, v]) => `<option value="${k}"${k === (S.upLevel || 'L2') ? ' selected' : ''}>${k} — ${esc(v)}</option>`).join('')}</select></label>
        <label class="f-group chk"><input type="checkbox" id="upInclude"${S.upInclude === false ? '' : ' checked'}> сразу включать в общий реестр</label>
      </div>
      <div id="upReport">${uploadReport()}</div>
    </section>`;
    if (W.cloud && S.localDocs && S.localDocs.length) {
      h += `<div class="migrate-note"><p><b>В этом браузере есть ${pl(S.localDocs.length, 'документ', 'документа', 'документов')}, загруженных без входа:</b> ${S.localDocs.map((d) => esc(d.name)).join(', ')}. Перенести их в личный кабинет?</p><button type="button" class="btn btn-primary btn-sm" id="migrateLocal">Перенести в кабинет</button></div>`;
    }

    h += `<section class="block docs-block"><div class="block-head"><h2>В работе ${docs.length ? `<span class="count">${docs.length}</span>` : ''}</h2>
      ${docs.length ? `<div class="head-actions"><a class="btn btn-sm" href="#/common">${ICON.reg}Общий реестр · ${nReq}</a><a class="btn btn-sm" href="#/overlaps">${ICON.ov}Пересечения · ${nOv}</a><button type="button" class="btn btn-sm" data-dl="all">${ICON.down}Всё одним архивом</button></div>` : ''}</div>`;
    if (!docs.length) h += `<div class="empty">Документов пока нет.${W.builtinError ? ' Опубликованный регламент не загрузился: откройте приложение по ссылке GitHub Pages, а не двойным щелчком по файлу.' : ''}</div>`;
    else {
      const lv = (e) => { const m = modelOf(e); if (!m || !m.type) return 'none'; return m.type.level ?? 'ext'; };
      const groups = [1, 2, 3, 4, 'ext', 'none'].map((l) => [l, docs.filter((e) => lv(e) === l)]).filter(([, list]) => list.length);
      h += groups.map(([l, list]) => `<div class="lvl-group"><h3 class="lvl-head">${l === 'ext' ? '<span class="lvl-n ext">ВН</span><span>Внешняя документация</span>' : l === 'none' ? '<span class="lvl-n none">?</span><span>Вид документа не определён <span class="muted">— выберите его в карточке документа</span></span>' : `<span class="lvl-n">${l}</span><span>${l} уровень <span class="muted">— ${esc(levelInfo(l).purpose)}</span></span>`}<span class="count">${list.length}</span></h3><div class="doc-cards">${list.map(docCard).join('')}</div></div>`).join('');
    }
    h += `<p class="ws-foot muted">${W.cloud ? `Документы и правки хранятся в базе данных и доступны вам с любого устройства после входа. Другие пользователи их не видят; чтобы передать документ коллеге, скачайте XML или реестр.` : W.storage ? 'Загруженные документы и правки хранятся только в этом браузере. Чтобы передать их коллеге, скачайте XML документа или общий реестр и отправьте файлом — коллега загрузит его у себя.' : '<b>Браузер не разрешает сохранять данные</b> (например, в приватном окне): загруженные документы пропадут после закрытия вкладки.'}${docs.some((d) => !d.builtin) ? ' <button type="button" class="link-btn" id="wsClear">Удалить все загруженные документы</button>' : ''}</p>`;
    h += '</section>';

    h += `<section class="block how"><h2>Как это работает</h2><ol class="steps">
      <li><b>Загрузка.</b> Word и PDF разбираются по нумерации пунктов и заголовкам, таблицы терминов и сводная информация попадают в метаданные. Excel-реестр читается по заголовкам столбцов шаблона V0.1, XML ИСМ открывается как есть.</li>
      <li><b>Разметка.</b> Требование — предложение с модальным словом: «должен», «следует», «необходимо», «не допускается», «рекомендуется». Перечень после «должен включать:» даёт отдельное требование на каждый пункт перечня. Цитата сохраняется дословно.</li>
      <li><b>Реестр.</b> Каждое требование получает карточку: рабочий номер TEMP, выбранный уровень, статус «Черновик», версию 0.1. Владельца, критичность и критерий приёмки назначьте в карточке, кнопка «Изменить».</li>
      <li><b>Пересечения.</b> Требования всех документов общего реестра сравниваются между собой. Почти совпадающие, пересекающиеся и противоречащие по модальности пары выводятся отдельно; ложные отметьте «не дубль».</li>
    </ol></section>`;
    return h;
  }

  function docCard(e) {
    const m = modelOf(e);
    const cur = e.key === S.key;
    if (!m) {
      return `<article class="doc-card bad"><div class="dc-top">${srcBadge(e)}<span class="dc-code">${esc(e.name)}</span></div>
        <p class="integrity-list">Не удалось прочитать: ${esc(e.error)}</p>
        <div class="dc-actions"><span class="sp"></span>${delBtn(e)}</div></article>`;
    }
    const rows = m.reqs.map(registryRow);
    const done = rows.filter((x) => x[17] === 'Готово').length;
    const nClauses = m.clauses.filter((c) => !c.pseudo).length;
    const facts = [];
    if (m.sections.length && e.kind !== 'xlsx') facts.push(pl(m.sections.length, 'раздел', 'раздела', 'разделов'));
    if (nClauses && e.kind !== 'xlsx') facts.push(pl(nClauses, 'пункт', 'пункта', 'пунктов'));
    facts.push(`<b>${pl(m.reqs.length, 'требование', 'требования', 'требований')}</b>`);
    const nSys = m.reqs.filter((r) => r.category === 'system').length;
    if (m.reqs.length) facts.push(`бизнес ${m.reqs.length - nSys}, системных ${nSys}`, `комплектно ${done} из ${m.reqs.length}`);
    const nOv = e.included ? new Set(overlapPairs().filter((p) => p.a.m === m || p.b.m === m).map((p) => p.id)).size : 0;
    const warn = (e.report && e.report.warnings || []).filter(Boolean);
    return `<article class="doc-card${cur ? ' current' : ''}${e.included ? '' : ' excluded'}">
      <div class="dc-top">${srcBadge(e)}<span class="dc-code">${esc(m.id || '—')}</span>${m.version ? `<span class="muted">версия ${esc(m.version)}</span>` : ''}${e.overridden ? '<span class="chip implicit">есть правки</span>' : ''}
        <select class="type-sel" data-doctype="${esc(e.key)}" title="Вид документа" aria-label="Вид документа">${typeOptions(m.typeCode)}</select></div>
      <h3><a href="#/open/${esc(e.key)}">${esc(docTitle(m))}</a></h3>
      <p class="dc-facts">${facts.join(' · ')}${nOv ? ` · <a href="#/overlaps?doc=${esc(e.key)}">пересечения: ${nOv}</a>` : ''}</p>
      ${warn.length ? `<p class="dc-warn" title="${esc(warn.join('\n'))}">${esc(warn[0])}${warn.length > 1 ? ` <span class="muted">и ещё ${warn.length - 1}</span>` : ''}</p>` : ''}
      <p class="dc-src muted">${e.builtin ? 'Опубликован в репозитории, общий для всех по ссылке' : `Из файла «${esc(e.name)}», ${esc(fmtDate(e.addedAt))}`}</p>
      <div class="dc-actions">
        <label class="switch"><input type="checkbox" data-include="${esc(e.key)}"${e.included ? ' checked' : ''}><span class="sw" aria-hidden="true"></span>в общем реестре</label>
        <span class="sp"></span>
        <a class="btn btn-sm btn-primary" href="#/open/${esc(e.key)}">Открыть</a>
        <button type="button" class="btn btn-sm" data-docxml="${esc(e.key)}" title="Скачать XML документа">${ICON.down}XML</button>
        ${e.builtin ? (e.overridden ? `<button type="button" class="btn btn-sm" data-docreset="${esc(e.key)}">Сбросить правки</button>` : '') : delBtn(e)}
      </div>
    </article>`;
  }
  function typeOptions(cur) {
    const groups = [1, 2, 3, 4, null].map((l) => [l, typeList().filter((t) => t.level === l)]);
    return `<option value=""${cur ? '' : ' selected'}>вид не определён</option>${groups.map(([l, list]) => `<optgroup label="${l ? `${l} уровень — ${levelInfo(l).purpose}` : 'Внешняя документация'}">${list.map((t) => `<option value="${t.code}"${t.code === cur ? ' selected' : ''}>${t.code} · ${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}`;
  }
  // Вид документа записывается в XML: metadata/documentType/@code и название вида
  async function setDocType(key, code) {
    const e = entry(key);
    if (!e) return;
    const t = typeByCode(code);
    try {
      const dom = xdom(e);
      const md = kid(dom.documentElement, 'metadata');
      let dt = kid(md, 'documentType');
      if (!dt) { dt = mk(dom, 'documentType'); place(dom, md, dt, kid(md, 'title') ? kid(md, 'title').nextElementSibling : md.firstElementChild); }
      if (code) dt.setAttribute('code', code); else dt.removeAttribute('code');
      dt.textContent = t ? t.name : 'Документ';
      await commitDoc(e, dom);
      toast(t ? `Вид документа: ${t.name}${t.level ? `, ${t.level} уровень` : ''}` : 'Вид документа сброшен');
      rerender();
    } catch (err) { toast('Не удалось изменить вид: ' + err.message, 5000); }
  }
  const delBtn = (e) => `<button type="button" class="btn btn-sm danger" data-docdel="${esc(e.key)}">${S.confirmDel === e.key ? 'Точно удалить?' : 'Удалить'}</button>`;

  function uploadReport() {
    const up = S.upload;
    if (!up) return '';
    const ok = up.items.filter((i) => i.state === 'ok');
    const busy = up.items.some((i) => i.state === 'wait' || i.state === 'work');
    let h = `<div class="up-report"><div class="up-head"><b>${busy ? 'Обрабатываю файлы…' : `Загружено ${ok.length} из ${up.items.length}`}</b>${!busy && ok.length > 1 ? ' <a href="#/common">Открыть общий реестр</a>' : ''}</div><ul>`;
    up.items.forEach((i) => {
      const st = { wait: 'в очереди', work: 'разбираю…', ok: 'готово', err: 'ошибка' }[i.state];
      h += `<li class="up-item ${i.state}"><span class="up-st">${st}</span><span class="up-name">${esc(i.name)}</span><span class="up-msg">${i.msg ? esc(i.msg) : ''}${i.key ? ` <a href="#/open/${esc(i.key)}">Открыть</a>` : ''}</span></li>`;
    });
    return h + '</ul></div>';
  }
  const renderUploadReport = () => { const b = $('#upReport'); if (b) b.innerHTML = uploadReport(); };

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (S.upload && S.upload.items.some((i) => i.state === 'work')) { toast('Дождитесь окончания текущей загрузки', 3000); return; }
    const level = ($('#upLevel') && $('#upLevel').value) || S.upLevel || 'L2';
    const include = $('#upInclude') ? $('#upInclude').checked : S.upInclude !== false;
    S.upLevel = level; S.upInclude = include;
    S.upload = { items: files.map((f) => ({ name: f.name, state: 'wait', msg: '' })) };
    if (parseHash().view !== 'home') location.hash = '#/';
    renderUploadReport();
    const today = ymd();
    let seq = tempStart(today);
    const added = [];
    for (let i = 0; i < files.length; i++) {
      const it = S.upload.items[i];
      it.state = 'work'; renderUploadReport();
      try {
        const res = await window.ISM.convert.fromFile(files[i], { level, tempStart: seq, today });
        if (res.report && res.report.tempNext) seq = res.report.tempNext;
        const key = `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const e = { key, name: files[i].name, kind: res.kind, xml: res.xml, addedAt: Date.now(), included: include, report: res.report || {}, level };
        W.models.delete(key);
        const m = modelOf(e);
        if (!m) throw new Error(e.error);
        const same = W.docs.map(modelOf).filter((x) => x && x.id && x.id === m.id && x.version === m.version);
        if (same.length) e.report.warnings = [...(e.report.warnings || []), `Документ ${m.id} версии ${m.version} уже есть в списке — его требования будут отмечены как почти совпадающие. Лишнюю копию исключите из общего реестра.`];
        W.docs.push(e);
        await persist(e);
        it.state = 'ok'; it.key = key;
        it.msg = `${L.srcLong[res.kind]}: ${res.kind === 'xlsx' ? pl(m.reqs.length, 'карточка', 'карточки', 'карточек') : `${pl(m.sections.length, 'раздел', 'раздела', 'разделов')}, ${pl(m.reqs.length, 'требование', 'требования', 'требований')}`}${(e.report.warnings || []).length ? '. ' + e.report.warnings[0].replace(/\.$/, '') : ''}.`;
        added.push(e);
      } catch (err) {
        it.state = 'err'; it.msg = err.message || String(err);
      }
      renderUploadReport();
    }
    W.tempSeq = { [today]: seq }; saveMeta('tempSeq', W.tempSeq);
    if (added.length) bump();
    if (added.length === 1 && files.length === 1) {
      const m = modelOf(added[0]);
      toast(`Документ добавлен: ${pl(m.reqs.length, 'требование', 'требования', 'требований')}`, 3500);
      openDoc(added[0].key, '#/doc');
    } else if (parseHash().view === 'home') {
      render();
    }
  }

  async function removeDoc(key) {
    const e = entry(key);
    if (!e || e.builtin) return;
    W.docs = W.docs.filter((d) => d !== e);
    W.models.delete(key);
    for (const l of W.links.filter((x) => x.from.startsWith(key + '|') || x.to.startsWith(key + '|'))) await removeLink(l);
    if (W.storage) await store().deleteDoc(key).catch(() => {});
    if (S.key === key) { S.key = ''; S.m = null; if (W.docs[0]) useDoc(W.docs[0].key); }
    bump();
    toast(`Документ «${e.name}» удалён`);
    render();
  }

  /* ---------- Правка XML документа ---------- */
  const REQ_ORDER = ['title', 'statement', 'quote', 'subject', 'action', 'object', 'counterpart', 'owner', 'applicability', 'verification', 'externalReference', 'tags', 'criticalityBasis', 'registry'];
  const ROOT_ORDER = ['metadata', 'scope', 'changeHistory', 'terms', 'roles', 'objects', 'body', 'references', 'semanticLinks', 'editorialNotes'];
  const CLAUSE_ORDER = ['text', 'requirement', 'clause'];
  const xdom = (e) => new DOMParser().parseFromString(e.xml, 'application/xml');
  function serializeDom(dom) {
    const s = new XMLSerializer().serializeToString(dom).replace(/^<\?xml[^>]*\?>\s*/, '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n${s.trimEnd()}\n`;
  }
  function unitOf(dom) {
    for (const n of dom.documentElement.childNodes) {
      if (n.nodeType === 3) { const mm = n.nodeValue.match(/\n([ \t]+)$/); if (mm) return mm[1]; }
    }
    return ' ';
  }
  const depthOf = (el) => { let d = 0; for (let x = el; x.parentNode && x.parentNode.nodeType === 1; x = x.parentNode) d++; return d; };
  function mk(dom, name, attrs = {}, content) {
    const el = dom.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => { if (v !== '' && v != null) el.setAttribute(k, v); });
    if (Array.isArray(content)) content.forEach((c) => el.appendChild(c));
    else if (content != null) el.textContent = content;
    return el;
  }
  function place(dom, parent, el, before) {
    const unit = unitOf(dom);
    const ind = '\n' + unit.repeat(depthOf(parent) + 1);
    if (before) {
      parent.insertBefore(el, before);
      parent.insertBefore(dom.createTextNode(ind), before);
    } else if (parent.firstElementChild) {
      const last = parent.lastChild;
      if (last && last.nodeType === 3 && !last.nodeValue.trim()) { parent.insertBefore(dom.createTextNode(ind), last); parent.insertBefore(el, last); }
      else { parent.appendChild(dom.createTextNode(ind)); parent.appendChild(el); }
    } else {
      while (parent.firstChild && parent.firstChild.nodeType === 3 && !parent.firstChild.nodeValue.trim()) parent.removeChild(parent.firstChild);
      parent.appendChild(dom.createTextNode(ind)); parent.appendChild(el);
      parent.appendChild(dom.createTextNode('\n' + unit.repeat(depthOf(parent))));
    }
  }
  function pretty(dom, el) {
    const list = Array.from(el.children);
    if (!list.length) return;
    const unit = unitOf(dom); const d = depthOf(el);
    Array.from(el.childNodes).forEach((n) => { if (n.nodeType === 3 && !n.nodeValue.trim()) el.removeChild(n); });
    list.forEach((k) => { el.insertBefore(dom.createTextNode('\n' + unit.repeat(d + 1)), k); pretty(dom, k); });
    el.appendChild(dom.createTextNode('\n' + unit.repeat(d)));
  }
  function rm(el) {
    if (!el || !el.parentNode) return;
    const p = el.previousSibling;
    if (p && p.nodeType === 3 && !p.nodeValue.trim()) p.parentNode.removeChild(p);
    el.parentNode.removeChild(el);
  }
  function putOrdered(dom, parent, el, order) {
    const idx = order.indexOf(el.localName);
    const before = Array.from(parent.children).find((c) => order.indexOf(c.localName) > idx) || null;
    place(dom, parent, el, before);
    pretty(dom, el);
  }
  function allIds(dom) {
    const ids = new Set();
    const w = dom.createTreeWalker(dom.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let n = w.currentNode; n; n = w.nextNode()) { const v = n.getAttribute('id'); if (v) ids.add(v); }
    return ids;
  }
  function freshId(dom, prefix) {
    const ids = allIds(dom);
    let n = 1;
    while (ids.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }
  const byIdIn = (dom, name, id) => Array.from(dom.getElementsByTagNameNS(NS, name)).find((x) => x.getAttribute('id') === id) || null;
  // Роль или объект по названию: находит существующий (по имени или синониму) или заводит новый
  function refByName(dom, container, item, prefix, type, name) {
    const root = dom.documentElement;
    let box = kid(root, container);
    const low = name.toLowerCase();
    if (box) {
      for (const it of kids(box, item)) {
        const names = [txt(kid(it, 'name')), ...kids(it, 'alias').map(txt)].map((s) => s.toLowerCase());
        if (names.includes(low)) return attr(it, 'id');
      }
    } else {
      box = mk(dom, container);
      putOrdered(dom, root, box, ROOT_ORDER);
    }
    const id = freshId(dom, prefix);
    const it = mk(dom, item, { id, type }, [mk(dom, 'name', {}, name)]);
    place(dom, box, it, null);
    pretty(dom, it);
    return id;
  }
  const methodCode = (text) => {
    const low = text.toLowerCase();
    const hit = Object.entries(REG_METHOD).find(([, v]) => v.toLowerCase() === low) || Object.entries(L.verification).find(([, v]) => v.toLowerCase() === low);
    return hit ? hit[0] : text;
  };

  // Записывает поля карточки в элемент <requirement>
  function applyCard(dom, reqEl, d, orig) {
    const setOne = (name, build) => { kids(reqEl, name).forEach(rm); const el = build(); if (el) putOrdered(dom, reqEl, el, REQ_ORDER); };
    setOne('title', () => (d.title ? mk(dom, 'title', {}, d.title) : null));
    let st = kid(reqEl, 'statement');
    if (!st) { st = mk(dom, 'statement'); putOrdered(dom, reqEl, st, REQ_ORDER); }
    st.textContent = d.statement;
    setOne('quote', () => (d.quote ? mk(dom, 'quote', {}, d.quote) : null));

    if (d.object !== orig.object) {
      const first = kid(reqEl, 'object');
      const ref = d.object ? refByName(dom, 'objects', 'object', 'OBJ-U', 'object', d.object) : '';
      if (first) { if (ref) first.setAttribute('ref', ref); else rm(first); }
      else if (ref) putOrdered(dom, reqEl, mk(dom, 'object', { ref }), REQ_ORDER);
    }
    const status = d.confirmed ? 'confirmed' : 'preliminary';
    if (d.owner) { const ref = refByName(dom, 'roles', 'role', 'ROLE-U', 'org-unit', d.owner); setOne('owner', () => mk(dom, 'owner', { ref, status })); }
    else kids(reqEl, 'owner').forEach(rm);
    if (d.conditions.join('\n') !== orig.conditions.join('\n')) {
      setOne('applicability', () => (d.conditions.length ? mk(dom, 'applicability', {}, d.conditions.map((c) => mk(dom, 'condition', {}, c))) : null));
    }
    let v = kid(reqEl, 'verification');
    const hasChecks = v && kids(v, 'check').length;
    if (!v && (d.method || d.criterion)) { v = mk(dom, 'verification', { method: '' }); putOrdered(dom, reqEl, v, REQ_ORDER); v.setAttribute('method', ''); }
    if (v) {
      if (d.method !== orig.method) v.setAttribute('method', methodCode(d.method));
      kids(v, 'criterion').forEach(rm);
      if (d.criterion) { const c = mk(dom, 'criterion', {}, d.criterion); const first = v.firstElementChild; place(dom, v, c, first); }
      if (!d.method && !d.criterion && !hasChecks) rm(v);
    }
    if (d.crit) reqEl.setAttribute('criticality', d.crit); else reqEl.removeAttribute('criticality');
    setOne('criticalityBasis', () => (d.critBasis ? mk(dom, 'criticalityBasis', { status }, d.critBasis) : null));
    reqEl.setAttribute('modality', d.modality);
    if (d.category) {
      reqEl.setAttribute('category', d.category);
      reqEl.setAttribute('categoryStatus', d.category !== orig.category || orig.catConfirmed ? 'confirmed' : 'preliminary');
    }
    const found = window.ISM.convert.modalityOf(d.statement);
    reqEl.setAttribute('modalityBasis', found === d.modality ? 'explicit' : 'implicit');
    if (d.quote) reqEl.setAttribute('source', norm(d.quote) === norm(d.statement) ? 'authoritative' : 'derived');
    else reqEl.removeAttribute('source');

    let rg = kid(reqEl, 'registry');
    if (!rg) { rg = mk(dom, 'registry'); putOrdered(dom, reqEl, rg, REQ_ORDER); }
    [['id', d.regId], ['level', d.level], ['status', d.status], ['version', d.version], ['effective', d.effective], ['evidence', d.evidence]]
      .forEach(([k, val]) => { if (val) rg.setAttribute(k, val); else rg.removeAttribute(k); });
    kids(rg, 'remark').forEach(rm);
    if (d.remark) place(dom, rg, mk(dom, 'remark', {}, d.remark), null);
  }

  function deleteReqEl(dom, id) {
    rm(byIdIn(dom, 'requirement', id));
    const root = dom.documentElement;
    const sl = kid(root, 'semanticLinks');
    if (sl) { kids(sl, 'link').filter((l) => attr(l, 'from') === id || attr(l, 'to') === id).forEach(rm); if (!sl.firstElementChild) rm(sl); }
    const en = kid(root, 'editorialNotes');
    if (en) { kids(en, 'note').filter((n) => attr(n, 'target') === id).forEach(rm); if (!en.firstElementChild) rm(en); }
  }

  async function commitDoc(e, dom) {
    const xml = serializeDom(dom);
    let m;
    try { m = parseModel(xml, e.builtin ? W.builtinUrl : location.href); } catch (err) { throw new Error('после правки XML стал некорректным: ' + err.message); }
    e.xml = xml;
    if (e.builtin) e.overridden = true;
    m.key = e.key; m.entry = e;
    W.models.set(e.key, m);
    await persist(e);
    bump();
    if (S.key === e.key) { S.m = m; renderToc(); }
    renderSidebar();
  }

  /* ---------- Редактор карточки ---------- */
  function guessStatement(c) {
    if (!c || !c.text) return '';
    const sents = window.ISM.convert.sentences(c.text);
    const modal = sents.find((s) => window.ISM.convert.modalityOf(s));
    if (modal) return modal;
    return c.text.length <= 400 ? c.text : '';
  }
  function openEditor({ key, reqId = '', clauseId = '' }) {
    const e = entry(key);
    const m = modelOf(e);
    if (!m) return;
    const r = reqId ? m.byId.get(reqId) : null;
    const c = r ? r.clause : m.byId.get(clauseId);
    if (!r && !c) { toast('Пункт не найден', 4000); return; }
    const isNew = !r;
    const levels = m.reqs.map((x) => x.registry && x.registry.level).filter(Boolean);
    const topLevel = levels.sort((a, b) => levels.filter((x) => x === b).length - levels.filter((x) => x === a).length)[0] || e.level || 'L2';
    const g = (r && r.registry) || {};
    const st = isNew ? guessStatement(c) : r.statement;
    const val = {
      title: r ? r.title : '', statement: st, quote: r ? r.quote : (c.text && c.text.includes(st) ? st : ''),
      modality: r ? r.modality : (window.ISM.convert.modalityOf(st) || 'shall'), crit: r ? r.criticality : '',
      critBasis: r && r.critBasis ? r.critBasis.text : '', confirmed: !!(r && r.owner && r.owner.status === 'confirmed'),
      object: r && r.objects.length ? nameOf(r.objects[0], m) : '', owner: r && r.owner ? nameOf(r.owner.ref, m) : '',
      conditions: r ? r.conditions : [], method: r ? methodText(r.verification) : '', criterion: r && r.verification ? r.verification.criterion : '',
      regId: g.id || '', level: g.level || topLevel, status: g.status || 'draft', version: g.version || '0.1', effective: g.effective || '', evidence: g.evidence || '', remark: g.remark || '',
      category: r ? r.category : window.ISM.convert.categoryOf(st), catConfirmed: !!(r && !r.catAuto && r.categoryStatus === 'confirmed'),
    };
    const links = r ? linksOf(r).filter((l) => l.from === uk(r) && l.relation === 'derives').map((l) => l.to) : [];
    S.edit = { key, reqId: r ? r.id : '', clauseId: c ? c.id : '', orig: val, isNew, links, linksOrig: links.slice() };
    S.confirmDel = '';
    const opt = (list, cur) => list.map(([k, t]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const methods = [...new Set([...Object.values(REG_METHOD), ...METHOD_HINTS, ...m.reqs.map((x) => methodText(x.verification)).filter(Boolean)])];
    const need = '<i class="need" title="Нужно для комплектности карточки">●</i>';
    const miss = r ? regMissing(registryRow(r)) : [];
    const dlg = $('#editor');
    dlg.innerHTML = `<form id="edForm" novalidate>
      <header class="ed-head"><div><h2>${isNew ? 'Новое требование' : 'Карточка требования'}</h2><p>${srcBadge(e)} ${esc(docName(m))} · ${esc(c ? cite(c) : '')}${r ? ` · <span class="req-id">${esc(r.id)}</span>` : ''}</p></div>
        <button type="button" class="icon-x" data-edclose aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
      <div class="ed-body">
        ${c && c.text ? `<details class="ed-src"${isNew ? ' open' : ''}><summary>Текст пункта ${esc(cite(c))}</summary><p>${esc(c.text)}</p></details>` : ''}
        <p class="ed-need">${need} — поля, без которых карточка в реестре остаётся «Заполнить».${r ? (miss.length ? ` Сейчас не хватает: <b>${esc(miss.join(', '))}</b>.` : ' <b class="ok">Карточка комплектна.</b>') : ''}</p>
        <label class="fld wide"><span>Атомарная формулировка${need}</span><textarea name="statement" rows="3" required>${esc(val.statement)}</textarea></label>
        <label class="fld wide"><span>Дословная цитата из пункта</span><textarea name="quote" rows="2">${esc(val.quote)}</textarea><small id="edQuoteHelp">Фрагмент текста пункта без изменений — по нему проверяется связь требования с текстом.</small></label>
        <label class="fld wide"><span>Наименование карточки${need}</span><input name="title" value="${esc(val.title)}" placeholder="Кратко: о чём требование"></label>
        <div class="fld-row four">
          <label class="fld"><span>Модальность</span><select name="modality">${opt(Object.entries(L.modality), val.modality)}</select></label>
          <label class="fld"><span>Тип требования</span><select name="category">${opt(Object.entries(CAT), val.category)}</select>${val.catConfirmed ? '' : '<small>определён автоматически</small>'}</label>
          <label class="fld"><span>Критичность${need}</span><select name="crit"><option value="">не назначена</option>${opt(Object.entries(L.criticality).map(([k, t]) => [k, `${k} — ${t.replace(' невыполнения', '')}`]), val.crit)}</select></label>
          <label class="fld"><span>Уровень${need}</span><select name="level">${opt(Object.entries(L.level).map(([k, t]) => [k, `${k} — ${t}`]), val.level)}</select></label>
        </div>
        <div class="fld-row two">
          <label class="fld"><span>Объект требования${need}</span><input name="object" list="dlObjects" value="${esc(val.object)}" placeholder="К чему относится"></label>
          <label class="fld"><span>Владелец требования${need}</span><input name="owner" list="dlRoles" value="${esc(val.owner)}" placeholder="Подразделение или роль"></label>
        </div>
        <label class="fld wide"><span>Обоснование критичности</span><input name="critBasis" value="${esc(val.critBasis)}" placeholder="Какие последствия у невыполнения"></label>
        <label class="chk wide"><input type="checkbox" name="confirmed"${val.confirmed ? ' checked' : ''}> Владелец и критичность подтверждены владельцем требования</label>
        <label class="fld wide"><span>Область / условия применения${need}</span><textarea name="conditions" rows="2" placeholder="Каждое условие с новой строки">${esc(val.conditions.join('\n'))}</textarea></label>
        <div class="fld-row two">
          <label class="fld"><span>Метод верификации${need}</span><input name="method" list="dlMethods" value="${esc(val.method)}"></label>
          <label class="fld"><span>Критерий приёмки${need}</span><input name="criterion" value="${esc(val.criterion)}" placeholder="Когда требование считается выполненным"></label>
        </div>
        <fieldset class="ed-links"><legend>Основание — требования вышестоящих документов</legend><div id="edLinks">${edLinksHtml()}</div></fieldset>
        <fieldset class="ed-reg"><legend>Карточка реестра</legend>
          <div class="fld-row">
            <label class="fld"><span>ID карточки</span><input name="regId" value="${esc(val.regId)}" placeholder="${isNew ? 'TEMP присвоится при сохранении' : ''}"></label>
            <label class="fld"><span>Статус${need}</span><select name="status">${opt(Object.entries(L.regStatus), val.status)}</select></label>
            <label class="fld"><span>Версия</span><input name="version" value="${esc(val.version)}"></label>
          </div>
          <div class="fld-row two">
            <label class="fld"><span>Дата вступления</span><input type="date" name="effective" value="${esc(val.effective)}"></label>
            <label class="fld"><span>Ссылка на подтверждение</span><input name="evidence" value="${esc(val.evidence)}"></label>
          </div>
          <label class="fld wide"><span>Разногласия / примечание</span><textarea name="remark" rows="2">${esc(val.remark)}</textarea></label>
        </fieldset>
        <datalist id="dlObjects">${m.objects.map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
        <datalist id="dlRoles">${m.roles.map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
        <datalist id="dlMethods">${methods.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <p class="ed-err" id="edErr" hidden></p>
      </div>
      <footer class="ed-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" id="edDelete">Удалить<span class="hide-sm"> требование</span></button>'}
        <span class="sp"></span>
        ${e.builtin && !e.overridden ? '<span class="muted ed-note">Правка сохранится только в этом браузере</span>' : ''}
        <button type="button" class="btn" data-edclose>Отмена</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Добавить' : 'Сохранить'}</button>
      </footer>
    </form>`;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    const first = dlg.querySelector(isNew ? '[name="statement"]' : '[name="owner"]');
    if (first) first.focus();
  }
  // Кандидаты в основания: требования документов выше по иерархии (и внешняя документация)
  function basisDocs(m) {
    if (m.typeCode === 'EXT') return [];
    const lvl = levelOf(m);
    return models().filter((x) => x !== m && (!m.type || x.typeCode === 'EXT' || (levelOf(x) && levelOf(x) < lvl)));
  }
  function suggestBasis(stmt, cands, n = 5, min = 0.2) {
    if (!stmt || !cands.length) return [];
    const items = [{ key: '__self', text: stmt }, ...cands.map((r) => ({ key: uk(r), text: r.statement }))];
    return window.ISM.overlap.findPairs(items, { minScore: min }).filter((p) => p.a === '__self' || p.b === '__self')
      .slice(0, n).map((p) => ({ key: p.a === '__self' ? p.b : p.a, score: p.score }));
  }
  function edLinksHtml() {
    const ed = S.edit;
    const m = modelOf(entry(ed.key));
    const docs = basisDocs(m);
    const cur = ed.links.map((k) => reqByUk(k)).filter(Boolean);
    let h = cur.length
      ? `<ul class="link-list">${cur.map((t) => `<li><span class="lk-doc">${srcBadge(t.m.entry)}<b>${esc(docName(t.m))}</b> ${esc(reqCite(t))}${t.registry && t.registry.id ? ` · <span class="req-id">${esc(t.registry.id)}</span>` : ''}</span><span class="lk-text">${esc(t.statement)}</span><button type="button" class="icon-x sm" data-unlink="${esc(uk(t))}" aria-label="Убрать основание"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`).join('')}</ul>`
      : '<p class="muted lk-empty">Оснований нет.</p>';
    if (!docs.length) {
      return h + `<p class="muted lk-empty">${m.typeCode === 'EXT' ? 'Внешняя документация — верх иерархии, оснований у неё нет.' : `Выше по иерархии документов нет. Загрузите ${levelOf(m) === 1 ? 'внешний документ (закон, ГОСТ)' : 'положение, стандарт, регламент или политику'}, чтобы связать требования.`}</p>`;
    }
    const cands = docs.flatMap((x) => x.reqs).filter((t) => !ed.links.includes(uk(t)));
    const stmt = ($('#edForm [name="statement"]') && $('#edForm [name="statement"]').value) || ed.orig.statement;
    const sug = suggestBasis(stmt, cands);
    const short = (t) => `${reqCite(t)} — ${t.statement.length > 90 ? t.statement.slice(0, 88) + '…' : t.statement}`;
    h += `<div class="lk-add"><select id="edLinkSel" aria-label="Требование-основание"><option value="">Выберите требование вышестоящего документа…</option>
      ${sug.length ? `<optgroup label="Похожие по формулировке">${sug.map((x) => { const t = reqByUk(x.key); return `<option value="${esc(x.key)}">${Math.round(x.score * 100)} % · ${esc(docName(t.m))} ${esc(short(t))}</option>`; }).join('')}</optgroup>` : ''}
      ${docs.map((x) => `<optgroup label="${esc(`${x.type ? x.type.code + ' · ' : ''}${docName(x)} — ${docTitle(x)}`.slice(0, 90))}">${x.reqs.filter((t) => !ed.links.includes(uk(t))).map((t) => `<option value="${esc(uk(t))}">${esc(short(t))}</option>`).join('')}</optgroup>`).join('')}
      </select><button type="button" class="btn btn-sm" id="edLinkAdd">Добавить</button></div>
      <small class="muted">Нижестоящее требование выводится из вышестоящего и реализует его. Связи видны на графе требований.</small>`;
    return h;
  }
  function closeEditor() {
    const dlg = $('#editor');
    if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
    S.edit = null;
  }
  async function saveEditor() {
    const ed = S.edit;
    if (!ed) return;
    const form = $('#edForm');
    const fd = new FormData(form);
    const g = (k) => norm(fd.get(k));
    const d = {
      title: g('title'), statement: g('statement'), quote: g('quote'), modality: g('modality'), crit: g('crit'), critBasis: g('critBasis'),
      confirmed: fd.get('confirmed') === 'on', object: g('object'), owner: g('owner'),
      conditions: String(fd.get('conditions') || '').split('\n').map(norm).filter(Boolean), method: g('method'), criterion: g('criterion'),
      regId: g('regId'), level: g('level'), status: g('status'), version: g('version'), effective: g('effective'), evidence: g('evidence'), remark: g('remark'),
      category: g('category'),
    };
    const err = (msg, field) => { const b = $('#edErr'); b.textContent = msg; b.hidden = false; if (field) form.querySelector(`[name="${field}"]`).focus(); };
    if (!d.statement) return err('Заполните атомарную формулировку.', 'statement');
    const e = entry(ed.key);
    const m = modelOf(e);
    const c = m.byId.get(ed.clauseId);
    if (d.quote && c && c.textEl && !c.text.includes(d.quote)) return err('Цитата не найдена в тексте пункта дословно. Скопируйте фрагмент из текста пункта (он показан вверху) или очистите поле.', 'quote');
    if (d.effective && !/^\d{4}-\d{2}-\d{2}$/.test(d.effective)) return err('Дата вступления должна быть датой.', 'effective');
    try {
      const dom = xdom(e);
      let reqEl;
      if (ed.reqId) {
        reqEl = byIdIn(dom, 'requirement', ed.reqId);
        if (!reqEl) throw new Error('требование не найдено в XML');
      } else {
        const clEl = byIdIn(dom, 'clause', ed.clauseId);
        if (!clEl) throw new Error('пункт не найден в XML');
        const base = `REQ-${(m.id || 'DOC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[^\p{L}_]+/u, '')}-U`;
        const number = c.label ? `${c.parent ? c.parent.number : ''} ${c.label}`.trim() : c.number;
        reqEl = mk(dom, 'requirement', { id: freshId(dom, base), number, modality: d.modality }, [mk(dom, 'statement', {}, d.statement)]);
        putOrdered(dom, clEl, reqEl, CLAUSE_ORDER);
        if (!d.regId) d.regId = nextTemp();
      }
      applyCard(dom, reqEl, d, ed.orig);
      const newId = reqEl.getAttribute('id');
      await commitDoc(e, dom);
      const from = `${e.key}|${newId}`;
      for (const t of ed.linksOrig.filter((x) => !ed.links.includes(x))) await removeLink({ from, to: t, relation: 'derives' });
      for (const t of ed.links.filter((x) => !ed.linksOrig.includes(x))) await addLink({ from, to: t, relation: 'derives' });
      closeEditor();
      toast(ed.isNew ? 'Требование добавлено' : 'Карточка сохранена');
      if (ed.isNew && S.key === e.key) S.openAtoms.add(ed.clauseId);
      rerender();
      if (ed.isNew) S.lastAdded = newId;
    } catch (ex) {
      err('Не удалось сохранить: ' + ex.message);
    }
  }
  async function deleteFromEditor() {
    const ed = S.edit;
    if (!ed || !ed.reqId) return;
    const btn = $('#edDelete');
    if (S.confirmDel !== ed.reqId) { S.confirmDel = ed.reqId; btn.textContent = 'Точно удалить?'; return; }
    try {
      const e = entry(ed.key);
      const dom = xdom(e);
      deleteReqEl(dom, ed.reqId);
      await commitDoc(e, dom);
      const k = `${e.key}|${ed.reqId}`;
      for (const l of W.links.filter((x) => x.from === k || x.to === k)) await removeLink(l);
      closeEditor();
      toast('Требование удалено');
      rerender();
    } catch (ex) { $('#edErr').textContent = 'Не удалось удалить: ' + ex.message; $('#edErr').hidden = false; }
  }

  /* ---------- Вид: роли ---------- */
  function viewRoles() {
    const m = M();
    const resp = m.reqs.filter((r) => r.subject && r.action);
    const actions = [];
    resp.forEach((r) => { if (!actions.some((a) => a.code === r.action.code)) actions.push(r.action); });
    const actors = m.roles.filter((ro) => resp.some((r) => r.subject === ro.id));

    let h = '<div class="page-head"><div><h1>Роли</h1><p>Кто что делает по документу и кто владеет требованиями. Собрано из атомарных требований и связей.</p></div></div>';
    if (actors.length) {
      h += '<section class="block"><h2>Кто что делает</h2><div class="table-wrap"><table class="grid matrix"><thead><tr><th>Роль</th>';
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
        h += `<p style="margin:0 0 6px"><b>Владелец ${pl(owns.length, 'требования', 'требований', 'требований')}</b>${cc.length ? ` (${cc.map(([c, n]) => `${c}: ${n}`).join(', ')})` : ''}. <a href="#/registry?owner=${esc(ro.id)}">Открыть в реестре</a></p>`;
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
    let h = '<div class="page-head"><div><h1>Объекты</h1><p>Над чем выполняются требования: документы, их части, системы, понятия.</p></div></div>';
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
        if (using.length) lines.push(`<a href="#/req?object=${esc(o.id)}">${pl(using.length, 'требование', 'требования', 'требований')}</a>: ${cites.map((r) => `<a href="#/req/${esc(r.id)}">${esc(reqCite(r))}</a>`).join(', ')}`);
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
    if (!m.links.length) return h + '<div class="empty">Связей в документе нет.</div>';
    h += '<div class="table-wrap wide"><table class="grid"><thead><tr><th>От</th><th style="width:18%">Связь</th><th>К</th><th style="width:16%">Основание</th></tr></thead><tbody>';
    list.forEach((l) => {
      h += `<tr><td>${refLink(l.from)}</td><td>${esc(L.relation[l.relation] || l.relation)}<div class="muted"><code>${esc(l.relation)}</code></div></td><td>${refLink(l.to)}</td><td>${l.clause ? refLink(l.clause) : '<span class="muted">—</span>'}</td></tr>`;
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- Вид: замечания ---------- */
  function viewNotes() {
    const m = M();
    let h = `<div class="page-head"><div><h1>Замечания к документу</h1><p>Выявлены при переводе документа в XML. Это не часть нормативного текста, а вопросы к разработчикам и методологу ИСМ.</p></div></div>`;
    if (!m.notes.length) return h + '<div class="empty">Замечаний нет.</div>';
    m.notes.forEach((n) => {
      h += `<div class="note" id="${esc(n.id)}"><div class="note-head"><b>${esc(L.noteType[n.type] || n.type)}</b><span>${esc(n.id)}</span>${n.target ? `<span>к объекту: ${refLink(n.target)}</span>` : ''}</div><p>${esc(n.text)}</p></div>`;
    });
    return h;
  }

  /* ---------- Вид: проверка ---------- */
  const CL_KEY = () => (S.key === BUILTIN ? `ism-checklist:${M().id}:${M().version}` : `ism-checklist:${S.key}`);
  function loadChecks() { try { return JSON.parse(localStorage.getItem(CL_KEY()) || '{}'); } catch { return {}; } }
  function saveChecks(o) { try { localStorage.setItem(CL_KEY(), JSON.stringify(o)); } catch { /* хранилище недоступно */ } }
  const autoReqs = () => M().reqs.filter((r) => r.verification && r.verification.checks.length);
  const manualReqs = () => M().reqs.filter((r) => !(r.verification && r.verification.checks.length) && r.rkind !== 'document-control');

  function viewCheck() {
    const auto = autoReqs();
    const manual = manualReqs();
    let h = auto.length
      ? '<div class="page-head"><div><h1>Проверка функциональной модели</h1><p>Автоматическая проверка BPMN-схемы из графической части ФМ и чек-лист для остальных требований.</p></div></div>'
      : '<div class="page-head"><div><h1>Чек-лист проверки</h1><p>Отмечайте требования документа, выполнение которых проверено. Удобно для экспертизы и внутреннего аудита.</p></div></div>';

    if (auto.length) {
      h += `<section class="block"><h2>Схема процесса в BPMN</h2>
        <p class="lead">Загрузите файл .bpmn (BPMN 2.0 XML из Camunda Modeler, bpmn.io и других редакторов). Проверяются ${pl(auto.length, 'требование', 'требования', 'требований')} ${[...new Set(auto.map(reqCite))].join(', ')}. Файл обрабатывается в браузере и никуда не отправляется.</p>
        <label class="drop" id="drop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4h14v-4"/></svg>
          <b>Перетащите файл .bpmn сюда или выберите на компьютере</b><span class="muted">Можно и .xml, если внутри BPMN 2.0</span>
          <input type="file" id="bpmnFile" accept=".bpmn,.xml,application/xml,text/xml"></label>
        <p class="samples">Нет схемы под рукой? Попробуйте пример: <button type="button" class="link-btn" data-sample="examples/fm-process-errors.bpmn">схема с ошибками</button> или <button type="button" class="link-btn" data-sample="examples/fm-process-ok.bpmn">схема без ошибок</button>.</p>
        <div class="check-res" id="checkRes">${S.bpmn ? bpmnResults(S.bpmn) : ''}</div></section>`;
    }
    if (!manual.length) return h + '<div class="empty">Требований для чек-листа нет.</div>';
    const done = loadChecks();
    const n = manual.filter((r) => done[r.id]).length;
    h += `<section class="block"><h2>${auto.length ? 'Чек-лист экспертизы' : 'Требования'}</h2>
      <p class="lead">${auto.length ? 'Эти требования машиной не проверяются. ' : ''}Отмечайте выполненные. Отметки хранятся только в этом браузере.</p>
      <div class="progress" aria-hidden="true"><span style="width:${manual.length ? Math.round((n / manual.length) * 100) : 0}%"></span></div>
      <div class="result-line" style="margin-top:4px;max-width:860px"><span id="clCount">Отмечено ${n} из ${manual.length}</span>
        <span style="display:flex;gap:8px"><button type="button" class="btn btn-sm" id="clCopy">Скопировать отчёт</button><button type="button" class="btn btn-sm" id="clReset">Сбросить отметки</button></span></div>
      <div class="checklist">`;
    let lastSec = null;
    manual.forEach((r) => {
      const top = topSection(r.section);
      if (top !== lastSec) { h += `<div class="cl-group">${esc(top.skind === 'appendix' ? top.number : top.number ? top.number + '.' : '')} ${esc(top.title)}</div>`; lastSec = top; }
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
    autoReqs().forEach((r) => {
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

  /* ---------- Боковая панель, вкладки, меню документов, поиск ---------- */
  function renderToc() {
    const m = M();
    const toc = $('#toc');
    if (!m) { toc.innerHTML = ''; return; }
    const li = (s, lvl) => {
      const isApp = s.skind === 'appendix';
      const n = isApp ? '' : s.number;
      const t = isApp ? `${s.number}. ${s.title}` : s.title;
      const subs = s.items.filter((i) => i.kind === 'section');
      return `<li><a href="#/doc/${esc(s.id)}" data-toc="${esc(s.id)}"${!n ? ' class="nonum"' : ''}>${n ? `<span class="n">${esc(n)}</span>` : ''}<span>${esc(t)}</span></a>${subs.length && lvl < 2 ? `<ol>${subs.map((x) => li(x, lvl + 1)).join('')}</ol>` : ''}</li>`;
    };
    let h = `<p class="toc-title">Содержание: ${esc(docName(m))}</p><ol>`;
    if (m.changes.length) h += '<li><a href="#/doc/changes" data-toc="changes" class="nonum"><span>Регистрация изменений</span></a></li>';
    h += m.body.map((s) => li(s, 1)).join('') + '</ol>';
    toc.innerHTML = h;
  }

  function renderSidebar(view = parseHash().view) {
    const box = $('#wsnav');
    if (!box) return;
    const isWs = !!WS_VIEWS[view] || !S.m;
    const cur = (v) => (isWs && view === v ? ' aria-current="page"' : '');
    const nOv = W.docs.length ? overlapPairs().length : 0;
    let h = `<nav class="ws-nav" aria-label="Рабочее пространство">
      <a href="#/"${cur('home')}>${ICON.docs}<span>Документы</span><span class="count">${W.docs.length}</span></a>
      <a href="#/common"${cur('common')}>${ICON.reg}<span>Общий реестр</span><span class="count">${commonList().length}</span></a>
      <a href="#/graph"${cur('graph')}>${ICON.graph}<span>Граф требований</span><span class="count">${W.links.length || ''}</span></a>
      <a href="#/overlaps"${cur('overlaps')}>${ICON.ov}<span>Пересечения</span><span class="count${nOv ? ' hot' : ''}">${nOv}</span></a>
    </nav>`;
    if (W.docs.length) {
      h += '<p class="toc-title">Документы</p><ul class="doc-list">';
      W.docs.forEach((e) => {
        const m = modelOf(e);
        const on = !isWs && e.key === S.key;
        h += `<li><a href="#/open/${esc(e.key)}"${on ? ' aria-current="page"' : ''} class="${e.included ? '' : 'excluded'}" title="${esc(m ? docTitle(m) : e.name)}">${srcBadge(e)}<span class="dl-name"><b>${esc(m ? docName(m) : e.name)}</b><span>${esc(m ? docTitle(m) : e.error || '')}</span></span><span class="count">${m ? m.reqs.length : '!'}</span></a></li>`;
      });
      h += '</ul>';
    }
    h += `<label class="side-upload">${ICON.up}<span>Загрузить документы</span><input type="file" class="up-input" multiple accept="${ACCEPT}"></label>`;
    box.innerHTML = h;
    $('#toc').hidden = isWs;
  }

  function renderDocMenu(isWs) {
    const sum = $('#docMenu summary');
    const m = M();
    sum.innerHTML = !isWs && m
      ? `${srcBadge(m.entry)}<span class="dp-name"><b>${esc(docName(m))}</b><span>${esc(docTitle(m))}</span></span>${ICON.chev}`
      : `<span class="dp-name"><b>Все документы</b><span>${pl(W.docs.length, 'документ', 'документа', 'документов')} в работе</span></span>${ICON.chev}`;
    let h = '<p class="menu-cap">Открыть документ</p>';
    W.docs.forEach((e) => {
      const dm = modelOf(e);
      h += `<a role="menuitem" class="dm-item${!isWs && e.key === S.key ? ' on' : ''}" href="#/open/${esc(e.key)}">${srcBadge(e)}<span><b>${esc(dm ? docName(dm) : e.name)}</b><span>${esc(dm ? docTitle(dm) : e.error)}${dm ? ` · ${pl(dm.reqs.length, 'требование', 'требования', 'требований')}` : ''}</span></span></a>`;
    });
    h += `<hr><label class="menu-file dm-add" role="menuitem">${ICON.up}<span><b>Загрузить документы</b><span>Word, PDF, Excel-реестр или XML ИСМ</span></span><input type="file" class="up-input" multiple accept="${ACCEPT}"></label>
      <a role="menuitem" class="dm-item" href="#/">${ICON.docs}<span><b>Все документы</b><span>список, загрузка, настройки общего реестра</span></span></a>
      <a role="menuitem" class="dm-item" href="#/common">${ICON.reg}<span><b>Общий реестр</b><span>${pl(commonList().length, 'карточка', 'карточки', 'карточек')} из ${pl(includedModels().length, 'документа', 'документов', 'документов')}</span></span></a>`;
    $('#docMenuPanel').innerHTML = h;
  }

  function renderDlMenu(isWs) {
    const m = M();
    let h = '';
    if (!isWs && m) {
      h += `<p class="menu-cap">${esc(docName(m))}</p>
        <button type="button" role="menuitem" data-dl="xml"><b>XML документа</b><span>${esc(xmlFileName(m.entry))}</span></button>
        <button type="button" role="menuitem" data-dl="xlsx"${m.reqs.length ? '' : ' disabled'}><b>Реестр документа (Excel)</b><span>карточки в формате мастер-реестра, столбцы A–R</span></button>
        <button type="button" role="menuitem" data-dl="zip"><b>Комплект документа архивом</b><span>XML, XSD, XSLT${m.entry.builtin ? ', рисунки' : ''} и build.bat для Windows</span></button><hr>`;
    }
    const n = commonList().length;
    h += `<p class="menu-cap">Общий реестр</p>
      <button type="button" role="menuitem" data-dl="cxlsx"${n ? '' : ' disabled'}><b>Общий реестр (Excel)</b><span>${pl(n, 'карточка', 'карточки', 'карточек')} всех документов реестра</span></button>
      <button type="button" role="menuitem" data-dl="cxml"${n ? '' : ' disabled'}><b>Общий реестр (XML ИСМ)</b><span>один документ, раздел на каждый источник</span></button>
      <button type="button" role="menuitem" data-dl="all"${W.docs.length ? '' : ' disabled'}><b>Всё одним архивом</b><span>XML всех документов, общий реестр, XSD и XSLT</span></button><hr>
      <p class="menu-cap">Модель данных</p>
      <button type="button" role="menuitem" data-dl="xsd"><b>XSD-схема</b><span>ism-regulation-v1.xsd, проверка XML</span></button>
      <button type="button" role="menuitem" data-dl="xsl"><b>XSLT-представление</b><span>ism-regulation-view.xsl, HTML из XML без приложения</span></button>`;
    $('#dlPanel').innerHTML = h;
  }

  function renderTabs(view, isWs) {
    let tabs;
    if (isWs) {
      tabs = [['home', '#/', 'Документы', W.docs.length], ['common', '#/common', 'Общий реестр', commonList().length], ['graph', '#/graph', 'Граф требований', ''], ['overlaps', '#/overlaps', 'Пересечения', W.docs.length ? overlapPairs().length : 0]];
    } else {
      const m = M();
      const hasAuto = m.reqs.some((r) => r.verification && r.verification.checks.length);
      tabs = [
        ['doc', '#/doc', 'Документ', ''],
        ['req', '#/req', 'Требования', m.reqs.length],
        ['registry', '#/registry', 'Реестр', m.reqs.length],
        m.roles.length ? ['roles', '#/roles', 'Роли', m.roles.length] : null,
        m.objects.length ? ['objects', '#/objects', 'Объекты', m.objects.length] : null,
        m.links.length ? ['links', '#/links', 'Связи', m.links.length] : null,
        m.reqs.length ? ['check', '#/check', hasAuto ? 'Проверка ФМ' : 'Чек-лист', ''] : null,
        m.notes.length ? ['notes', '#/notes', 'Замечания', m.notes.length] : null,
      ].filter(Boolean);
    }
    $('#tabs').innerHTML = tabs.map(([k, href, t, c]) => `<a class="tab" href="${href}"${view === k ? ' aria-current="page"' : ''}>${t}${c !== '' ? `<span class="count">${c}</span>` : ''}</a>`).join('');
    $('#tabs').classList.toggle('ws', isWs);
  }

  function indexOf(m) {
    if (m.index) return m.index;
    const idx = [];
    m.clauses.forEach((c) => { if (c.text) idx.push({ g: 'Пункты', t: cite(c), body: c.text, view: 'doc', id: c.id }); });
    m.reqs.forEach((r) => idx.push({ g: 'Требования', t: `${reqCite(r)}: ${r.title || r.statement}`, body: `${r.title} ${r.statement} ${r.quote} ${r.id} ${r.registry ? r.registry.id : ''}`, view: 'req', id: r.id }));
    m.terms.forEach((t) => idx.push({ g: 'Термины', t: t.name + (t.abbr ? ` (${t.abbr})` : ''), body: `${t.name} ${t.abbr} ${t.def}`, view: 'doc', id: t.id }));
    m.roles.forEach((r) => idx.push({ g: 'Роли и объекты', t: r.name, body: `${r.name} ${r.aliases.join(' ')}`, view: 'roles', id: r.id }));
    m.objects.forEach((o) => idx.push({ g: 'Роли и объекты', t: o.name, body: `${o.name} ${o.aliases.join(' ')} ${o.description} ${o.codes.map((c) => c.code).join(' ')}`, view: 'objects', id: o.id }));
    m.notes.forEach((n) => idx.push({ g: 'Замечания', t: `${n.id}: ${L.noteType[n.type] || n.type}`, body: n.text, view: 'notes', id: n.id }));
    m.index = idx;
    return idx;
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
    const inDoc = S.ctx === 'doc' && S.m;
    const pool = inDoc ? indexOf(S.m).map((e) => ({ ...e, href: `#/${e.view}/${e.id}` }))
      : models().flatMap((m) => indexOf(m).filter((e) => e.g !== 'Роли и объекты').map((e) => ({ ...e, g: `${docName(m)} (${L.src[m.entry.kind]}) · ${e.g}`, href: `#/open/${m.key}/${e.view}/${e.id}` })));
    const hits = pool.filter((e) => { const hay = e.body.toLowerCase(); return words.every((w) => hay.includes(w)); });
    if (!hits.length) { box.innerHTML = `<div class="sr-empty">Ничего не найдено по запросу «${esc(q)}».</div>`; box.hidden = false; return; }
    const groups = new Map();
    hits.forEach((x) => { if (!groups.has(x.g)) groups.set(x.g, []); groups.get(x.g).push(x); });
    let h = '';
    groups.forEach((list, g) => {
      h += `<div class="sr-group">${esc(g)}: ${list.length}</div>`;
      list.slice(0, inDoc ? 6 : 4).forEach((e) => { h += `<a class="sr-item" role="option" href="${esc(e.href)}">${esc(e.t.length > 120 ? e.t.slice(0, 118) + '…' : e.t)}<small>${snippet(e.body, words[0])}</small></a>`; });
    });
    box.innerHTML = h;
    box.hidden = false;
  }

  /* ---------- Роутинг ---------- */
  const DOC_VIEWS = { doc: viewDoc, req: viewReqs, registry: viewRegistry, roles: viewRoles, objects: viewObjects, links: viewLinks, check: viewCheck, notes: viewNotes };
  const WS_VIEWS = { home: viewHome, common: viewCommon, overlaps: viewOverlaps, graph: viewGraph, account: viewAccount };
  function parseHash() {
    let raw = location.hash.replace(/^#\/?/, '');
    try { raw = decodeURIComponent(raw); } catch { /* оставляем как есть */ }
    const qi = raw.indexOf('?');
    const path = qi < 0 ? raw : raw.slice(0, qi);
    const parts = path.split('/');
    return { view: parts[0] || 'home', id: parts[1] || '', parts, params: new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1)) };
  }
  const rerender = () => { S.keepScroll = true; render(); };

  function render() {
    if (!W.ready) return;
    const keep = S.keepScroll;
    S.keepScroll = false;
    const y = window.scrollY;
    const fresh = location.hash !== S.lastHash;
    S.lastHash = location.hash;
    let { view, id, parts, params } = parseHash();

    if (view === 'open') {
      const rest = parts.slice(2).join('/');
      const q = params.toString();
      openDoc(parts[1], rest ? `#/${rest}${q ? '?' + q : ''}` : '#/doc');
      return;
    }
    if (!WS_VIEWS[view] && !DOC_VIEWS[view]) view = 'home';
    if (DOC_VIEWS[view]) {
      if (id && (!S.m || !S.m.byId.has(id))) { const e = findDocWith(id); if (e) useDoc(e.key); }
      if (!S.m && S.key) useDoc(S.key);
      if (!S.m && W.docs[0]) useDoc(W.docs[0].key);
      if (!S.m) view = 'home';
    }
    const isWs = !!WS_VIEWS[view];
    S.ctx = isWs ? 'ws' : 'doc';

    if (fresh) {
      if (view === 'req') {
        ['modality', 'basis', 'check', 'role', 'object', 'kind', 'section', 'crit', 'owner'].forEach((k) => { if (params.has(k)) S.f[k] = params.get(k); });
        if (params.has('q')) S.f.q = params.get('q');
        if (id) S.openRows.add(id);
      }
      if (view === 'registry') {
        ['crit', 'owner', 'done', 'q', 'ov'].forEach((k) => { if (params.has(k)) S.rf[k] = params.get(k); });
        if (id) S.openReg.add(`${S.key}|${id}`);
      }
      if (view === 'common') ['crit', 'owner', 'done', 'q', 'ov', 'doc'].forEach((k) => { if (params.has(k)) S.cf[k] = params.get(k); });
      if (view === 'overlaps') {
        S.of.req = params.get('req') || '';
        S.of.doc = params.get('doc') || '';
        S.of.limit = 60;
        if (params.has('min')) S.of.min = Math.max(0.4, Math.min(0.95, Number(params.get('min')) || 0.55));
      }
    }
    if (view === 'doc' && id) {
      const o = S.m.byId.get(id);
      if (o && o.kind === 'requirement' && o.clause) S.openAtoms.add(o.clause.id);
    }

    renderTabs(view, isWs);
    renderSidebar(view);
    renderDocMenu(isWs);
    renderDlMenu(isWs);
    renderBanner(isWs);
    $('#searchInput').placeholder = isWs ? 'Поиск по всем документам' : 'Поиск по тексту, требованиям и терминам';

    const el = $('#view');
    el.innerHTML = (isWs ? WS_VIEWS : DOC_VIEWS)[view]();
    el.className = 'view' + (view === 'doc' ? '' : view === 'graph' ? ' full' : ' wide');
    if (view === 'req') renderReqResults();
    if (view === 'registry') renderRegistryResults();
    if (view === 'common') renderCommonResults();
    if (view === 'overlaps') renderOverlapResults();
    if (view === 'graph') {
      if (fresh && params.get('doc')) G.sel = 'doc:' + params.get('doc');
      if (fresh && params.get('req')) G.sel = params.get('req');
      bindGraph(); renderGraph(false);
    }
    document.title = isWs ? `ИСМ XML — ${{ home: 'документы', common: 'общий реестр требований', overlaps: 'пересекающиеся требования', account: 'личный кабинет', graph: 'граф требований' }[view]}` : `${S.m.id} — ${S.m.meta.title}`;
    if (view === 'account' && W.cloud) loadAccount();
    closeNav();

    if (keep) { window.scrollTo(0, y); }
    else {
      const targetId = view === 'req' && id ? `row-${id}` : view === 'registry' && id ? `reg-${id}` : (!isWs ? id : '');
      const t = targetId && document.getElementById(targetId);
      if (t) {
        requestAnimationFrame(() => {
          t.scrollIntoView({ block: 'start' });
          t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
        });
      } else window.scrollTo(0, 0);
    }
    if (view === 'doc') observeSections();
  }

  function renderBanner(isWs) {
    const b = $('#banner');
    const e = S.m && S.m.entry;
    if (!isWs && e && e.builtin && e.overridden) {
      b.innerHTML = 'В опубликованный регламент внесены правки в этом браузере. Коллеги их не видят — передайте им XML из меню «Выгрузить». <button type="button" data-docreset="builtin">Сбросить правки</button>';
      b.hidden = false;
    } else if (W.loadError) {
      b.innerHTML = `Документы из базы не загрузились: ${esc(W.loadError)} <button type="button" onclick="location.reload()">Обновить страницу</button>`;
      b.hidden = false;
    } else if (!W.storage) {
      b.innerHTML = 'Браузер не разрешает этому сайту хранить данные, поэтому загруженные документы и правки пропадут после закрытия вкладки. Скачивайте результаты в XML или Excel.';
      b.hidden = false;
    } else b.hidden = true;
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
  const xmlBlob = (text) => new Blob([text], { type: 'application/xml' });
  const todayRu = () => new Date().toLocaleDateString('ru-RU');
  async function kitFiles(dir) {
    for (const [k, name] of [['xsd', 'ism-regulation-v1.xsd'], ['xsl', 'ism-regulation-view.xsl'], ['ps1', 'build.ps1'], ['bat', 'build.bat']]) {
      dir.file(name, await (await fetch(KIT[k])).arrayBuffer());
    }
  }
  async function download(kind, arg) {
    try {
      const m = M();
      const docOrigin = () => `${m.id}, версия ${m.version}`;
      const commonOrigin = (list) => `общий реестр, ${pl(new Set(list.map((r) => r.m.key)).size, 'документ', 'документа', 'документов')}`;
      switch (kind) {
        case 'xml': return saveBlob(xmlBlob(m.entry.xml), xmlFileName(m.entry));
        case 'docxml': { const e = entry(arg); return saveBlob(xmlBlob(e.xml), xmlFileName(e)); }
        case 'xsd': return saveBlob(xmlBlob(await fetchText(KIT.xsd)), 'ism-regulation-v1.xsd');
        case 'xsl': return saveBlob(xmlBlob(await fetchText(KIT.xsl)), 'ism-regulation-view.xsl');
        case 'xlsx': return await exportXlsx(m.reqs, `${safeName(m.id)} — реестр требований.xlsx`, docOrigin());
        case 'xlsx-filtered': return await exportXlsx(filteredReqs(), `${safeName(m.id)} — реестр требований (выборка).xlsx`, docOrigin());
        case 'xlsx-registry': { const l = filteredRegistry(); return await exportXlsx(l, `${safeName(m.id)} — реестр требований${l.length !== m.reqs.length ? ' (выборка)' : ''}.xlsx`, docOrigin()); }
        case 'cxlsx': { const l = commonList(); return await exportXlsx(l, `Общий реестр требований ${todayRu()}.xlsx`, commonOrigin(l)); }
        case 'cxlsx-f': { const l = filteredCommon(); return await exportXlsx(l, `Общий реестр требований${l.length !== commonList().length ? ' (выборка)' : ''} ${todayRu()}.xlsx`, commonOrigin(l)); }
        case 'cxml': return saveBlob(xmlBlob(registryXml(commonList())), `common-registry-${ymd()}.xml`);
        case 'cxml-f': return saveBlob(xmlBlob(registryXml(filteredCommon())), `common-registry-${ymd()}${filteredCommon().length !== commonList().length ? '-selection' : ''}.xml`);
        case 'zip': {
          toast('Собираю архив…');
          if (!window.JSZip) await loadScript(JSZIP_URL);
          const zip = new window.JSZip();
          const dir = zip.folder(`ИСМ XML ${safeName(m.id)}`);
          dir.file(xmlFileName(m.entry), m.entry.xml);
          await kitFiles(dir);
          if (m.entry.builtin) {
            for (const src of [...new Set(m.figures)]) {
              const r = await fetch(resolveSrc(src));
              if (r.ok) dir.file(src, await r.arrayBuffer());
            }
          }
          saveBlob(await zip.generateAsync({ type: 'blob' }), `ИСМ-XML-${safeName(m.id)}.zip`);
          return toast('Архив готов');
        }
        case 'all': {
          toast('Собираю архив…');
          if (!window.JSZip) await loadScript(JSZIP_URL);
          const zip = new window.JSZip();
          const dir = zip.folder(`ИСМ XML ${ymd()}`);
          const used = new Set();
          W.docs.forEach((e) => {
            let n = xmlFileName(e), k = 2;
            while (used.has(n)) n = xmlFileName(e).replace(/\.xml$/, `-${k++}.xml`);
            used.add(n);
            dir.file(`documents/${n}`, e.xml);
          });
          if (commonList().length) dir.file(`common-registry-${ymd()}.xml`, registryXml(commonList()));
          await kitFiles(dir);
          dir.file('README.txt', `Выгрузка из приложения ИСМ XML, ${todayRu()}.\r\n\r\ndocuments/ — XML ИСМ каждого документа (${W.docs.length} шт.). Их можно загрузить в приложение у коллеги: кнопка «Загрузить».\r\ncommon-registry-*.xml — общий реестр требований одним документом ИСМ.\r\nism-regulation-v1.xsd — схема для проверки XML. build.bat собирает HTML-представление любого XML рядом с ним.\r\n`);
          saveBlob(await zip.generateAsync({ type: 'blob' }), `ИСМ-XML-${ymd()}.zip`);
          return toast('Архив готов');
        }
        default: return undefined;
      }
    } catch (e) {
      toast('Не удалось выгрузить: ' + e.message, 5000);
      return undefined;
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
    const local = S.m && !S.m.entry.builtin;
    try { await navigator.clipboard.writeText(url); toast(local ? 'Ссылка скопирована. Документ хранится в вашем браузере: у коллеги ссылка откроется, если он загрузит этот же документ.' : 'Ссылка скопирована', local ? 5000 : 2400); }
    catch { window.prompt('Скопируйте ссылку:', url); }
  }
  function closeNav() {
    document.body.classList.remove('nav-open');
    $('.nav-toggle').setAttribute('aria-expanded', 'false');
    $('#scrim').hidden = true;
  }
  const closeMenus = (except) => $$('details.menu[open]').forEach((d) => { if (d !== except) d.open = false; });

  function resetBuiltin() {
    const e = entry(BUILTIN);
    if (!e) return;
    fetchText(W.builtinUrl).then(async (text) => {
      e.xml = text; e.overridden = false;
      W.models.delete(BUILTIN);
      await persist(e);
      bump();
      if (S.key === BUILTIN) { S.m = modelOf(e); renderToc(); }
      toast('Правки сброшены: показан опубликованный регламент');
      rerender();
    }).catch((err) => toast('Не удалось загрузить опубликованный регламент: ' + err.message, 5000));
  }

  function bindGlobal() {
    window.addEventListener('hashchange', () => {
      // Ссылку из письма открыли в уже открытой вкладке: токены разбирает только загрузка страницы
      if (/(access_token|error_description)=/.test(location.hash)) { location.reload(); return; }
      render();
    });

    document.addEventListener('click', (ev) => {
      const t = ev.target;
      const on = (sel) => t.closest(sel);
      let x;
      if ((x = on('[data-atoms]'))) {
        const id = x.dataset.atoms;
        const list = document.getElementById('atoms-' + id);
        const open = x.getAttribute('aria-expanded') !== 'true';
        x.setAttribute('aria-expanded', String(open));
        list.hidden = !open;
        if (open) S.openAtoms.add(id); else S.openAtoms.delete(id);
        return;
      }
      if (on('#toggleAll')) {
        S.allAtoms = !S.allAtoms;
        if (!S.allAtoms) S.openAtoms.clear();
        $$('[data-atoms]').forEach((b) => { b.setAttribute('aria-expanded', String(S.allAtoms)); document.getElementById('atoms-' + b.dataset.atoms).hidden = !S.allAtoms; });
        on('#toggleAll').textContent = S.allAtoms ? 'Свернуть требования в тексте' : 'Показать все требования в тексте';
        return;
      }
      if (on('#toggleMarkup')) { S.markup = !S.markup; rerender(); return; }
      if ((x = on('[data-edit]'))) {
        const u = x.dataset.edit; const i = u.indexOf('|');
        openEditor({ key: u.slice(0, i), reqId: u.slice(i + 1) });
        return;
      }
      if ((x = on('[data-add]'))) { openEditor({ key: S.key, clauseId: x.dataset.add }); return; }
      if (on('[data-edclose]')) { closeEditor(); return; }
      if (on('#edDelete')) { deleteFromEditor(); return; }
      if ((x = on('[data-amode]'))) { const em = $('#authForm [name="email"]'); if (em && em.value) A.email = em.value.trim(); setAuth(x.dataset.amode); return; }
      if (on('#signOut') || on('#signOut2')) { signOut(); return; }
      if (on('#migrateLocal')) { on('#migrateLocal').disabled = true; migrateLocal(); return; }
      if (on('#edLinkAdd')) {
        const v = $('#edLinkSel').value;
        if (v && !S.edit.links.includes(v)) { S.edit.links.push(v); $('#edLinks').innerHTML = edLinksHtml(); }
        return;
      }
      if ((x = on('[data-unlink]'))) { S.edit.links = S.edit.links.filter((k) => k !== x.dataset.unlink); $('#edLinks').innerHTML = edLinksHtml(); return; }
      if ((x = on('[data-copy]'))) { copyLink(x.dataset.copy); return; }
      if ((x = on('[data-row]'))) {
        const id = x.dataset.row;
        if (S.openRows.has(id)) S.openRows.delete(id); else S.openRows.add(id);
        renderReqResults();
        const r = document.getElementById('row-' + id);
        if (r) r.querySelector('[data-row]').focus();
        return;
      }
      if ((x = on('[data-f]'))) {
        S.f[x.dataset.f] = x.dataset.v;
        $$(`[data-f="${x.dataset.f}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === x)));
        renderReqResults();
        return;
      }
      if (on('#resetF')) { S.f = freshF(); if (location.hash.includes('?')) location.hash = '#/req'; else rerender(); return; }
      if (on('#csvFiltered')) { download('xlsx-filtered'); return; }
      if ((x = on('[data-dl]'))) { closeMenus(); if (!x.disabled) download(x.dataset.dl); return; }
      if ((x = on('[data-docxml]'))) { download('docxml', x.dataset.docxml); return; }
      if ((x = on('[data-rf]'))) {
        S.rf[x.dataset.rf] = x.dataset.v;
        $$(`[data-rf="${x.dataset.rf}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === x)));
        renderRegistryResults();
        return;
      }
      if ((x = on('[data-cf]'))) {
        S.cf[x.dataset.cf] = x.dataset.v; S.cf.limit = 300;
        $$(`[data-cf="${x.dataset.cf}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === x)));
        renderCommonResults();
        return;
      }
      if ((x = on('[data-of]'))) {
        S.of[x.dataset.of] = x.dataset.v; S.of.limit = 60;
        $$(`[data-of="${x.dataset.of}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === x)));
        renderOverlapResults();
        return;
      }
      if ((x = on('[data-ovdismiss]'))) {
        const id = x.dataset.ovdismiss;
        if (W.dismissed.has(id)) W.dismissed.delete(id); else W.dismissed.add(id);
        W.disVer = (W.disVer || 0) + 1;
        saveMeta('dismissed', Array.from(W.dismissed));
        renderOverlapResults();
        renderSidebar(); renderTabs('overlaps', true);
        const lbl = $('#ovHidden') && $('#ovHidden').parentNode;
        if (lbl) lbl.lastChild.nodeValue = ` показать отмеченные «не дубль» (${W.dismissed.size})`;
        toast(W.dismissed.has(id) ? 'Пара отмечена «не дубль» и скрыта' : 'Пара возвращена в список');
        return;
      }
      if ((x = on('[data-gf]'))) {
        G.f[x.dataset.gf] = x.dataset.v;
        if (x.dataset.gf === 'mode') { G.vb = null; rerender(); return; }
        renderGraph(true); $$(`[data-gf="${x.dataset.gf}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === x))); return;
      }
      if ((x = on('[data-gz]'))) { if (x.dataset.gz === 'fit') graphFit(); else graphZoom(x.dataset.gz === 'in' ? 1 / 1.25 : 1.25); return; }
      if ((x = on('[data-gsel]'))) { G.sel = x.dataset.gsel; renderGraph(true); return; }
      if ((x = on('[data-gaccept]'))) {
        const [from, to] = x.dataset.gaccept.split('>');
        x.disabled = true;
        addLink({ from, to, relation: 'derives' }).then(() => { toast('Основание добавлено'); renderGraph(true); renderSidebar(); renderTabs('graph', true); });
        return;
      }
      if ((x = on('[data-gunlink]'))) {
        const [from, to] = x.dataset.gunlink.split('>');
        removeLink({ from, to, relation: 'derives' }).then(() => { toast('Основание убрано'); renderGraph(true); renderSidebar(); renderTabs('graph', true); });
        return;
      }
      if (on('#ovAll')) { S.of.req = ''; if (location.hash.includes('req=')) location.hash = '#/overlaps'; else renderOverlapResults(); return; }
      if (on('#moreOv')) { S.of.limit += 60; renderOverlapResults(); return; }
      if (on('#moreCommon')) { S.cf.limit = (S.cf.limit || 300) + 300; renderCommonResults(); return; }
      if ((x = on('[data-rowner]'))) {
        S.rf.owner = S.rf.owner === x.dataset.rowner ? '' : x.dataset.rowner;
        $$('[data-rowner]').forEach((b) => { const o = b.dataset.rowner === S.rf.owner; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); });
        renderRegistryResults();
        return;
      }
      if ((x = on('[data-reg]'))) {
        const id = x.dataset.reg;
        if (S.openReg.has(id)) S.openReg.delete(id); else S.openReg.add(id);
        if ($('#comResults')) renderCommonResults(); else renderRegistryResults();
        const btn = $(`[data-reg="${CSS.escape(id)}"]`);
        if (btn) btn.focus();
        return;
      }
      if (on('#resetRF')) { S.rf = freshRF(); if (location.hash.includes('?')) location.hash = '#/registry'; else rerender(); return; }
      if (on('#resetCF')) { S.cf = freshCF(); if (location.hash.includes('?')) location.hash = '#/common'; else rerender(); return; }
      if ((x = on('[data-docdel]'))) {
        const key = x.dataset.docdel;
        if (S.confirmDel !== key) { S.confirmDel = key; x.textContent = 'Точно удалить?'; setTimeout(() => { if (S.confirmDel === key) { S.confirmDel = ''; if (x.isConnected) x.textContent = 'Удалить'; } }, 4000); return; }
        S.confirmDel = '';
        removeDoc(key);
        return;
      }
      if (on('[data-docreset]')) { resetBuiltin(); return; }
      if ((x = on('#wsClear'))) {
        if (S.confirmDel !== '*') { S.confirmDel = '*'; x.textContent = 'Удалить все загруженные? Нажмите ещё раз'; return; }
        S.confirmDel = '';
        (async () => {
          for (const e of W.docs.filter((d) => !d.builtin)) { W.models.delete(e.key); if (W.storage) await store().deleteDoc(e.key).catch(() => {}); }
          W.docs = W.docs.filter((d) => d.builtin);
          if (!entry(S.key)) { S.key = ''; S.m = null; if (W.docs[0]) useDoc(W.docs[0].key); }
          S.upload = null;
          bump(); toast('Загруженные документы удалены'); rerender();
        })();
        return;
      }
      if ((x = on('[data-sample]'))) {
        fetchText(x.dataset.sample).then((text) => { S.bpmn = runBpmn(text, x.dataset.sample.split('/').pop()); $('#checkRes').innerHTML = bpmnResults(S.bpmn); $('#checkRes').scrollIntoView({ block: 'nearest' }); })
          .catch((err) => toast('Не удалось открыть пример: ' + err.message, 5000));
        return;
      }
      if (on('#clReset')) { saveChecks({}); rerender(); toast('Отметки сброшены'); return; }
      if (on('#clCopy')) {
        const done = loadChecks();
        const text = `Проверка по ${M().id} (версия ${M().version})\n` + manualReqs().map((r) => `${done[r.id] ? '[x]' : '[ ]'} ${reqCite(r)}: ${r.statement}`).join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Отчёт скопирован')).catch(() => window.prompt('Скопируйте отчёт:', text));
        return;
      }
      if (on('.nav-toggle')) {
        const open = !document.body.classList.contains('nav-open');
        document.body.classList.toggle('nav-open', open);
        $('.nav-toggle').setAttribute('aria-expanded', String(open));
        $('#scrim').hidden = !open;
        return;
      }
      if (on('#scrim')) { closeNav(); return; }
      if (on('.sr-item')) { $('#searchResults').hidden = true; $('#searchInput').blur(); }
      if (on('.menu-panel a')) closeMenus();
      const menu = on('details.menu');
      closeMenus(menu);
      if (!on('.search')) $('#searchResults').hidden = true;
    });

    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'fq') { S.f.q = t.value; renderReqResults(); }
      if (t.id === 'rq') { S.rf.q = t.value; renderRegistryResults(); }
      if (t.id === 'cq') { S.cf.q = t.value; S.cf.limit = 300; renderCommonResults(); }
      if (t.id === 'ovMin') {
        S.of.min = Number(t.value) / 100; S.of.limit = 60;
        $('#ovMinVal').textContent = `${t.value} %`;
        renderOverlapResults();
      }
      if (t.id === 'searchInput') doSearch(t.value);
    });
    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.fsel) { S.f[t.dataset.fsel] = t.value; renderReqResults(); }
      if (t.dataset.csel) { S.cf[t.dataset.csel] = t.value; S.cf.limit = 300; renderCommonResults(); }
      if (t.id === 'ovMin') { renderSidebar(); renderTabs('overlaps', true); }
      if (t.dataset.gt) { G.f[t.dataset.gt] = t.checked; renderGraph(true); }
      if (t.id === 'ovDoc') { S.of.doc = t.value; S.of.limit = 60; renderOverlapResults(); }
      if (t.id === 'ovHidden') { S.of.hidden = t.checked; renderOverlapResults(); }
      if (t.id === 'relSel') { S.linkRel = t.value; rerender(); }
      if (t.id === 'upLevel') S.upLevel = t.value;
      if (t.id === 'upInclude') S.upInclude = t.checked;
      if (t.dataset.doctype) { setDocType(t.dataset.doctype, t.value); return; }
      if (t.dataset.include) {
        const e = entry(t.dataset.include);
        if (e) { e.included = t.checked; persist(e); bump(); rerender(); toast(t.checked ? 'Документ включён в общий реестр' : 'Документ исключён из общего реестра'); }
      }
      if (t.dataset.cl) {
        const o = loadChecks(); if (t.checked) o[t.dataset.cl] = 1; else delete o[t.dataset.cl]; saveChecks(o);
        t.closest('.cl-item').classList.toggle('done', t.checked);
        const manual = manualReqs();
        const n = manual.filter((r) => o[r.id]).length;
        $('#clCount').textContent = `Отмечено ${n} из ${manual.length}`;
        $('.progress span').style.width = Math.round((n / manual.length) * 100) + '%';
      }
      if (t.id === 'bpmnFile' && t.files[0]) readBpmn(t.files[0]);
      if ((t.id === 'upFiles' || t.classList.contains('up-input')) && t.files.length) {
        const files = Array.from(t.files);
        t.value = '';
        closeMenus(); closeNav();
        addFiles(files);
      }
    });

    document.addEventListener('submit', (ev) => {
      const f = ev.target;
      if (f.id === 'edForm') { ev.preventDefault(); saveEditor(); }
      if (f.id === 'authForm') { ev.preventDefault(); submitAuth(f); }
      if (f.id === 'profileForm') {
        ev.preventDefault();
        const name = norm(new FormData(f).get('full_name'));
        window.ISM.cloud.auth.updateProfile({ full_name: name }).then(() => { S.profile = { ...(S.profile || {}), full_name: name }; toast('Имя сохранено'); })
          .catch((err) => toast('Не удалось сохранить: ' + err.message, 5000));
      }
      if (f.id === 'passwordForm') {
        ev.preventDefault();
        const fd = new FormData(f);
        const pw = String(fd.get('password') || '');
        const box = $('#accErr');
        const err = (m) => { box.textContent = m; box.hidden = false; };
        if (pw.length < 8) return err('Пароль должен быть не короче 8 символов.');
        if (pw !== String(fd.get('password2') || '')) return err('Пароли не совпадают.');
        box.hidden = true;
        window.ISM.cloud.auth.setPassword(pw).then(() => { f.reset(); toast('Пароль изменён'); }).catch((e2) => err(e2.message));
      }
      return undefined;
    });
    $('#editor').addEventListener('cancel', () => { S.edit = null; });
    $('#editor').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) closeEditor(); });

    // Перетаскивание: схема BPMN — в зону проверки, документы — в любое место страницы
    const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      const d = ev.target.closest && ev.target.closest('#drop, #upDrop');
      $$('.drop.over').forEach((x) => { if (x !== d) x.classList.remove('over'); });
      if (d) d.classList.add('over');
      document.body.classList.toggle('drag-files', !d || d.id === 'upDrop');
    });
    document.addEventListener('dragleave', (ev) => {
      if (ev.relatedTarget == null) { document.body.classList.remove('drag-files'); $$('.drop.over').forEach((x) => x.classList.remove('over')); }
    });
    document.addEventListener('drop', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      document.body.classList.remove('drag-files');
      $$('.drop.over').forEach((x) => x.classList.remove('over'));
      const d = ev.target.closest && ev.target.closest('#drop');
      if (d) { if (ev.dataTransfer.files[0]) readBpmn(ev.dataTransfer.files[0]); return; }
      addFiles(ev.dataTransfer.files);
    });

    document.addEventListener('keydown', (ev) => {
      if ($('#editor').open) return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (ev.key === '/' && !inField) { ev.preventDefault(); $('#searchInput').focus(); return; }
      if (ev.key === 'Escape') {
        $('#searchResults').hidden = true; closeMenus(); closeNav();
        if (document.activeElement.id === 'searchInput') document.activeElement.blur();
      }
      if (document.activeElement.id === 'searchInput' && (ev.key === 'ArrowDown' || ev.key === 'Enter')) {
        const first = $('#searchResults .sr-item');
        if (first && ev.key === 'ArrowDown') { ev.preventDefault(); first.focus(); }
        if (first && ev.key === 'Enter') { ev.preventDefault(); location.hash = first.getAttribute('href'); $('#searchResults').hidden = true; document.activeElement.blur(); }
      } else if (document.activeElement.classList.contains('sr-item') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        const items = $$('#searchResults .sr-item');
        const i = items.indexOf(document.activeElement);
        const next = items[i + (ev.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus(); else if (ev.key === 'ArrowUp') $('#searchInput').focus();
      }
    });
  }

  function readBpmn(file) {
    const fr = new FileReader();
    fr.onload = () => { S.bpmn = runBpmn(String(fr.result), file.name); const box = $('#checkRes'); if (box) { box.innerHTML = bpmnResults(S.bpmn); box.scrollIntoView({ block: 'nearest' }); } };
    fr.onerror = () => toast('Не удалось прочитать файл', 4000);
    fr.readAsText(file);
  }

  /* ---------- Запуск ---------- */
  async function boot() {
    bindGlobal();
    const cloud = window.ISM.cloud;
    if (cloud && cloud.enabled) {
      W.cloud = true;
      let session = null;
      try { session = await cloud.auth.session(); } catch (e) { A.err = e.message; }
      // Старая ссылка из письма Supabase: вход уже выполнен, токены убираем из адреса
      if (cloud.urlEvent) history.replaceState(null, '', location.pathname + location.search + '#/');
      if (!session) { renderAuth(); return; }
      W.user = session.user;
    }
    await startApp();
  }
  async function startApp() {
    if (W.started) return;
    W.started = true;
    try {
      document.body.classList.remove('auth-mode');
      $('#auth').hidden = true;
      renderUser();
      await initWorkspace();
      if (S.key) useDoc(S.key);
      if (W.cloud) {
        window.ISM.cloud.auth.onChange((event) => { if (event === 'SIGNED_OUT' && W.user) { W.user = null; location.reload(); } });
        checkLocalDocs();
      }
      render();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty"><p><b>Не удалось запустить приложение.</b> ${esc(e.message)}</p></div>`;
    }
  }

  /* ---------- Регистрация и вход ---------- */
  // Подтверждения почты нет: регистрация по почте и паролю сразу открывает приложение.
  // Для этого в проекте Supabase выключено Authentication → Sign In / Providers → Email → Confirm email.
  const CONFIRM_ON = 'В проекте Supabase включено подтверждение почты, а приложение работает без него. Администратору: Authentication → Sign In / Providers → Email → выключить «Confirm email».';
  const A = { mode: 'login', email: '', err: '', busy: false };
  const authField = (name, label, type, extra = '') => `<label class="fld"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
  function renderAuth() {
    document.body.classList.add('auth-mode');
    const box = $('#auth');
    box.hidden = false;
    const email = esc(A.email);
    const forms = {
      login: `<h2>Вход</h2>
        ${authField('email', 'Почта', 'email', `autocomplete="email" required value="${email}"`)}
        ${authField('password', 'Пароль', 'password', 'autocomplete="current-password" required')}
        <button type="submit" class="btn btn-primary wide"${A.busy ? ' disabled' : ''}>Войти</button>
        <p class="auth-links"><span>Нет учётной записи? <button type="button" class="link-btn" data-amode="signup">Зарегистрироваться</button></span></p>
        <p class="auth-hint">Забыли пароль — напишите администратору приложения.</p>`,
      signup: `<h2>Регистрация</h2>
        ${authField('email', 'Почта', 'email', `autocomplete="email" required value="${email}"`)}
        ${authField('password', 'Пароль', 'password', 'autocomplete="new-password" minlength="8" required')}
        ${authField('password2', 'Пароль ещё раз', 'password', 'autocomplete="new-password" minlength="8" required')}
        <p class="auth-hint">Пароль не короче 8 символов. Почта нужна как логин: писем приложение не отправляет.</p>
        <button type="submit" class="btn btn-primary wide"${A.busy ? ' disabled' : ''}>Зарегистрироваться</button>
        <p class="auth-links"><span>Уже зарегистрированы? <button type="button" class="link-btn" data-amode="login">Войти</button></span></p>`,
    };
    box.innerHTML = `<div class="auth-wrap">
      <section class="auth-intro">
        <div class="auth-brand"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="26" height="22"/><path d="M3 19h26M17 19v8M9 11h12"/></svg><b>ИСМ XML</b></div>
        <h1>Реестр требований ИСМ</h1>
        <ul>
          <li>Загрузка регламентов из Word, PDF, Excel и XML, разметка атомарных требований</li>
          <li>Бизнес- и системные требования, владельцы, критичность, карточки корпоративного реестра</li>
          <li>Граф требований по уровням документов: от политик до записей</li>
          <li>Ваши документы видите только вы</li>
        </ul>
      </section>
      <section class="auth-card">
        <form id="authForm" data-mode="${A.mode}" novalidate>
          ${forms[A.mode] || forms.login}
          <p class="auth-err" id="aErr" role="alert"${A.err ? '' : ' hidden'}>${esc(A.err)}</p>
        </form>
      </section>
    </div>`;
    const first = box.querySelector(A.email ? '[name="password"]' : '[name="email"]');
    if (first) first.focus();
  }
  function setAuth(mode, { err = '' } = {}) { A.mode = mode; A.err = err; A.busy = false; renderAuth(); }
  async function submitAuth(form) {
    const fd = new FormData(form);
    const v = (k) => String(fd.get(k) || '').trim();
    const auth = window.ISM.cloud.auth;
    const showErr = (m) => { A.busy = false; A.err = m; const e = $('#aErr'); e.textContent = m; e.hidden = false; form.querySelector('[type="submit"]').disabled = false; };
    const email = v('email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Введите почту в формате name@example.ru.');
    if (A.mode === 'login' && !v('password')) return showErr('Введите пароль.');
    if (A.mode === 'signup' && v('password').length < 8) return showErr('Пароль должен быть не короче 8 символов.');
    if (A.mode === 'signup' && v('password') !== v('password2')) return showErr('Пароли не совпадают.');
    A.busy = true; A.email = email;
    form.querySelector('[type="submit"]').disabled = true;
    $('#aErr').hidden = true;
    try {
      if (A.mode === 'signup') {
        const res = await auth.signUp(email, v('password'));
        if (!res.session) return showErr(`Учётная запись создана, но войти пока нельзя. ${CONFIRM_ON}`);
        W.user = res.session.user;
        toast('Учётная запись создана, добро пожаловать', 3500);
        return await startApp();
      }
      const session = await auth.signIn(email, v('password'));
      W.user = session.user;
      return await startApp();
    } catch (err) {
      return showErr(/не подтверждена/.test(err.message) ? CONFIRM_ON : err.message);
    }
  }
  async function signOut() {
    try { await window.ISM.cloud.auth.signOut(); } catch { /* сеанс уже закрыт */ }
    W.user = null;
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }

  // Меню пользователя в верхней панели
  function renderUser() {
    const menu = $('#userMenu');
    if (!W.cloud || !W.user) { menu.hidden = true; return; }
    const email = W.user.email || '';
    menu.hidden = false;
    $('#userMenu summary').innerHTML = `<span class="avatar" aria-hidden="true">${esc(email.charAt(0).toUpperCase() || '?')}</span><span class="sr-only">Личный кабинет</span>`;
    $('#userPanel').innerHTML = `<p class="menu-cap">Вы вошли как</p><p class="user-email">${esc(email)}</p>
      <a role="menuitem" class="dm-item" href="#/account"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span><b>Личный кабинет</b><span>учётная запись, пароль, данные</span></span></a>
      <button type="button" role="menuitem" id="signOut"><b>Выйти</b><span>завершить сеанс на этом устройстве</span></button>`;
  }

  /* ---------- Личный кабинет ---------- */
  function viewAccount() {
    let h = '<div class="page-head"><div><h1>Личный кабинет</h1><p>Учётная запись и ваши данные в базе. Документы и карточки видите только вы.</p></div></div>';
    if (!W.cloud) {
      return h + `<div class="acc-grid"><section class="acc-card"><h2>Вход не подключён</h2>
        <p>Приложение работает без учётных записей: документы хранятся только в этом браузере. Регистрация по почте, личный кабинет и база данных включаются, когда администратор подключает проект Supabase — инструкция в README репозитория, раздел «База данных и вход».</p></section></div>`;
    }
    const u = W.user || {};
    const p = S.profile || {};
    const all = models();
    const reqs = all.flatMap((m) => m.reqs);
    const nSys = reqs.filter((r) => r.category === 'system').length;
    const dt = (x) => (x ? new Date(x).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }) : '—');
    h += `<div class="acc-grid">
      <section class="acc-card"><h2>Учётная запись</h2>
        <dl class="acc-dl">
          <dt>Почта</dt><dd>${esc(u.email || '')}</dd>
          <dt>Зарегистрирован</dt><dd>${esc(dt(u.created_at))}</dd>
          <dt>Последний вход</dt><dd>${esc(dt(u.last_sign_in_at))}</dd>
        </dl>
        <form id="profileForm" class="acc-form"><label class="fld"><span>Имя (необязательно)</span><input name="full_name" value="${esc(p.full_name || '')}" autocomplete="name"></label>
          <button type="submit" class="btn btn-sm">Сохранить имя</button></form>
      </section>
      <section class="acc-card"><h2>Пароль</h2>
        <form id="passwordForm" class="acc-form">
          <label class="fld"><span>Новый пароль</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label class="fld"><span>Ещё раз</span><input name="password2" type="password" minlength="8" autocomplete="new-password" required></label>
          <button type="submit" class="btn btn-sm">Сменить пароль</button>
        </form>
        <p class="acc-err" id="accErr" hidden></p>
        <button type="button" class="btn danger" id="signOut2">Выйти из учётной записи</button>
      </section>
      <section class="acc-card wide"><h2>Мои данные в базе</h2>
        <div class="acc-stats">
          <div><span class="lbl">Документов</span><b>${all.length}</b></div>
          <div><span class="lbl">Требований</span><b>${reqs.length}</b></div>
          <div><span class="lbl">Бизнес / системные</span><b><span class="cb">${reqs.length - nSys}</span> / <span class="cs">${nSys}</span></b></div>
          <div><span class="lbl">Связей-оснований</span><b>${W.links.length}</b></div>
        </div>
        <p class="muted">База данных: ${esc(window.ISM.cloud.host)}. Таблицы: виды документов, документы, требования, связи требований, отметки «не дубль», настройки. Доступ к строкам ограничен вашей учётной записью.</p>
        <div class="head-actions"><button type="button" class="btn btn-sm" data-dl="all">${ICON.down}Скачать всё одним архивом</button><a class="btn btn-sm" href="#/">${ICON.docs}К документам</a></div>
      </section>
    </div>`;
    return h;
  }
  async function loadAccount() {
    if (S.profileLoaded) return;
    S.profileLoaded = true;
    try { S.profile = await window.ISM.cloud.auth.profile(); const i = $('#profileForm [name="full_name"]'); if (i && S.profile.full_name) i.value = S.profile.full_name; } catch { /* профиль необязателен */ }
  }

  // Документы, загруженные в этом браузере до входа, — предложить перенести в базу
  async function checkLocalDocs() {
    try {
      const local = (await window.ISM.store.allDocs()).filter((d) => d.key !== BUILTIN && d.xml);
      const done = new Set((await window.ISM.store.getMeta('migrated', [])) || []);
      S.localDocs = local.filter((d) => !done.has(`${W.user.id}:${d.key}`) && !entry(d.key));
      if (S.localDocs.length && parseHash().view === 'home') rerender();
    } catch { S.localDocs = []; }
  }
  async function migrateLocal() {
    const list = S.localDocs || [];
    const done = new Set((await window.ISM.store.getMeta('migrated', [])) || []);
    let n = 0;
    for (const d of list) {
      const e = { key: d.key, name: d.name, kind: d.kind, xml: d.xml, addedAt: d.addedAt, included: d.included !== false, report: d.report || {}, level: d.level };
      W.docs.push(e);
      W.models.delete(e.key);
      if (!modelOf(e)) { W.docs.pop(); continue; }
      await persist(e);
      done.add(`${W.user.id}:${d.key}`);
      n++;
    }
    await window.ISM.store.setMeta('migrated', Array.from(done));
    S.localDocs = [];
    bump();
    toast(`Перенесено в базу: ${pl(n, 'документ', 'документа', 'документов')}`);
    rerender();
  }
  window.ISM = window.ISM || {};
  window.ISM.app = { state: S, workspace: W, render };
  boot();
})();
