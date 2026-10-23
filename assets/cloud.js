/* ИСМ XML — личный кабинет и база данных Supabase.
   Вход: регистрация по почте и паролю и вход по почте и паролю, без подтверждения почты
   (в проекте Supabase выключено Authentication → Sign In / Providers → Email → Confirm email).
   Учётные записи и пароли хранит Supabase Auth; документы, требования, связи — таблицы из supabase/setup.sql.
   Хранилище повторяет интерфейс ISM.store (store.js), поэтому приложение работает с ним так же, как с IndexedDB.
   Общий реестр требований (registry) — одна таблица на всех пользователей, пополняется функцией registry_sync. */
(() => {
  'use strict';
  const cfg = window.ISM_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const SDK = 'assets/vendor/supabase.js'; // supabase-js 2.117.2, MIT; ключ sb_publishable_ передаётся только в заголовке apikey
  let sb = null;
  let uid = null;
  // Старые ссылки из писем Supabase (#access_token=… или #error=…): сеанс подхватывается, адрес очищается
  const APP_URL = location.origin + location.pathname;
  const hashParams = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const urlEvent = hashParams.has('access_token') ? (hashParams.get('type') || 'signin')
    : hashParams.has('error') || hashParams.has('error_description') ? 'error' : '';
  const urlError = urlEvent === 'error' ? (hashParams.get('error_code') || hashParams.get('error_description') || hashParams.get('error')) : '';

  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('не удалось загрузить ' + src)); document.head.appendChild(s); });
  }
  async function client() {
    if (sb) return sb;
    if (!window.supabase) await loadScript(SDK);
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !!urlEvent, flowType: 'implicit', storageKey: 'ism-xml-auth' },
    });
    return sb;
  }

  // Сообщения Supabase Auth — на русском
  function ru(error) {
    const msg = String((error && (error.message || error.error_description)) || error || '') + (error && error.code ? ` ${error.code}` : '');
    const sec = msg.match(/after (\d+) seconds?/i);
    const map = [
      [/invalid login credentials/i, 'Неверная почта или пароль.'],
      [/email not confirmed/i, 'Почта не подтверждена.'],
      [/user already registered|already been registered|user_already_exists/i, 'Эта почта уже зарегистрирована. Войдите со своим паролем.'],
      // Supabase пытается отправить письмо, только если в проекте осталось включено подтверждение почты
      [/email address not authorized|error sending confirmation/i, 'Почта не подтверждена: Supabase требует письмо с подтверждением.'],
      [/rate limit|too many/i, 'Слишком много попыток за короткое время. Подождите и попробуйте снова.'],
      [/password should be at least (\d+)/i, 'Пароль слишком короткий.'],
      [/weak password|password.*(weak|pwned)/i, 'Пароль слишком простой. Используйте буквы разного регистра, цифры и знаки.'],
      [/unable to validate email|invalid format|email.*invalid/i, 'Неверный формат почты.'],
      [/signups? not allowed|signup is disabled/i, 'Регистрация в проекте отключена администратором.'],
      [/same.*password|new password should be different/i, 'Новый пароль совпадает со старым.'],
      [/reauthenticat/i, 'Для смены пароля нужно заново войти в приложение.'],
      [/failed to fetch|network/i, 'Нет связи с сервером базы данных. Проверьте интернет.'],
      [/documents_source_kind_check/i, 'База данных не принимает файлы этого вида: выполните последнюю версию supabase/setup.sql в SQL Editor Supabase.'],
      [/could not find the (table|function)|schema cache|relation .* does not exist|function .* does not exist|PGRST20[25]/i, 'База данных проекта не настроена или устарела: выполните последнюю версию supabase/setup.sql в SQL Editor Supabase.'],
      [/jwt|not authenticated|нужно войти/i, 'Сеанс истёк. Войдите снова.'],
    ];
    if (sec) return `Повторить можно через ${sec[1]} с.`;
    const hit = map.find(([rx]) => rx.test(msg));
    return hit ? hit[1] : msg || 'Неизвестная ошибка сервера.';
  }
  const fail = (error) => { const e = new Error(ru(error)); e.raw = error; throw e; };
  const check = ({ data, error }) => { if (error) fail(error); return data; };

  /* ---------- Вход и регистрация ---------- */
  const auth = {
    async session() {
      const c = await client();
      const { data } = await c.auth.getSession();
      uid = data.session ? data.session.user.id : null;
      return data.session || null;
    },
    async signUp(email, password) {
      const c = await client();
      const data = check(await c.auth.signUp({ email, password, options: { emailRedirectTo: APP_URL } }));
      // Для уже зарегистрированной почты Supabase может вернуть пользователя без identities
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Эта почта уже зарегистрирована. Войдите со своим паролем.');
      }
      if (data.session) uid = data.session.user.id;
      return { session: data.session };
    },
    async signIn(email, password) {
      const c = await client();
      const data = check(await c.auth.signInWithPassword({ email, password }));
      uid = data.session.user.id;
      return data.session;
    },
    async signOut() {
      const c = await client();
      await c.auth.signOut();
      uid = null;
      cache.settings = null; cache.dismissed = null;
    },
    async setPassword(password) {
      const c = await client();
      check(await c.auth.updateUser({ password }));
    },
    async profile() {
      const c = await client();
      const data = check(await c.from('profiles').select('email,full_name,created_at').eq('id', uid).maybeSingle());
      return data || {};
    },
    async updateProfile(fields) {
      const c = await client();
      check(await c.from('profiles').update({ full_name: fields.full_name || null }).eq('id', uid));
    },
    uid: () => uid,
    async onChange(cb) {
      const c = await client();
      c.auth.onAuthStateChange((event, session) => { uid = session ? session.user.id : null; cb(event, session); });
    },
  };

  /* ---------- Хранилище документов (интерфейс ISM.store) ---------- */
  const cache = { settings: null, dismissed: null };
  async function settings() {
    if (cache.settings) return cache.settings;
    const c = await client();
    const data = check(await c.from('user_settings').select('settings').eq('owner_id', uid).maybeSingle());
    cache.settings = (data && data.settings) || {};
    return cache.settings;
  }
  const splitKey = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };

  const store = {
    mode: 'cloud',
    async available() { return !!uid; },
    async allDocs() {
      const c = await client();
      const rows = check(await c.from('documents').select('client_key,source_kind,file_name,xml,included,overridden,report,added_at').order('added_at', { ascending: true }));
      return (rows || []).map((d) => ({
        key: d.client_key, name: d.file_name || '', kind: d.source_kind, xml: d.xml, included: d.included,
        overridden: d.overridden, report: d.report || {}, addedAt: Date.parse(d.added_at) || 0, builtin: d.source_kind === 'builtin',
      }));
    },
    // sync — строки документа и его требований для таблиц documents и requirements
    async putDoc(rec, sync) {
      const c = await client();
      const doc = (sync && sync.doc) || {
        key: rec.key, source_kind: rec.builtin ? 'builtin' : rec.kind, file_name: rec.name || null, xml: rec.xml,
        included: rec.included, overridden: !!rec.overridden, report: rec.report || {}, added_at: new Date(rec.addedAt || Date.now()).toISOString(),
      };
      check(await c.rpc('save_document', { p_doc: doc, p_reqs: sync && sync.reqs ? sync.reqs : null }));
    },
    async deleteDoc(key) {
      const c = await client();
      check(await c.from('documents').delete().eq('owner_id', uid).eq('client_key', key));
    },
    async getMeta(key, fallback) {
      if (key === 'dismissed') {
        const c = await client();
        const rows = check(await c.from('overlap_dismissals').select('pair_key'));
        cache.dismissed = new Set((rows || []).map((r) => r.pair_key));
        return Array.from(cache.dismissed);
      }
      const s = await settings();
      return key in s ? s[key] : fallback;
    },
    async setMeta(key, value) {
      const c = await client();
      if (key === 'dismissed') {
        const next = new Set(value || []);
        const prev = cache.dismissed || new Set();
        const add = [...next].filter((k) => !prev.has(k));
        const del = [...prev].filter((k) => !next.has(k));
        if (add.length) check(await c.from('overlap_dismissals').insert(add.map((pair_key) => ({ owner_id: uid, pair_key }))));
        for (const k of del) check(await c.from('overlap_dismissals').delete().eq('owner_id', uid).eq('pair_key', k));
        cache.dismissed = next;
        return;
      }
      const s = { ...(await settings()), [key]: value };
      cache.settings = s;
      check(await c.from('user_settings').upsert({ owner_id: uid, settings: s, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' }));
    },
    async allLinks() {
      const c = await client();
      const rows = check(await c.from('requirement_links').select('from_doc,from_req,to_doc,to_req,relation'));
      return (rows || []).map((l) => ({ from: `${l.from_doc}|${l.from_req}`, to: `${l.to_doc}|${l.to_req}`, relation: l.relation }));
    },
    async addLink(l) {
      const c = await client();
      const [fd, fr] = splitKey(l.from);
      const [td, tr] = splitKey(l.to);
      check(await c.from('requirement_links').insert({ owner_id: uid, from_doc: fd, from_req: fr, to_doc: td, to_req: tr, relation: l.relation || 'derives' }));
    },
    async removeLink(l) {
      const c = await client();
      const [fd, fr] = splitKey(l.from);
      const [td, tr] = splitKey(l.to);
      check(await c.from('requirement_links').delete().eq('owner_id', uid).eq('from_doc', fd).eq('from_req', fr).eq('to_doc', td).eq('to_req', tr).eq('relation', l.relation || 'derives'));
    },
  };

  /* ---------- Общий реестр требований: один на всех пользователей ---------- */
  // Обозначение документа ИСМ (C2.4.1.MTH.01) — общий ключ; документ без обозначения — свой у каждого пользователя.
  // Правило совпадает с функцией registry_source в setup.sql.
  const ISM_CODE = /^[A-ZА-Я]\d+(?:\.\d+)+\.[A-Z]{2,5}\.\d{2,3}$/;
  const REG_FIELDS = 'id,source_key,req_id,pos,card_id,doc_code,doc_title,doc_version,doc_type,statement,modality,category,complete,cols,added_by,added_at,updated_at';
  const PAGE = 1000; // столько строк Supabase отдаёт за один запрос
  const registry = {
    sourceOf: (code) => (ISM_CODE.test(code || '') ? code : `${uid || '-'}/${String(code || '').trim() || 'без обозначения'}`),
    async count() {
      const c = await client();
      const { count, error } = await c.from('registry_entries').select('id', { count: 'exact', head: true });
      if (error) fail(error);
      return count || 0;
    },
    async all() {
      const c = await client();
      const out = [];
      for (let from = 0; ; from += PAGE) {
        const rows = check(await c.from('registry_entries').select(REG_FIELDS).order('doc_code').order('source_key').order('pos').order('id').range(from, from + PAGE - 1)) || [];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
    // doc: {code, title, version, type}; rows: [{req_id, card_id, statement, modality, category, complete, cols}]
    async sync(doc, rows) {
      const c = await client();
      return check(await c.rpc('registry_sync', { p_doc: doc, p_rows: rows })) || {};
    },
    async remove(code) {
      const c = await client();
      return check(await c.rpc('registry_remove', { p_code: code || '' })) || 0;
    },
  };

  window.ISM = window.ISM || {};
  window.ISM.cloud = { enabled, auth, store, registry, urlEvent, urlError, ru, host: enabled ? cfg.supabaseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '' };
})();
