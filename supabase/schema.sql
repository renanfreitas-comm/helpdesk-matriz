-- ==========================================================================
-- HELP DESK MATRIZ — ESTRUTURA DO BANCO NO SUPABASE
-- ==========================================================================
-- Como usar: Supabase > SQL Editor > New query > cole TODO este arquivo >
-- Run.  Pode rodar de novo sem problema (o script é "idempotente": não
-- apaga dados já existentes).
--
-- O que este arquivo cria:
--   * As tabelas: usuarios, chamados, relatorios, maquinas,
--     maquina_historico, itens_estoque e visitas.
--   * As regras de acesso (RLS) — equivalentes às antigas regras do Firestore:
--       - só quem tem perfil em "usuarios" lê ou grava qualquer coisa;
--       - ninguém se promove a admin; sempre resta pelo menos um admin;
--       - técnico só muda o STATUS dos chamados em que é responsável;
--       - técnico só vê/edita os próprios relatórios; admin vê todos;
--       - visitas: só quem registrou ou admin edita;
--       - excluir chamados, máquinas, estoque e visitas: só admin.
--   * Gatilhos que preenchem sozinhos quem criou, quando criou, quando
--     atualizou e quando o chamado foi resolvido (não dá para falsificar).
--   * A linha do tempo de cada chamado (chamado_eventos): abertura,
--     mudanças de status/responsável e comentários dos técnicos.
--   * O "bucket" privado "laudos" (Storage) para os laudos das visitas.
--   * A publicação Realtime, para as telas se atualizarem sozinhas.
-- ==========================================================================

-- --------------------------------------------------------------- USUÁRIOS
create table if not exists public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 120),
  email      text not null check (email = lower(email) and char_length(email) <= 200),
  papel      text not null default 'tecnico' check (papel in ('tecnico', 'admin')),
  criado_em  timestamptz not null default now()
);

-- Funções auxiliares usadas nas regras (security definer = enxergam a
-- tabela usuarios mesmo com RLS ligado, sem causar recursão).
create or replace function public.eh_membro()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and papel = 'admin');
$$;

create or replace function public.meu_nome()
returns text language sql stable security definer set search_path = public as $$
  select nome from public.usuarios where id = auth.uid();
$$;

create or replace function public.nome_usuario(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select nome from public.usuarios where id = p_uid;
$$;

-- E-mail, id e data de criação do perfil são fixos; e nunca pode ficar
-- sem nenhum admin no sistema.
create or replace function public.tg_usuarios()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.email := old.email;
    new.criado_em := old.criado_em;
    if old.papel = 'admin' and new.papel <> 'admin'
       and (select count(*) from public.usuarios where papel = 'admin') <= 1 then
      raise exception 'Precisa haver pelo menos um supervisor/admin no sistema.';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.papel = 'admin'
       and (select count(*) from public.usuarios where papel = 'admin') <= 1 then
      raise exception 'Não é possível excluir o único supervisor/admin.';
    end if;
    return old;
  end if;
  return new;
end $$;

drop trigger if exists usuarios_regras on public.usuarios;
create trigger usuarios_regras before update or delete on public.usuarios
  for each row execute function public.tg_usuarios();

-- --------------------------------------------------------------- CHAMADOS
create table if not exists public.chamados (
  id               text primary key default gen_random_uuid()::text,
  numero           text not null default '' check (char_length(numero) <= 100),
  area             text not null default '' check (char_length(area) <= 200),
  atividade        text not null default '' check (char_length(atividade) <= 5000),
  prioridade       text not null default 'media' check (prioridade in ('baixa', 'media', 'alta')),
  status           text not null default 'aberto' check (status in ('aberto', 'andamento', 'resolvido')),
  responsavel_uid  uuid,
  responsavel_nome text check (char_length(responsavel_nome) <= 120),
  criado_por_uid   uuid,
  criado_por_nome  text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  resolvido_em     timestamptz
);
create index if not exists chamados_criado_em_idx on public.chamados (criado_em desc);
create index if not exists chamados_responsavel_idx on public.chamados (responsavel_uid);

create or replace function public.tg_chamados()
returns trigger language plpgsql as $$
begin
  -- auth.uid() nulo = SQL Editor / script de migração: grava como veio.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.criado_por_uid := auth.uid();
    new.criado_por_nome := public.meu_nome();
    new.criado_em := now();
    new.atualizado_em := now();
    -- Técnico pode abrir o chamado sem responsável ou já para si mesmo
    -- (o caso mais comum: ele mesmo vai atender). Nunca para outra pessoa.
    if not public.eh_admin() and new.responsavel_uid is distinct from auth.uid() then
      new.responsavel_uid := null;
    end if;
    new.resolvido_em := case when new.status = 'resolvido' then now() end;
  else
    new.id := old.id;
    new.criado_por_uid := old.criado_por_uid;
    new.criado_por_nome := old.criado_por_nome;
    new.criado_em := old.criado_em;
    new.atualizado_em := now();
    -- Técnico: só muda o status dos chamados dele, ou "assume" um chamado
    -- sem responsável (colocando a si mesmo como responsável).
    if not public.eh_admin() then
      if (new.numero, new.area, new.atividade, new.prioridade)
         is distinct from (old.numero, old.area, old.atividade, old.prioridade) then
        raise exception 'Técnicos só podem alterar o status do chamado.' using errcode = '42501';
      end if;
      if new.responsavel_uid is distinct from old.responsavel_uid
         and not (old.responsavel_uid is null and new.responsavel_uid = auth.uid()) then
        raise exception 'Você só pode assumir chamados que estão sem responsável.' using errcode = '42501';
      end if;
      if old.responsavel_uid is null and new.responsavel_uid is null then
        raise exception 'Assuma o chamado antes de mudar o status.' using errcode = '42501';
      end if;
    end if;
    -- Data de resolução: gravada na transição para "resolvido", limpa ao reabrir.
    if new.status = 'resolvido' and old.status <> 'resolvido' then
      new.resolvido_em := now();
    elsif new.status <> 'resolvido' then
      new.resolvido_em := null;
    else
      new.resolvido_em := old.resolvido_em;
    end if;
  end if;

  -- Nome do responsável sempre coerente com o cadastro.
  new.responsavel_nome := case when new.responsavel_uid is null then null
                               else public.nome_usuario(new.responsavel_uid) end;
  return new;
end $$;

drop trigger if exists chamados_regras on public.chamados;
create trigger chamados_regras before insert or update on public.chamados
  for each row execute function public.tg_chamados();

-- Linha do tempo do chamado: eventos automáticos + comentários.
create table if not exists public.chamado_eventos (
  id          bigint generated always as identity primary key,
  chamado_id  text not null references public.chamados (id) on delete cascade,
  tipo        text not null check (tipo in ('criacao', 'status', 'atribuicao', 'edicao', 'comentario')),
  texto       text not null default '' check (char_length(texto) <= 2000),
  autor_uid   uuid,
  autor_nome  text,
  criado_em   timestamptz not null default now()
);
create index if not exists chamado_eventos_chamado_idx on public.chamado_eventos (chamado_id, criado_em);

-- Comentários: autor e data sempre de quem está logado.
create or replace function public.tg_chamado_eventos()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.autor_uid := auth.uid();
    new.autor_nome := public.meu_nome();
    new.criado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists chamado_eventos_autor on public.chamado_eventos;
create trigger chamado_eventos_autor before insert on public.chamado_eventos
  for each row execute function public.tg_chamado_eventos();

-- Registra sozinho na linha do tempo o que mudou no chamado.
-- (security definer: grava o evento mesmo sem permissão direta na tabela.)
create or replace function public.tg_chamados_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rotulo jsonb := '{"aberto":"Aberto","andamento":"Em andamento","resolvido":"Resolvido"}';
begin
  if auth.uid() is null then return null; end if;  -- migração/SQL Editor: sem eventos

  if tg_op = 'INSERT' then
    insert into chamado_eventos (chamado_id, tipo, texto, autor_uid, autor_nome)
    values (new.id, 'criacao',
            'Chamado aberto' || coalesce(' — responsável: ' || new.responsavel_nome, ''),
            auth.uid(), meu_nome());
    return null;
  end if;

  if new.responsavel_uid is distinct from old.responsavel_uid then
    insert into chamado_eventos (chamado_id, tipo, texto, autor_uid, autor_nome)
    values (new.id, 'atribuicao',
            case when new.responsavel_uid is null then 'Responsável removido'
                 when new.responsavel_uid = auth.uid() and old.responsavel_uid is null then 'Assumiu o chamado'
                 else 'Atribuído a ' || coalesce(new.responsavel_nome, '—') end,
            auth.uid(), meu_nome());
  end if;
  if new.status is distinct from old.status then
    insert into chamado_eventos (chamado_id, tipo, texto, autor_uid, autor_nome)
    values (new.id, 'status',
            'Status: ' || (rotulo ->> old.status) || ' → ' || (rotulo ->> new.status),
            auth.uid(), meu_nome());
  end if;
  if (new.numero, new.area, new.atividade, new.prioridade)
     is distinct from (old.numero, old.area, old.atividade, old.prioridade) then
    insert into chamado_eventos (chamado_id, tipo, texto, autor_uid, autor_nome)
    values (new.id, 'edicao', 'Dados do chamado editados', auth.uid(), meu_nome());
  end if;
  return null;
end $$;

drop trigger if exists chamados_historico on public.chamados;
create trigger chamados_historico after insert or update on public.chamados
  for each row execute function public.tg_chamados_historico();

-- ------------------------------------------------------------- RELATÓRIOS
create table if not exists public.relatorios (
  id            text primary key default gen_random_uuid()::text,
  tecnico_uid   uuid default auth.uid(),            -- nulo só em relatórios antigos de usuários já excluídos
  tecnico_nome  text,
  data          date not null,
  atividades    jsonb not null default '[]'::jsonb
                check (jsonb_typeof(atividades) = 'array' and jsonb_array_length(atividades) <= 100),
  resumo        text not null default '' check (char_length(resumo) <= 5000),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists relatorios_tecnico_data_idx on public.relatorios (tecnico_uid, data desc);
create index if not exists relatorios_data_idx on public.relatorios (data desc);

create or replace function public.tg_relatorios()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.tecnico_uid := auth.uid();       -- sempre em nome de quem está logado
    new.tecnico_nome := public.meu_nome();
    new.criado_em := now();
  else
    new.id := old.id;
    new.tecnico_uid := old.tecnico_uid;
    new.tecnico_nome := old.tecnico_nome;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists relatorios_regras on public.relatorios;
create trigger relatorios_regras before insert or update on public.relatorios
  for each row execute function public.tg_relatorios();

-- --------------------------------------------------------------- MÁQUINAS
-- Obs.: na tela, alguns campos foram reaproveitados com outros rótulos
-- (setor = Serial, responsavel_uso = Ativo, so = Setor destino, ip =
-- Chamado, processador = Chegada, memoria_ram = Saída, armazenamento =
-- Situação). Os nomes foram mantidos para não perder dados.
create table if not exists public.maquinas (
  id              text primary key default gen_random_uuid()::text,
  nome            text not null check (char_length(nome) between 1 and 200),
  setor           text not null default '' check (char_length(setor) <= 200),
  responsavel_uso text not null default '' check (char_length(responsavel_uso) <= 200),
  status          text not null default 'ativa' check (status in ('ativa', 'manutencao', 'baixada', 'entregue')),
  so              text not null default '' check (char_length(so) <= 200),
  ip              text not null default '' check (char_length(ip) <= 200),
  processador     text not null default '' check (char_length(processador) <= 200),
  memoria_ram     text not null default '' check (char_length(memoria_ram) <= 200),
  armazenamento   text not null default '' check (char_length(armazenamento) <= 200),
  observacoes     text not null default '' check (char_length(observacoes) <= 5000),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists maquinas_nome_idx on public.maquinas (nome);

-- Histórico de manutenções. "on delete cascade": excluir a máquina apaga
-- o histórico dela junto.
create table if not exists public.maquina_historico (
  id            text primary key default gen_random_uuid()::text,
  maquina_id    text not null references public.maquinas (id) on delete cascade,
  descricao     text not null check (char_length(descricao) between 1 and 5000),
  tecnico_uid   uuid,
  tecnico_nome  text,
  criado_em     timestamptz not null default now()
);
create index if not exists maquina_historico_maquina_idx on public.maquina_historico (maquina_id, criado_em desc);

create or replace function public.tg_carimbo_simples()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_em := now();
  else
    new.id := old.id;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists maquinas_regras on public.maquinas;
create trigger maquinas_regras before insert or update on public.maquinas
  for each row execute function public.tg_carimbo_simples();

create or replace function public.tg_historico()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  new.tecnico_uid := auth.uid();
  new.tecnico_nome := public.meu_nome();
  new.criado_em := now();
  return new;
end $$;

drop trigger if exists historico_regras on public.maquina_historico;
create trigger historico_regras before insert on public.maquina_historico
  for each row execute function public.tg_historico();

-- ---------------------------------------------------------------- ESTOQUE
create table if not exists public.itens_estoque (
  id              text primary key default gen_random_uuid()::text,
  equipamento     text not null check (char_length(equipamento) between 1 and 200),
  serial          text not null default '' check (char_length(serial) <= 200),
  ativo           text not null default '' check (char_length(ativo) <= 200),
  chegada         text not null default '' check (chegada ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
  saida           text not null default '' check (saida ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
  delegacao       text not null default '' check (char_length(delegacao) <= 200),
  loja_setor      text not null default '' check (char_length(loja_setor) <= 200),
  prioridade      text not null default 'media' check (prioridade in ('baixa', 'media', 'alta')),
  tecnico_uid     uuid,
  tecnico_nome    text,
  situacao        text not null default 'recebido'
                  check (situacao in ('recebido', 'em_configuracao', 'aguardando_peca', 'concluido', 'entregue')),
  observacoes     text not null default '' check (char_length(observacoes) <= 5000),
  criado_por_uid  uuid,
  criado_por_nome text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists itens_estoque_equipamento_idx on public.itens_estoque (equipamento);

-- Gatilho de autoria para tabelas com criado_por_uid / criado_por_nome.
create or replace function public.tg_autoria()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.criado_por_uid := auth.uid();
    new.criado_por_nome := public.meu_nome();
    new.criado_em := now();
  else
    new.id := old.id;
    new.criado_por_uid := old.criado_por_uid;
    new.criado_por_nome := old.criado_por_nome;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

create or replace function public.tg_estoque_tecnico()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  new.tecnico_nome := case when new.tecnico_uid is null then null
                           else public.nome_usuario(new.tecnico_uid) end;
  return new;
end $$;

drop trigger if exists itens_estoque_regras on public.itens_estoque;
create trigger itens_estoque_regras before insert or update on public.itens_estoque
  for each row execute function public.tg_autoria();
drop trigger if exists itens_estoque_tecnico on public.itens_estoque;
create trigger itens_estoque_tecnico before insert or update on public.itens_estoque
  for each row execute function public.tg_estoque_tecnico();

-- ---------------------------------------------------------------- VISITAS
create table if not exists public.visitas (
  id                  text primary key default gen_random_uuid()::text,
  numero              text not null default '' check (char_length(numero) <= 100),
  titulo              text not null check (char_length(titulo) between 1 and 300),
  recurso_responsavel text not null check (char_length(recurso_responsavel) between 1 and 200),
  cidade              text not null default '' check (char_length(cidade) <= 200),
  data                date not null,
  area                text not null default '' check (char_length(area) <= 200),
  tipo_atendimento    text not null default '' check (char_length(tipo_atendimento) <= 50),
  status              text not null default 'agendada' check (status in ('agendada', 'realizada', 'cancelada')),
  empresa_responsavel text not null default '' check (char_length(empresa_responsavel) <= 100),
  observacoes         text not null default '' check (char_length(observacoes) <= 5000),
  laudo_path          text check (char_length(laudo_path) <= 500),   -- arquivo no Storage (bucket "laudos")
  laudo_url           text check (laudo_url is null or laudo_url ~ '^https://([a-z0-9-]+[.])*google[.]com/'), -- laudos antigos (Google Drive)
  laudo_nome          text check (char_length(laudo_nome) <= 300),
  criado_por_uid      uuid,
  criado_por_nome     text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists visitas_data_idx on public.visitas (data desc);

drop trigger if exists visitas_regras on public.visitas;
create trigger visitas_regras before insert or update on public.visitas
  for each row execute function public.tg_autoria();

create or replace function public.pode_editar_visita(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visitas v
    where v.id = p_id
      and (v.criado_por_uid = auth.uid() or public.eh_admin())
  );
$$;

-- ===================================================== REGRAS DE ACESSO (RLS)
alter table public.usuarios          enable row level security;
alter table public.chamados          enable row level security;
alter table public.chamado_eventos   enable row level security;
alter table public.relatorios        enable row level security;
alter table public.maquinas          enable row level security;
alter table public.maquina_historico enable row level security;
alter table public.itens_estoque     enable row level security;
alter table public.visitas           enable row level security;

-- Visitantes não logados não têm acesso a nada.
revoke all on all tables in schema public from anon;

-- Apaga as políticas antigas antes de recriar (permite rodar o script de novo).
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- usuarios: cada um lê o próprio perfil; membros leem todos (selects de
-- responsável etc.). Só admin muda papel/nome. Criar/excluir conta é feito
-- pela função "admin-usuarios" (Edge Function), nunca direto do site.
create policy usuarios_ler on public.usuarios for select to authenticated
  using (id = auth.uid() or (select public.eh_membro()));
create policy usuarios_editar on public.usuarios for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- chamados
create policy chamados_ler on public.chamados for select to authenticated
  using ((select public.eh_membro()));
create policy chamados_criar on public.chamados for insert to authenticated
  with check ((select public.eh_membro()));
create policy chamados_editar on public.chamados for update to authenticated
  using ((select public.eh_admin())
         or ((responsavel_uid = auth.uid() or responsavel_uid is null) and (select public.eh_membro())))
  with check ((select public.eh_membro()));
create policy chamados_excluir on public.chamados for delete to authenticated
  using ((select public.eh_admin()));

-- chamado_eventos: todos do time leem; qualquer um comenta; eventos
-- automáticos só pelo gatilho; ninguém edita; só admin exclui.
create policy eventos_ler on public.chamado_eventos for select to authenticated
  using ((select public.eh_membro()));
create policy eventos_comentar on public.chamado_eventos for insert to authenticated
  with check ((select public.eh_membro()) and tipo = 'comentario' and char_length(texto) > 0);
create policy eventos_excluir on public.chamado_eventos for delete to authenticated
  using ((select public.eh_admin()));

-- relatorios: técnico só os próprios; admin todos.
create policy relatorios_ler on public.relatorios for select to authenticated
  using ((select public.eh_membro()) and (tecnico_uid = auth.uid() or (select public.eh_admin())));
create policy relatorios_criar on public.relatorios for insert to authenticated
  with check ((select public.eh_membro()) and tecnico_uid = auth.uid());
create policy relatorios_editar on public.relatorios for update to authenticated
  using ((select public.eh_membro()) and (tecnico_uid = auth.uid() or (select public.eh_admin())))
  with check ((select public.eh_membro()));
create policy relatorios_excluir on public.relatorios for delete to authenticated
  using ((select public.eh_membro()) and (tecnico_uid = auth.uid() or (select public.eh_admin())));

-- maquinas
create policy maquinas_ler on public.maquinas for select to authenticated
  using ((select public.eh_membro()));
create policy maquinas_criar on public.maquinas for insert to authenticated
  with check ((select public.eh_membro()));
create policy maquinas_editar on public.maquinas for update to authenticated
  using ((select public.eh_membro())) with check ((select public.eh_membro()));
create policy maquinas_excluir on public.maquinas for delete to authenticated
  using ((select public.eh_admin()));

-- maquina_historico: só adicionar; ninguém edita depois.
create policy historico_ler on public.maquina_historico for select to authenticated
  using ((select public.eh_membro()));
create policy historico_criar on public.maquina_historico for insert to authenticated
  with check ((select public.eh_membro()));
create policy historico_excluir on public.maquina_historico for delete to authenticated
  using ((select public.eh_admin()));

-- itens_estoque
create policy estoque_ler on public.itens_estoque for select to authenticated
  using ((select public.eh_membro()));
create policy estoque_criar on public.itens_estoque for insert to authenticated
  with check ((select public.eh_membro()));
create policy estoque_editar on public.itens_estoque for update to authenticated
  using ((select public.eh_membro())) with check ((select public.eh_membro()));
create policy estoque_excluir on public.itens_estoque for delete to authenticated
  using ((select public.eh_admin()));

-- visitas: só quem registrou ou admin edita.
create policy visitas_ler on public.visitas for select to authenticated
  using ((select public.eh_membro()));
create policy visitas_criar on public.visitas for insert to authenticated
  with check ((select public.eh_membro()));
create policy visitas_editar on public.visitas for update to authenticated
  using ((select public.eh_membro()) and (criado_por_uid = auth.uid() or (select public.eh_admin())))
  with check ((select public.eh_membro()));
create policy visitas_excluir on public.visitas for delete to authenticated
  using ((select public.eh_admin()));

-- ================================================ STORAGE: LAUDOS DAS VISITAS
-- Bucket privado: os links são temporários (gerados na hora de abrir).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('laudos', 'laudos', false, 15728640, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Os arquivos ficam em "laudos/<id da visita>/<arquivo>".
drop policy if exists laudos_ler on storage.objects;
drop policy if exists laudos_enviar on storage.objects;
drop policy if exists laudos_atualizar on storage.objects;
drop policy if exists laudos_excluir on storage.objects;

create policy laudos_ler on storage.objects for select to authenticated
  using (bucket_id = 'laudos' and (select public.eh_membro()));
create policy laudos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'laudos' and public.pode_editar_visita((storage.foldername(name))[1]));
create policy laudos_atualizar on storage.objects for update to authenticated
  using (bucket_id = 'laudos' and public.pode_editar_visita((storage.foldername(name))[1]))
  with check (bucket_id = 'laudos' and public.pode_editar_visita((storage.foldername(name))[1]));
create policy laudos_excluir on storage.objects for delete to authenticated
  using (bucket_id = 'laudos' and public.pode_editar_visita((storage.foldername(name))[1]));

-- ====================================================== REALTIME (telas ao vivo)
do $$
declare t text;
begin
  foreach t in array array['usuarios', 'chamados', 'chamado_eventos', 'relatorios', 'maquinas',
                           'maquina_historico', 'itens_estoque', 'visitas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
