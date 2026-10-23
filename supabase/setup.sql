-- =====================================================================
-- ИСМ XML — база данных в Supabase (PostgreSQL 15+)
--
-- Как применить: Supabase → SQL Editor → вставить файл целиком → Run.
-- Скрипт можно запускать повторно: объекты создаются «если нет»,
-- справочники обновляются, данные пользователей не трогаются.
--
-- Устройство:
--   document_levels, document_types   справочник иерархии документов ИСМ (4 уровня + внешняя документация)
--   documents                          документы пользователя: вид, обозначение, XML ИСМ — источник истины
--   requirements                       атомарные требования и карточки реестра (копия из XML для запросов и отчётов)
--   requirement_links                  связи между требованиями разных документов (основание, уточнение, противоречие…)
--   overlap_dismissals                 пары «не дубль», отмеченные пользователем
--   user_settings                      настройки пользователя (счётчик TEMP, последний открытый документ)
--   profiles                           профиль личного кабинета; учётные записи и пароли хранит Supabase Auth (auth.users)
--   registry_entries                   ОБЩИЙ реестр требований — один на всех пользователей (в конце файла)
--   Представления по уровням: documents_level_1 … documents_level_4, documents_external; v_registry, v_document_stats
--
-- Доступ: документы, требования и связи каждый пользователь видит и меняет только свои
-- (Row Level Security, owner_id = auth.uid()). Общий реестр читают все вошедшие пользователи,
-- а пополняют его только функции registry_sync и registry_remove.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Справочник: уровни и виды документов
-- ---------------------------------------------------------------------
create table if not exists public.document_levels (
  level   smallint primary key check (level between 1 and 4),
  name    text not null,
  purpose text not null
);
comment on table public.document_levels is 'Уровни иерархии документов ИСМ';

insert into public.document_levels (level, name, purpose) values
  (1, '1 уровень', 'стратегическое управление, принятие решений, контроль деятельности'),
  (2, '2 уровень', 'управление деятельностью применительно к процессам'),
  (3, '3 уровень', 'исполнение деятельности'),
  (4, '4 уровень', 'свидетельства о выполнении требований')
on conflict (level) do update set name = excluded.name, purpose = excluded.purpose;

create table if not exists public.document_types (
  code        text primary key,
  name        text not null,
  level       smallint references public.document_levels(level),  -- null: внешняя документация
  description text not null,
  sort        smallint not null
);
comment on table public.document_types is 'Виды документов ИСМ. REC и EXT — коды приложения для видов без кода в классификаторе';
comment on column public.document_types.level is 'Уровень иерархии; пусто для внешней документации';

insert into public.document_types (code, name, level, description, sort) values
  ('GPL',  'Политика', 1, 'Устанавливает общие требования. Характеризуется широкой областью применения и низкой детализацией', 10),
  ('GOAL', 'Цели', 1, 'Официально зафиксированные ожидаемые результаты деятельности', 20),
  ('GDL',  'Руководство', 1, 'Содержит изложение руководящих принципов и основных направлений развития деятельности Предприятия', 30),
  ('PLC',  'Положение', 2, 'Определяет общие правила и требования к реализации конкретного направления сферы деятельности/процесса (отвечает на вопрос — что делаем?)', 40),
  ('PCD',  'Процедура', 2, 'Описывает этапы реализации процесса/подпроцесса, включая состав, последовательность этапов реализации, сроки выполнения, распределение ответственности, требования к результату процесса и способы его измерения (отвечает на вопрос — как делаем?)', 50),
  ('STD',  'Стандарт', 2, 'Устанавливает требования к процессу верхнего уровня и его реализации', 60),
  ('RGL',  'Регламент', 2, 'Описывает состав, структуру и порядок управления процессом', 70),
  ('SOP',  'Стандартная операционная процедура', 2, 'Содержит только схему процесса, описание ролей и краткое описание процесса, которое помещается на одну или две страницы', 80),
  ('MTH',  'Методика', 3, 'Содержит конкретные приёмы, техники, технологии и инструменты практических действий в процессах', 90),
  ('INS',  'Инструкция', 3, 'Содержит свод правил, устанавливающий, разъясняющий и детально раскрывающий порядок и способы выполнения действий', 100),
  ('REC',  'Записи и отчёты', 4, 'Содержат информацию о достигнутых результатах или свидетельства осуществлённой деятельности (шаблоны, чек-листы, журналы, реестры, перечни и т. п.)', 110),
  ('EXT',  'Внешняя документация', null, 'Документация, созданная за пределами Предприятия (законодательная база, постановления Правительства, ГОСТы, ОСТы, СНиПы, ТУ и пр.)', 120)
on conflict (code) do update set name = excluded.name, level = excluded.level, description = excluded.description, sort = excluded.sort;

-- ---------------------------------------------------------------------
-- Профиль личного кабинета (создаётся автоматически при регистрации)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Профиль пользователя. Пароль и подтверждение почты хранит Supabase Auth (auth.users)';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Документы
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_key  text not null,                       -- ключ документа в приложении
  type_code   text references public.document_types(code),
  ism_id      text,                                -- обозначение, например C2.4.1.MTH.01
  title       text not null default '',
  version     text,
  status      text,                                -- статус документа: draft, effective, superseded, withdrawn
  source_kind text not null check (source_kind in ('builtin', 'docx', 'doc', 'pdf', 'xlsx', 'xml', 'vsdx')),
  file_name   text,
  xml         text,                                -- XML ИСМ; пусто у неизменённого опубликованного регламента
  included    boolean not null default true,       -- входит в общий реестр
  overridden  boolean not null default false,      -- опубликованный регламент изменён пользователем
  report      jsonb not null default '{}'::jsonb,  -- отчёт автоматической разметки
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, client_key)
);
-- Новые виды исходных файлов (Word 97–2003, Visio) для баз, созданных прежней версией скрипта
alter table public.documents drop constraint if exists documents_source_kind_check;
alter table public.documents add constraint documents_source_kind_check
  check (source_kind in ('builtin', 'docx', 'doc', 'pdf', 'xlsx', 'xml', 'vsdx'));

comment on table public.documents is 'Документы пользователя; XML ИСМ — источник истины, остальные поля для поиска и отчётов';
create index if not exists documents_owner_idx on public.documents (owner_id, added_at);
create index if not exists documents_type_idx on public.documents (type_code);

-- ---------------------------------------------------------------------
-- Атомарные требования и карточки реестра
-- ---------------------------------------------------------------------
create table if not exists public.requirements (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id          uuid not null references public.documents(id) on delete cascade,
  req_id               text not null,               -- requirement/@id в XML
  clause_id            text,
  clause_cite          text,                        -- «п. 3.3», «Приложение 1»
  card_id              text,                        -- ID карточки реестра: TEMP-… или CR-…
  title                text,
  statement            text not null,
  quote                text,
  modality             text check (modality in ('shall', 'should', 'may', 'shall-not')),
  category             text check (category in ('business', 'system')),  -- бизнес-требование или системное
  category_status      text not null default 'preliminary' check (category_status in ('preliminary', 'confirmed')),
  criticality          text check (criticality in ('C1', 'C2', 'C3', 'C4')),
  owner_name           text,                        -- владелец требования
  object_name          text,
  conditions           text,                        -- область / условия применения
  verification_method  text,
  acceptance_criterion text,
  reg_level            text check (reg_level in ('L1', 'L2', 'L3', 'L4', 'L5', 'L6')),
  reg_status           text check (reg_status in ('draft', 'operator-review', 'approval', 'approved', 'effective', 'revision', 'superseded', 'archived')),
  reg_version          text,
  effective_date       date,
  evidence             text,
  remark               text,
  complete             boolean not null default false,  -- карточка комплектна (столбцы B–M шаблона заполнены)
  updated_at           timestamptz not null default now(),
  unique (document_id, req_id)
);
comment on table public.requirements is 'Атомарные требования; пересобираются из XML документа при каждом сохранении';
create index if not exists requirements_owner_idx on public.requirements (owner_id);
create index if not exists requirements_doc_idx on public.requirements (document_id);
create index if not exists requirements_category_idx on public.requirements (owner_id, category);

-- ---------------------------------------------------------------------
-- Связи между требованиями разных документов (для графа требований)
-- ---------------------------------------------------------------------
create table if not exists public.requirement_links (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_doc   text not null,      -- client_key документа
  from_req   text not null,      -- requirement/@id
  to_doc     text not null,
  to_req     text not null,
  relation   text not null default 'derives' check (relation in ('derives', 'refines', 'conflicts', 'duplicates')),
  note       text,
  created_at timestamptz not null default now(),
  unique (owner_id, from_doc, from_req, to_doc, to_req, relation),
  foreign key (owner_id, from_doc) references public.documents (owner_id, client_key) on delete cascade,
  foreign key (owner_id, to_doc) references public.documents (owner_id, client_key) on delete cascade
);
comment on table public.requirement_links is 'derives — требование выведено из требования вышестоящего документа и реализует его; refines — уточняет; conflicts — противоречит; duplicates — дублирует';

create table if not exists public.overlap_dismissals (
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pair_key   text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, pair_key)
);

create table if not exists public.user_settings (
  owner_id   uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Сохранение документа вместе с требованиями одной транзакцией
-- ---------------------------------------------------------------------
create or replace function public.save_document(p_doc jsonb, p_reqs jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_type text := nullif(p_doc ->> 'type_code', '');
begin
  if v_uid is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;
  if v_type is not null and not exists (select 1 from document_types where code = v_type) then
    v_type := null;
  end if;

  insert into documents as d (owner_id, client_key, type_code, ism_id, title, version, status, source_kind, file_name, xml, included, overridden, report, added_at, updated_at)
  values (
    v_uid, p_doc ->> 'key', v_type, p_doc ->> 'ism_id', coalesce(p_doc ->> 'title', ''), p_doc ->> 'version', p_doc ->> 'status',
    p_doc ->> 'source_kind', p_doc ->> 'file_name', p_doc ->> 'xml',
    coalesce((p_doc ->> 'included')::boolean, true), coalesce((p_doc ->> 'overridden')::boolean, false),
    coalesce(p_doc -> 'report', '{}'::jsonb), coalesce((p_doc ->> 'added_at')::timestamptz, now()), now()
  )
  on conflict (owner_id, client_key) do update set
    type_code = excluded.type_code, ism_id = excluded.ism_id, title = excluded.title, version = excluded.version,
    status = excluded.status, source_kind = excluded.source_kind, file_name = excluded.file_name, xml = excluded.xml,
    included = excluded.included, overridden = excluded.overridden, report = excluded.report, updated_at = now()
  returning d.id into v_id;

  if p_reqs is not null then
    delete from requirements where document_id = v_id;
    insert into requirements (owner_id, document_id, req_id, clause_id, clause_cite, card_id, title, statement, quote, modality,
      category, category_status, criticality, owner_name, object_name, conditions, verification_method, acceptance_criterion,
      reg_level, reg_status, reg_version, effective_date, evidence, remark, complete)
    select v_uid, v_id, r ->> 'req_id', r ->> 'clause_id', r ->> 'clause_cite', nullif(r ->> 'card_id', ''), nullif(r ->> 'title', ''),
      coalesce(r ->> 'statement', ''), nullif(r ->> 'quote', ''), nullif(r ->> 'modality', ''),
      nullif(r ->> 'category', ''), coalesce(nullif(r ->> 'category_status', ''), 'preliminary'), nullif(r ->> 'criticality', ''),
      nullif(r ->> 'owner_name', ''), nullif(r ->> 'object_name', ''), nullif(r ->> 'conditions', ''),
      nullif(r ->> 'verification_method', ''), nullif(r ->> 'acceptance_criterion', ''),
      nullif(r ->> 'reg_level', ''), nullif(r ->> 'reg_status', ''), nullif(r ->> 'reg_version', ''),
      nullif(r ->> 'effective_date', '')::date, nullif(r ->> 'evidence', ''), nullif(r ->> 'remark', ''),
      coalesce((r ->> 'complete')::boolean, false)
    from jsonb_array_elements(p_reqs) as r;
  end if;
  return v_id;
end;
$$;
comment on function public.save_document(jsonb, jsonb) is 'Создаёт или обновляет документ пользователя и пересобирает его требования';

-- ---------------------------------------------------------------------
-- Представления: документы по уровням иерархии и реестр
-- security_invoker: представления подчиняются RLS вызывающего пользователя
-- ---------------------------------------------------------------------
create or replace view public.documents_typed with (security_invoker = true) as
  select d.id, d.owner_id, d.client_key, d.ism_id, d.title, d.version, d.status, d.source_kind, d.file_name,
         d.included, d.added_at, d.updated_at, d.type_code, t.name as type_name, t.level, l.purpose as level_purpose
  from public.documents d
  left join public.document_types t on t.code = d.type_code
  left join public.document_levels l on l.level = t.level;

create or replace view public.documents_level_1 with (security_invoker = true) as select * from public.documents_typed where level = 1;
create or replace view public.documents_level_2 with (security_invoker = true) as select * from public.documents_typed where level = 2;
create or replace view public.documents_level_3 with (security_invoker = true) as select * from public.documents_typed where level = 3;
create or replace view public.documents_level_4 with (security_invoker = true) as select * from public.documents_typed where level = 4;
create or replace view public.documents_external with (security_invoker = true) as select * from public.documents_typed where type_code = 'EXT';
comment on view public.documents_level_1 is 'Политики, цели, руководства';
comment on view public.documents_level_2 is 'Положения, процедуры, стандарты, регламенты, СОП';
comment on view public.documents_level_3 is 'Методики и инструкции';
comment on view public.documents_level_4 is 'Записи и отчёты: шаблоны, чек-листы, журналы, реестры';
comment on view public.documents_external is 'Внешняя документация: законы, ГОСТы, СНиПы, ТУ';

create or replace view public.v_registry with (security_invoker = true) as
  select r.owner_id, d.client_key, d.ism_id, d.title as document_title, d.type_code, t.name as type_name, t.level,
         d.included, r.req_id, r.card_id, r.title, r.statement, r.category, r.category_status, r.modality, r.criticality,
         r.owner_name, r.object_name, r.conditions, r.verification_method, r.acceptance_criterion,
         r.reg_level, r.reg_status, r.reg_version, r.effective_date, r.evidence, r.remark, r.complete, r.clause_cite
  from public.requirements r
  join public.documents d on d.id = r.document_id
  left join public.document_types t on t.code = d.type_code;
comment on view public.v_registry is 'Корпоративный реестр требований по всем документам пользователя';

create or replace view public.v_document_stats with (security_invoker = true) as
  select d.id, d.owner_id, d.client_key, d.ism_id, d.title, d.type_code,
         count(r.id) as requirements,
         count(r.id) filter (where r.category = 'business') as business,
         count(r.id) filter (where r.category = 'system') as system,
         count(r.id) filter (where r.complete) as complete
  from public.documents d
  left join public.requirements r on r.document_id = d.id
  group by d.id;

-- ---------------------------------------------------------------------
-- Row Level Security: каждый видит только свои данные
-- ---------------------------------------------------------------------
alter table public.document_levels    enable row level security;
alter table public.document_types     enable row level security;
alter table public.profiles           enable row level security;
alter table public.documents          enable row level security;
alter table public.requirements       enable row level security;
alter table public.requirement_links  enable row level security;
alter table public.overlap_dismissals enable row level security;
alter table public.user_settings      enable row level security;

drop policy if exists "Справочник уровней читают все" on public.document_levels;
create policy "Справочник уровней читают все" on public.document_levels for select using (true);
drop policy if exists "Справочник видов читают все" on public.document_types;
create policy "Справочник видов читают все" on public.document_types for select using (true);

drop policy if exists "Свой профиль: чтение" on public.profiles;
create policy "Свой профиль: чтение" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Свой профиль: изменение" on public.profiles;
create policy "Свой профиль: изменение" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['documents', 'requirements', 'requirement_links', 'overlap_dismissals', 'user_settings'] loop
    execute format('drop policy if exists "Только свои строки" on public.%I', t);
    execute format('create policy "Только свои строки" on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Права (в Supabase выдаются по умолчанию; здесь — явно, чтобы скрипт был самодостаточным)
grant usage on schema public to anon, authenticated;
grant select on public.document_levels, public.document_types to anon, authenticated;
grant select, insert, update, delete on public.documents, public.requirements, public.requirement_links,
  public.overlap_dismissals, public.user_settings to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.documents_typed, public.documents_level_1, public.documents_level_2, public.documents_level_3,
  public.documents_level_4, public.documents_external, public.v_registry, public.v_document_stats to authenticated;
revoke all on public.documents, public.requirements, public.requirement_links, public.overlap_dismissals,
  public.user_settings, public.profiles from anon;
revoke execute on function public.save_document(jsonb, jsonb) from public, anon;
grant execute on function public.save_document(jsonb, jsonb) to authenticated;

-- =====================================================================
-- Общий реестр требований — один на всех пользователей
--
--   registry_entries   записи реестра: столбцы A–T мастер-реестра и поля для поиска повторов
--   registry_sync      добавляет требования документа пользователя без повторов:
--                        • тот же документ (обозначение ИСМ) и тот же номер требования — повтор;
--                        • та же формулировка (без учёта регистра, пунктуации, «ё») — повтор;
--                        • документ с тем же обозначением уже добавил другой пользователь — не добавляется
--   registry_remove    убирает из реестра требования документа, добавленные этим пользователем
--
-- Запись принадлежит тому, кто первым добавил документ: обновить или убрать её может только он.
-- Требования опубликованного регламента C2.4.1.MTH.01 заложены сразу (added_by пустой).
-- =====================================================================

-- Однократно, при первом создании общего реестра: опубликованный регламент больше не копируется
-- каждому пользователю как документ — его требования хранятся в общем реестре
do $$
begin
  if to_regclass('public.registry_entries') is null then
    delete from public.documents where source_kind = 'builtin' and not overridden;
  end if;
end;
$$;

create table if not exists public.registry_entries (
  id             bigint generated always as identity primary key,
  source_key     text not null,                  -- обозначение документа ИСМ; без обозначения — «id пользователя/название»
  req_id         text not null,                  -- идентификатор требования в документе
  pos            integer not null default 0,     -- порядок в документе
  card_id        text not null default '',
  doc_code       text not null default '',
  doc_title      text not null default '',
  doc_version    text not null default '',
  doc_type       text,
  statement      text not null,
  statement_hash text not null,                  -- md5 нормализованной формулировки
  modality       text,
  category       text check (category in ('business', 'system')),
  complete       boolean not null default false,
  cols           jsonb not null default '[]'::jsonb,  -- значения столбцов A–T для выгрузки в Excel
  added_by       uuid references auth.users (id) on delete cascade,  -- пустой у опубликованного регламента
  added_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint registry_entries_doc_req unique (source_key, req_id),
  constraint registry_entries_statement unique (statement_hash)
);
create index if not exists registry_entries_order on public.registry_entries (doc_code, source_key, pos);
comment on table public.registry_entries is 'Общий реестр требований всех пользователей, без повторов по документу и номеру требования и по формулировке';

-- Формулировка для сравнения: строчные буквы, «ё» → «е», без пунктуации и лишних пробелов
create or replace function public.registry_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.translate(coalesce(t, ''), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе')),
    '[^0-9a-zа-я]+', ' ', 'g'))
$$;

-- Ключ документа: обозначение ИСМ (C2.4.1.MTH.01) общее для всех; документ без обозначения — свой у каждого пользователя
create or replace function public.registry_source(p_code text) returns text
language sql stable set search_path = '' as $$
  select case
    when coalesce(p_code, '') ~ '^[A-ZА-Я][0-9]+(\.[0-9]+)+\.[A-Z]{2,5}\.[0-9]{2,3}$' then p_code
    else coalesce(auth.uid()::text, '-') || '/' || coalesce(nullif(pg_catalog.btrim(p_code), ''), 'без обозначения')
  end
$$;

create or replace function public.registry_sync(p_doc jsonb, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_src   text;
  v_row   jsonb;
  v_hash  text;
  v_cat   text;
  v_cols  jsonb;
  v_ex    public.registry_entries%rowtype;
  v_keys  text[] := '{}';
  v_pos   integer := 0;
  v_pub   boolean;
  n_other integer;
  n_add integer := 0; n_upd integer := 0; n_dup integer := 0; n_del integer := 0;
begin
  if v_uid is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Требования документа: ожидается массив';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'В документе больше 5000 требований';
  end if;
  v_src := public.registry_source(p_doc ->> 'code');

  -- Документ с этим обозначением уже добавил другой пользователь (или он опубликован): не смешиваем версии
  select count(*), coalesce(bool_or(e.added_by is null), false) into n_other, v_pub
    from public.registry_entries e where e.source_key = v_src and e.added_by is distinct from v_uid;
  if n_other > 0 then
    return jsonb_build_object('source', v_src, 'added', 0, 'updated', 0, 'duplicates', 0, 'removed', 0,
      'existing', n_other, 'owner', case when v_pub then 'published' else 'other' end);
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_pos := v_pos + 1;
    continue when coalesce(v_row ->> 'req_id', '') = '' or public.registry_norm(v_row ->> 'statement') = '';
    v_keys := v_keys || (v_row ->> 'req_id');
    v_hash := md5(public.registry_norm(v_row ->> 'statement'));
    v_cat := case when v_row ->> 'category' in ('business', 'system') then v_row ->> 'category' end;
    v_cols := case when jsonb_typeof(v_row -> 'cols') = 'array' then v_row -> 'cols' else '[]'::jsonb end;

    select * into v_ex from public.registry_entries e where e.source_key = v_src and e.req_id = v_row ->> 'req_id';
    if found then
      -- формулировку изменили так, что она совпала с другой записью реестра — эта запись лишняя
      if v_ex.statement_hash <> v_hash and exists (select 1 from public.registry_entries e where e.statement_hash = v_hash) then
        delete from public.registry_entries e where e.id = v_ex.id;
        n_dup := n_dup + 1;
        continue;
      end if;
      update public.registry_entries e set
        pos = v_pos, card_id = coalesce(v_row ->> 'card_id', ''), doc_code = coalesce(p_doc ->> 'code', ''),
        doc_title = coalesce(p_doc ->> 'title', ''), doc_version = coalesce(p_doc ->> 'version', ''), doc_type = nullif(p_doc ->> 'type', ''),
        statement = v_row ->> 'statement', statement_hash = v_hash, modality = nullif(v_row ->> 'modality', ''), category = v_cat,
        complete = coalesce((v_row ->> 'complete')::boolean, false), cols = v_cols, updated_at = now()
      where e.id = v_ex.id
        and (e.pos, e.card_id, e.doc_code, e.doc_title, e.doc_version, e.doc_type, e.statement, e.modality, e.category, e.complete, e.cols)
            is distinct from
            (v_pos, coalesce(v_row ->> 'card_id', ''), coalesce(p_doc ->> 'code', ''), coalesce(p_doc ->> 'title', ''), coalesce(p_doc ->> 'version', ''),
             nullif(p_doc ->> 'type', ''), v_row ->> 'statement', nullif(v_row ->> 'modality', ''), v_cat, coalesce((v_row ->> 'complete')::boolean, false), v_cols);
      if found then n_upd := n_upd + 1; end if;
    else
      insert into public.registry_entries (source_key, req_id, pos, card_id, doc_code, doc_title, doc_version, doc_type,
        statement, statement_hash, modality, category, complete, cols, added_by)
      values (v_src, v_row ->> 'req_id', v_pos, coalesce(v_row ->> 'card_id', ''), coalesce(p_doc ->> 'code', ''),
        coalesce(p_doc ->> 'title', ''), coalesce(p_doc ->> 'version', ''), nullif(p_doc ->> 'type', ''),
        v_row ->> 'statement', v_hash, nullif(v_row ->> 'modality', ''), v_cat, coalesce((v_row ->> 'complete')::boolean, false), v_cols, v_uid)
      on conflict do nothing;
      if found then n_add := n_add + 1; else n_dup := n_dup + 1; end if;
    end if;
  end loop;

  -- требования, которых больше нет в документе
  delete from public.registry_entries e where e.source_key = v_src and e.added_by = v_uid and not (e.req_id = any (v_keys));
  get diagnostics n_del = row_count;
  return jsonb_build_object('source', v_src, 'added', n_add, 'updated', n_upd, 'duplicates', n_dup, 'removed', n_del, 'existing', 0, 'owner', 'me');
end;
$$;
comment on function public.registry_sync(jsonb, jsonb) is 'Добавляет требования документа в общий реестр без повторов; возвращает счётчики';

create or replace function public.registry_remove(p_code text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  n     integer;
begin
  if v_uid is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;
  delete from public.registry_entries e where e.source_key = public.registry_source(p_code) and e.added_by = v_uid;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.registry_remove(text) is 'Убирает из общего реестра требования документа, добавленные текущим пользователем';

alter table public.registry_entries enable row level security;
drop policy if exists "Общий реестр: чтение" on public.registry_entries;
create policy "Общий реестр: чтение" on public.registry_entries for select to authenticated using (true);
revoke all on public.registry_entries from anon, authenticated;
grant select on public.registry_entries to authenticated;
revoke execute on function public.registry_sync(jsonb, jsonb), public.registry_remove(text) from public, anon;
grant execute on function public.registry_sync(jsonb, jsonb), public.registry_remove(text) to authenticated;

-- Требования опубликованного регламента C2.4.1.MTH.01 (столбцы A–T мастер-реестра)
-- @@SEED-BEGIN@@
insert into public.registry_entries (source_key, req_id, pos, card_id, doc_code, doc_title, doc_version, doc_type,
  statement, statement_hash, modality, category, complete, cols)
select s.code, s.req_id, s.pos, s.card_id, s.code, s.title, s.version, nullif(s.type, ''), s.statement,
  md5(public.registry_norm(s.statement)), nullif(s.modality, ''), nullif(s.category, ''), s.complete, s.cols
from jsonb_to_recordset($seed$[{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":1,"req_id":"REQ-C2.4.1-MTH01-3.1.3-01","card_id":"TEMP-20261020-001","statement":"После ввода разработанного решения в промышленную эксплуатацию ФМ интегрируется в модель бизнес-процесса, в том числе на формализованном уровне (схема процесса, текст).","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-001","Интеграция ФМ в модель бизнес-процесса","Функциональная модель информационной системы","После ввода разработанного решения в промышленную эксплуатацию ФМ интегрируется в модель бизнес-процесса, в том числе на формализованном уровне (схема процесса, текст).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.1.3; REQ-C2.4.1-MTH01-3.1.3-01","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2); после ввода разработанного решения в промышленную эксплуатацию","C3","Экспертиза документа","После ввода решения в промышленную эксплуатацию схема процесса и текст ФМ включены в модель бизнес-процесса; указана редакция модели.","Черновик","0.1","","","Ответственный за интеграцию в документе не назван (замечание EN-05). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Модель бизнес-процесса расходится с фактическим решением; устраняется актуализацией модели. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":2,"req_id":"REQ-C2.4.1-MTH01-3.3-01","card_id":"TEMP-20261020-002","statement":"Подразделение, обеспечивающее цифровизацию бизнес-процессов, описывает текстовую часть ФМ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-002","Исполнитель описания текстовой части ФМ","Текстовая (описательная) часть ФМ","Подразделение, обеспечивающее цифровизацию бизнес-процессов, описывает текстовую часть ФМ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-01","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Проверка листа согласования / истории изменений ФМ","Текстовую часть ФМ подготовило подразделение, обеспечивающее цифровизацию бизнес-процессов; это видно из листа согласования или истории изменений ФМ.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Не определён исполнитель отдельной работы с ФМ; последствия локальны и устраняются распределением задачи. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":3,"req_id":"REQ-C2.4.1-MTH01-3.3-02","card_id":"TEMP-20261020-003","statement":"Подразделение, обеспечивающее цифровизацию бизнес-процессов, актуализирует схему процесса с учетом операций, выполняемых информационной системой.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-003","Актуализация схемы процесса","Схема процесса","Подразделение, обеспечивающее цифровизацию бизнес-процессов, актуализирует схему процесса с учетом операций, выполняемых информационной системой.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-02","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Проверка листа согласования / истории изменений ФМ","Схема процесса обновлена с учетом операций, выполняемых ИС; изменение внесено подразделением цифровизации и отражено в истории изменений схемы.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Не определён исполнитель отдельной работы с ФМ; последствия локальны и устраняются распределением задачи. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":4,"req_id":"REQ-C2.4.1-MTH01-3.3-03","card_id":"TEMP-20261020-004","statement":"Подразделение, обеспечивающее цифровизацию бизнес-процессов, актуализирует ФМ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-004","Актуализация ФМ","Функциональная модель информационной системы","Подразделение, обеспечивающее цифровизацию бизнес-процессов, актуализирует ФМ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-03","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Проверка листа согласования / истории изменений ФМ","ФМ соответствует действующему функционалу модуля; актуализация выполнена подразделением цифровизации и отражена в истории изменений ФМ.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Не определён исполнитель отдельной работы с ФМ; последствия локальны и устраняются распределением задачи. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":5,"req_id":"REQ-C2.4.1-MTH01-3.3-04","card_id":"TEMP-20261020-005","statement":"Подразделение, обеспечивающее цифровизацию бизнес-процессов, оптимизирует ФМ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-005","Оптимизация ФМ","Функциональная модель информационной системы","Подразделение, обеспечивающее цифровизацию бизнес-процессов, оптимизирует ФМ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-04","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Проверка листа согласования / истории изменений ФМ","Оптимизация ФМ выполнена подразделением цифровизации; изменения отражены в истории изменений ФМ.","Черновик","0.1","","","Что считается оптимизацией ФМ, в документе не определено — критерий требует уточнения владельцем. Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Не определён исполнитель отдельной работы с ФМ; последствия локальны и устраняются распределением задачи. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":6,"req_id":"REQ-C2.4.1-MTH01-3.3-05","card_id":"TEMP-20261020-006","statement":"Подразделение, обеспечивающее цифровизацию бизнес-процессов, согласовывает новую редакцию ФМ, выпускаемую взамен ранее утвержденной, с владельцами модулей и ФЗ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-006","Согласование новой редакции ФМ","Функциональная модель информационной системы","Подразделение, обеспечивающее цифровизацию бизнес-процессов, согласовывает новую редакцию ФМ, выпускаемую взамен ранее утвержденной, с владельцами модулей и ФЗ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-05","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2); выпуск новой редакции ФМ взамен ранее утвержденной","C2","Проверка листа согласования / истории изменений ФМ","Новая редакция ФМ до утверждения согласована со всеми владельцами затронутых модулей и ФЗ; есть лист согласования.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Без согласования/утверждения ФМ не имеет силы и не может использоваться как действующее описание. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":7,"req_id":"REQ-C2.4.1-MTH01-3.3-06","card_id":"TEMP-20261020-007","statement":"Владельцы модулей согласовывают ФМ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-007","Согласование ФМ владельцами модулей","Функциональная модель информационной системы","Владельцы модулей согласовывают ФМ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-06","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Проверка листа согласования / истории изменений ФМ","В листе согласования ФМ есть отметки всех владельцев затронутых модулей.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Без согласования/утверждения ФМ не имеет силы и не может использоваться как действующее описание. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":8,"req_id":"REQ-C2.4.1-MTH01-3.3-07","card_id":"TEMP-20261020-008","statement":"ФЗ утверждает ФМ.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-008","Утверждение ФМ функциональным заказчиком","Функциональная модель информационной системы","ФЗ утверждает ФМ.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 3.3; REQ-C2.4.1-MTH01-3.3-07","L2","Департамент цифровизации инжиниринга и платформ","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Проверка листа согласования / истории изменений ФМ","ФМ утверждена ФЗ: есть отметка об утверждении с датой.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Без согласования/утверждения ФМ не имеет силы и не может использоваться как действующее описание. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":9,"req_id":"REQ-C2.4.1-MTH01-4-01","card_id":"TEMP-20261020-009","statement":"ФМ должна включать описательную (текстовую) часть.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-009","Наличие текстовой части ФМ","Функциональная модель информационной системы","ФМ должна включать описательную (текстовую) часть.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4 (вводный абзац); REQ-C2.4.1-MTH01-4-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","ФМ содержит текстовую (описательную) часть.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":10,"req_id":"REQ-C2.4.1-MTH01-4-02","card_id":"TEMP-20261020-010","statement":"ФМ должна включать графическую часть.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-010","Наличие графической части ФМ","Функциональная модель информационной системы","ФМ должна включать графическую часть.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4 (вводный абзац); REQ-C2.4.1-MTH01-4-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","ФМ содержит графическую часть — схему процесса.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":11,"req_id":"REQ-C2.4.1-MTH01-4.1.1-01","card_id":"TEMP-20261020-011","statement":"Текстовая часть ФМ должна включать раздел о назначении и основных функциях модуля информационной системы.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-011","Раздел «Назначение и основные функции модуля»","Текстовая (описательная) часть ФМ","Текстовая часть ФМ должна включать раздел о назначении и основных функциях модуля информационной системы.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.1; REQ-C2.4.1-MTH01-4.1.1-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","В текстовой части ФМ есть раздел о назначении и основных функциях модуля.","Черновик","0.1","","","Название раздела в п. 4.1.1 и в заголовке п. 4.1.2 расходится (замечание EN-09). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":12,"req_id":"REQ-C2.4.1-MTH01-4.1.1-02","card_id":"TEMP-20261020-012","statement":"Текстовая часть ФМ должна включать раздел о бизнес-ролях и их функциях в информационной системе.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-012","Раздел «Бизнес-роли и их функции»","Текстовая (описательная) часть ФМ","Текстовая часть ФМ должна включать раздел о бизнес-ролях и их функциях в информационной системе.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.1; REQ-C2.4.1-MTH01-4.1.1-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","В текстовой части ФМ есть раздел о бизнес-ролях и их функциях в ИС.","Черновик","0.1","","","Название раздела в п. 4.1.1 и в заголовке п. 4.1.3 расходится (замечание EN-09). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":13,"req_id":"REQ-C2.4.1-MTH01-4.1.1-03","card_id":"TEMP-20261020-013","statement":"Текстовая часть ФМ должна включать раздел о входных и выходных данных с указанием поставщика/потребителя.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-013","Раздел «Входные и выходные данные»","Текстовая (описательная) часть ФМ","Текстовая часть ФМ должна включать раздел о входных и выходных данных с указанием поставщика/потребителя.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.1; REQ-C2.4.1-MTH01-4.1.1-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","В текстовой части ФМ есть раздел о входных и выходных данных с поставщиками и потребителями.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":14,"req_id":"REQ-C2.4.1-MTH01-4.1.1-04","card_id":"TEMP-20261020-014","statement":"Текстовая часть ФМ должна включать раздел о внутреннем процессе преобразования данных и взаимодействии с другими модулями/информационными системами.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-014","Раздел «Преобразование данных и взаимодействие»","Текстовая (описательная) часть ФМ","Текстовая часть ФМ должна включать раздел о внутреннем процессе преобразования данных и взаимодействии с другими модулями/информационными системами.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.1; REQ-C2.4.1-MTH01-4.1.1-04","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","В текстовой части ФМ есть раздел о внутреннем процессе преобразования данных и взаимодействии с другими модулями и ИС.","Черновик","0.1","","","Название раздела в п. 4.1.1 и в заголовке п. 4.1.5 расходится (замечание EN-09). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Обязательная часть ФМ: без неё ФМ неполна и не может быть согласована. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":15,"req_id":"REQ-C2.4.1-MTH01-4.1.2-01","card_id":"TEMP-20261020-015","statement":"Раздел о назначении и основных функциях модуля должен подробно раскрывать ключевые цели, преследуемые при внедрении модуля.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-015","Цели внедрения модуля","Раздел «Назначение и основные функции модуля информационной системы»","Раздел о назначении и основных функциях модуля должен подробно раскрывать ключевые цели, преследуемые при внедрении модуля.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.2; REQ-C2.4.1-MTH01-4.1.2-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","В разделе перечислены ключевые цели внедрения модуля.","Черновик","0.1","","","Слово «подробно» не задаёт бинарного критерия; глубину описания определяет эксперт. Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":16,"req_id":"REQ-C2.4.1-MTH01-4.1.2-02","card_id":"TEMP-20261020-016","statement":"Раздел о назначении и основных функциях модуля должен содержать полный перечень всех основных операций, осуществляемых модулем.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-016","Полный перечень операций модуля","Раздел «Назначение и основные функции модуля информационной системы»","Раздел о назначении и основных функциях модуля должен содержать полный перечень всех основных операций, осуществляемых модулем.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.2; REQ-C2.4.1-MTH01-4.1.2-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Перечень содержит все основные операции модуля; сверен с функционалом модуля или ТЗ на него.","Черновик","0.1","","","Обоснование C2: Ядро ФМ: пропуск ведёт к неописанному функционалу модуля. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":17,"req_id":"REQ-C2.4.1-MTH01-4.1.2-03","card_id":"TEMP-20261020-017","statement":"Раздел о назначении и основных функциях модуля должен показывать, каким способом модуль помогает решать конкретные бизнес-задачи Предприятия.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-017","Решаемые бизнес-задачи","Раздел «Назначение и основные функции модуля информационной системы»","Раздел о назначении и основных функциях модуля должен показывать, каким способом модуль помогает решать конкретные бизнес-задачи Предприятия.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.2; REQ-C2.4.1-MTH01-4.1.2-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для ключевых целей указано, какую бизнес-задачу Предприятия решает модуль и каким способом.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":18,"req_id":"REQ-C2.4.1-MTH01-4.1.2-04","card_id":"TEMP-20261020-018","statement":"В разделе о назначении и основных функциях модуля особое внимание уделяется тому, как внедрение модуля способствует оптимизации рутинных процедур, снижению временных затрат и повышению уровня автоматизации ключевых аспектов деятельности Предприятия.","modality":"should","category":"business","complete":true,"cols":["TEMP-20261020-018","Вклад модуля в оптимизацию и автоматизацию","Раздел «Назначение и основные функции модуля информационной системы»","В разделе о назначении и основных функциях модуля особое внимание уделяется тому, как внедрение модуля способствует оптимизации рутинных процедур, снижению временных затрат и повышению уровня автоматизации ключевых аспектов деятельности Предприятия.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.2; REQ-C2.4.1-MTH01-4.1.2-04","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C4","Экспертиза документа","В разделе описано, как модуль сокращает рутинные операции и временные затраты и повышает автоматизацию.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C4: Рекомендация («рекомендуется»): влияет на наглядность, а не на полноту ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":19,"req_id":"REQ-C2.4.1-MTH01-4.1.3a-01","card_id":"TEMP-20261020-019","statement":"Раздел о бизнес-ролях должен содержать подробную классификацию категорий пользователей, непосредственно вовлеченных в работу с модулем информационной системы.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-019","Классификация категорий пользователей","Раздел «Бизнес-роли и их функции в информационной системе»","Раздел о бизнес-ролях должен содержать подробную классификацию категорий пользователей, непосредственно вовлеченных в работу с модулем информационной системы.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 а); REQ-C2.4.1-MTH01-4.1.3a-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","В разделе приведён перечень категорий пользователей модуля; каждая категория описана.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":20,"req_id":"REQ-C2.4.1-MTH01-4.1.3a-02","card_id":"TEMP-20261020-020","statement":"В разделе о бизнес-ролях должны быть четко обозначены полномочия и функциональные возможности категорий пользователей в рамках набора функций, предоставляемого информационной системой.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-020","Полномочия категорий пользователей","Раздел «Бизнес-роли и их функции в информационной системе»","В разделе о бизнес-ролях должны быть четко обозначены полномочия и функциональные возможности категорий пользователей в рамках набора функций, предоставляемого информационной системой.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 а); REQ-C2.4.1-MTH01-4.1.3a-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждой категории пользователей указаны полномочия и доступные функции модуля.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":21,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-01","card_id":"TEMP-20261020-021","statement":"Для каждой бизнес-роли должно быть представлено подробное описание ее назначения.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-021","Назначение бизнес-роли","Раздел «Бизнес-роли и их функции в информационной системе»","Для каждой бизнес-роли должно быть представлено подробное описание ее назначения.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждой бизнес-роли описано её назначение.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":22,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-02","card_id":"TEMP-20261020-022","statement":"Для каждой бизнес-роли должно быть представлено подробное описание ее области ответственности.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-022","Область ответственности бизнес-роли","Раздел «Бизнес-роли и их функции в информационной системе»","Для каждой бизнес-роли должно быть представлено подробное описание ее области ответственности.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждой бизнес-роли описана её область ответственности.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":23,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-03","card_id":"TEMP-20261020-023","statement":"Каждая роль должна иметь четко обозначенный список возможных операций, выполняемых в информационной системе.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-023","Перечень операций роли","Раздел «Бизнес-роли и их функции в информационной системе»","Каждая роль должна иметь четко обозначенный список возможных операций, выполняемых в информационной системе.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждой роли приведён список операций, которые она выполняет в ИС.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":24,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-04","card_id":"TEMP-20261020-024","statement":"Функции бизнес-ролей должны быть привязаны к системным ролям информационной системы.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-024","Привязка функций к системным ролям","Раздел «Бизнес-роли и их функции в информационной системе»","Функции бизнес-ролей должны быть привязаны к системным ролям информационной системы.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-04","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Каждая функция бизнес-роли сопоставлена с системной ролью ИС.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Влияет на настройку ролевой модели ИС: функции без привязки к системным ролям не реализуемы однозначно. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":25,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-05","card_id":"TEMP-20261020-025","statement":"Функции приводятся с указанием конкретных возможностей и ограничений.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-025","Возможности и ограничения функций","Раздел «Бизнес-роли и их функции в информационной системе»","Функции приводятся с указанием конкретных возможностей и ограничений.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-05","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждой функции роли указаны возможности и ограничения.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":26,"req_id":"REQ-C2.4.1-MTH01-4.1.3b-06","card_id":"TEMP-20261020-026","statement":"В разделе должны быть четко сформулированы ограничения доступа к критически важным ресурсам и операциям в зависимости от уровня компетенции каждого пользователя.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-026","Ограничения доступа к критичным ресурсам","Раздел «Бизнес-роли и их функции в информационной системе»","В разделе должны быть четко сформулированы ограничения доступа к критически важным ресурсам и операциям в зависимости от уровня компетенции каждого пользователя.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.3 б); REQ-C2.4.1-MTH01-4.1.3b-06","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Для каждого уровня компетенции пользователей указаны ограничения доступа к критически важным ресурсам и операциям.","Черновик","0.1","","","Перечень критически важных ресурсов документ не определяет — его задаёт ФМ конкретного модуля. Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Риск для информационной безопасности: не зафиксированы ограничения доступа к критичным ресурсам. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":27,"req_id":"REQ-C2.4.1-MTH01-4.1.4-01","card_id":"TEMP-20261020-027","statement":"Раздел о входных и выходных данных должен детально рассматривать структуру информационных потоков до начала внутренней процедуры обработки (входные данные).","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-027","Входные информационные потоки","Раздел «Входные и выходные данные, поставщик/потребитель»","Раздел о входных и выходных данных должен детально рассматривать структуру информационных потоков до начала внутренней процедуры обработки (входные данные).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.4; REQ-C2.4.1-MTH01-4.1.4-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Описаны все входные информационные потоки: состав данных и точка поступления до начала обработки.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":28,"req_id":"REQ-C2.4.1-MTH01-4.1.4-02","card_id":"TEMP-20261020-028","statement":"Раздел о входных и выходных данных должен детально рассматривать структуру информационных потоков после полного завершения всех этапов преобразования данных (выходные данные).","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-028","Выходные информационные потоки","Раздел «Входные и выходные данные, поставщик/потребитель»","Раздел о входных и выходных данных должен детально рассматривать структуру информационных потоков после полного завершения всех этапов преобразования данных (выходные данные).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.4; REQ-C2.4.1-MTH01-4.1.4-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Описаны все выходные информационные потоки после завершения преобразования данных.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":29,"req_id":"REQ-C2.4.1-MTH01-4.1.4-03","card_id":"TEMP-20261020-029","statement":"Для входных и выходных данных указываются поставщик и потребитель.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-029","Поставщики и потребители данных","Раздел «Входные и выходные данные, поставщик/потребитель»","Для входных и выходных данных указываются поставщик и потребитель.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.4; REQ-C2.4.1-MTH01-4.1.4-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Для каждого входного и выходного потока указаны поставщик и потребитель.","Черновик","0.1","","","Требование выведено из заголовка пункта: в тексте п. 4.1.4 поставщик и потребитель не упомянуты. Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Риск ошибок интеграции: без интерфейсов, протоколов и поставщиков/потребителей данных смежные системы не согласуются. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":30,"req_id":"REQ-C2.4.1-MTH01-4.1.4-04","card_id":"TEMP-20261020-030","statement":"Изложение должно наглядно отображать существующие связи между отдельными компонентами информационной системы.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-030","Связи между компонентами ИС","Раздел «Входные и выходные данные, поставщик/потребитель»","Изложение должно наглядно отображать существующие связи между отдельными компонентами информационной системы.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.4; REQ-C2.4.1-MTH01-4.1.4-04","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Связи между компонентами ИС показаны схемой или таблицей.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":31,"req_id":"REQ-C2.4.1-MTH01-4.1.4-05","card_id":"TEMP-20261020-031","statement":"Изложение должно демонстрировать способы взаимодействия внутренних компонентов информационной системы с внешними.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-031","Взаимодействие с внешними компонентами","Раздел «Входные и выходные данные, поставщик/потребитель»","Изложение должно демонстрировать способы взаимодействия внутренних компонентов информационной системы с внешними.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.4; REQ-C2.4.1-MTH01-4.1.4-05","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Показано взаимодействие внутренних компонентов ИС с внешними системами и пользователями.","Черновик","0.1","","","В тексте «с внешним» — принято «с внешними» (замечание EN-10). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":32,"req_id":"REQ-C2.4.1-MTH01-4.1.5a-01","card_id":"TEMP-20261020-032","statement":"В разделе подробно излагаются этапы трансформации исходных данных внутри информационной системы: прием данных, предварительная обработка, фильтрация, нормализация, агрегация и вывод результата.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-032","Этапы трансформации данных","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","В разделе подробно излагаются этапы трансформации исходных данных внутри информационной системы: прием данных, предварительная обработка, фильтрация, нормализация, агрегация и вывод результата.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 а); REQ-C2.4.1-MTH01-4.1.5a-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Описаны применимые к модулю этапы обработки: приём, предварительная обработка, фильтрация, нормализация, агрегация, вывод результата.","Черновик","0.1","","","Не все этапы применимы к каждому модулю; неприменимые следует отметить явно. Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":33,"req_id":"REQ-C2.4.1-MTH01-4.1.5a-02","card_id":"TEMP-20261020-033","statement":"Этапы трансформации данных представляются в виде DFD-диаграмм.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-033","DFD-диаграмма обработки данных","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","Этапы трансформации данных представляются в виде DFD-диаграмм.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 а); REQ-C2.4.1-MTH01-4.1.5a-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Этапы трансформации данных представлены DFD-диаграммой.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":34,"req_id":"REQ-C2.4.1-MTH01-4.1.5a-03","card_id":"TEMP-20261020-034","statement":"Описываются типы используемых алгоритмов анализа и машинного обучения.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-034","Типы алгоритмов анализа и МО","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","Описываются типы используемых алгоритмов анализа и машинного обучения.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 а); REQ-C2.4.1-MTH01-4.1.5a-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2); в модуле используются алгоритмы анализа и/или машинного обучения","C3","Экспертиза документа","Если в модуле используются алгоритмы анализа или машинного обучения, указаны их типы.","Черновик","0.1","","","Условие применимости выведено из формулировки (замечание EN-08). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":35,"req_id":"REQ-C2.4.1-MTH01-4.1.5a-04","card_id":"TEMP-20261020-035","statement":"Обозначаются форматы хранения промежуточных результатов и итоговых данных.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-035","Форматы хранения данных","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","Обозначаются форматы хранения промежуточных результатов и итоговых данных.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 а); REQ-C2.4.1-MTH01-4.1.5a-04","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Указаны форматы хранения промежуточных результатов и итоговых данных.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":36,"req_id":"REQ-C2.4.1-MTH01-4.1.5b-01","card_id":"TEMP-20261020-036","statement":"Детально перечисляются интерфейсы связи с остальными элементами информационной инфраструктуры предприятия (базы данных, ERP-системы, BI-платформы).","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-036","Интерфейсы с инфраструктурой предприятия","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","Детально перечисляются интерфейсы связи с остальными элементами информационной инфраструктуры предприятия (базы данных, ERP-системы, BI-платформы).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 б); REQ-C2.4.1-MTH01-4.1.5b-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Перечислены все интерфейсы модуля с базами данных, ERP, BI и другими элементами инфраструктуры.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Риск ошибок интеграции: без интерфейсов, протоколов и поставщиков/потребителей данных смежные системы не согласуются. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":37,"req_id":"REQ-C2.4.1-MTH01-4.1.5b-02","card_id":"TEMP-20261020-037","statement":"Описываются стандартизированные протоколы передачи данных и форматы сообщений, принятые для межмодульного взаимодействия.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-037","Протоколы и форматы сообщений","Раздел «Внутренний процесс преобразования данных и взаимодействие с другими модулями»","Описываются стандартизированные протоколы передачи данных и форматы сообщений, принятые для межмодульного взаимодействия.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.1.5 б); REQ-C2.4.1-MTH01-4.1.5b-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза документа","Для каждого интерфейса указаны протокол передачи данных и формат сообщений.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Риск ошибок интеграции: без интерфейсов, протоколов и поставщиков/потребителей данных смежные системы не согласуются. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":38,"req_id":"REQ-C2.4.1-MTH01-4.2.1-01","card_id":"TEMP-20261020-038","statement":"Ключевым элементом графической части ФМ должна быть визуальная схема процесса в нотации BPMN версии 2.0.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-038","Схема процесса в BPMN 2.0","Графическая часть ФМ","Ключевым элементом графической части ФМ должна быть визуальная схема процесса в нотации BPMN версии 2.0.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.1; REQ-C2.4.1-MTH01-4.2.1-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Экспертиза BPMN-схемы","Графическая часть содержит схему процесса в нотации BPMN 2.0 (файл .bpmn или выгрузка из BPMN-редактора).","Черновик","0.1","","","BPMN 2.0 отсутствует в перечне нормативных ссылок (замечание EN-03). Модальность выведена из формулировки: в тексте нет «должен». Обоснование C2: Основа графической части: без BPMN 2.0 схема не проверяется и не интегрируется в модель процесса. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":39,"req_id":"REQ-C2.4.1-MTH01-4.2.2a-01","card_id":"TEMP-20261020-039","statement":"На схеме процесса должны быть четко разделены зоны ответственности: шаги и взаимодействия процесса отражают зоны ответственности каждого участника.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-039","Разделение зон ответственности на схеме","Схема процесса","На схеме процесса должны быть четко разделены зоны ответственности: шаги и взаимодействия процесса отражают зоны ответственности каждого участника.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 а); REQ-C2.4.1-MTH01-4.2.2a-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза BPMN-схемы","Каждый шаг и взаимодействие на схеме находится в дорожке или пуле ответственного участника.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":40,"req_id":"REQ-C2.4.1-MTH01-4.2.2a-02","card_id":"TEMP-20261020-040","statement":"Процесс должен начинаться и заканчиваться определенными пунктами — началом и концом процесса (в нотации BPMN — начальным и завершающим событиями).","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-040","Начало и конец процесса","Схема процесса","Процесс должен начинаться и заканчиваться определенными пунктами — началом и концом процесса (в нотации BPMN — начальным и завершающим событиями).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 а); REQ-C2.4.1-MTH01-4.2.2a-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Автоматическая проверка BPMN-схемы (XPath) / экспертиза","В каждом процессе есть начальное и завершающее события; автоматическая проверка не находит нарушений.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":41,"req_id":"REQ-C2.4.1-MTH01-4.2.2b-01","card_id":"TEMP-20261020-041","statement":"На схеме процесса используются стандартные символы и условные обозначения BPMN 2.0: события, действия (операции), потоки управления, шлюзы, пулы и дорожки.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-041","Стандартные символы BPMN","Схема процесса","На схеме процесса используются стандартные символы и условные обозначения BPMN 2.0: события, действия (операции), потоки управления, шлюзы, пулы и дорожки.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 б); REQ-C2.4.1-MTH01-4.2.2b-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза BPMN-схемы","На схеме используются только стандартные элементы BPMN 2.0.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":42,"req_id":"REQ-C2.4.1-MTH01-4.2.2b-02","card_id":"TEMP-20261020-042","statement":"Для обозначения альтернативных потоков процесса или сходящихся потоков управления используется исключающий шлюз.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-042","Исключающий шлюз для альтернатив","Исключающий шлюз","Для обозначения альтернативных потоков процесса или сходящихся потоков управления используется исключающий шлюз.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 б); REQ-C2.4.1-MTH01-4.2.2b-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза BPMN-схемы","Альтернативные и сходящиеся потоки оформлены исключающими шлюзами.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":43,"req_id":"REQ-C2.4.1-MTH01-4.2.2b-03","card_id":"TEMP-20261020-043","statement":"Для обозначения параллельных потоков процесса (слияние, ветвление, соединение потоков управления) используется параллельный шлюз.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-043","Параллельный шлюз для параллельных потоков","Параллельный шлюз","Для обозначения параллельных потоков процесса (слияние, ветвление, соединение потоков управления) используется параллельный шлюз.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 б); REQ-C2.4.1-MTH01-4.2.2b-03","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза BPMN-схемы","Параллельные ветвления и слияния оформлены параллельными шлюзами.","Черновик","0.1","","","Модальность выведена из формулировки: в тексте нет «должен». Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":44,"req_id":"REQ-C2.4.1-MTH01-4.2.2v-01","card_id":"TEMP-20261020-044","statement":"Каждый элемент на диаграмме должен иметь четкую связь с ответственными исполнителями или ролями.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-044","Связь элементов схемы с ответственными","Схема процесса","Каждый элемент на диаграмме должен иметь четкую связь с ответственными исполнителями или ролями.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 в); REQ-C2.4.1-MTH01-4.2.2v-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C2","Автоматическая проверка BPMN-схемы (XPath) / экспертиза","Каждый элемент схемы находится в дорожке или пуле ответственного; автоматическая проверка не находит нарушений.","Черновик","0.1","","","Обоснование C2: Без привязки к исполнителям схема не определяет ответственность за шаги процесса. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":45,"req_id":"REQ-C2.4.1-MTH01-4.2.2g-01","card_id":"TEMP-20261020-045","statement":"На схеме процесса следует минимизировать количество пересекающихся линий (потоков управления).","modality":"should","category":"business","complete":true,"cols":["TEMP-20261020-045","Минимум пересечений потоков","Схема процесса","На схеме процесса следует минимизировать количество пересекающихся линий (потоков управления).","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 г); REQ-C2.4.1-MTH01-4.2.2g-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C4","Экспертная оценка BPMN-схемы","Пересечения потоков управления отсутствуют или сведены к минимуму по оценке эксперта.","Черновик","0.1","","","«Минимизация» не даёт бинарного критерия; решение принимает эксперт. Модальность выведена из формулировки: в тексте нет «должен». Обоснование C4: Рекомендация («рекомендуется»): влияет на наглядность, а не на полноту ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":46,"req_id":"REQ-C2.4.1-MTH01-4.2.2d-01","card_id":"TEMP-20261020-046","statement":"Каждая операция должна последовательно вести к следующей, обеспечивая непрерывность процесса и потока данных.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-046","Непрерывность потока операций","Схема процесса","Каждая операция должна последовательно вести к следующей, обеспечивая непрерывность процесса и потока данных.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 д); REQ-C2.4.1-MTH01-4.2.2d-01","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Автоматическая проверка BPMN-схемы (XPath) / экспертиза","У каждой операции есть исходящий поток управления; автоматическая проверка не находит нарушений.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":47,"req_id":"REQ-C2.4.1-MTH01-4.2.2d-02","card_id":"TEMP-20261020-047","statement":"Не допускается, чтобы процесс останавливался или терял логику следования, в том числе чтобы процедура/операция являлась завершающим событием процесса.","modality":"shall-not","category":"business","complete":true,"cols":["TEMP-20261020-047","Запрет обрыва процесса","Схема процесса","Не допускается, чтобы процесс останавливался или терял логику следования, в том числе чтобы процедура/операция являлась завершающим событием процесса.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","п. 4.2.2 д); REQ-C2.4.1-MTH01-4.2.2d-02","L2","Отдел цифрового развития процессов","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Автоматическая проверка BPMN-схемы (XPath) / экспертиза","Элементы без исходящего потока — только завершающие события; автоматическая проверка не находит нарушений.","Черновик","0.1","","","Обоснование C3: Снижает качество раздела или схемы; выявляется на экспертизе и исправляется новой редакцией ФМ. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]},{"code":"C2.4.1.MTH.01","title":"Методика по разработке функциональных моделей информационных систем","version":"1.0","type":"MTH","pos":48,"req_id":"REQ-C2.4.1-MTH01-APP1-01","card_id":"TEMP-20261020-048","statement":"При работе с документом следует проверить актуальность источников и использовать их последние утвержденные редакции или редакции документов, изданных взамен.","modality":"shall","category":"business","complete":true,"cols":["TEMP-20261020-048","Актуальность нормативных ссылок","Перечень нормативных ссылок документа","При работе с документом следует проверить актуальность источников и использовать их последние утвержденные редакции или редакции документов, изданных взамен.","C2.4.1.MTH.01 «Методика по разработке функциональных моделей информационных систем», версия 1.0","Приложение 1; REQ-C2.4.1-MTH01-APP1-01","L2","Отдел интегрированной системы менеджмента","Описание функциональных моделей, разрабатываемых для вновь введенного функционала информационных систем (п. 2.1.2)","C3","Экспертиза документа","Для каждого источника из Приложения 1 проверена актуальность; используются действующие редакции.","Черновик","0.1","","","Обоснование C3: Использование устаревшего источника выявляется при пересмотре; последствия локальны. Критичность и владелец — предварительно, подтвердить владельцем.","Готово","Бизнес-требование",""]}]$seed$::jsonb) as s(code text, title text, version text, type text, pos integer,
  req_id text, card_id text, statement text, modality text, category text, complete boolean, cols jsonb)
on conflict do nothing;
-- @@SEED-END@@
