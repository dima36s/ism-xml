/* ИСМ XML — разбор загруженных документов в XML ИСМ прямо в браузере.
   .docx — по стилям и нумерации Word; .doc (Word 97–2003) — так же, через doc.js; PDF — по текстовому слою (pdf.js);
   Visio .vsdx — через visio.js: страница — раздел с рисунком схемы, дорожки и шаги — таблица «Участник — Действие»;
   Excel — по заголовкам столбцов корпоративного реестра; XML ИСМ — как есть.
   Требования выделяются правилами: предложение со словами «должен», «следует»,
   «необходимо», «не допускается» и т. п. становится атомарным требованием
   с дословной цитатой; описательные обязанности («ФЗ утверждает ФМ», «ФМ согласовывается»,
   перечни под заголовками требований, таблицы ответственности) — требованием с выведенной модальностью. */
(() => {
  'use strict';
  const NS = 'urn:protech:ism:regulation:1.0';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const VENDOR = {
    jszip: 'assets/vendor/jszip.min.js',
    exceljs: 'assets/vendor/exceljs.min.js',
    pdf: 'assets/vendor/pdf.min.js',
    pdfWorker: 'assets/vendor/pdf.worker.min.js',
    doc: 'assets/doc.js',
    visio: 'assets/visio.js',
  };

  /* ---------- Утилиты ---------- */
  const norm = (s) => String(s ?? '').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error('не удалось загрузить ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const translit = (s) => String(s).toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '');
  function ncname(s, fallback) {
    let x = translit(norm(s)).replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (!x) x = fallback || 'x';
    if (!/^[a-z_]/i.test(x)) x = 'n' + x;
    return x;
  }
  const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const lowerFirst = (s) => (s && !/^[А-ЯЁA-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  /* ---------- Модальность ---------- */
  const B = '(?<![а-яёa-z])';
  const E = '(?![а-яёa-z])';
  const RX = {
    shallNot: new RegExp(`${B}(не\\s+допуска(?:ется|ются)|недопустим[а-яё]*|запрещ(?:ается|аются|ено|ена|ены)|не\\s+долж(?:ен|на|но|ны)|не\\s+следует|не\\s+разреша(?:ется|ются)|нельзя|не\\s+(?:может|могут)\\s+(?:быть|превышать|составлять|использоваться|применяться|передаваться))${E}`, 'iu'),
    should: new RegExp(`${B}(рекоменду(?:ется|ются)|желательно|целесообразно)${E}`, 'iu'),
    shall: new RegExp(`${B}(долж(?:ен|на|но|ны)|следует|необходимо|обязан[аоы]?|обязательн(?:ы|а|о)\\s+для|в\\s+обязательном\\s+порядке|требу(?:ется|ются)|подлеж(?:ит|ат)|надлежит)${E}`, 'iu'),
    may: new RegExp(`${B}(допуска(?:ется|ются)|разреша(?:ется|ются)|вправе|(?:имеет|имеют)\\s+право)${E}`, 'iu'),
  };
  function modalityOf(text) {
    const t = String(text);
    if (RX.shallNot.test(t)) return 'shall-not';
    if (RX.should.test(t)) return 'should';
    if (RX.shall.test(t)) return 'shall';
    if (RX.may.test(t)) return 'may';
    return null;
  }

  /* ---------- Неявные требования ---------- */
  // В регламентах обязанность часто записана без «должен»: «ФЗ утверждает ФМ», «ФМ согласовывается с владельцами»,
  // «Функции приводятся с указанием ограничений», перечни под заголовком «Требования к содержанию раздела».
  const ACT_V = ['утвержда', 'согласовыва', 'разрабатыва', 'обеспечива', 'осуществля', 'выполня', 'назнача', 'контролиру', 'организу', 'предоставля',
    'направля', 'переда', 'передава', 'рассматрива', 'принима', 'информиру', 'уведомля', 'актуализиру', 'оптимизиру', 'формиру', 'подготавлива',
    'подписыва', 'регистриру', 'публику', 'проверя', 'оценива', 'анализиру', 'устанавлива', 'описыва', 'обознача', 'указыва', 'перечисля', 'излага',
    'использу', 'применя', 'интегриру', 'оформля', 'фиксиру', 'составля', 'заполня', 'размеща', 'отправля', 'созда', 'обновля', 'пересматрива',
    'корректиру', 'учитыва', 'сохраня', 'архивиру', 'запрашива', 'отража', 'выделя', 'соблюда', 'отслежива', 'сопровожда', 'поддержива',
    'извеща', 'визиру', 'исполня', 'возлага', 'закрепля', 'планиру', 'документиру', 'тестиру', 'внедря', 'доводя', 'утвержд', 'заключа', 'расторга',
    'продлева', 'приостанавлива', 'возобновля', 'фиксиру', 'вывешива', 'доставля', 'выдава', 'оплачива', 'начисля', 'списыва', 'инвентаризиру',
    'маркиру', 'упаковыва', 'транспортиру', 'обрабатыва', 'вырабатыва', 'присваива', 'согласу', 'координиру', 'куриру', 'инструктиру', 'обуча',
    'возвраща', 'отклоня', 'одобря', 'созыва', 'избира', 'рассыла', 'собира', 'выявля', 'устраня', 'сверя', 'блокиру', 'уполномочива', 'контролир'];
  const ACT_C = ['провод', 'вед', 'хран', 'готов', 'привод', 'внос', 'довод', 'доклад', 'вруч', 'осуществ', 'определ', 'представ', 'направ', 'устран', 'провер',
    'утверд', 'созд', 'устанав', 'назнач', 'выдел', 'возлож', 'одобр', 'обеспеч', 'отмеч', 'выпуск', 'уничтож', 'плат', 'перевод', 'сообщ', 'вынос', 'нес'];
  const VERB_RX = new RegExp(`(?<![а-яё])(?:(?:${ACT_V.join('|')})(?:ет|ют|ется|ются|ёт|ётся)|(?:${ACT_C.join('|')})(?:ит|ят|ится|ятся|ет|ёт|ут|ется|ётся|утся))(?![а-яё])`, 'iu');
  const ROLE_RX = /(?<![а-яё])(подразделени|отдел(?:ы|а|ом)?(?![а-яё])|служб|департамент|дирекци|управлени[еяю](?=\s+[а-яё])|владел|руководител|менеджер|работник|сотрудник|специалист|исполнител|ответственн|заказчик|пользовател|администратор|аналитик|разработчик|комисси|директор|начальник|инициатор|автор|куратор|эксперт|оператор|участник|член|секретар|методолог|координатор|лиц[оа](?![а-яё])|комитет|подрядчик|поставщик|работодател|персонал|инженер|технолог|бухгалтер|юрист|архитектор|тестировщик|контрол[её]р|аудитор|представител|заместител|председател|правлени|совет(?![а-яё])|собственник)/iu;
  const NOT_ROLE_ABBR = new Set(['ФМ', 'ИС', 'АС', 'ПО', 'БД', 'ЛНА', 'ИСМ', 'НСИ', 'ТЗ', 'РФ', 'ГОСТ', 'СНИП', 'ТУ', 'ОТ', 'ПБ', 'СМК', 'ERP', 'BPMN', 'DFD', 'BI', 'API', 'XML', 'PDF', 'ИТ', 'IT', 'КПЭ', 'KPI', 'ОРД', 'ДИ', 'СТО']);
  const roleAbbr = (s) => (s.match(/(?<![А-ЯЁA-Za-zа-яё])[А-ЯЁ]{2,5}(?![А-ЯЁA-Za-zа-яё])/g) || []).some((a) => !NOT_ROLE_ABBR.has(a));
  const DOC_SELF = /^(?:(?:настоящ|данн)[а-яё]*\s+)?(?:методик|документ|положени|регламент|стандарт|инструкци|политик|процедур|порядок|правила)[а-яё]*(?:\s|$)/iu;
  const DEFINITION = /^[^,:;]{1,80}?\s[–—-]\s|^[^,:;]{1,60}?\s-\s?это\s|\sпредставля(?:ет|ют)\s+собой\s/iu;
  const SHORT_PART = /(?<![а-яё])(сформулирован|представлен|изображен|обозначен|указан|определен|установлен|утвержден|согласован|оформлен|предусмотрен|описан|отражен|включен|приведен|выделен|зафиксирован|назначен|разработан|подписан|зарегистрирован|доведен|направлен|размещен|заполнен|составлен|обеспечен|учтен|учтён|согласована)(?:ы|а|о)?(?![а-яё])/iu;
  const COMPOSE = /(?<![а-яё])(включа(?:ет|ют)(?:\s+в\s+себя)?|содерж(?:ит|ат)|состо(?:ит|ят)\s+из|предусматрива(?:ет|ют)|охватыва(?:ет|ют))(?![а-яё])/iu;
  // «Ключевым элементом … является …», «Его задача заключается в …» — только такие «является» считаются требованием
  const IS_RX = /^(?:ключев|основн|главн|обязательн|неотъемлем|важнейш|единствен|первоочередн)[а-яё]*\s+(?:[а-яё]+\s+)?(?:элемент|цел|задач|част|услови|требовани|принцип|результат|составляющ)[а-яё]*\s.*?(?<![а-яё])явля(?:ется|ются)(?![а-яё])|(?<![а-яё])(?:задач|цел|назначени)[а-яё]*(?:\s+[^.]{0,80}?)?\s(?:заключа(?:ется|ются)|состо(?:ит|ят))\s+в(?![а-яё])/iu;
  const RESP = /(?<![а-яё])ответственност[а-яё]*\s+за\s.+?(?<![а-яё])нес(?:[её]т|ут)(?![а-яё])|(?<![а-яё])нес(?:[её]т|ут)\s+(?:персональную\s+|личную\s+)?ответственност/iu;
  const ATTENTION = /(?<![а-яё])(особое\s+)?внимание\s+(?:следует\s+)?уделя(?:ется|ют)|уделя(?:ется|ют)\s+(?:особое\s+)?внимание/iu;
  const VN = /^(?:[а-яё]+(?:ое|ая|ий|ый|ее|ие|ые|ой)\s+){0,2}(описани|обозначени|изложени|перечислени|стандартизаци|минимизаци|определени|указани|разделени|наличи|использовани|соблюдени|обеспечени|проведени|согласовани|утверждени|актуализаци|подготовк|контрол|хранени|регистраци|оформлени|разработк|формировани|ведени[ея]|предоставлени|назначени[ея]\s|выполнени|осуществлени|анализ|оценк|проверк|мониторинг|фиксаци|документировани|информировани|уведомлени|рассмотрени|направлени[ея]\s|организаци|планировани|уч[её]т|отражени|детализаци|классификаци|демонстраци|завершени|применени|установлени|представлени|включени|выявлени|устранени|исключени|сохранени|архивировани|доведени|отображени|визуализаци|ограничени|разграничени|защит|резервировани|копировани|тестировани|обучени|инструктаж|привязк|сопровождени|поддержани|приведени|получени|передач|размещени|публикаци|подписани|визировани|заключени|ознакомлени|экспертиз|консультировани|взаимодействи|инвентаризаци|расследовани|аттестаци|сертификаци|калибровк|поверк)[а-яё]*/iu;
  const NORM_TITLE = /требовани|правил|принцип|порядок|обязанност|ответственност|полномочи|запрет|ограничени|услови[яй] (?:выполнени|проведени|применени)/iu;
  const NO_IMPLICIT = /термин|сокращени|определени|обозначени|область применения|назначение документа|нормативн\S* ссылк|ссылки|библиограф|истори\S* изменени|регистраци\S* изменени|лист (?:согласования|ознакомления)|приложени\S* \S+\s*$/iu;

  // Модальность предложения без «должен»: {mod, why} или null. norm — пункт в разделе с требованиями или правилами.
  function implicitOf(s, inNorm) {
    const t = String(s).trim();
    if (t.length < 12 || /\?$/.test(t)) return null;
    if (ATTENTION.test(t)) return 'should';
    if (RESP.test(t)) return 'shall';
    const def = DEFINITION.test(t);
    const v = VERB_RX.exec(t);
    if (v && !def) {
      const subj = t.slice(0, v.index).split(/[:;]/).pop(); // подлежащее — после последнего двоеточия
      const passive = /ся$/i.test(v[0]);
      const words = subj.split(/\s+/).filter(Boolean).length;
      if (!/(?<![а-яё])(котор|чтобы|что(?![а-яё]))/iu.test(subj) && words <= 14 && !DOC_SELF.test(subj.replace(/^[,\s]+/, ''))) {
        if (passive && !/(?<![а-яё])позволя/iu.test(t)) return 'shall';
        if (!passive && (ROLE_RX.test(subj) || roleAbbr(subj))) return 'shall';
      }
    }
    if (!inNorm) return null;
    // «ФМ представляет собой описание, которое включает две составляющие» — в разделе требований это требование к составу
    if (def && !(COMPOSE.test(t) && !/^[^,:;]{1,80}?\s[–—-]\s/u.test(t))) return null;
    if (COMPOSE.test(t) || IS_RX.test(t) || SHORT_PART.test(t)) return 'shall';
    return null;
  }
  // Пункт перечня — именная группа («подробное изложение этапов…», «обозначение форматов хранения»)
  const nominalItem = (s) => { const x = String(s).trim(); const c = x.indexOf(': '); return VN.test(x) || (c > 0 && c < 90 && VN.test(x.slice(c + 2))); };
  // Таблица ответственности: «Участник | Функция», «Действие | Ответственный | Срок»
  function dutyTable(rows) {
    if (!rows || rows.length < 2) return null;
    const head = rows[0].map(cellText);
    const who = head.findIndex((h) => /^(участник|роль|ответственн|исполнител|подразделени|должност|кто|субъект)/iu.test(h));
    const what = head.findIndex((h, i) => i !== who && /^(функци|действи|операци|шаг|мероприяти|работ[аы]|наименование (?:этапа|работ|операци|действи|мероприяти)|содержание|этап|обязанност|ответственност|полномочи|задач|что делает)/iu.test(h));
    if (who < 0 || what < 0) return null;
    const when = head.findIndex((h, i) => i !== who && i !== what && /^(срок|когда|периодичност|время)/iu.test(h));
    return { who, what, when };
  }
  // «A должен X, а также Y» → два требования; Y — инфинитив или краткое причастие после «должен быть»
  function splitAlso(s) {
    const parts = s.split(/,\s+а\s+также\s+|;\s+а\s+также\s+/u);
    if (parts.length !== 2) return [s];
    const m = parts[0].match(/^(.*?(?<![а-яё])(?:не\s+)?(?:долж(?:ен|на|но|ны)|обязан[аоы]?|следует|необходимо|требуется)(?![а-яё]))(\s+быть)?/iu);
    if (!m) return [s];
    const second = parts[1].trim();
    const first = parts[0].trim();
    const w = second.split(/\s+/);
    const firstWord = /^(четко|чётко|подробно|детально|полностью|ясно|наглядно|обязательно|своевременно|также)$/i.test(w[0]) ? 1 : 0;
    const head = (w[firstWord] || '').toLowerCase();
    if (/(ть|ться|ти|чь)$/.test(head) && !m[2]) return [first, `${m[1]} ${second}`];
    if (m[2] && /(н|ны|на|но|ен|ён)$/.test(head)) {
      const agree = /ны$/.test(head) ? 'должны' : /на$/.test(head) ? 'должна' : /но$/.test(head) ? 'должно' : 'должен';
      return [first, `${m[1].replace(/долж(?:ен|на|но|ны)$/iu, agree)}${m[2]} ${second}`];
    }
    return [s];
  }

  /* ---------- Предложения ---------- */
  const ABBR = ['т.е.', 'т.п.', 'т.д.', 'т.ч.', 'и др.', 'др.', 'п.', 'пп.', 'ст.', 'г.', 'гг.', 'рис.', 'табл.', 'см.', 'стр.', 'ч.', 'разд.', 'прил.', 'ед.', 'им.', 'напр.', 'мм.', 'руб.'];
  function sentences(text) {
    let t = String(text);
    const keep = [];
    ABBR.forEach((a) => {
      const re = new RegExp(a.replace(/\./g, '\\.').replace(/ /g, '\\s'), 'gi');
      t = t.replace(re, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0002`; });
    });
    t = t.replace(/(\d)\.(\d)/g, '$1\u0003$2');
    const parts = t.split(/(?<=[.!?;])\s+(?=[«"(]?[А-ЯЁA-Z0-9])|(?<=;)\s+/);
    return parts.map((p) => p.replace(/\u0003/g, '.').replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i])).map((p) => p.trim()).filter(Boolean);
  }

  /* ---------- Построение XML ---------- */
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
  const el = (n, a, c) => ({ n, a: a || {}, c: c == null ? [] : c });
  function ser(node, depth) {
    const pad = ' '.repeat(depth);
    const attrs = Object.entries(node.a).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    if (typeof node.c === 'string') return `${pad}<${node.n}${attrs}>${escText(node.c)}</${node.n}>`;
    if (!node.c.length) return `${pad}<${node.n}${attrs}/>`;
    return `${pad}<${node.n}${attrs}>\n${node.c.map((x) => ser(x, depth + 1)).join('\n')}\n${pad}</${node.n}>`;
  }

  /* ---------- Структура документа из блоков ---------- */
  // Блок: {type:'p', text, label, labelKind:'num'|'letter'|'other', bullet, heading, styleName} | {type:'table', rows:[[{lines}]]}
  const depthOf = (label) => (label.match(/\d+/g) || []).length;
  const plausibleLabel = (l) => !/^\d{4}$/.test(l) && !(l.split('.').slice(1).some((x) => x === '0')) && depthOf(l) <= 6;
  const cleanLabel = (l) => norm(l).replace(/[.)\s]+$/, (m) => (m.includes(')') ? ')' : ''));
  function headingLevel(b) {
    if (b.type !== 'p') return 0;
    if (b.heading) return Math.min(b.heading, 3);
    if (/^приложение\s+\S+/i.test(b.label || '') || /^приложение\s+[\dА-ЯЁA-Z]+\.?(\s|$)/i.test(b.text)) return b.text.length < 160 ? 1 : 0;
    if (b.labelKind === 'num' && depthOf(b.label) <= 2 && b.text.length <= 120 && !/[.;:,]$/.test(b.text) && !/_{2,}/.test(b.text) && /^[«"(]?[А-ЯЁA-Z]/.test(b.text) && !modalityOf(b.text)) return depthOf(b.label);
    return 0;
  }
  const isTermsTable = (t) => t.rows.length > 1 && /термин/i.test(cellText(t.rows[0][0])) && t.rows[0].length >= 2 && /определени/i.test(cellText(t.rows[0][1]));
  const cellText = (c) => norm((c && c.lines ? c.lines : []).join(' '));

  function metaFromTables(tables, meta) {
    const KEYS = [
      [/^(название|наименование документа|наименование)$/i, 'title'], [/^(идентификатор|обозначение|код документа|шифр)$/i, 'id'],
      [/^(версия|редакция)$/i, 'version'], [/^(наименование процесса|процесс)$/i, 'process'], [/^владелец процесса$/i, 'owner'],
      [/^менеджер процесса$/i, 'manager'], [/^разработчик/i, 'developer'], [/^методолог/i, 'methodologist'], [/^(вид документа|тип документа)$/i, 'docType'],
    ];
    tables.forEach((t) => {
      const head = t.rows[0] ? t.rows[0].map(cellText) : [];
      if (head.length >= 3 && /^версия$/i.test(head[0]) && head.some((h) => /основание/i.test(h))) {
        const iDate = head.findIndex((h) => /дата/i.test(h)), iBasis = head.findIndex((h) => /основание/i.test(h)), iDesc = head.findIndex((h) => /описание/i.test(h));
        meta.changes = t.rows.slice(1).map((r) => ({ version: cellText(r[0]), date: iDate >= 0 ? cellText(r[iDate]) : '', basis: iBasis >= 0 ? cellText(r[iBasis]) : '', description: iDesc >= 0 ? cellText(r[iDesc]) : '' })).filter((c) => c.version || c.description);
        return;
      }
      t.rows.forEach((r) => {
        if (r.length < 2) return;
        const k = cellText(r[0]);
        const hit = KEYS.find(([re]) => re.test(k));
        if (!hit) return;
        const lines = (r[1].lines || []).map(norm).filter(Boolean);
        const v = norm(lines.join(' '));
        if (!v) return;
        const key = hit[1];
        if (key === 'process') meta.processLines = lines;
        else if (['owner', 'manager', 'methodologist', 'developer'].includes(key)) meta[key + 'Lines'] = lines;
        else if (!meta[key]) meta[key] = v;
      });
    });
  }
  const PERSON = /([А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.)\s*$/;
  function splitParty(lines) {
    // «Должность Фамилия И.О.» или должность и ФИО отдельными строками
    const out = [];
    let pos = '';
    (lines || []).forEach((l) => {
      const m = l.match(PERSON);
      if (m && norm(l.slice(0, m.index))) out.push({ text: norm(l.slice(0, m.index)), person: m[1] });
      else if (m && pos) { out.push({ text: pos, person: m[1] }); pos = ''; }
      else if (m) out.push({ text: '', person: m[1] });
      else { if (pos) out.push({ text: pos }); pos = l; }
    });
    if (pos) out.push({ text: pos });
    return out.filter((p) => p.text || p.person);
  }

  function buildIsm(blocks, meta, opts) {
    const ids = new Set();
    const uid = (base) => { let x = base, i = 2; while (ids.has(x)) x = `${base}-${i++}`; ids.add(x); return x; };
    const code = ncname(meta.id || opts.fileStem, 'DOC').toUpperCase().replace(/^N(?=\d)/, 'D');
    const report = { sections: 0, clauses: 0, requirements: 0, explicit: 0, implicit: 0, derived: 0, tables: 0, terms: 0, warnings: [] };
    const terms = [];
    const refs = [];
    const objects = new Map();
    const level = opts.level || 'L2';
    let tempNo = opts.tempStart || 1;
    const today = opts.today;

    // 1. Тело начинается с первого заголовка или нумерованного пункта; всё до него — титул и сводные таблицы
    let start = blocks.findIndex((b) => b.type === 'p' && (headingLevel(b) || b.labelKind === 'num'));
    if (start < 0) start = 0;
    const pre = blocks.slice(0, start);
    metaFromTables(pre.filter((b) => b.type === 'table'), meta);
    if (!meta.title && meta.coreTitle && !/укажите|введите|название документа|заголовок/i.test(meta.coreTitle)) meta.title = meta.coreTitle;
    if (!meta.title) {
      const cand = pre.filter((b) => b.type === 'p' && b.text.length > 15 && b.text.length < 200
        && !/^(оглавление|содержание|сводная информация|регистрация изменений|лист (согласования|ознакомления|регистрации изменений))$/i.test(b.text)
        && !/^(название|идентификатор|наименование процесса|владелец процесса|менеджер процесса|разработчик|методолог|версия|дата|основание|описание изменения)/i.test(b.text)
        && !/[А-ЯЁ]\.\s?[А-ЯЁ]\./.test(b.text) && !/_{2,}/.test(b.text) && !/^[A-ZА-ЯЁ]\d+(\.\d+)*\s/.test(b.text)
        && !/error|reference source|ошибка|не найден/i.test(b.text));
      const typed = cand.find((b) => /^(методика|регламент|положение|стандарт|инструкция|политика|процедура|техническое задание|порядок|правила)\s/i.test(b.text));
      // В PDF без таблиц строки сводной информации похожи на заголовок, поэтому берём только крупный шрифт
      const pick = typed || (opts.kind === 'pdf' ? cand.find((b) => b.h && meta.bodySize && b.h >= meta.bodySize * 1.25) : cand[0]);
      if (pick) meta.title = pick.text;
    }
    if (!meta.title) report.warnings.push('Название документа не найдено — укажите его в XML (metadata/title).');
    const body = blocks.slice(start);
    if (!body.some((b) => b.type === 'p')) report.warnings.push('В документе не найден текст абзацев.');

    // 2. Разделы и пункты
    const secs = [];
    let top = null, sub = null, clause = null, subclause = null;
    let pCount = 0;
    const curSection = () => sub || top || (top = newSection('', opts.fileStem ? 'Текст документа' : 'Документ', 1));
    function newSection(number, title, lvl) {
      const s = { kind: 'section', id: uid(`S-${ncname(number || title.slice(0, 24), 'sec')}`), number, title, items: [], lvl };
      report.sections++;
      if (lvl === 1 || !top) { secs.push(s); top = s; sub = null; } else { top.items.push(s); sub = s; }
      clause = null; subclause = null;
      return s;
    }
    function newClause(number, label) {
      const sec = curSection();
      const base = number ? `CL-${ncname(number, 'p')}` : `CL-${sec.id.replace(/^S-/, '')}-${++pCount}`;
      const c = { kind: 'clause', id: uid(base), number, label: label || '', text: [], subs: [], reqs: [] };
      report.clauses++;
      if (label && clause) { clause.subs.push(c); subclause = c; } else { sec.items.push(c); clause = c; subclause = null; }
      return c;
    }
    const target = () => subclause || clause || newClause('', '');
    let lastList = null;

    body.forEach((b) => {
      if (b.type === 'figure') { target().text.push({ kind: 'figure', src: b.src, alt: b.alt }); lastList = null; return; }
      if (b.type === 'table') {
        report.tables++;
        if (isTermsTable(b)) {
          b.rows.slice(1).forEach((r) => {
            const name = cellText(r[0]), def = (r[1] && r[1].lines ? r[1].lines.map(norm).filter(Boolean) : []);
            if (!name || !def.length) return;
            const m = name.match(/^(.*?)\s*\(([^()]{1,40})\)\s*$/);
            terms.push({ name: m ? m[1] : name, abbr: m ? m[2] : '', def: def[0], notes: def.slice(1) });
          });
          report.terms = terms.length;
          curSection().items.push({ kind: 'termList' });
          clause = null; subclause = null; lastList = null;
          return;
        }
        const sec = curSection();
        const head = b.rows[0].map(cellText);
        if (/нормативн|ссылк/i.test(sec.title) && head.some((h) => /^(id|обозначение|номер документа)$/i.test(h))) {
          const iId = head.findIndex((h) => /^(id|обозначение|номер документа)$/i.test(h));
          const iName = head.findIndex((h) => /наименовани/i.test(h));
          b.rows.slice(1).forEach((r) => {
            const idt = cellText(r[iId]), title = iName >= 0 ? cellText(r[iName]) : '';
            if (idt || title) refs.push({ identifier: idt || title, title: title || idt });
          });
          sec.items.push({ kind: 'referenceList' });
          clause = null; subclause = null; lastList = null;
          return;
        }
        target().text.push({ kind: 'table', rows: b.rows });
        lastList = null;
        return;
      }
      if (!b.text) return;
      let hl = headingLevel(b);
      if (hl && !b.heading && b.labelKind === 'num' && top && /^приложение/i.test(top.number || '')) hl = 0;
      if (hl) {
        let number = b.labelKind === 'num' || /^приложение/i.test(b.label || '') ? cleanLabel(b.label) : '';
        let title = b.text;
        const app = !number && b.text.match(/^(приложение\s+[\dА-ЯЁA-Z]+)\.?\s*(.*)$/i);
        if (app) { number = upperFirst(app[1]); title = app[2] || app[1]; }
        newSection(number, title, hl === 1 ? 1 : 2);
        lastList = null;
        return;
      }
      if (b.bullet) {
        const t = target();
        const lt = t.text[t.text.length - 1];
        if (lt && lt.kind === 'list' && lastList === lt) lt.items.push(b.text);
        else { const l = { kind: 'list', style: b.listStyle || 'dash', items: [b.text] }; t.text.push(l); lastList = l; }
        return;
      }
      lastList = null;
      if (b.labelKind === 'num') { newClause(cleanLabel(b.label), '').text.push({ kind: 'p', text: b.text }); return; }
      if (b.labelKind === 'letter' && (clause || subclause)) {
        if (subclause) subclause = null;
        newClause('', cleanLabel(b.label)).text.push({ kind: 'p', text: b.text });
        return;
      }
      target().text.push({ kind: 'p', text: (b.labelKind === 'other' && b.label ? b.label + ' ' : '') + b.text });
    });

    // 3. Требования из пунктов
    const docSource = meta.title || opts.fileName;
    function reqsForClause(c, sec) {
      const out = [];
      const add = (statement, quote, modality, basis, source) => {
        const nn = String(out.length + 1).padStart(2, '0');
        const cite = c.number || (c.label ? `${(c.parentNumber || '')} ${c.label}`.trim() : sec.number ? `${sec.number}` : '');
        const objName = guessObject(statement);
        let objId = null;
        if (objName) {
          const key = objName.toLowerCase();
          if (!objects.has(key)) objects.set(key, { id: uid(`OBJ-${objects.size + 1}`), name: objName });
          objId = objects.get(key).id;
        }
        out.push({
          id: uid(`REQ-${code}-${ncname(c.number || (c.parentNumber ? c.parentNumber + c.label : '') || c.id.replace(/^CL-/, ''), 'p')}-${nn}`),
          number: cite, modality, basis, source, statement, quote, title: autoTitle(statement), objId,
          temp: `TEMP-${today}-${String(tempNo++).padStart(3, '0')}`,
        });
        report.requirements++;
        if (basis === 'explicit') report.explicit++; else report.implicit++;
        if (source === 'derived') report.derived++;
      };
      // Раздел с требованиями или правилами: там описательные формулировки и перечни — тоже требования
      const lead0 = c.text[0] && c.text[0].kind === 'p' ? c.text[0].text : '';
      const inNorm = !NO_IMPLICIT.test(sec.title || '') && (NORM_TITLE.test(sec.title || '') || NORM_TITLE.test(lead0) || !!c.normCtx);
      const quiet = NO_IMPLICIT.test(sec.title || '');
      c.subs.forEach((sc) => { sc.normCtx = inNorm || NORM_TITLE.test(lead0); });
      const sentence = (s, src = 'authoritative') => {
        const m = modalityOf(s);
        if (m) { splitAlso(s).forEach((x, k) => add(finish(x), s, m, 'explicit', k ? 'derived' : src)); return true; }
        if (quiet) return false;
        const im = implicitOf(s, inNorm);
        if (im) { add(finish(s), s, im, 'implicit', src); return true; }
        return false;
      };
      // Подзаголовок внутри пункта: с заглавной буквы, коротко, без глагола-действия; или вводная фраза с двоеточием
      const headingLike = (x) => /:\s*$/.test(x) || (/^[«"(]?[А-ЯЁA-Z0-9]/.test(x) && x.length <= 120 && !/[.!?;]$/.test(x) && !VERB_RX.test(x) && !modalityOf(x));
      for (let i = 0; i < c.text.length; i++) {
        const blk = c.text[i];
        if (blk.kind === 'p') {
          const next = c.text[i + 1];
          const leadMod = modalityOf(blk.text);
          const leadText = blk.text.replace(/:\s*$/, '');
          if (next && next.kind === 'list' && headingLike(blk.text)) {
            const compose = COMPOSE.test(leadText);
            const normLead = inNorm || NORM_TITLE.test(leadText) || compose || !!leadMod;
            next.items.forEach((it) => {
              const item = it.replace(/[;.,:]\s*$/, '').trim();
              if (sentences(it).map((s) => sentence(s)).some(Boolean)) return;
              if (quiet || !normLead || DEFINITION.test(item)) return;
              if (leadMod || compose) add(finish(`${leadText} ${lowerFirst(item)}`), item, leadMod || 'shall', leadMod ? 'explicit' : 'implicit', 'derived');
              else if (nominalItem(item)) add(finish(`${leadText}: ${lowerFirst(item)}`), item, 'shall', 'implicit', 'derived');
            });
            i++;
            continue;
          }
          if (headingLike(blk.text) && !modalityOf(blk.text) && !/:\s/.test(blk.text)) continue; // подзаголовок внутри пункта
          let found = false;
          sentences(blk.text).forEach((s) => { if (sentence(s)) found = true; });
          // «Четкость и простота структуры: минимизация количества пересекающихся линий»
          if (!found && inNorm && !quiet && /^[^:]{3,80}:\s/.test(blk.text) && nominalItem(blk.text)) add(finish(blk.text), blk.text, 'shall', 'implicit', 'authoritative');
        } else if (blk.kind === 'list') {
          blk.items.forEach((it) => {
            const item = it.replace(/[;.,:]\s*$/, '').trim();
            if (sentences(it).map((s) => sentence(s)).some(Boolean)) return;
            if (inNorm && !quiet && !DEFINITION.test(item) && nominalItem(item)) add(finish(item), item, 'shall', 'implicit', 'authoritative');
          });
        } else if (blk.kind === 'table') {
          const duty = quiet ? null : dutyTable(blk.rows);
          if (duty) {
            blk.rows.slice(1).forEach((r) => {
              const who = cellText(r[duty.who]);
              const when = duty.when >= 0 ? cellText(r[duty.when]) : '';
              const lines = (r[duty.what] && r[duty.what].lines ? r[duty.what].lines : []).flatMap((ln) => ln.split(/;\s*/)).map(norm).map((x) => x.replace(/[;.,]\s*$/, '')).filter(Boolean);
              lines.forEach((ln) => {
                const m = modalityOf(ln);
                add(finish(`${who ? who + ': ' : ''}${who ? lowerFirst(ln) : ln}${when ? ` (срок: ${when})` : ''}`), ln, m || 'shall', m ? 'explicit' : 'implicit', 'derived');
              });
            });
          } else {
            blk.rows.forEach((r) => r.forEach((cell) => (cell.lines || []).forEach((ln) => sentences(ln).forEach((s) => { const m = modalityOf(s); if (m) add(finish(s), s, m, 'explicit', 'authoritative'); }))));
          }
        }
      }
      c.reqs = out;
      c.subs.forEach((sc) => { sc.parentNumber = c.number; reqsForClause(sc, sec); });
    }
    const walk = (s) => s.items.forEach((it) => { if (it.kind === 'section') walk(it); else if (it.kind === 'clause') reqsForClause(it, s); });
    secs.forEach(walk);

    // 4. Сборка XML
    const party = (lines, role) => splitParty(lines).map((p) => el(role === 'developer' ? 'developer' : role, { role: role === 'owner' ? 'process-owner' : role === 'manager' ? 'process-manager' : role, person: p.person }, p.text || p.person));
    const procLine = (meta.processLines || []).slice(-1)[0] || '';
    const pm = procLine.match(/^([A-ZА-ЯЁ]\d+(?:\.\d+)*)\s+(.*)$/);
    const md = el('metadata', {}, [
      el('title', {}, meta.title || opts.fileStem),
      el('documentType', { code: typeOf(meta.docCode, meta.docType, meta.title) || meta.docCode || '' }, DOC_TYPES[typeOf(meta.docCode, meta.docType, meta.title)] || meta.docType || 'Документ'),
      ...(meta.org ? [el('organization', {}, meta.org)] : []),
      el('processRef', { id: pm ? pm[1] : '' }, pm ? pm[2] : procLine || 'не указан'),
      ...((meta.processLines || []).length > 1 ? [el('processPath', {}, meta.processLines.map((l) => { const x = l.match(/^([A-ZА-ЯЁ]\d+(?:\.\d+)*)\s+(.*)$/); return el('process', { id: x ? x[1] : '' }, x ? x[2] : l); }).filter((p) => p.a.id))] : []),
    ]);
    if (md.c[md.c.length - 1].n === 'processPath' && !md.c[md.c.length - 1].c.length) md.c.pop();
    const owners = party(meta.ownerLines, 'owner');
    md.c.push(owners[0] || el('owner', { role: 'process-owner' }, 'не указан'));
    const mgr = party(meta.managerLines, 'manager'); if (mgr[0]) md.c.push(mgr[0]);
    party(meta.developerLines, 'developer').forEach((d) => md.c.push(d));
    const mth = party(meta.methodologistLines, 'methodologist'); if (mth[0]) md.c.push(el('methodologist', { role: 'ism-methodologist', person: mth[0].a.person }, mth[0].c));

    const root = el('ismDocument', { xmlns: NS, 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', 'xsi:schemaLocation': `${NS} ism-regulation-v1.xsd`, id: meta.id || opts.fileStem, version: meta.version || 'не указана', status: 'draft' }, [md]);
    if (meta.changes && meta.changes.length) {
      root.c.push(el('changeHistory', {}, meta.changes.map((c) => el('change', { version: c.version || '—', date: /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date : '' }, [...(c.basis ? [el('basis', {}, c.basis)] : []), el('description', {}, c.description || '—')]))));
    }
    if (terms.length) {
      root.c.push(el('terms', {}, terms.map((t, i) => el('term', { id: uid(`TERM-${i + 1}`) }, [el('name', {}, t.name), ...(t.abbr ? [el('abbreviation', {}, t.abbr)] : []), el('definition', {}, t.def), ...t.notes.map((n) => el('note', {}, n))]))));
    }
    if (objects.size) root.c.push(el('objects', {}, Array.from(objects.values()).map((o) => el('object', { id: o.id, type: 'object' }, [el('name', {}, o.name)]))));

    const textNode = (blocks) => el('text', {}, blocks.map((b) => {
      if (b.kind === 'p') return el('p', {}, b.text);
      if (b.kind === 'figure') return el('figure', { src: b.src, alt: b.alt });
      if (b.kind === 'list') return el('list', { style: b.style }, b.items.map((t) => el('item', {}, t)));
      const rows = b.rows.map((r) => r.map((cell) => {
        const lines = (cell.lines || []).map(norm).filter(Boolean);
        return lines.length > 1 ? el('cell', {}, lines.map((l) => el('p', {}, l))) : el('cell', {}, lines[0] || '');
      }));
      return el('table', {}, rows.length > 1 ? [el('head', {}, rows[0]), ...rows.slice(1).map((r) => el('row', {}, r))] : rows.map((r) => el('row', {}, r)));
    }));
    const reqNode = (r) => el('requirement', { id: r.id, number: r.number, modality: r.modality, modalityBasis: r.basis, category: categoryOf(r.statement), categoryStatus: 'preliminary', source: r.source }, [
      el('title', {}, r.title), el('statement', {}, r.statement), el('quote', {}, r.quote),
      ...(r.objId ? [el('object', { ref: r.objId })] : []),
      el('registry', { id: r.temp, level, status: 'draft', version: '0.1' }, [el('remark', {}, `Карточка создана автоматически из файла «${opts.fileName}»: наименование${r.objId ? ' и объект' : ''} предложены по тексту; владелец, критичность и критерий приёмки не заполнены.`)]),
    ]);
    const clauseNode = (c) => el('clause', { id: c.id, number: c.number, label: c.label, type: c.reqs.length ? 'normative' : 'informative' }, [
      ...(c.text.length ? [textNode(c.text)] : []), ...c.reqs.map(reqNode), ...c.subs.map(clauseNode),
    ]);
    const secNode = (s) => el('section', { id: s.id, number: s.number, title: s.title, kind: /^приложение/i.test(s.number) ? 'appendix' : '' }, s.items.map((it) => {
      if (it.kind === 'section') return secNode(it);
      if (it.kind === 'termList') return el('termList');
      if (it.kind === 'referenceList') return el('referenceList');
      return clauseNode(it);
    }));
    root.c.push(el('body', {}, secs.length ? secs.map(secNode) : [el('section', { id: uid('S-1'), title: 'Текст документа' })]));
    if (refs.length) root.c.push(el('references', {}, refs.map((r, i) => el('reference', { id: uid(`REF-${ncname(r.identifier, String(i + 1))}`), type: 'internal', origin: 'source' }, [el('identifier', {}, r.identifier), el('title', {}, r.title)]))));
    const how = opts.kind === 'pdf' ? 'по текстовому слою PDF: таблицы и рисунки не восстанавливаются, нумерация распознана по началу строк'
      : opts.kind === 'vsdx' ? 'по схеме Visio: каждая страница — раздел с рисунком схемы, надписи дорожек и шагов внутри них собраны в таблицу «Участник — Действие», остальные надписи фигур — абзацами сверху вниз'
        : `по стилям и нумерации Word${opts.kind === 'doc' ? ' (формат Word 97–2003)' : ''}: рисунки не переносятся`;
    root.c.push(el('editorialNotes', {}, [el('note', { id: uid('EN-AUTO'), type: 'interpretation' },
      `Документ «${opts.fileName}» разобран автоматически ${how}. Выделено атомарных требований: ${report.requirements}, из них ${report.explicit} — по модальным словам («должен», «следует», «необходимо», «не допускается» и др.), ${report.implicit} — по описательным формулировкам: действия ролей в настоящем времени («ФЗ утверждает ФМ»), страдательный залог («ФМ согласовывается»), перечни под заголовками требований и правил, таблицы ответственности. У таких требований модальность выведена — проверьте их. Владельцы, критичность и критерии приёмки не заполнены.`)]));

    if (!secs.length) report.warnings.push('Не найдено ни одного раздела или пункта.');
    if (!report.requirements) report.warnings.push('Не найдено требований: ни модальных слов («должен», «следует», «не допускается»), ни описательных обязанностей.');
    report.tempNext = tempNo;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${ser(root, 0)}\n`;
    return { xml, report };
  }
  const finish = (s) => upperFirst(s.replace(/[;,]\s*$/, '').trim()).replace(/([^.!?])$/, '$1.');
  function autoTitle(st) {
    let t = st.replace(/[.;]+$/, '');
    const cut = t.search(/[,:(—–]/);
    if (cut > 25) t = t.slice(0, cut);
    if (t.length > 70) { t = t.slice(0, 70); t = t.slice(0, t.lastIndexOf(' ')) + '…'; }
    return t;
  }
  function guessObject(st) {
    const m = st.match(/^(.{2,90}?)\s+(?:не\s+)?(?:долж(?:ен|на|но|ны)|обязан[аоы]?|подлеж(?:ит|ат))(?![а-яё])/i);
    if (!m) return '';
    let o = m[1].replace(/[,;:]$/, '').trim();
    if (o.includes(':')) o = o.slice(o.lastIndexOf(':') + 1).trim();
    if (/^(пункт|раздел|подраздел|документ|настоящий|данный|данная|данное|он|она|это)$/i.test(o)) return '';
    if (/^(в|во|при|для|на|по|после|до|с|со|к|из|от|если|когда|каждый|каждая|каждое|все|он|она|оно|они|это|который|которая)\s/i.test(o + ' ')) return '';
    if (o.split(/\s+/).length > 9 || /[,;]/.test(o)) return '';
    return upperFirst(o);
  }
  /* ---------- Виды документов ИСМ (иерархия: 4 уровня и внешняя документация) ---------- */
  const DOC_LEVELS = [
    { level: 1, name: '1 уровень', purpose: 'стратегическое управление, принятие решений, контроль деятельности' },
    { level: 2, name: '2 уровень', purpose: 'управление деятельностью применительно к процессам' },
    { level: 3, name: '3 уровень', purpose: 'исполнение деятельности' },
    { level: 4, name: '4 уровень', purpose: 'свидетельства о выполнении требований' },
  ];
  const DOC_TYPE_LIST = [
    { code: 'GPL', name: 'Политика', level: 1, description: 'Устанавливает общие требования. Характеризуется широкой областью применения и низкой детализацией' },
    { code: 'GOAL', name: 'Цели', level: 1, description: 'Официально зафиксированные ожидаемые результаты деятельности' },
    { code: 'GDL', name: 'Руководство', level: 1, description: 'Содержит изложение руководящих принципов и основных направлений развития деятельности Предприятия' },
    { code: 'PLC', name: 'Положение', level: 2, description: 'Определяет общие правила и требования к реализации конкретного направления деятельности/процесса — что делаем' },
    { code: 'PCD', name: 'Процедура', level: 2, description: 'Описывает этапы процесса: состав, последовательность, сроки, ответственность, требования к результату и способы его измерения — как делаем' },
    { code: 'STD', name: 'Стандарт', level: 2, description: 'Устанавливает требования к процессу верхнего уровня и его реализации' },
    { code: 'RGL', name: 'Регламент', level: 2, description: 'Описывает состав, структуру и порядок управления процессом' },
    { code: 'SOP', name: 'Стандартная операционная процедура', level: 2, description: 'Содержит только схему процесса, описание ролей и краткое описание процесса на одну-две страницы' },
    { code: 'MTH', name: 'Методика', level: 3, description: 'Содержит конкретные приёмы, техники, технологии и инструменты практических действий в процессах' },
    { code: 'INS', name: 'Инструкция', level: 3, description: 'Свод правил, устанавливающий, разъясняющий и детально раскрывающий порядок и способы выполнения действий' },
    { code: 'REC', name: 'Записи и отчёты', level: 4, description: 'Информация о достигнутых результатах или свидетельства деятельности: шаблоны, чек-листы, журналы, реестры, перечни' },
    { code: 'EXT', name: 'Внешняя документация', level: null, description: 'Документация, созданная за пределами Предприятия: законодательная база, постановления Правительства, ГОСТы, ОСТы, СНиПы, ТУ' },
  ];
  const DOC_TYPES = Object.fromEntries(DOC_TYPE_LIST.map((t) => [t.code, t.name]));
  const TYPE_ALIAS = { POL: 'GPL', PRC: 'PCD', REG: 'RGL', PROC: 'PCD', INSTR: 'INS', MET: 'MTH', GOST: 'EXT' };
  const TYPE_WORDS = [
    [/^стандартн\S* операционн\S* процедур/i, 'SOP'], [/^политик/i, 'GPL'], [/^цел[ьи](?![а-яё])/i, 'GOAL'], [/^руководств/i, 'GDL'],
    [/^положени/i, 'PLC'], [/^процедур/i, 'PCD'], [/^(стандарт|ст[ао]\s)/i, 'STD'], [/^регламент/i, 'RGL'], [/^методик/i, 'MTH'], [/^инструкци/i, 'INS'],
    [/^(реестр|журнал|отч[её]т|чек-?лист|перечень|шаблон|запис[ьи]|протокол|акт)(?![а-яё])/i, 'REC'],
    [/^(гост|ост|снип|сп\s|ту\s|федеральн\S* закон|постановлени|приказ|iso|исо)/i, 'EXT'],
  ];
  // Вид документа по коду (MTH), названию вида («Методика») или заголовку документа
  function typeOf(code, name, title) {
    const c = String(code || '').toUpperCase();
    if (DOC_TYPES[c]) return c;
    if (TYPE_ALIAS[c]) return TYPE_ALIAS[c];
    for (const s of [name, title]) {
      const t = String(s || '').trim();
      const hit = t && TYPE_WORDS.find(([rx]) => rx.test(t));
      if (hit) return hit[1];
    }
    return '';
  }
  const docTypeFromCode = (c) => DOC_TYPES[typeOf(c)] || '';

  /* ---------- Бизнес- или системное требование ---------- */
  // Системное — требование к информационной системе: её функциям, данным, интерфейсам, качеству работы.
  // Бизнес-требование — к процессу, людям, подразделениям, документам.
  const IT_SUBJECT = /(?<![а-яё])(систем[аеуыой]{0,2}(?!\s+(менеджмент|управлени[яе] качеств|качеств|мотиваци|ценност|оплат|стимулир))|модул[ьяюеи]\S*|программ\S*|приложени[еяю](?!\s+[\dа-яёa-z](?![а-яёa-z0-9]))|сервис\S*|портал\S*|интерфейс\S*|баз\S* данных|функционал\S*|сервер\S*)(?![а-яё])/iu;
  const IT_ABBR = /(?<![А-ЯЁа-яёA-Za-z])(ИС|АС|АСУ[А-ЯЁ]*|ПО|БД|API|ERP|САПР|PLM)(?![А-ЯЁа-яёA-Za-z])/u;
  const DOC_SUBJECT = /(?<![а-яё])(раздел\S*|пункт\S*|подраздел\S*|документ\S*|описани\S*|перечень|схем\S*|диаграмм\S*|модел\S*|фм|глав\S*|таблиц\S*|приложени[ея]\s+[\dа-яёa-z](?![а-яёa-z0-9]))(?![а-яё])/iu;
  const IT_BEHAVIOR = /(автоматическ\S*|в (информационной )?системе\s+должн|системой\s+должн|средствами\s+(системы|ис|по)|интеграци\S* с\s|время отклика|резервн\S* копир|разграничени\S* (прав )?доступа|авторизац\S*|аутентификац\S*|шифрован\S*|журнал\S* (событий|аудита)|логировани\S*|отказоустойчив\S*|производительност\S* системы|(?<![а-яё])api(?![а-яё])|(пользовател\S*|оператор\S*)\s+должн\S*\s+(иметь возможность|мочь)|возможност\S* (выгруз|загруз|просмотр|редактир|формирова|поиск|печат|экспорт|импорт|фильтр)\S*)/iu;
  const MODAL_ANY = new RegExp(`${B}(не\\s+)?(долж(?:ен|на|но|ны)|следует|необходимо|обязан[аоы]?|требу(?:ется|ются)|подлеж(?:ит|ат)|надлежит|рекоменду(?:ется|ются)|допуска(?:ется|ются)|запрещ\\S*|обеспечива\\S*|позволя\\S*|формиру\\S*)${E}`, 'iu');
  function categoryOf(text) {
    const t = String(text || '');
    const mm = MODAL_ANY.exec(t);
    if (!mm) return IT_BEHAVIOR.test(t) ? 'system' : 'business'; // без модального слова подлежащее не выделить
    const subject = t.slice(0, mm.index);
    if (DOC_SUBJECT.test(subject)) return IT_BEHAVIOR.test(t) && !/описани|раздел/i.test(subject) ? 'system' : 'business';
    if (IT_SUBJECT.test(subject) || IT_ABBR.test(subject)) return 'system';
    if (IT_BEHAVIOR.test(t)) return 'system';
    return 'business';
  }

  /* ---------- .docx ---------- */
  const wkids = (e, name) => (e ? Array.from(e.childNodes).filter((n) => n.nodeType === 1 && n.localName === name && n.namespaceURI === W) : []);
  const wkid = (e, name) => wkids(e, name)[0] || null;
  const wval = (e) => (e ? e.getAttributeNS(W, 'val') || e.getAttribute('w:val') : null);
  const ROMAN = (n) => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; m.forEach(([v, r]) => { while (n >= v) { s += r; n -= v; } }); return s; };
  const RUS = 'абвгдежзиклмнопрстуфхцчшщэюя';
  function fmtNum(n, fmt) {
    switch (fmt) {
      case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
      case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
      case 'lowerRoman': return ROMAN(n);
      case 'upperRoman': return ROMAN(n).toUpperCase();
      case 'russianLower': return RUS[(n - 1) % RUS.length];
      case 'russianUpper': return RUS[(n - 1) % RUS.length].toUpperCase();
      case 'decimalZero': return String(n).padStart(2, '0');
      case 'none': case 'bullet': return '';
      default: return String(n);
    }
  }

  async function parseDocx(buf) {
    if (!window.JSZip) await loadScript(VENDOR.jszip);
    let zip;
    try { zip = await window.JSZip.loadAsync(buf); } catch (e) { throw new Error('Файл не открывается как .docx. Старый формат .doc нужно пересохранить в Word как .docx.'); }
    const read = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const doc = await read('word/document.xml');
    if (!doc) throw new Error('В архиве нет word/document.xml — это не документ Word .docx.');
    const stylesX = await read('word/styles.xml');
    const numX = await read('word/numbering.xml');
    const coreX = await read('docProps/core.xml');

    const styles = {};
    if (stylesX) Array.from(stylesX.getElementsByTagNameNS(W, 'style')).forEach((s) => {
      const id = s.getAttributeNS(W, 'styleId') || s.getAttribute('w:styleId');
      const pPr = wkid(s, 'pPr'); const np = wkid(pPr, 'numPr');
      styles[id] = {
        name: wval(wkid(s, 'name')) || id, basedOn: wval(wkid(s, 'basedOn')),
        numId: np ? wval(wkid(np, 'numId')) : null, ilvl: np && wkid(np, 'ilvl') ? +wval(wkid(np, 'ilvl')) : null,
        outline: wkid(pPr, 'outlineLvl') ? +wval(wkid(pPr, 'outlineLvl')) : null,
      };
    });
    const styleProp = (id, prop, guard = 0) => { const s = styles[id]; if (!s || guard > 12) return null; if (s[prop] !== null && s[prop] !== undefined) return s[prop]; return s.basedOn ? styleProp(s.basedOn, prop, guard + 1) : null; };

    const abstracts = {}; const nums = {};
    if (numX) {
      Array.from(numX.getElementsByTagNameNS(W, 'abstractNum')).forEach((a) => {
        const aid = a.getAttributeNS(W, 'abstractNumId') || a.getAttribute('w:abstractNumId');
        const lv = {};
        wkids(a, 'lvl').forEach((l) => {
          const il = +(l.getAttributeNS(W, 'ilvl') || l.getAttribute('w:ilvl'));
          lv[il] = { start: wkid(l, 'start') ? +wval(wkid(l, 'start')) : 1, fmt: wval(wkid(l, 'numFmt')) || 'decimal', text: wval(wkid(l, 'lvlText')) ?? '' };
        });
        abstracts[aid] = lv;
      });
      Array.from(numX.getElementsByTagNameNS(W, 'num')).forEach((n) => {
        const id = n.getAttributeNS(W, 'numId') || n.getAttribute('w:numId');
        const over = {};
        wkids(n, 'lvlOverride').forEach((o) => { const il = +(o.getAttributeNS(W, 'ilvl') || o.getAttribute('w:ilvl')); const so = wkid(o, 'startOverride'); if (so) over[il] = +wval(so); });
        nums[id] = { aid: wval(wkid(n, 'abstractNumId')), over };
      });
    }
    const counters = {};
    const seenNum = new Set();
    function label(numId, ilvl) {
      const nm = nums[numId]; if (!nm) return null;
      const lv = abstracts[nm.aid]; if (!lv || !lv[ilvl]) return null;
      if (lv[ilvl].fmt === 'bullet') return { bullet: true };
      const key = nm.aid;
      const c = counters[key] || (counters[key] = []);
      if (!seenNum.has(numId)) {
        // новый экземпляр списка со startOverride начинает нумерацию заново
        seenNum.add(numId);
        Object.keys(nm.over).forEach((il) => { for (let i = +il; i < 9; i++) c[i] = undefined; });
      }
      const startOf = (i) => (nm.over[i] ?? (lv[i] ? lv[i].start : 1));
      c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl] + 1;
      for (let i = ilvl + 1; i < 9; i++) c[i] = undefined;
      const text = lv[ilvl].text.replace(/%(\d)/g, (_, k) => { const i = +k - 1; const v = c[i] === undefined ? startOf(i) : c[i]; return fmtNum(v, lv[i] ? lv[i].fmt : 'decimal'); });
      const fmt = lv[ilvl].fmt;
      const kind = /letter|russian/i.test(fmt) && !/\d/.test(text) ? 'letter' : /^[\d.\s]+$/.test(text) && /\d/.test(text) ? 'num' : 'other';
      return { text, kind, bullet: false };
    }

    const pText = (p) => {
      let t = '';
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          const ln = c.localName;
          if (ln === 't' && c.namespaceURI === W) t += c.textContent;
          else if ((ln === 'tab' || ln === 'br' || ln === 'cr') && c.namespaceURI === W) t += ' ';
          else if (ln === 'instrText' || ln === 'delText' || ln === 'pPr' || ln === 'rPr') continue;
          else if (ln === 'fldSimple' || ln === 'hyperlink' || ln === 'r' || ln === 'smartTag' || ln === 'ins' || ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml') walk(c);
        }
      };
      walk(p);
      return norm(t);
    };

    const blocks = [];
    let inToc = false;
    function para(p) {
      const pPr = wkid(p, 'pPr');
      const sid = wval(wkid(pPr, 'pStyle'));
      const sname = (styleProp(sid, 'name') || sid || '').toString();
      if (/^toc|оглавлен|table of contents/i.test(sname)) return;
      const text = pText(p);
      if (!text) return;
      if (/^(оглавление|содержание)$/i.test(text)) { inToc = true; return; }
      if (inToc && /\s\d+$/.test(text) && text.length < 140) return;
      inToc = false;
      const np = wkid(pPr, 'numPr');
      let numId = np ? wval(wkid(np, 'numId')) : styleProp(sid, 'numId');
      let ilvl = np && wkid(np, 'ilvl') ? +wval(wkid(np, 'ilvl')) : (styleProp(sid, 'ilvl') ?? 0);
      let outline = wkid(pPr, 'outlineLvl') ? +wval(wkid(pPr, 'outlineLvl')) : styleProp(sid, 'outline');
      let heading = null;
      const hm = sname.match(/^(?:heading|заголовок)\s*(\d)/i);
      if (hm) heading = +hm[1];
      else if (outline !== null && outline !== undefined && outline < 3) heading = outline + 1;
      else if (/заголовок приложения|appendix/i.test(sname)) heading = 1;
      const b = { type: 'p', text, styleName: sname, heading };
      if (numId && numId !== '0') {
        const lb = label(numId, ilvl);
        if (lb && lb.bullet) b.bullet = true;
        else if (lb && lb.text) { b.label = lb.text; b.labelKind = lb.kind; }
      }
      if (!b.label && !b.bullet) {
        const m = text.match(/^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/);
        if (m && plausibleLabel(m[1])) { b.label = m[1]; b.labelKind = 'num'; b.text = m[2]; }
      }
      blocks.push(b);
    }
    function table(tbl) {
      const rows = wkids(tbl, 'tr').map((tr) => wkids(tr, 'tc').map((tc) => {
        const lines = [];
        const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (c.localName === 'p') { const t = pText(c); if (t) lines.push(t); } else if (c.localName === 'tbl') walk(c); else if (c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'tr' || c.localName === 'tc') walk(c); } };
        walk(tc);
        return { lines };
      }));
      const nonEmpty = rows.filter((r) => r.some((c) => c.lines.length));
      if (nonEmpty.length) blocks.push({ type: 'table', rows: nonEmpty });
    }
    const bodyEl = doc.getElementsByTagNameNS(W, 'body')[0];
    const walkBody = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
        if (c.localName === 'p') para(c);
        else if (c.localName === 'tbl') table(c);
        else if (c.localName === 'sdt') {
          const gal = c.getElementsByTagNameNS(W, 'docPartGallery')[0];
          if (gal && /table of contents/i.test(wval(gal) || '')) continue;
          const cont = wkid(c, 'sdtContent'); if (cont) walkBody(cont);
        }
      }
    };
    walkBody(bodyEl);
    const meta = {};
    if (coreX) { const t = coreX.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]; if (t && norm(t.textContent).length > 3) meta.coreTitle = norm(t.textContent); }
    return { blocks, meta };
  }

  /* ---------- Visio ---------- */
  const b64utf8 = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  async function parseVisio(buf, fileStem) {
    if (!window.JSZip) await loadScript(VENDOR.jszip);
    await loadScript(VENDOR.visio);
    const v = await window.ISM.visio.parse(buf);
    const blocks = [];
    const pages = v.pages.filter((p) => p.svg || p.texts.length || p.lanes.length); // пустые страницы пропускаем
    if (!pages.length) throw new Error('В схеме Visio нет фигур.');
    pages.forEach((p) => {
      blocks.push({ type: 'p', text: p.name, heading: 1 });
      if (p.svg) blocks.push({ type: 'figure', src: `data:image/svg+xml;base64,${b64utf8(p.svg)}`, alt: `Схема «${p.name}»` });
      if (p.lanes.length) blocks.push({ type: 'table', rows: [[{ lines: ['Участник'] }, { lines: ['Действие'] }], ...p.lanes.map((l) => [{ lines: [l.name] }, { lines: l.steps }])] });
      p.texts.forEach((x) => blocks.push({ type: 'p', text: x }));
    });
    return { blocks, meta: { title: v.meta.title || fileStem }, pages };
  }

  /* ---------- PDF ---------- */
  async function parsePdf(buf) {
    if (!window.pdfjsLib) await loadScript(VENDOR.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR.pdfWorker;
    let pdf;
    try { pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; } catch (e) { throw new Error('PDF не открывается: ' + e.message); }
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str !== undefined).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || it.height || 10, w: it.width, eol: it.hasEOL }));
      items.sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
      const lines = [];
      items.forEach((it) => {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) <= Math.max(2, it.h * 0.35)) {
          const gap = it.x - (last.xEnd ?? last.x);
          last.text += (gap > it.h * 0.18 && !/\s$/.test(last.text) && !/^\s/.test(it.s) ? ' ' : '') + it.s;
          last.xEnd = it.x + (it.w || 0);
          last.h = Math.max(last.h, it.h);
        } else if (it.s.trim()) {
          lines.push({ text: it.s, x: it.x, y: it.y, h: it.h, xEnd: it.x + (it.w || 0), page: i, H: vp.height });
        }
      });
      lines.forEach((l) => { l.text = norm(l.text); });
      pages.push(lines.filter((l) => l.text));
    }
    const all = pages.flat();
    if (!all.length) throw new Error('В PDF нет текстового слоя (похоже на скан). Распознавание сканов не поддерживается — загрузите .docx или PDF с текстом.');
    // колонтитулы: строки у краёв страницы, повторяющиеся на половине страниц и чаще
    const sig = (t) => t.replace(/\d+/g, '#');
    const cnt = new Map();
    all.forEach((l) => { if (l.y > l.H * 0.9 || l.y < l.H * 0.1) { const k = sig(l.text); cnt.set(k, (cnt.get(k) || 0) + 1); } });
    const minRep = Math.max(2, Math.ceil(pages.length * 0.5));
    const isFurniture = (l) => ((l.y > l.H * 0.9 || l.y < l.H * 0.1) && (cnt.get(sig(l.text)) || 0) >= minRep) || /^\s*\d+\s*(\|\s*\d+)?\s*$/.test(l.text) || /^стр(аница)?\.?\s*\d+/i.test(l.text) || /\.{4,}\s*\d+\s*$/.test(l.text);
    const lines = all.filter((l) => !isFurniture(l));

    const blocks = [];
    let cur = null;
    const LABEL = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;
    const LETTER = /^([а-яa-z])\)\s+(\S.*)$/i;
    const BULLET = /^[-–—−•●▪◦\uF0B7\uF02D\uF0A7\uF076\uF0D8\uF0FC]\s*(\S.*)$/;
    const APP = /^(Приложение\s+[\dА-ЯЁA-Z]+)\.?\s*(.*)$/i;
    let prev = null;
    const shortHead = (b) => b && ((b.labelKind === 'num' && depthOf(b.label) <= 2) || b.heading) && b.text.length < 110 && !/[.;:,]$/.test(b.text);
    lines.forEach((l) => {
      let m;
      const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
      const fontJump = prev && Math.abs(l.h - prev.h) > Math.max(1.2, prev.h * 0.12);
      const bigGap = (prev && prev.page === l.page && gap > Math.max(l.h, prev.h) * 1.9) || fontJump || (shortHead(cur) && /^[«"(]?[А-ЯЁA-Z]/.test(l.text));
      if ((m = l.text.match(APP))) { cur = { type: 'p', text: norm(m[2] || m[1]), label: m[1], labelKind: 'other', heading: 1 }; blocks.push(cur); }
      else if ((m = l.text.match(LABEL)) && plausibleLabel(m[1]) && !(prev && prev.page === l.page && !bigGap && cur && !/[.;:!?]$/.test(cur.text) && depthOf(m[1]) === 1 && +m[1] > 31)) {
        cur = { type: 'p', text: m[2], label: m[1], labelKind: 'num' }; blocks.push(cur);
      } else if ((m = l.text.match(LETTER))) { cur = { type: 'p', text: m[2], label: m[1] + ')', labelKind: 'letter' }; blocks.push(cur); }
      else if ((m = l.text.match(BULLET))) { cur = { type: 'p', text: m[1], bullet: true }; blocks.push(cur); }
      else if (!cur || bigGap || (/[.!?:;]$/.test(cur.text) && /^[А-ЯЁA-Z«"]/.test(l.text) && l.x <= (prev ? prev.x + 2 : l.x))) {
        cur = { type: 'p', text: l.text }; blocks.push(cur);
      } else {
        cur.text = cur.text.endsWith('-') && /^[а-яё]/.test(l.text) ? cur.text.slice(0, -1) + l.text : cur.text + ' ' + l.text;
      }
      if (cur && cur.h == null) { cur.h = l.h; cur.page = l.page; }
      prev = l;
    });
    blocks.forEach((b) => { b.text = norm(b.text); });
    const hs = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
    const meta = { bodySize: hs.length ? hs[Math.floor(hs.length / 2)] : 0 };
    try { const info = await pdf.getMetadata(); const t = info && info.info && info.info.Title; if (t && norm(t).length > 3) meta.coreTitle = norm(t); } catch (e) { /* без метаданных */ }
    return { blocks, meta };
  }

  /* ---------- Метаданные по тексту ---------- */
  function sniffMeta(blocks, meta, fileStem) {
    const head = fileStem + ' \n ' + blocks.slice(0, 60).filter((b) => b.type === 'p').map((b) => b.text).join(' \n ');
    const tableText = blocks.slice(0, 20).filter((b) => b.type === 'table').map((t) => t.rows.map((r) => r.map(cellText).join(' ')).join(' ')).join(' ');
    const idm = (head + ' ' + tableText).match(/\b([A-ZА-Я]\d+(?:\.\d+)+\.([A-Z]{2,5})\.\d{2,3})\b/);
    if (idm) { meta.id = meta.id || idm[1]; meta.docCode = idm[2]; }
    const vm = (head + ' ' + tableText).match(/(?:^|[\s(])(?:версия|редакция)\s+(\d+(?:\.\d+)*)/i);
    if (vm && !meta.version) meta.version = vm[1];
    const om = (head + ' ' + tableText).match(/(ООО|АО|ПАО|ЗАО|ОАО)\s+«[^»]{2,60}»/);
    if (om) meta.org = om[0];
    if (!meta.id) meta.id = fileStem;
  }

  /* ---------- Excel-реестр ---------- */
  const REG_COLS = [
    ['id', /^id$/i], ['title', /^наименование$/i], ['object', /^объект/i], ['statement', /формулировка/i], ['source', /^источник/i],
    ['clause', /^пункт/i], ['level', /^уровень$/i], ['owner', /^владелец/i], ['scope', /^область/i], ['crit', /^критичность$/i],
    ['method', /^метод/i], ['criterion', /^критерий/i], ['status', /^статус$/i], ['version', /^версия$/i], ['effective', /^дата вступления/i],
    ['evidence', /^ссылка на подтверждение/i], ['remark', /^(разногласия|примечание)/i], ['category', /^тип требования/i],
  ];
  const STATUS_CODE = { 'черновик': 'draft', 'на проверке оператора': 'operator-review', 'на согласовании': 'approval', 'утверждено': 'approved', 'действует': 'effective', 'на пересмотре': 'revision', 'заменено': 'superseded', 'архив': 'archived' };
  // Чтение .xlsx без внешних библиотек, кроме JSZip: общие строки, встроенные строки, числа, кэш формул
  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  async function readXlsx(buf) {
    if (!window.JSZip) await loadScript(VENDOR.jszip);
    let zip;
    try { zip = await window.JSZip.loadAsync(buf); } catch (e) { throw new Error('Файл не открывается как книга Excel .xlsx. Старый формат .xls нужно пересохранить как .xlsx.'); }
    const read = async (p) => { const f = zip.file(p) || zip.file(p.replace(/^\//, '')); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
    const wbx = await read('xl/workbook.xml');
    if (!wbx) throw new Error('В архиве нет xl/workbook.xml — это не книга Excel.');
    const relx = await read('xl/_rels/workbook.xml.rels');
    const rels = {};
    if (relx) Array.from(relx.getElementsByTagName('Relationship')).forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const sst = [];
    const sx = await read('xl/sharedStrings.xml');
    if (sx) Array.from(sx.getElementsByTagNameNS('*', 'si')).forEach((si) => sst.push(Array.from(si.getElementsByTagNameNS('*', 't')).filter((t) => !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')));
    const sheets = [];
    for (const sh of Array.from(wbx.getElementsByTagNameNS('*', 'sheet'))) {
      const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
      let target = rels[rid];
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const x = await read(target);
      if (!x) continue;
      const rows = new Map();
      Array.from(x.getElementsByTagNameNS('*', 'c')).forEach((c) => {
        const ref = c.getAttribute('r'); if (!ref) return;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagNameNS('*', 'v')[0];
        let val = '';
        if (t === 's') val = v ? sst[+v.textContent] ?? '' : '';
        else if (t === 'inlineStr') val = Array.from(c.getElementsByTagNameNS('*', 't')).map((n) => n.textContent).join('');
        else val = v ? v.textContent : '';
        const rn = +ref.replace(/^[A-Z]+/, '');
        if (!rows.has(rn)) rows.set(rn, new Map());
        rows.get(rn).set(colIndex(ref), val);
      });
      sheets.push({ name: sh.getAttribute('name'), rows });
    }
    return sheets;
  }
  const serialToDate = (v) => { const n = +v; if (!(n > 20000 && n < 80000)) return ''; const d = new Date(Math.round((n - 25569) * 86400000)); return d.toISOString().slice(0, 10); };
  async function parseXlsx(buf, opts) {
    const sheets = await readXlsx(buf);
    let sheet = null, headRow = 0, map = null;
    for (const sh of sheets) {
      for (let r = 1; r <= 20; r++) {
        const row = sh.rows.get(r); if (!row) continue;
        const m = {};
        row.forEach((val, col) => { const t = norm(val); const hit = REG_COLS.find(([, re]) => re.test(t)); if (hit && !m[hit[0]]) m[hit[0]] = col; });
        if (m.id && m.statement) { sheet = sh; headRow = r; map = m; break; }
      }
      if (sheet) break;
    }
    if (!sheet) throw new Error('В книге не найден лист реестра: нужна строка заголовков со столбцами «ID» и «Атомарная формулировка».');
    const cards = [];
    const last = Math.max(...sheet.rows.keys());
    for (let r = headRow + 1; r <= last; r++) {
      const row = sheet.rows.get(r); if (!row) continue;
      const card = {};
      REG_COLS.forEach(([k]) => { card[k] = map[k] ? norm(row.get(map[k]) || '') : ''; });
      if (card.effective && /^\d+(\.\d+)?$/.test(card.effective)) card.effective = serialToDate(card.effective) || card.effective;
      if (!card.id && !card.statement) continue;
      cards.push(card);
    }
    if (!cards.length) throw new Error(`На листе «${sheet.name}» под заголовками нет карточек.`);
    return buildFromCards(cards, sheet.name, opts);
  }

  function buildFromCards(cards, sheetName, opts) {
    const ids = new Set();
    const uid = (base) => { let x = base, i = 2; while (ids.has(x)) x = `${base}-${i++}`; ids.add(x); return x; };
    const code = ncname(opts.code || opts.fileStem, 'REG').toUpperCase();
    const roles = new Map(), objects = new Map();
    const STATUS_OK = new Set(Object.values(STATUS_CODE));
    const refOf = (map, prefix, name) => { const k = name.toLowerCase(); if (!map.has(k)) map.set(k, { id: uid(`${prefix}-${map.size + 1}`), name }); return map.get(k).id; };
    const report = { sections: 1, clauses: cards.length, requirements: cards.length, explicit: 0, derived: 0, tables: 0, terms: 0, warnings: [] };
    const clauses = cards.map((c, i) => {
      const st = c.statement || c.title || c.id;
      const found = modalityOf(st);
      const mod = c.modality || found;
      if (found) report.explicit++;
      const status = STATUS_OK.has(c.status) ? c.status : STATUS_CODE[(c.status || '').toLowerCase()] || '';
      const confirmed = c.ownerConfirmed ?? (status === 'approved' || status === 'effective');
      const crit = /^C[1-4]$/i.test(c.crit) ? c.crit.toUpperCase() : '';
      if (c.crit && !crit) report.warnings.push(`Карточка ${c.id || i + 1}: критичность «${c.crit}» не из справочника C1–C4 — пропущена.`);
      const lvl = /^L[1-6]$/i.test(c.level) ? c.level.toUpperCase() : '';
      const eff = /^\d{4}-\d{2}-\d{2}$/.test(c.effective) ? c.effective : (c.effective.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) ? c.effective.replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, '$3-$2-$1') : '');
      const remarkParts = [c.remark, c.effective && !eff ? `Дата вступления: ${c.effective}` : ''].filter(Boolean);
      const cat = c.category === 'business' || c.category === 'system' ? c.category : (/систем/i.test(c.category || '') ? 'system' : /бизнес/i.test(c.category || '') ? 'business' : categoryOf(st));
      const catSt = c.categoryStatus || (c.category ? 'confirmed' : 'preliminary');
      const req = el('requirement', { id: uid(`REQ-${code}-${String(i + 1).padStart(3, '0')}`), number: c.clause, modality: mod || 'shall', modalityBasis: found && found === mod ? 'explicit' : 'implicit', category: cat, categoryStatus: catSt === 'confirmed' ? 'confirmed' : 'preliminary', criticality: crit, source: 'authoritative' }, [
        ...(c.title ? [el('title', {}, c.title)] : []),
        el('statement', {}, st), el('quote', {}, st),
        ...(c.object ? [el('object', { ref: refOf(objects, 'OBJ', c.object) })] : []),
        ...(c.owner ? [el('owner', { ref: refOf(roles, 'ROLE', c.owner), status: confirmed ? 'confirmed' : 'preliminary' })] : []),
        ...(c.scope ? [el('applicability', {}, [el('condition', {}, c.scope)])] : []),
        ...(c.method || c.criterion ? [el('verification', { method: c.method || 'не указан' }, c.criterion ? [el('criterion', {}, c.criterion)] : [])] : []),
        ...(c.critBasis && c.critBasis.text ? [el('criticalityBasis', { status: c.critBasis.status || 'preliminary' }, c.critBasis.text)] : []),
        el('registry', { id: c.id, level: lvl, status, version: c.version, effective: eff, evidence: c.evidence, sourceDocument: c.source, sourceClause: c.clause }, remarkParts.length ? [el('remark', {}, remarkParts.join(' '))] : []),
      ]);
      c.reqId = req.a.id;
      return el('clause', { id: uid(`CL-${ncname(c.id || String(i + 1), 'c')}`), number: c.id, type: 'normative' }, [el('text', {}, [el('p', {}, st)]), req]);
    });
    // Разделы: по одному на источник, если карточки сгруппированы (общий реестр), иначе один раздел листа
    const groups = [];
    cards.forEach((c, i) => {
      const g = c.group || '';
      let sec = groups.find((x) => x.g === g);
      if (!sec) groups.push(sec = { g, items: [] });
      sec.items.push(clauses[i]);
    });
    const root = el('ismDocument', { xmlns: NS, 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', 'xsi:schemaLocation': `${NS} ism-regulation-v1.xsd`, id: opts.docId || opts.fileStem, version: opts.version || 'не указана', status: 'draft' }, [
      el('metadata', {}, [el('title', {}, opts.title || `Реестр требований «${opts.fileStem}»`), el('documentType', { code: 'REC' }, 'Реестр требований'), el('processRef', { id: '' }, 'не указан'), el('owner', { role: 'process-owner' }, 'не указан')]),
    ]);
    if (roles.size) root.c.push(el('roles', {}, Array.from(roles.values()).map((r) => el('role', { id: r.id, type: 'org-unit' }, [el('name', {}, r.name)]))));
    if (objects.size) root.c.push(el('objects', {}, Array.from(objects.values()).map((o) => el('object', { id: o.id, type: 'object' }, [el('name', {}, o.name)]))));
    root.c.push(el('body', {}, groups.length > 1 || (groups[0] && groups[0].g)
      ? groups.map((g, k) => el('section', { id: uid(`S-${ncname(g.g.slice(0, 32), 'doc')}`), number: String(k + 1), title: g.g || 'Без источника' }, g.items))
      : [el('section', { id: uid('S-REG'), title: `Карточки реестра, лист «${sheetName}»` }, clauses)]));
    // Основания между карточками (граф требований): нижестоящее требование реализует вышестоящее
    const links = (opts.links || []).filter((l) => cards[l.a] && cards[l.b] && cards[l.a].reqId && cards[l.b].reqId);
    if (links.length) root.c.push(el('semanticLinks', {}, links.map((l) => el('link', { from: cards[l.a].reqId, to: cards[l.b].reqId, relation: l.relation || 'implements' }))));
    const notes = [el('note', { id: uid('EN-AUTO'), type: 'interpretation' }, opts.note || `Карточки загружены из Excel-реестра «${opts.fileName}», лист «${sheetName}»: ${cards.length} шт. Текст исходных документов в реестре отсутствует, поэтому пункт каждой карточки содержит только её формулировку; источник и пункт сохранены в карточке.`)];
    // Пересечения между карточками (общий реестр): замечание к первой карточке пары
    (opts.pairs || []).forEach((p, k) => {
      const a = cards[p.a], b = cards[p.b];
      if (!a || !b) return;
      notes.push(el('note', { id: uid(`EN-OV-${k + 1}`), type: p.kind === 'conflict' ? 'inconsistency' : 'duplicate', target: a.reqId }, p.text));
    });
    root.c.push(el('editorialNotes', {}, notes));
    return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${ser(root, 0)}\n`, report };
  }

  /* ---------- Точка входа ---------- */
  async function fromFile(file, opts = {}) {
    const name = file.name;
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    const fileStem = name.replace(/\.[^.]+$/, '');
    const o = { fileName: name, fileStem, level: opts.level || 'L2', tempStart: opts.tempStart || 1, today: opts.today };
    const buf = await file.arrayBuffer();
    if (ext === 'xml') {
      const text = new TextDecoder('utf-8').decode(buf);
      const d = new DOMParser().parseFromString(text, 'application/xml');
      if (d.getElementsByTagName('parsererror')[0]) throw new Error('Файл не является корректным XML.');
      const r = d.documentElement;
      if (r.localName !== 'ismDocument' || r.namespaceURI !== NS) throw new Error(`Это не документ ИСМ: нужен корневой элемент <ismDocument xmlns="${NS}">.`);
      return { kind: 'xml', xml: text, report: { requirements: r.getElementsByTagNameNS(NS, 'requirement').length, warnings: [] } };
    }
    if (ext === 'docx' || ext === 'docm') {
      const { blocks, meta } = await parseDocx(buf);
      sniffMeta(blocks, meta, fileStem);
      const res = buildIsm(blocks, meta, { ...o, kind: 'docx' });
      return { kind: 'docx', ...res };
    }
    if (ext === 'pdf') {
      const { blocks, meta } = await parsePdf(buf);
      sniffMeta(blocks, meta, fileStem);
      const res = buildIsm(blocks, meta, { ...o, kind: 'pdf' });
      res.report.warnings.unshift('PDF: таблицы и рисунки не восстанавливаются; проверьте границы пунктов.');
      return { kind: 'pdf', ...res };
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const res = await parseXlsx(buf, o);
      return { kind: 'xlsx', ...res };
    }
    if (ext === 'doc' || ext === 'dot') {
      const head = new Uint8Array(buf.slice(0, 16));
      const sig = String.fromCharCode(...head);
      if (head[0] === 0x50 && head[1] === 0x4B) { // на самом деле .docx с расширением .doc
        const { blocks, meta } = await parseDocx(buf);
        sniffMeta(blocks, meta, fileStem);
        return { kind: 'docx', ...buildIsm(blocks, meta, { ...o, kind: 'docx' }) };
      }
      if (sig.startsWith('{\\rtf')) throw new Error('Файл с расширением .doc на самом деле в формате RTF. Откройте его в Word и сохраните как .docx.');
      if (/^\s*(<|MIME)/i.test(sig)) throw new Error('Файл с расширением .doc на самом деле веб-страница (HTML/MHT). Откройте его в Word и сохраните как .docx.');
      await loadScript(VENDOR.doc);
      const { blocks, meta } = window.ISM.doc.parse(buf);
      sniffMeta(blocks, meta, fileStem);
      const res = buildIsm(blocks, meta, { ...o, kind: 'doc' });
      return { kind: 'doc', ...res };
    }
    if (ext === 'vsdx' || ext === 'vsdm') {
      const { blocks, meta, pages } = await parseVisio(buf, fileStem);
      sniffMeta(blocks, meta, fileStem);
      const res = buildIsm(blocks, meta, { ...o, kind: 'vsdx' });
      res.report.pages = pages.length;
      res.report.lanes = pages.reduce((a, p) => a + p.lanes.length, 0);
      return { kind: 'vsdx', ...res };
    }
    if (ext === 'vsd' || ext === 'vss' || ext === 'vst') throw new Error('Старый формат Visio .vsd в браузере не читается. Откройте схему в Visio и сохраните как «Документ Visio (*.vsdx)».');
    if (ext === 'xls') throw new Error('Старый формат .xls не поддерживается: пересохраните файл как .xlsx.');
    throw new Error('Поддерживаются Word (.docx, .doc), PDF, Excel-реестр (.xlsx), Visio (.vsdx) и XML ИСМ.');
  }

  window.ISM = window.ISM || {};
  const fromCards = (cards, opts) => buildFromCards(cards, opts.sheetName || '', opts);
  window.ISM.convert = { fromFile, fromCards, modalityOf, categoryOf, typeOf, DOC_TYPE_LIST, DOC_LEVELS, sentences, loadScript, VENDOR };
})();
