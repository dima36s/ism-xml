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
--   Представления по уровням: documents_level_1 … documents_level_4, documents_external; v_registry, v_document_stats
--
-- Доступ: каждый пользователь видит и меняет только свои строки (Row Level Security, owner_id = auth.uid()).
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
  source_kind text not null check (source_kind in ('builtin', 'docx', 'pdf', 'xlsx', 'xml')),
  file_name   text,
  xml         text,                                -- XML ИСМ; пусто у неизменённого опубликованного регламента
  included    boolean not null default true,       -- входит в общий реестр
  overridden  boolean not null default false,      -- опубликованный регламент изменён пользователем
  report      jsonb not null default '{}'::jsonb,  -- отчёт автоматической разметки
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, client_key)
);
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
