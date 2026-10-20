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
--   * Tarefas diárias (tarefas + tarefa_conclusoes): o admin cadastra, todos
--     veem, cada técnico marca as suas como feitas no dia; e a função
--     relatorio_pendencias(), usada pelo e-mail automático das 18h.
--   * O "bucket" privado "laudos" (Storage) para os laudos das visitas.
--   * A publicação Realtime, para as telas se atualizarem sozinhas.
--   * Controle de sessão (sessoes_ativas): cada conta só fica conectada em
--     UMA máquina por vez. Enquanto ela estiver ativa num computador, outro
--     computador não entra. Só a sessão registrada lê/grava dados.
-- ==========================================================================

-- --------------------------------------------------------------- USUÁRIOS
create table if not exists public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 120),
  email      text not null check (email = lower(email) and char_length(email) <= 200),
  papel      text not null default 'tecnico' check (papel in ('tecnico', 'admin', 'painel')),
  criado_em  timestamptz not null default now()
);
-- Papel "painel": conta só de leitura para a TV/monitor com o painel de
-- tarefas. Vê tarefas, conclusões e chamados; não grava nada.
alter table public.usuarios drop constraint if exists usuarios_papel_check;
alter table public.usuarios add constraint usuarios_papel_check check (papel in ('tecnico', 'admin', 'painel'));

-- ------------------------------------------------- SESSÃO: UMA MÁQUINA POR VEZ
-- Uma linha por pessoa conectada: em qual máquina (navegador) está, qual
-- sessão do login (session_id do Supabase Auth) e o último "sinal de vida"
-- (o site manda um a cada 30 s). Sem sinal por 2 minutos (navegador
-- fechado, PC desligado), a vaga é liberada para outra máquina.
create table if not exists public.sessoes_ativas (
  usuario_id       uuid primary key references public.usuarios (id) on delete cascade,
  dispositivo_id   text not null check (char_length(dispositivo_id) between 8 and 100),
  dispositivo_nome text not null default '' check (char_length(dispositivo_nome) <= 120),
  sessao_auth      text,
  iniciada_em      timestamptz not null default now(),
  ultimo_sinal     timestamptz not null default now()
);
-- Logins (session_id) abertos nesta máquina: cada aba do navegador tem o
-- seu próprio login, então a mesma pessoa pode ter várias abas abertas na
-- MESMA máquina sem uma derrubar a outra.
alter table public.sessoes_ativas add column if not exists sessoes_auth text[] not null default '{}';

-- A requisição atual vem da sessão registrada para esta pessoa?
-- (Se o token não trouxer session_id, não bloqueia — evita trancar todos.)
create or replace function public.sessao_atual_valida()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when coalesce(auth.jwt() ->> 'session_id', '') = '' then true
    else exists (select 1 from public.sessoes_ativas s
                 where s.usuario_id = auth.uid()
                   and (s.sessao_auth = auth.jwt() ->> 'session_id'
                        or (auth.jwt() ->> 'session_id') = any (s.sessoes_auth)))
  end;
$$;

-- Funções auxiliares usadas nas regras (security definer = enxergam a
-- tabela usuarios mesmo com RLS ligado, sem causar recursão).
-- "Membro" = tem perfil E está usando a sessão registrada (uma máquina só).
create or replace function public.eh_membro()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and papel <> 'painel')
     and public.sessao_atual_valida();
$$;

-- Conta do painel de TV (só leitura de tarefas e chamados).
create or replace function public.eh_painel()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and papel = 'painel')
     and public.sessao_atual_valida();
$$;

-- A conta de painel nunca pode ser responsável por chamado ou tarefa.
create or replace function public.conta_eh_painel(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = p_uid and papel = 'painel');
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and papel = 'admin')
     and public.sessao_atual_valida();
$$;

-- Ocupa a vaga de sessão desta conta para este navegador. Recusa se outra
-- máquina estiver ativa (sinal nos últimos 2 minutos).
create or replace function public.reivindicar_sessao(p_dispositivo text, p_nome text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  atual public.sessoes_ativas;
  sid text := nullif(auth.jwt() ->> 'session_id', '');
begin
  if auth.uid() is null or not exists (select 1 from public.usuarios where id = auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_perfil');
  end if;
  if coalesce(char_length(p_dispositivo), 0) not between 8 and 100 then
    return jsonb_build_object('ok', false, 'motivo', 'dispositivo_invalido');
  end if;

  select * into atual from public.sessoes_ativas where usuario_id = auth.uid() for update;
  if found and atual.dispositivo_id <> p_dispositivo
     and atual.ultimo_sinal > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'em_uso',
      'dispositivo', atual.dispositivo_nome, 'desde', atual.iniciada_em, 'ultimo_sinal', atual.ultimo_sinal);
  end if;

  insert into public.sessoes_ativas (usuario_id, dispositivo_id, dispositivo_nome, sessao_auth, sessoes_auth, iniciada_em, ultimo_sinal)
  values (auth.uid(), p_dispositivo, left(coalesce(p_nome, ''), 120), sid,
          case when sid is null then '{}'::text[] else array[sid] end, now(), now())
  on conflict (usuario_id) do update set
    iniciada_em = case when public.sessoes_ativas.dispositivo_id = excluded.dispositivo_id
                       then public.sessoes_ativas.iniciada_em else now() end,
    -- Mesma máquina: acrescenta este login (outra aba) aos que já existem,
    -- guardando no máximo os 20 mais recentes. Outra máquina: começa do zero.
    sessoes_auth = case
      when public.sessoes_ativas.dispositivo_id = excluded.dispositivo_id then
        (select coalesce(array_agg(x order by ord), '{}') from (
           select x, max(ord) as ord
             from unnest(array_remove(public.sessoes_ativas.sessoes_auth
                                      || public.sessoes_ativas.sessao_auth
                                      || excluded.sessao_auth, null)) with ordinality as u(x, ord)
            group by x order by max(ord) desc limit 20) z)
      else excluded.sessoes_auth end,
    dispositivo_id = excluded.dispositivo_id,
    dispositivo_nome = excluded.dispositivo_nome,
    sessao_auth = excluded.sessao_auth,
    ultimo_sinal = now();
  return jsonb_build_object('ok', true);
end $$;

-- "Sinal de vida" a cada 30 s. Devolve false se esta máquina perdeu a vaga
-- (admin desconectou, ou outra máquina entrou depois de ela ficar sem sinal).
create or replace function public.sinal_sessao(p_dispositivo text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.sessoes_ativas set ultimo_sinal = now()
   where usuario_id = auth.uid() and dispositivo_id = p_dispositivo
     and (nullif(auth.jwt() ->> 'session_id', '') is null
          or sessao_auth = auth.jwt() ->> 'session_id'
          or (auth.jwt() ->> 'session_id') = any (sessoes_auth));
  return found;
end $$;

-- Ao clicar em "Sair": encerra só o login DESTA aba. Quando não sobra
-- nenhuma aba logada nesta máquina, libera a vaga na hora.
create or replace function public.encerrar_sessao(p_dispositivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  sid text := nullif(auth.jwt() ->> 'session_id', '');
begin
  if sid is not null then
    update public.sessoes_ativas
       set sessoes_auth = array_remove(sessoes_auth, sid),
           sessao_auth = case when sessao_auth = sid then null else sessao_auth end
     where usuario_id = auth.uid() and dispositivo_id = p_dispositivo;
  end if;
  delete from public.sessoes_ativas
   where usuario_id = auth.uid() and dispositivo_id = p_dispositivo
     and (sid is null or (sessao_auth is null and cardinality(sessoes_auth) = 0));
end $$;

-- Admin desconecta alguém (ex.: esqueceu o PC ligado e precisa entrar em outro).
create or replace function public.derrubar_sessao(p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas o supervisor/admin pode desconectar sessões.' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Para encerrar a sua própria sessão, use "Sair".';
  end if;
  delete from public.sessoes_ativas where usuario_id = p_usuario;
end $$;

revoke execute on function public.reivindicar_sessao(text, text) from public, anon;
revoke execute on function public.sinal_sessao(text) from public, anon;
revoke execute on function public.encerrar_sessao(text) from public, anon;
revoke execute on function public.derrubar_sessao(uuid) from public, anon;
grant execute on function public.reivindicar_sessao(text, text) to authenticated;
grant execute on function public.sinal_sessao(text) to authenticated;
grant execute on function public.encerrar_sessao(text) to authenticated;
grant execute on function public.derrubar_sessao(uuid) to authenticated;

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
    if new.papel = 'painel' and old.papel <> 'painel'
       and (exists (select 1 from public.tarefas where responsavel_uid = old.id and ativa)
            or exists (select 1 from public.chamados where responsavel_uid = old.id and status <> 'resolvido')) then
      raise exception 'Esta pessoa ainda é responsável por tarefas ou chamados em aberto. Passe-os para outra pessoa antes de transformar a conta em painel.';
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

  if public.conta_eh_painel(new.responsavel_uid) then
    raise exception 'A conta de painel (TV) não pode ser responsável por chamados.' using errcode = '42501';
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

-- Técnico atribuído (só admin atribui). O técnico atribuído pode editar a
-- visita, marcar como realizada e anexar o laudo.
alter table public.visitas add column if not exists tecnico_uid uuid references public.usuarios (id) on delete set null;
alter table public.visitas add column if not exists tecnico_nome text;
create index if not exists visitas_tecnico_idx on public.visitas (tecnico_uid, data);

create or replace function public.tg_visitas_tecnico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.eh_admin() then
    -- Só o admin escolhe/troca o técnico.
    if tg_op = 'INSERT' then new.tecnico_uid := null;
    else new.tecnico_uid := old.tecnico_uid; end if;
  end if;
  if new.tecnico_uid is not null then
    if not exists (select 1 from usuarios where id = new.tecnico_uid and papel in ('tecnico', 'admin')) then
      raise exception 'Escolha um técnico do time (contas de Painel de TV não recebem visitas).' using errcode = '22023';
    end if;
    new.tecnico_nome := public.nome_usuario(new.tecnico_uid);
    if coalesce(trim(new.recurso_responsavel), '') = '' then new.recurso_responsavel := new.tecnico_nome; end if;
  else
    new.tecnico_nome := null;
  end if;
  return new;
end $$;
drop trigger if exists visitas_tecnico on public.visitas;
create trigger visitas_tecnico before insert or update on public.visitas
  for each row execute function public.tg_visitas_tecnico();

drop trigger if exists visitas_regras on public.visitas;
create trigger visitas_regras before insert or update on public.visitas
  for each row execute function public.tg_autoria();

create or replace function public.pode_editar_visita(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visitas v
    where v.id = p_id
      and (v.criado_por_uid = auth.uid() or v.tecnico_uid = auth.uid() or public.eh_admin())
  );
$$;

-- ---------------------------------------------------------------- TAREFAS
-- Cada linha é uma tarefa recorrente (ou de data única) de um técnico.
-- O que muda dia a dia fica em tarefa_conclusoes (uma linha por dia feito).
create or replace function public.hoje_sp()
returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

create table if not exists public.tarefas (
  id               text primary key default gen_random_uuid()::text,
  titulo           text not null check (char_length(titulo) between 1 and 200),
  descricao        text not null default '' check (char_length(descricao) <= 2000),
  responsavel_uid  uuid references public.usuarios (id) on delete set null,
  responsavel_nome text,
  -- diaria = todo dia | dias_uteis = seg a sex | semanal = dias escolhidos | unica = uma data
  recorrencia      text not null default 'dias_uteis'
                   check (recorrencia in ('diaria', 'dias_uteis', 'semanal', 'unica')),
  dias_semana      smallint[] not null default '{}'    -- 0 = domingo ... 6 = sábado (para "semanal")
                   check (dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  data_unica       date,
  ativa            boolean not null default true,
  ordem            integer not null default 0,
  criado_por_uid   uuid,
  criado_por_nome  text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (recorrencia <> 'semanal' or cardinality(dias_semana) > 0),
  check (recorrencia <> 'unica' or data_unica is not null)
);
create index if not exists tarefas_responsavel_idx on public.tarefas (responsavel_uid);

create table if not exists public.tarefa_conclusoes (
  id                 bigint generated always as identity primary key,
  tarefa_id          text not null references public.tarefas (id) on delete cascade,
  data               date not null,
  concluida_por_uid  uuid,
  concluida_por_nome text,
  concluida_em       timestamptz not null default now(),
  observacao         text not null default '' check (char_length(observacao) <= 500),
  unique (tarefa_id, data)
);
create index if not exists tarefa_conclusoes_data_idx on public.tarefa_conclusoes (data);

-- A tarefa vale neste dia? (mesma regra usada no site, em js/tarefas-util.js)
create or replace function public.tarefa_vale_no_dia(t public.tarefas, d date)
returns boolean language sql stable as $$
  select t.ativa and case t.recorrencia
    when 'unica'      then d = t.data_unica
    when 'diaria'     then (t.criado_em at time zone 'America/Sao_Paulo')::date <= d
    when 'dias_uteis' then (t.criado_em at time zone 'America/Sao_Paulo')::date <= d
                           and extract(isodow from d) between 1 and 5
    when 'semanal'    then (t.criado_em at time zone 'America/Sao_Paulo')::date <= d
                           and extract(dow from d)::smallint = any (t.dias_semana)
    else false end;
$$;

drop trigger if exists tarefas_regras on public.tarefas;
create trigger tarefas_regras before insert or update on public.tarefas
  for each row execute function public.tg_autoria();

create or replace function public.tg_tarefas_responsavel()
returns trigger language plpgsql as $$
begin
  if public.conta_eh_painel(new.responsavel_uid) then
    raise exception 'A conta de painel (TV) não pode ser responsável por tarefas.' using errcode = '42501';
  end if;
  new.responsavel_nome := case when new.responsavel_uid is null then null
                               else public.nome_usuario(new.responsavel_uid) end;
  return new;
end $$;
drop trigger if exists tarefas_responsavel on public.tarefas;
create trigger tarefas_responsavel before insert or update on public.tarefas
  for each row execute function public.tg_tarefas_responsavel();

-- Quem concluiu e quando: sempre de quem está logado.
create or replace function public.tg_tarefa_conclusoes()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.concluida_por_uid := auth.uid();
    new.concluida_por_nome := public.meu_nome();
    new.concluida_em := now();
  end if;
  return new;
end $$;
drop trigger if exists tarefa_conclusoes_autor on public.tarefa_conclusoes;
create trigger tarefa_conclusoes_autor before insert on public.tarefa_conclusoes
  for each row execute function public.tg_tarefa_conclusoes();

-- Técnico só conclui as próprias tarefas e só no dia de hoje; admin, qualquer uma.
create or replace function public.pode_concluir_tarefa(p_tarefa text, p_data date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_admin()
      or (p_data = public.hoje_sp()
          and exists (select 1 from public.tarefas t
                      where t.id = p_tarefa and t.responsavel_uid = auth.uid()));
$$;


-- ===================================================== REGRAS DE ACESSO (RLS)
alter table public.usuarios          enable row level security;
alter table public.sessoes_ativas    enable row level security;
alter table public.chamados          enable row level security;
alter table public.chamado_eventos   enable row level security;
alter table public.relatorios        enable row level security;
alter table public.maquinas          enable row level security;
alter table public.maquina_historico enable row level security;
alter table public.itens_estoque     enable row level security;
alter table public.visitas           enable row level security;
alter table public.tarefas           enable row level security;
alter table public.tarefa_conclusoes enable row level security;

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
  using (id = auth.uid() or (select public.eh_membro()) or (select public.eh_painel()));
-- sessoes_ativas: cada um vê a própria; admin vê todas (painel de sessões).
-- Gravações só pelas funções reivindicar/sinal/encerrar/derrubar_sessao.
create policy sessoes_ler on public.sessoes_ativas for select to authenticated
  using (usuario_id = auth.uid() or (select public.eh_admin()));

create policy usuarios_editar on public.usuarios for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));

-- chamados
create policy chamados_ler on public.chamados for select to authenticated
  using ((select public.eh_membro()) or (select public.eh_painel()));
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
  using ((select public.eh_membro()) and (criado_por_uid = auth.uid() or tecnico_uid = auth.uid() or (select public.eh_admin())))
  with check ((select public.eh_membro()));
create policy visitas_excluir on public.visitas for delete to authenticated
  using ((select public.eh_admin()));

-- tarefas: todos do time veem as de todos; só admin cria, edita e exclui.
create policy tarefas_ler on public.tarefas for select to authenticated
  using ((select public.eh_membro()) or (select public.eh_painel()));
create policy tarefas_criar on public.tarefas for insert to authenticated
  with check ((select public.eh_admin()));
create policy tarefas_editar on public.tarefas for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy tarefas_excluir on public.tarefas for delete to authenticated
  using ((select public.eh_admin()));

-- tarefa_conclusoes: todos veem; técnico marca/desmarca as próprias só no
-- dia de hoje; admin marca/desmarca qualquer uma, em qualquer data.
create policy conclusoes_ler on public.tarefa_conclusoes for select to authenticated
  using ((select public.eh_membro()) or (select public.eh_painel()));
create policy conclusoes_marcar on public.tarefa_conclusoes for insert to authenticated
  with check ((select public.eh_membro()) and public.pode_concluir_tarefa(tarefa_id, data));
create policy conclusoes_desmarcar on public.tarefa_conclusoes for delete to authenticated
  using ((select public.eh_admin())
         or (concluida_por_uid = auth.uid() and data = public.hoje_sp()));

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

-- ==================================================================
-- OUTUBRO/2026: BASE DE SOLUÇÕES, AGENDA DA EQUIPE E NOTIFICAÇÕES
-- ==================================================================

-- ----------------------------------------------------- BASE DE SOLUÇÕES
-- "Como resolvi": salvo pelo técnico ao fechar um chamado (ou à mão).
create table if not exists public.solucoes (
  id              text primary key default gen_random_uuid()::text,
  titulo          text not null check (char_length(titulo) between 3 and 200),
  categoria       text not null default 'outro'
                  check (categoria in ('impressora', 'computador', 'rede', 'acesso', 'telefonia', 'sistemas', 'outro')),
  problema        text not null default '' check (char_length(problema) <= 2000),
  passos          text not null check (char_length(passos) between 3 and 5000),
  chamado_id      text references public.chamados (id) on delete set null,
  usos            integer not null default 0 check (usos >= 0),
  ultimo_uso      timestamptz,
  revisar         boolean not null default false,
  criado_por_uid  uuid,
  criado_por_nome text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists solucoes_categoria_idx on public.solucoes (categoria);

drop trigger if exists solucoes_autoria on public.solucoes;
create trigger solucoes_autoria before insert or update on public.solucoes
  for each row execute function public.tg_autoria();

-- Contador "resolveu N chamados": só sobe por esta função (1 por chamado).
create table if not exists public.solucao_usos (
  solucao_id text not null references public.solucoes (id) on delete cascade,
  chamado_id text not null references public.chamados (id) on delete cascade,
  usado_por  uuid,
  usado_em   timestamptz not null default now(),
  primary key (solucao_id, chamado_id)
);

alter table public.solucoes enable row level security;
alter table public.solucao_usos enable row level security;
drop policy if exists solucoes_ler on public.solucoes;
drop policy if exists solucoes_criar on public.solucoes;
drop policy if exists solucoes_editar on public.solucoes;
drop policy if exists solucoes_excluir on public.solucoes;
drop policy if exists solucao_usos_ler on public.solucao_usos;
create policy solucoes_ler on public.solucoes for select to authenticated
  using ((select public.eh_membro()));
create policy solucoes_criar on public.solucoes for insert to authenticated
  with check ((select public.eh_membro()) and usos = 0);
create policy solucoes_editar on public.solucoes for update to authenticated
  using ((select public.eh_membro()) and (criado_por_uid = auth.uid() or (select public.eh_admin())))
  with check ((select public.eh_membro()));
create policy solucoes_excluir on public.solucoes for delete to authenticated
  using ((select public.eh_admin()) or ((select public.eh_membro()) and criado_por_uid = auth.uid()));
create policy solucao_usos_ler on public.solucao_usos for select to authenticated
  using ((select public.eh_membro()));

-- Ninguém muda o contador de usos editando a linha (só a função acima).
create or replace function public.tg_solucoes_usos()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' and current_setting('hd.usando_solucao', true) is distinct from '1' then
    new.usos := old.usos;
    new.ultimo_uso := old.ultimo_uso;
  end if;
  return new;
end $$;
drop trigger if exists solucoes_usos on public.solucoes;
create trigger solucoes_usos before update on public.solucoes
  for each row execute function public.tg_solucoes_usos();

create or replace function public.usar_solucao(p_solucao text, p_chamado text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.eh_membro() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if not exists (select 1 from solucoes where id = p_solucao) then
    raise exception 'Solução não encontrada.';
  end if;
  insert into solucao_usos (solucao_id, chamado_id, usado_por)
  values (p_solucao, p_chamado, auth.uid())
  on conflict do nothing;
  if found then
    perform set_config('hd.usando_solucao', '1', true);
    update solucoes set usos = usos + 1, ultimo_uso = now() where id = p_solucao;
    perform set_config('hd.usando_solucao', '0', true);
  end if;
  select usos into n from solucoes where id = p_solucao;
  return n;
end $$;
revoke execute on function public.usar_solucao(text, text) from public, anon;
grant execute on function public.usar_solucao(text, text) to authenticated;

-- ----------------------------------------------------- AGENDA DA EQUIPE
-- Férias, atestados, folgas, plantões e treinamentos. Visitas e tarefas
-- aparecem na agenda direto dos módulos delas.
create table if not exists public.agenda_eventos (
  id              text primary key default gen_random_uuid()::text,
  usuario_id      uuid not null references public.usuarios (id) on delete cascade,
  usuario_nome    text,
  tipo            text not null check (tipo in ('ferias', 'atestado', 'folga', 'plantao', 'treinamento', 'outro')),
  inicio          date not null,
  fim             date not null,
  observacao      text not null default '' check (char_length(observacao) <= 300),
  criado_por_uid  uuid,
  criado_por_nome text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (fim >= inicio and fim - inicio <= 366)
);
create index if not exists agenda_eventos_periodo_idx on public.agenda_eventos (inicio, fim);

drop trigger if exists agenda_autoria on public.agenda_eventos;
create trigger agenda_autoria before insert or update on public.agenda_eventos
  for each row execute function public.tg_autoria();

create or replace function public.tg_agenda_nome()
returns trigger language plpgsql as $$
begin
  if public.conta_eh_painel(new.usuario_id) then
    raise exception 'A conta de painel (TV) não entra na agenda.' using errcode = '42501';
  end if;
  new.usuario_nome := public.nome_usuario(new.usuario_id);
  return new;
end $$;
drop trigger if exists agenda_nome on public.agenda_eventos;
create trigger agenda_nome before insert or update on public.agenda_eventos
  for each row execute function public.tg_agenda_nome();

-- Tipos que tiram a pessoa do atendimento (não recebe chamado, some do painel).
create or replace function public.ausente_no_dia(p_uid uuid, p_dia date default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from agenda_eventos
                  where usuario_id = p_uid and tipo in ('ferias', 'atestado', 'folga')
                    and coalesce(p_dia, hoje_sp()) between inicio and fim);
$$;

alter table public.agenda_eventos enable row level security;
drop policy if exists agenda_ler on public.agenda_eventos;
drop policy if exists agenda_criar on public.agenda_eventos;
drop policy if exists agenda_editar on public.agenda_eventos;
drop policy if exists agenda_excluir on public.agenda_eventos;
-- Todos veem; cada um lança o próprio; admin lança de qualquer pessoa.
create policy agenda_ler on public.agenda_eventos for select to authenticated
  using ((select public.eh_membro()) or (select public.eh_painel()));
create policy agenda_criar on public.agenda_eventos for insert to authenticated
  with check ((select public.eh_admin()) or ((select public.eh_membro()) and usuario_id = auth.uid()));
create policy agenda_editar on public.agenda_eventos for update to authenticated
  using ((select public.eh_admin()) or ((select public.eh_membro()) and usuario_id = auth.uid()))
  with check ((select public.eh_admin()) or ((select public.eh_membro()) and usuario_id = auth.uid()));
create policy agenda_excluir on public.agenda_eventos for delete to authenticated
  using ((select public.eh_admin()) or ((select public.eh_membro()) and usuario_id = auth.uid()));

-- Relatório de pendências do dia, por pessoa (tarefas não concluídas +
-- chamados em aberto). Usado só pelo Apps Script com a chave de serviço.
-- Quem está ausente no dia (férias, atestado, folga) fica de fora.
create or replace function public.relatorio_pendencias(p_data date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with dia as (select coalesce(p_data, public.hoje_sp()) as d)
  select coalesce(jsonb_agg(p order by p->>'nome'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'uid', u.id, 'nome', u.nome, 'email', u.email, 'papel', u.papel,
      'data', (select d from dia),
      'tarefas_total', (select count(*) from public.tarefas t, dia
                        where t.responsavel_uid = u.id and public.tarefa_vale_no_dia(t, dia.d)),
      'tarefas_pendentes', coalesce((
        select jsonb_agg(jsonb_build_object('titulo', t.titulo, 'descricao', t.descricao) order by t.ordem, t.titulo)
        from public.tarefas t, dia
        where t.responsavel_uid = u.id and public.tarefa_vale_no_dia(t, dia.d)
          and not exists (select 1 from public.tarefa_conclusoes c where c.tarefa_id = t.id and c.data = dia.d)
      ), '[]'::jsonb),
      'chamados_abertos', coalesce((
        select jsonb_agg(jsonb_build_object('numero', c.numero, 'area', c.area, 'status', c.status,
                                            'prioridade', c.prioridade, 'atividade', left(c.atividade, 150),
                                            'criado_em', c.criado_em) order by c.criado_em)
        from public.chamados c
        where c.responsavel_uid = u.id and c.status <> 'resolvido'
      ), '[]'::jsonb)
    ) as p
    from public.usuarios u, dia
    where u.papel <> 'painel' and not public.ausente_no_dia(u.id, dia.d)
  ) s;
$$;
revoke execute on function public.relatorio_pendencias(date) from public, anon, authenticated;
grant execute on function public.relatorio_pendencias(date) to service_role;

-- ----------------------------------------------------- NOTIFICAÇÕES
create table if not exists public.notificacoes (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  tipo        text not null,
  titulo      text not null check (char_length(titulo) <= 200),
  texto       text not null default '' check (char_length(texto) <= 300),
  link        text not null default '' check (char_length(link) <= 300),
  autor_nome  text,
  lida        boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index if not exists notificacoes_usuario_idx on public.notificacoes (usuario_id, criado_em desc);

alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_ler on public.notificacoes;
drop policy if exists notificacoes_marcar on public.notificacoes;
drop policy if exists notificacoes_apagar on public.notificacoes;
-- Cada um só vê, marca como lida e apaga as próprias. Quem cria são os gatilhos.
create policy notificacoes_ler on public.notificacoes for select to authenticated
  using (usuario_id = auth.uid() and (select public.eh_membro()));
create policy notificacoes_marcar on public.notificacoes for update to authenticated
  using (usuario_id = auth.uid() and (select public.eh_membro())) with check (usuario_id = auth.uid());
create policy notificacoes_apagar on public.notificacoes for delete to authenticated
  using (usuario_id = auth.uid() and (select public.eh_membro()));
revoke insert on public.notificacoes from authenticated;
revoke update on public.notificacoes from authenticated;
grant update (lida) on public.notificacoes to authenticated;

alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('atribuicao', 'mencao', 'comentario', 'resolvido', 'tarefa', 'novo_chamado', 'seguranca'));

create or replace function public.notificar(p_para uuid, p_tipo text, p_titulo text, p_texto text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_para is null or p_para is not distinct from auth.uid() then return; end if;
  if public.conta_eh_painel(p_para) then return; end if;
  insert into notificacoes (usuario_id, tipo, titulo, texto, link, autor_nome)
  values (p_para, p_tipo, left(p_titulo, 200), left(coalesce(p_texto, ''), 300), left(coalesce(p_link, ''), 300), public.meu_nome());
  -- Guarda só as 200 mais recentes de cada pessoa.
  delete from notificacoes where usuario_id = p_para and id in (
    select id from notificacoes where usuario_id = p_para order by criado_em desc offset 200);
end $$;
revoke execute on function public.notificar(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.tg_notificar_chamados()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rotulo text := coalesce(nullif(new.numero, ''), 'sem número');
  resumo text := new.area || ' · ' || left(new.atividade, 120);
  link   text := 'chamados.html#c=' || new.id;
  u record;
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    if new.responsavel_uid is null then
      for u in select id from usuarios where papel <> 'painel' and id <> auth.uid() and not ausente_no_dia(id) loop
        perform notificar(u.id, 'novo_chamado', 'Novo chamado sem responsável: ' || rotulo, resumo, link);
      end loop;
    else
      perform notificar(new.responsavel_uid, 'atribuicao', meu_nome() || ' passou para você o chamado ' || rotulo, resumo, link);
    end if;
    return null;
  end if;
  if new.responsavel_uid is distinct from old.responsavel_uid and new.responsavel_uid is not null then
    perform notificar(new.responsavel_uid, 'atribuicao', meu_nome() || ' passou para você o chamado ' || rotulo, resumo, link);
  end if;
  if new.status = 'resolvido' and old.status <> 'resolvido' then
    perform notificar(new.criado_por_uid, 'resolvido',
      coalesce(new.responsavel_nome, meu_nome()) || ' resolveu o chamado ' || rotulo, resumo, link);
  end if;
  return null;
end $$;
drop trigger if exists chamados_notificar on public.chamados;
create trigger chamados_notificar after insert or update on public.chamados
  for each row execute function public.tg_notificar_chamados();

-- Comentário: avisa quem foi citado com @nome e o responsável pelo chamado.
create or replace function public.tg_notificar_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c chamados;
  u record;
  avisados uuid[] := '{}';
  texto_min text := lower(new.texto);
begin
  if auth.uid() is null or new.tipo <> 'comentario' then return null; end if;
  select * into c from chamados where id = new.chamado_id;
  if not found then return null; end if;
  for u in select id, nome from usuarios where papel <> 'painel' and id <> auth.uid() loop
    if position('@' || lower(split_part(u.nome, ' ', 1)) in texto_min) > 0
       or position('@' || lower(replace(u.nome, ' ', '')) in texto_min) > 0 then
      perform notificar(u.id, 'mencao', meu_nome() || ' mencionou você no chamado ' || coalesce(nullif(c.numero, ''), ''),
                        left(new.texto, 200), 'chamados.html#c=' || c.id);
      avisados := avisados || u.id;
    end if;
  end loop;
  if c.responsavel_uid is not null and not (c.responsavel_uid = any (avisados)) then
    perform notificar(c.responsavel_uid, 'comentario', meu_nome() || ' comentou no seu chamado ' || coalesce(nullif(c.numero, ''), ''),
                      left(new.texto, 200), 'chamados.html#c=' || c.id);
  end if;
  return null;
end $$;
drop trigger if exists chamado_eventos_notificar on public.chamado_eventos;
create trigger chamado_eventos_notificar after insert on public.chamado_eventos
  for each row execute function public.tg_notificar_comentario();

-- Visita atribuída a um técnico → avisa no sino.
create or replace function public.tg_notificar_visitas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tecnico_uid is null or new.tecnico_uid is not distinct from (case when tg_op = 'UPDATE' then old.tecnico_uid end) then return null; end if;
  perform notificar(new.tecnico_uid, 'atribuicao', 'Visita atribuída a você: ' || new.titulo,
    to_char(new.data, 'DD/MM/YYYY') || coalesce(nullif(' · ' || new.cidade, ' · '), '') || coalesce(nullif(' · ' || new.area, ' · '), ''),
    'visitas.html#v=' || new.id);
  return null;
end $$;
drop trigger if exists visitas_notificar on public.visitas;
create trigger visitas_notificar after insert or update on public.visitas
  for each row execute function public.tg_notificar_visitas();

create or replace function public.tg_notificar_tarefas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.responsavel_uid is null or not new.ativa then return null; end if;
  if tg_op = 'INSERT' or new.responsavel_uid is distinct from old.responsavel_uid then
    perform notificar(new.responsavel_uid, 'tarefa', 'Nova tarefa para você: ' || new.titulo,
                      left(coalesce(new.descricao, ''), 200), 'tarefas.html#minhas');
  end if;
  return null;
end $$;
drop trigger if exists tarefas_notificar on public.tarefas;
create trigger tarefas_notificar after insert or update on public.tarefas
  for each row execute function public.tg_notificar_tarefas();

-- ==================================================================
-- PORTAL DO COLABORADOR (abrir chamado SEM login, pelo link com código)
-- ==================================================================
-- Ninguém de fora grava direto na tabela chamados: o portal só chama as
-- duas funções abaixo, que conferem o código do link, limitam a quantidade
-- de envios e validam cada campo.

alter table public.chamados add column if not exists origem text not null default 'interno';
alter table public.chamados drop constraint if exists chamados_origem_check;
alter table public.chamados add constraint chamados_origem_check check (origem in ('interno', 'portal', 'qualitor'));
alter table public.chamados add column if not exists solicitante_nome text check (char_length(solicitante_nome) <= 120);
alter table public.chamados add column if not exists solicitante_setor text check (char_length(solicitante_setor) <= 120);
alter table public.chamados add column if not exists solicitante_contato text check (char_length(solicitante_contato) <= 120);
alter table public.chamados add column if not exists codigo_acompanhamento text;
create unique index if not exists chamados_codigo_acompanhamento_idx on public.chamados (codigo_acompanhamento) where codigo_acompanhamento is not null;
create index if not exists chamados_origem_criado_idx on public.chamados (origem, criado_em desc);

create sequence if not exists public.portal_numero_seq;

-- Configuração do portal (uma linha só). O código vai no link: portal.html?k=<código>
create table if not exists public.portal_config (
  id               integer primary key default 1 check (id = 1),
  chave            text not null default replace(gen_random_uuid()::text, '-', ''),
  ativo            boolean not null default true,
  limite_por_hora  integer not null default 30 check (limite_por_hora between 1 and 500),
  atualizado_em    timestamptz not null default now()
);
insert into public.portal_config (id) values (1) on conflict (id) do nothing;

alter table public.portal_config enable row level security;
drop policy if exists portal_config_ler on public.portal_config;
drop policy if exists portal_config_editar on public.portal_config;
create policy portal_config_ler on public.portal_config for select to authenticated
  using ((select public.eh_admin()));
create policy portal_config_editar on public.portal_config for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
revoke all on public.portal_config from anon;

-- Admin gera um código novo (o link antigo para de funcionar na hora).
create or replace function public.portal_nova_chave()
returns text language plpgsql security definer set search_path = public as $$
declare nova text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.eh_admin() then
    raise exception 'Apenas o supervisor/admin pode trocar o código do portal.' using errcode = '42501';
  end if;
  update portal_config set chave = nova, atualizado_em = now() where id = 1;
  return nova;
end $$;
revoke execute on function public.portal_nova_chave() from public, anon;
grant execute on function public.portal_nova_chave() to authenticated;

create or replace function public.abrir_chamado_portal(
  p_chave text, p_nome text, p_setor text, p_contato text,
  p_categoria text, p_descricao text, p_impacto text, p_armadilha text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg        portal_config;
  nome       text := btrim(coalesce(p_nome, ''));
  setor      text := btrim(coalesce(p_setor, ''));
  contato    text := btrim(coalesce(p_contato, ''));
  descricao  text := btrim(coalesce(p_descricao, ''));
  rotulos    jsonb := '{"impressora":"Impressora","computador":"Computador","rede":"Internet / Wi-Fi","acesso":"Acesso / senha","telefonia":"Telefone","sistemas":"Sistemas / e-mail","outro":"Outro"}';
  prioridade text := case p_impacto when 'alto' then 'alta' when 'medio' then 'media' else 'baixa' end;
  existente  chamados;
  novo       chamados;
  u          record;
begin
  select * into cfg from portal_config where id = 1;
  if not found or not cfg.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'desativado');
  end if;
  if coalesce(p_chave, '') <> cfg.chave then
    return jsonb_build_object('ok', false, 'motivo', 'link_invalido');
  end if;
  -- Campo escondido no formulário: pessoa nunca preenche, robô sim.
  if coalesce(p_armadilha, '') <> '' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido');
  end if;
  if char_length(nome) not between 2 and 120 or char_length(setor) not between 1 and 120
     or char_length(contato) > 120 or char_length(descricao) not between 5 and 2000
     or not (rotulos ? coalesce(p_categoria, '')) or coalesce(p_impacto, '') not in ('baixo', 'medio', 'alto') then
    return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  -- Envio repetido (duplo clique / F5): devolve o mesmo chamado.
  select * into existente from chamados
   where origem = 'portal' and solicitante_nome = nome and position(left(descricao, 200) in atividade) > 0
     and criado_em > now() - interval '15 minutes'
   order by criado_em desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'numero', existente.numero, 'codigo', existente.codigo_acompanhamento, 'repetido', true);
  end if;

  -- Limite de envios (protege contra spam/link vazado).
  if (select count(*) from chamados where origem = 'portal' and criado_em > now() - interval '1 hour') >= cfg.limite_por_hora
     or (select count(*) from chamados where origem = 'portal' and criado_em > now() - interval '1 minute') >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;

  insert into chamados (numero, area, atividade, prioridade, status, responsavel_uid,
                        criado_por_uid, criado_por_nome, criado_em, atualizado_em,
                        origem, solicitante_nome, solicitante_setor, solicitante_contato, codigo_acompanhamento)
  values ('P' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMM') || '-' || lpad(nextval('portal_numero_seq')::text, 4, '0'),
          setor, '[' || (rotulos ->> p_categoria) || '] ' || descricao, prioridade, 'aberto', null,
          null, 'Portal: ' || nome, now(), now(),
          'portal', nome, setor, nullif(contato, ''),
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  returning * into novo;

  -- Sem login, os gatilhos não registram nada: grava a criação e avisa o time.
  if auth.uid() is null then
    insert into chamado_eventos (chamado_id, tipo, texto, autor_uid, autor_nome)
    values (novo.id, 'criacao', 'Chamado aberto pelo portal por ' || nome || ' (' || setor || ')'
                                || coalesce(' · contato: ' || nullif(contato, ''), ''), null, 'Portal');
    for u in select id from usuarios where papel <> 'painel' and not ausente_no_dia(id) loop
      insert into notificacoes (usuario_id, tipo, titulo, texto, link, autor_nome)
      values (u.id, 'novo_chamado', 'Novo chamado pelo portal: ' || novo.numero,
              left(setor || ' · ' || nome || ' · ' || descricao, 300), 'chamados.html#c=' || novo.id, 'Portal');
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'numero', novo.numero, 'codigo', novo.codigo_acompanhamento);
end $$;
revoke execute on function public.abrir_chamado_portal(text, text, text, text, text, text, text, text) from public;
grant execute on function public.abrir_chamado_portal(text, text, text, text, text, text, text, text) to anon, authenticated;

-- Acompanhamento: só quem tem o código (vai no link) vê o andamento.
-- Mostra apenas o necessário: status, quem atende (primeiro nome) e as
-- etapas. Anotações internas da TI não aparecem.
create or replace function public.consultar_chamado_portal(p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when c.id is null then jsonb_build_object('ok', false) else jsonb_build_object(
    'ok', true,
    'numero', c.numero,
    'status', c.status,
    'prioridade', c.prioridade,
    'descricao', c.atividade,
    'setor', c.solicitante_setor,
    'solicitante', c.solicitante_nome,
    'criado_em', c.criado_em,
    'resolvido_em', c.resolvido_em,
    'responsavel', split_part(coalesce(c.responsavel_nome, ''), ' ', 1),
    'etapas', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'quando', e.criado_em,
               'texto', case e.tipo
                 when 'criacao' then 'Recebido pela TI'
                 when 'atribuicao' then case when c2.responsavel_nome is null then 'Aguardando técnico'
                                             else 'Técnico designado' end
                 when 'status' then replace(replace(replace(e.texto, 'Status: ', ''), 'Em andamento', 'Em atendimento'), '→', '→')
               end) order by e.criado_em)
      from chamado_eventos e, chamados c2
      where c2.id = c.id and e.chamado_id = c.id and e.tipo in ('criacao', 'atribuicao', 'status')
    ), '[]'::jsonb)
  ) end
  from (select 1) x
  left join chamados c on c.codigo_acompanhamento = p_codigo and c.origem = 'portal'
                       and char_length(coalesce(p_codigo, '')) >= 32;
$$;
revoke execute on function public.consultar_chamado_portal(text) from public;
grant execute on function public.consultar_chamado_portal(text) to anon, authenticated;

-- ==================================================================
-- MÁQUINA CHEGOU PARA MANUTENÇÃO → CHAMADO AUTOMÁTICO PARA A EQUIPE
-- ==================================================================
-- Quando uma máquina entra em manutenção (Delegação ou Situação =
-- "Manutenção"), abre um chamado sem responsável. Os técnicos são
-- avisados no sino. Se a máquina já tem um chamado de manutenção em
-- aberto, não abre outro.
alter table public.maquinas add column if not exists chamado_manutencao_id text
  references public.chamados (id) on delete set null;
create sequence if not exists public.manutencao_numero_seq;

create or replace function public.tg_maquina_manutencao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  entrou boolean;
  aberto boolean;
  novo_id text;
  numero text;
  detalhes text;
begin
  if auth.uid() is null then return new; end if;   -- migração/SQL Editor: não abre chamado
  entrou := (new.status = 'manutencao' or new.armazenamento = 'manutencao')
            and (tg_op = 'INSERT' or not (old.status = 'manutencao' or old.armazenamento = 'manutencao'));
  if not entrou then return new; end if;

  select exists (select 1 from chamados c where c.id = new.chamado_manutencao_id and c.status <> 'resolvido')
    into aberto;
  if aberto then return new; end if;

  numero := 'M' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMM') || '-' || lpad(nextval('manutencao_numero_seq')::text, 4, '0');
  detalhes := concat_ws(' · ',
    nullif('S/N ' || nullif(btrim(new.setor), ''), 'S/N '),
    nullif('Ativo ' || nullif(btrim(new.responsavel_uso), ''), 'Ativo '),
    nullif('Chegada ' || nullif(btrim(new.processador), ''), 'Chegada '),
    nullif('Chamado externo ' || nullif(btrim(new.ip), ''), 'Chamado externo '));
  insert into chamados (numero, area, atividade, prioridade, status, responsavel_uid)
  values (numero,
          coalesce(nullif(btrim(new.so), ''), 'TI'),
          left('Manutenção da máquina ' || new.nome || coalesce(' (' || nullif(detalhes, '') || ')', '')
               || coalesce(E'\n' || nullif(btrim(new.observacoes), ''), ''), 5000),
          'media', 'aberto', null)
  returning id into novo_id;

  new.chamado_manutencao_id := novo_id;
  -- Campo "Chamado" da máquina: preenche com o número, se estiver vazio.
  if btrim(coalesce(new.ip, '')) = '' then new.ip := numero; end if;
  return new;
end $$;
drop trigger if exists maquinas_manutencao on public.maquinas;
create trigger maquinas_manutencao before insert or update on public.maquinas
  for each row execute function public.tg_maquina_manutencao();

-- ==================================================================
-- LINKS ÚTEIS (menu com os sistemas usados pelo time)
-- ==================================================================
create table if not exists public.links_uteis (
  id         text primary key default gen_random_uuid()::text,
  titulo     text not null check (char_length(titulo) between 1 and 120),
  url        text not null check (url ~ '^https?://' and char_length(url) <= 2000),
  descricao  text not null default '' check (char_length(descricao) <= 200),
  categoria  text not null default 'Outros' check (char_length(categoria) between 1 and 60),
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now()
);
alter table public.links_uteis enable row level security;
drop policy if exists links_ler on public.links_uteis;
drop policy if exists links_criar on public.links_uteis;
drop policy if exists links_editar on public.links_uteis;
drop policy if exists links_excluir on public.links_uteis;
create policy links_ler on public.links_uteis for select to authenticated
  using ((select public.eh_membro()));
create policy links_criar on public.links_uteis for insert to authenticated
  with check ((select public.eh_admin()));
create policy links_editar on public.links_uteis for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy links_excluir on public.links_uteis for delete to authenticated
  using ((select public.eh_admin()));

-- Links iniciais: só entram se a tabela estiver vazia (rodar o script de
-- novo não duplica nem desfaz o que o admin editou).
insert into public.links_uteis (titulo, url, descricao, categoria, ordem)
select * from (values
  ('VExpenses', 'https://auth.vexpenses.com/login', 'Plataforma de reembolso', 'Administrativo', 1),
  ('Ponto LG', 'https://login.lg.com.br/login/commcenter', 'Plataforma de ponto', 'Administrativo', 2),
  ('VendApp', 'https://vendapp.com.br/vendapp/login', 'VendApp', 'Administrativo', 3),
  ('Fiserv (SiTef Express)', 'https://oauth.softwareexpress.com.br/auth/realms/sitefexpress/protocol/openid-connect/auth?response_type=code&client_id=sitefweb&redirect_uri=https%3A%2F%2Fsitefexpress2.softwareexpress.com.br%2Fsitefweb%2Fsso%2Flogin&state=f474e034-ab05-44d8-8ae8-a5c03f5862ae&login=true&scope=openid', 'Plataforma Fiserv', 'Administrativo', 4),
  ('Protheus Veneto', 'http://10.130.2.200:8101/', 'Só na rede da empresa / VPN', 'Protheus', 1),
  ('Protheus MDX', 'http://10.130.3.103:8098/', 'Só na rede da empresa / VPN', 'Protheus', 2),
  ('Protheus VMT', 'http://10.130.2.123:8101/', 'Só na rede da empresa / VPN', 'Protheus', 3),
  ('N-able', 'https://vivasecurity.n-able.com/IndexAction.action', 'Monitoramento e acesso remoto', 'Infraestrutura e segurança', 1),
  ('Controladora Ubiquiti', 'https://ubt.commcenter.com.br:8443/manage/account/login?redirect=%2Fmanage', 'Rede Wi-Fi (UniFi)', 'Infraestrutura e segurança', 2),
  ('Sophos Central', 'https://login.sophos.com/login.sophos.com/oauth2/v2.0/authorize?p=B2C_1A_signup_signin&client_id=d8ce821f-a1da-4b03-b7e2-1d1a9cc028f3&redirect_uri=https%3A%2F%2Fcloud.sophos.com%2Fmanage%2Fcentral-login&scope=openid&response_type=id_token&prompt=login&state=', 'Antivírus e firewall', 'Infraestrutura e segurança', 3),
  ('Intemobile', 'https://plataforma.intemobile.com/account/login', 'Plataforma de ativos', 'Infraestrutura e segurança', 4),
  ('Qualitor — Atendente', 'https://portal.vantix.com.br/login.php?cdlingua=&lasturl=47W104W116g109t108W47x105g110s100W101x120B46s112s104s112B63s95s112t111s114x116B97t108B95s61B84FNsctdxlgYsiWYWexe&f=N', 'Atender chamados no Qualitor', 'Qualitor', 1),
  ('Qualitor — Solicitante', 'https://qualitor.vantix.com.br/loginUsuario.php?cdlingua', 'Abrir chamado no Qualitor', 'Qualitor', 2)
) as v(titulo, url, descricao, categoria, ordem)
where not exists (select 1 from public.links_uteis);

-- ==================================================================
-- INTEGRAÇÃO COM O QUALITOR (o site como "frontend" do Qualitor)
-- ==================================================================
-- Ida:   chamado aberto no site (inclusive portal e manutenção) → abre no
--        Qualitor; anotação → acompanhamento; resolver → encerra.
-- Volta: a cada 5 minutos, atualiza a situação dos chamados ligados e
--        traz os chamados novos da fila da equipe no Qualitor.
-- Quem conversa com o Qualitor é a Edge Function "qualitor" (login e senha
-- ficam nos Secrets do Supabase, nunca no site). Aqui ficam a fila de envio,
-- os gatilhos e a configuração.

-- Extensões do Supabase para chamar a função (pg_net) e agendar (pg_cron).
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net indisponível: %', sqlerrm; end $$;
do $$ begin
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

alter table public.chamados drop constraint if exists chamados_origem_check;
alter table public.chamados add constraint chamados_origem_check check (origem in ('interno', 'portal', 'qualitor'));
alter table public.chamados add column if not exists qualitor_numero text;
alter table public.chamados add column if not exists qualitor_situacao text;
alter table public.chamados add column if not exists qualitor_responsavel text;
alter table public.chamados add column if not exists qualitor_sync text
  check (qualitor_sync in ('pendente', 'ok', 'erro'));
alter table public.chamados add column if not exists qualitor_erro text;
alter table public.chamados add column if not exists qualitor_atualizado_em timestamptz;
create unique index if not exists chamados_qualitor_numero_idx on public.chamados (qualitor_numero) where qualitor_numero is not null;

create table if not exists public.qualitor_config (
  id                 integer primary key default 1 check (id = 1),
  ativo              boolean not null default false,
  importar           boolean not null default true,
  enviar_anotacoes   boolean not null default true,
  encerrar_ao_resolver boolean not null default true,
  url_ws             text not null default 'https://portal.vantix.com.br/ws/services/Ticket/WSTicket.php',
  url_chamado        text not null default '',
  funcao_url         text not null default '',
  xml_abertura       text not null default
'<wsqualitor><contents><data>
<cdcliente>{{cdcliente}}</cdcliente>
<cdcontato>{{cdcontato}}</cdcontato>
<cdtipochamado>{{cdtipochamado}}</cdtipochamado>
<cdcategoria>{{cdcategoria}}</cdcategoria>
<cdequipe>{{cdequipe}}</cdequipe>
<cdseveridade>{{severidade}}</cdseveridade>
<nmtitulochamado>{{titulo}}</nmtitulochamado>
<dschamado>{{descricao}}</dschamado>
</data></contents></wsqualitor>',
  xml_acompanhamento text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
<dsacompanhamento>{{texto}}</dsacompanhamento>
<idtipoacompanhamento>1</idtipoacompanhamento>
</data></contents></wsqualitor>',
  xml_encerramento   text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
<dssolucao>{{texto}}</dssolucao>
</data></contents></wsqualitor>',
  xml_consulta       text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
</data></contents></wsqualitor>',
  xml_busca          text not null default
'<wsqualitor><contents><data>
<cdequipe>{{cdequipe}}</cdequipe>
<idsituacao>A</idsituacao>
</data></contents></wsqualitor>',
  -- Códigos fixos usados nos modelos acima ({{cdcliente}}, {{cdcategoria}}...).
  codigos            jsonb not null default '{"cdcliente":"","cdcontato":"","cdtipochamado":"","cdcategoria":"","cdequipe":""}'::jsonb,
  -- Prioridade do site → severidade do Qualitor.
  mapa_prioridade    jsonb not null default '{"alta":"1","media":"2","baixa":"3"}'::jsonb,
  -- Situação do Qualitor (texto contém…) → status do site.
  mapa_situacao      jsonb not null default '{"resolvido":["encerrad","fechad","resolvid","conclu","cancelad"],"andamento":["atendimento","andamento","execu","aguardando"]}'::jsonb,
  ultima_sinc        timestamptz,
  ultimo_erro        text,
  atualizado_em      timestamptz not null default now()
);
insert into public.qualitor_config (id) values (1) on conflict (id) do nothing;

-- Escopo: só chamados destas equipes (código ou nome exato) passam pela
-- integração, mesmo que o usuário do Qualitor enxergue mais. "locais"
-- (opcional) restringe ainda pelo local/departamento do solicitante.
-- Ações do site que também refletem no Qualitor (o site como "frontend"):
-- assumir/atribuir, iniciar, mudar prioridade e reabrir.
alter table public.qualitor_config add column if not exists enviar_acoes boolean not null default true;
alter table public.qualitor_config add column if not exists xml_atribuir text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
<cdresponsavel>{{cdresponsavel}}</cdresponsavel>
</data></contents></wsqualitor>';
alter table public.qualitor_config add column if not exists xml_iniciar text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
</data></contents></wsqualitor>';
alter table public.qualitor_config add column if not exists xml_prioridade text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
<cdseveridade>{{severidade}}</cdseveridade>
</data></contents></wsqualitor>';
alter table public.qualitor_config add column if not exists xml_reabrir text not null default
'<wsqualitor><contents><data>
<cdchamado>{{cdchamado}}</cdchamado>
<dsjustificativa>{{texto}}</dsjustificativa>
</data></contents></wsqualitor>';

-- O Qualitor da Comm (atendente "COM_TI") roda em portal.vantix.com.br.
alter table public.qualitor_config alter column url_ws set default 'https://portal.vantix.com.br/ws/services/Ticket/WSTicket.php';
update public.qualitor_config set url_ws = 'https://portal.vantix.com.br/ws/services/Ticket/WSTicket.php'
 where url_ws = 'https://qualitor.vantix.com.br/ws/services/Ticket/WSTicket.php' and not ativo;
alter table public.qualitor_config add column if not exists escopo jsonb not null default '{"equipes":[],"locais":[]}'::jsonb;

-- ---------------------------------------------------- travas de segurança
-- Modo validação (padrão): a integração só LÊ o Qualitor. Para escrever
-- (abrir, anotar, encerrar) um admin precisa confirmar que os Secrets usam
-- um usuário de integração dedicado — a confirmação fica registrada.
alter table public.qualitor_config add column if not exists modo_validacao boolean not null default true;
alter table public.qualitor_config add column if not exists conta_servico_confirmada_por text;
alter table public.qualitor_config add column if not exists conta_servico_confirmada_em timestamptz;
-- Chamado do portal (sem login) só vai ao Qualitor depois que um técnico assumir.
alter table public.qualitor_config add column if not exists portal_triagem boolean not null default true;

-- O segredo interno (banco → Edge Function) fica numa tabela que NINGUÉM
-- lê pelo site, nem admin. Só o banco (security definer) e a função.
create table if not exists public.qualitor_segredo (
  id    integer primary key default 1 check (id = 1),
  valor text not null
);
alter table public.qualitor_segredo enable row level security;
revoke all on public.qualitor_segredo from public, anon, authenticated;
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'qualitor_config' and column_name = 'segredo') then
    insert into public.qualitor_segredo (id, valor)
      select 1, segredo from public.qualitor_config where id = 1 and segredo <> '' on conflict (id) do nothing;
    alter table public.qualitor_config drop column segredo;
  end if;
end $$;
insert into public.qualitor_segredo (id, valor)
  values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

-- Admin: gera um segredo novo (se houver suspeita de vazamento).
create or replace function public.qualitor_trocar_segredo()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas o supervisor/admin.' using errcode = '42501'; end if;
  update qualitor_segredo set valor = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where id = 1;
  insert into qualitor_config_log (usuario_id, usuario_nome, campos, resumo)
  values (auth.uid(), meu_nome(), array['segredo'], 'Segredo interno trocado');
end $$;

-- Histórico de alterações da configuração (quem, quando, o quê).
create table if not exists public.qualitor_config_log (
  id           bigint generated always as identity primary key,
  quando       timestamptz not null default now(),
  usuario_id   uuid,
  usuario_nome text,
  campos       text[] not null default '{}',
  resumo       text not null default ''
);
alter table public.qualitor_config_log enable row level security;
drop policy if exists qualitor_config_log_ler on public.qualitor_config_log;
create policy qualitor_config_log_ler on public.qualitor_config_log for select to authenticated
  using ((select public.eh_admin()));
revoke insert, update, delete on public.qualitor_config_log from anon, authenticated;
revoke execute on function public.qualitor_trocar_segredo() from public, anon;
grant execute on function public.qualitor_trocar_segredo() to authenticated;

-- Validação NO ATO da configuração: o banco recusa o que for inseguro.
create or replace function public.tg_qualitor_config_valida()
returns trigger language plpgsql as $$
declare
  equipes int := jsonb_array_length(coalesce(new.escopo -> 'equipes', '[]'::jsonb));
  locais  int := jsonb_array_length(coalesce(new.escopo -> 'locais', '[]'::jsonb));
begin
  if new.url_ws !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/' then
    raise exception 'O endereço do webservice precisa começar com https:// (a senha do Qualitor não pode trafegar sem criptografia).' using errcode = '22023';
  end if;
  if new.funcao_url <> '' and new.funcao_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/qualitor$' then
    raise exception 'O endereço da Edge Function precisa ser o do seu projeto: https://<projeto>.supabase.co/functions/v1/qualitor (use o botão "Usar o padrão").' using errcode = '22023';
  end if;
  if new.url_chamado <> '' and new.url_chamado !~ '^https://' then
    raise exception 'O link para abrir chamados no Qualitor precisa começar com https://.' using errcode = '22023';
  end if;
  if new.xml_consulta not like '%{{cdchamado}}%' or new.xml_acompanhamento not like '%{{cdchamado}}%' or new.xml_encerramento not like '%{{cdchamado}}%' then
    raise exception 'Os modelos de consulta, acompanhamento e encerramento precisam usar {{cdchamado}} (senão a ação cairia em outro chamado).' using errcode = '22023';
  end if;
  if new.xml_atribuir not like '%{{cdchamado}}%' or new.xml_iniciar not like '%{{cdchamado}}%'
     or new.xml_prioridade not like '%{{cdchamado}}%' or new.xml_reabrir not like '%{{cdchamado}}%' then
    raise exception 'Os modelos de atribuir, iniciar, prioridade e reabrir precisam usar {{cdchamado}}.' using errcode = '22023';
  end if;
  if new.xml_atribuir not like '%{{cdresponsavel}}%' then
    raise exception 'O modelo de atribuir precisa usar {{cdresponsavel}}.' using errcode = '22023';
  end if;
  if equipes > 10 or locais > 10 then
    raise exception 'Escopo: no máximo 10 equipes e 10 locais.' using errcode = '22023';
  end if;
  if new.ativo and equipes = 0 and coalesce(new.codigos ->> 'cdequipe', '') = '' then
    raise exception 'Defina a equipe permitida (Escopo) antes de ligar a integração.' using errcode = '22023';
  end if;
  if new.ativo and new.funcao_url = '' then
    raise exception 'Preencha o endereço da Edge Function antes de ligar a integração.' using errcode = '22023';
  end if;
  -- A confirmação da conta de serviço só é gravada pelo próprio banco.
  if tg_op = 'UPDATE' then
    new.conta_servico_confirmada_por := old.conta_servico_confirmada_por;
    new.conta_servico_confirmada_em := old.conta_servico_confirmada_em;
    if old.modo_validacao and not new.modo_validacao then
      if auth.uid() is null then new.modo_validacao := true;
      else
        new.conta_servico_confirmada_por := public.meu_nome();
        new.conta_servico_confirmada_em := now();
      end if;
    elsif new.modo_validacao and not old.modo_validacao then
      new.conta_servico_confirmada_por := null;
      new.conta_servico_confirmada_em := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists qualitor_config_valida on public.qualitor_config;
create trigger qualitor_config_valida before insert or update on public.qualitor_config
  for each row execute function public.tg_qualitor_config_valida();

-- Registra a alteração e avisa os OUTROS admins quando algo sensível muda.
create or replace function public.tg_qualitor_config_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a jsonb := to_jsonb(old) - array['atualizado_em', 'ultima_sinc', 'ultimo_erro'];
  b jsonb := to_jsonb(new) - array['atualizado_em', 'ultima_sinc', 'ultimo_erro'];
  campos text[]; sensiveis text[]; partes text[] := '{}'; k text; adm record;
begin
  select array_agg(key order by key) into campos from jsonb_each(b) where b -> key is distinct from a -> key;
  if campos is null then return null; end if;
  sensiveis := array(select unnest(campos) intersect select unnest(array['ativo', 'modo_validacao', 'url_ws', 'funcao_url', 'escopo', 'codigos', 'importar', 'xml_busca', 'xml_consulta', 'portal_triagem']));
  foreach k in array campos loop
    if k in ('ativo', 'modo_validacao', 'importar', 'portal_triagem', 'url_ws', 'funcao_url', 'escopo') then
      partes := partes || format('%s: %s → %s', k, a -> k, b -> k);
    else
      partes := partes || k;
    end if;
  end loop;
  insert into qualitor_config_log (usuario_id, usuario_nome, campos, resumo)
  values (auth.uid(), coalesce(meu_nome(), 'sistema'), campos, left(array_to_string(partes, '; '), 2000));
  if array_length(sensiveis, 1) > 0 then
    for adm in select id from usuarios where papel = 'admin' loop
      perform notificar(adm.id, 'seguranca', 'Integração Qualitor alterada',
        coalesce(meu_nome(), 'Sistema') || ' mudou: ' || array_to_string(sensiveis, ', '), 'integracoes.html');
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists qualitor_config_log on public.qualitor_config;
create trigger qualitor_config_log after update on public.qualitor_config
  for each row execute function public.tg_qualitor_config_log();

-- Escreve no Qualitor só com a integração ligada E fora do modo validação.
create or replace function public.qualitor_escreve()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo and not modo_validacao from qualitor_config where id = 1), false);
$$;
create or replace function public.qualitor_portal_triagem()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select portal_triagem from qualitor_config where id = 1), true);
$$;
-- Chamados abertos pelo site caem na equipe configurada.
update public.qualitor_config
   set xml_abertura = replace(xml_abertura, '<cdcategoria>{{cdcategoria}}</cdcategoria>', E'<cdcategoria>{{cdcategoria}}</cdcategoria>\n<cdequipe>{{cdequipe}}</cdequipe>')
 where xml_abertura not like '%{{cdequipe}}%' and xml_abertura like '%<cdcategoria>{{cdcategoria}}</cdcategoria>%';

create table if not exists public.qualitor_fila (
  id            bigint generated always as identity primary key,
  tipo          text not null,
  chamado_id    text not null references public.chamados (id) on delete cascade,
  texto         text not null default '' check (char_length(texto) <= 4000),
  autor_nome    text,
  status        text not null default 'pendente',
  tentativas    integer not null default 0,
  erro          text,
  criado_em     timestamptz not null default now(),
  processado_em timestamptz
);
alter table public.qualitor_fila drop constraint if exists qualitor_fila_tipo_check;
alter table public.qualitor_fila add constraint qualitor_fila_tipo_check
  check (tipo in ('abrir', 'acompanhar', 'encerrar', 'atribuir', 'iniciar', 'prioridade', 'reabrir'));
create index if not exists qualitor_fila_pendente_idx on public.qualitor_fila (status, criado_em);
alter table public.qualitor_fila drop constraint if exists qualitor_fila_status_check;
alter table public.qualitor_fila add constraint qualitor_fila_status_check check (status in ('pendente', 'processando', 'ok', 'erro'));

-- Chamado novo vindo do Qualitor sem responsável: avisa o time no sino.
create or replace function public.qualitor_notificar_novo(p_chamado text)
returns void language plpgsql security definer set search_path = public as $$
declare c chamados; u record;
begin
  select * into c from chamados where id = p_chamado;
  if not found or c.responsavel_uid is not null then return; end if;
  for u in select id from usuarios where papel <> 'painel' and not ausente_no_dia(id) loop
    insert into notificacoes (usuario_id, tipo, titulo, texto, link, autor_nome)
    values (u.id, 'novo_chamado', 'Novo chamado no Qualitor: ' || c.numero,
            left(c.area || ' · ' || c.atividade, 300), 'chamados.html#c=' || c.id, 'Qualitor');
  end loop;
end $$;
revoke execute on function public.qualitor_notificar_novo(text) from public, anon, authenticated;
grant execute on function public.qualitor_notificar_novo(text) to service_role;

alter table public.qualitor_config enable row level security;
alter table public.qualitor_fila enable row level security;
drop policy if exists qualitor_config_ler on public.qualitor_config;
drop policy if exists qualitor_config_editar on public.qualitor_config;
drop policy if exists qualitor_fila_ler on public.qualitor_fila;
create policy qualitor_config_ler on public.qualitor_config for select to authenticated
  using ((select public.eh_admin()));
create policy qualitor_config_editar on public.qualitor_config for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy qualitor_fila_ler on public.qualitor_fila for select to authenticated
  using ((select public.eh_admin()));
revoke all on public.qualitor_config, public.qualitor_fila from anon;

-- O que todo membro do time pode saber (link para abrir o chamado no Qualitor).
create or replace function public.qualitor_publico()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.eh_membro() or public.eh_painel()
    then jsonb_build_object('ativo', ativo, 'url_chamado', url_chamado) else null end
  from qualitor_config where id = 1;
$$;
revoke execute on function public.qualitor_publico() from public, anon;
grant execute on function public.qualitor_publico() to authenticated;

-- Acorda a Edge Function (sem esperar resposta). Se pg_net ou a URL não
-- estiverem configurados, não faz nada: o agendamento de 5 min processa depois.
create or replace function public.qualitor_acordar(p_acao text default 'processar')
returns void language plpgsql security definer set search_path = public as $$
declare cfg qualitor_config; seg text;
begin
  select * into cfg from qualitor_config where id = 1;
  if not found or not cfg.ativo or cfg.funcao_url = '' then return; end if;
  select valor into seg from qualitor_segredo where id = 1;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
      using cfg.funcao_url,
            jsonb_build_object('acao', p_acao, 'segredo', seg),
            jsonb_build_object('Content-Type', 'application/json');
  exception when others then
    raise notice 'Qualitor: não foi possível acordar a função: %', sqlerrm;
  end;
end $$;
revoke execute on function public.qualitor_acordar(text) from public, anon, authenticated;

create or replace function public.qualitor_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo from qualitor_config where id = 1), false);
$$;

-- Campos do Qualitor só mudam pela sincronização (sem usuário logado).
-- Pelo site ninguém altera o número/situação nem cria chamado "do Qualitor".
create or replace function public.tg_qualitor_protege()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and current_setting('hd.qualitor_interno', true) is distinct from '1' then
    if tg_op = 'INSERT' then
      if new.origem = 'qualitor' then new.origem := 'interno'; end if;
      new.qualitor_numero := null; new.qualitor_situacao := null; new.qualitor_responsavel := null;
      new.qualitor_erro := null; new.qualitor_atualizado_em := null; new.qualitor_sync := null;
    else
      new.origem := old.origem;
      new.qualitor_numero := old.qualitor_numero; new.qualitor_situacao := old.qualitor_situacao;
      new.qualitor_responsavel := old.qualitor_responsavel; new.qualitor_erro := old.qualitor_erro;
      new.qualitor_atualizado_em := old.qualitor_atualizado_em; new.qualitor_sync := old.qualitor_sync;
    end if;
  end if;
  -- Chamado novo do site/portal/manutenção com a integração escrevendo: "enviando".
  -- Do portal (sem login), só depois que um técnico assumir (triagem).
  if tg_op = 'INSERT' and new.origem <> 'qualitor' and new.qualitor_numero is null
     and public.qualitor_escreve()
     and not (new.origem = 'portal' and public.qualitor_portal_triagem()) then
    new.qualitor_sync := 'pendente';
  end if;
  if tg_op = 'UPDATE' and new.origem = 'portal' and new.qualitor_numero is null and new.qualitor_sync is null
     and old.responsavel_uid is null and new.responsavel_uid is not null and public.qualitor_escreve() then
    new.qualitor_sync := 'pendente';
  end if;
  return new;
end $$;
drop trigger if exists chamados_qualitor_protege on public.chamados;
create trigger chamados_qualitor_protege before insert or update on public.chamados
  for each row execute function public.tg_qualitor_protege();

-- Chamado novo no site → fila "abrir" (vale para portal e manutenção também).
create or replace function public.tg_qualitor_chamado_novo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.origem = 'qualitor' or new.qualitor_numero is not null or new.qualitor_sync is distinct from 'pendente' then return null; end if;
  if tg_op = 'UPDATE' then
    -- Só o chamado do portal que acabou de sair da triagem.
    if old.qualitor_sync is not null or new.origem <> 'portal' then return null; end if;
    if exists (select 1 from qualitor_fila where chamado_id = new.id and tipo = 'abrir' and status <> 'ok') then return null; end if;
  end if;
  insert into qualitor_fila (tipo, chamado_id, autor_nome) values ('abrir', new.id, coalesce(meu_nome(), new.criado_por_nome));
  perform qualitor_acordar('processar');
  return null;
end $$;
drop trigger if exists chamados_qualitor_novo on public.chamados;
create trigger chamados_qualitor_novo after insert or update on public.chamados
  for each row execute function public.tg_qualitor_chamado_novo();

-- Resolvido no site → encerra no Qualitor. (Mudanças feitas pela própria
-- sincronização vêm sem usuário logado e não voltam para o Qualitor.)
create or replace function public.tg_qualitor_chamado_resolvido()
returns trigger language plpgsql security definer set search_path = public as $$
declare nota text;
begin
  if auth.uid() is null then return null; end if;
  if not (new.status = 'resolvido' and old.status <> 'resolvido') then return null; end if;
  if not exists (select 1 from qualitor_config where id = 1 and ativo and not modo_validacao and encerrar_ao_resolver) then return null; end if;
  if new.qualitor_numero is null and new.qualitor_sync is null then return null; end if;
  select texto into nota from chamado_eventos
   where chamado_id = new.id and tipo = 'comentario' order by criado_em desc limit 1;
  insert into qualitor_fila (tipo, chamado_id, texto, autor_nome)
  values ('encerrar', new.id, coalesce(nota, 'Resolvido pela equipe de TI'), meu_nome());
  perform qualitor_acordar('processar');
  return null;
end $$;
drop trigger if exists chamados_qualitor_resolvido on public.chamados;
create trigger chamados_qualitor_resolvido after update on public.chamados
  for each row execute function public.tg_qualitor_chamado_resolvido();

-- Anotação no site → acompanhamento no Qualitor.
create or replace function public.tg_qualitor_anotacao()
returns trigger language plpgsql security definer set search_path = public as $$
declare c chamados;
begin
  if auth.uid() is null or new.tipo <> 'comentario' then return null; end if;
  if not exists (select 1 from qualitor_config where id = 1 and ativo and not modo_validacao and enviar_anotacoes) then return null; end if;
  select * into c from chamados where id = new.chamado_id;
  if c.qualitor_numero is null and c.qualitor_sync is null then return null; end if;
  insert into qualitor_fila (tipo, chamado_id, texto, autor_nome) values ('acompanhar', new.chamado_id, new.texto, new.autor_nome);
  perform qualitor_acordar('processar');
  return null;
end $$;
drop trigger if exists chamado_eventos_qualitor on public.chamado_eventos;
create trigger chamado_eventos_qualitor after insert on public.chamado_eventos
  for each row execute function public.tg_qualitor_anotacao();

-- Técnico do site ↔ usuário do Qualitor (para atribuir o responsável certo
-- lá e reconhecer o responsável que vem de lá).
create table if not exists public.qualitor_usuarios (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  cdusuario  text not null check (cdusuario ~ '^[0-9A-Za-z_.-]{1,40}$'),
  atualizado_em timestamptz not null default now()
);
alter table public.qualitor_usuarios enable row level security;
drop policy if exists qualitor_usuarios_admin on public.qualitor_usuarios;
create policy qualitor_usuarios_admin on public.qualitor_usuarios for all to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
revoke all on public.qualitor_usuarios from anon;

-- Assumir/atribuir, iniciar, prioridade e reabrir no site → fila do Qualitor.
-- Só ações de pessoas (a sincronização vem sem usuário e não ecoa de volta).
create or replace function public.tg_qualitor_acoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare quem text := meu_nome(); mexeu boolean := false;
begin
  if auth.uid() is null then return null; end if;
  if new.origem = 'qualitor' and new.qualitor_numero is null then return null; end if;
  if new.qualitor_numero is null and new.qualitor_sync is distinct from 'pendente' then return null; end if;
  if not exists (select 1 from qualitor_config where id = 1 and ativo and not modo_validacao and enviar_acoes) then return null; end if;
  if new.responsavel_uid is not null and new.responsavel_uid is distinct from old.responsavel_uid then
    insert into qualitor_fila (tipo, chamado_id, texto, autor_nome) values ('atribuir', new.id, new.responsavel_uid::text, quem);
    mexeu := true;
  end if;
  if old.status = 'aberto' and new.status = 'andamento' then
    insert into qualitor_fila (tipo, chamado_id, autor_nome) values ('iniciar', new.id, quem);
    mexeu := true;
  end if;
  if new.prioridade is distinct from old.prioridade then
    insert into qualitor_fila (tipo, chamado_id, texto, autor_nome) values ('prioridade', new.id, new.prioridade, quem);
    mexeu := true;
  end if;
  if old.status = 'resolvido' and new.status <> 'resolvido' then
    insert into qualitor_fila (tipo, chamado_id, texto, autor_nome) values ('reabrir', new.id, 'Reaberto pelo Help Desk Matriz', quem);
    mexeu := true;
  end if;
  if mexeu then perform qualitor_acordar('processar'); end if;
  return null;
end $$;
drop trigger if exists chamados_qualitor_acoes on public.chamados;
create trigger chamados_qualitor_acoes after update on public.chamados
  for each row execute function public.tg_qualitor_acoes();

-- Admin: mandar de novo um chamado que falhou.
create or replace function public.qualitor_reenviar(p_chamado text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas o supervisor/admin pode reenviar.' using errcode = '42501';
  end if;
  if not public.qualitor_escreve() then
    raise exception 'A integração está em modo validação (só leitura) ou desligada: nada é enviado ao Qualitor.' using errcode = '22023';
  end if;
  update qualitor_fila set status = 'pendente', tentativas = 0, erro = null
   where chamado_id = p_chamado and status = 'erro';
  if not found and not exists (select 1 from chamados where id = p_chamado and qualitor_numero is not null) then
    insert into qualitor_fila (tipo, chamado_id, autor_nome) values ('abrir', p_chamado, meu_nome());
  end if;
  perform set_config('hd.qualitor_interno', '1', true);
  update chamados set qualitor_sync = 'pendente', qualitor_erro = null where id = p_chamado and qualitor_numero is null;
  perform set_config('hd.qualitor_interno', '0', true);
  perform qualitor_acordar('processar');
end $$;
revoke execute on function public.qualitor_reenviar(text) from public, anon;
grant execute on function public.qualitor_reenviar(text) to authenticated;

-- Agendamento: a cada 5 minutos sincroniza (traz novidades e reprocessa a fila).
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'qualitor-sincronizar';
  perform cron.schedule('qualitor-sincronizar', '*/5 * * * *', $c$select public.qualitor_acordar('sincronizar')$c$);
exception when others then raise notice 'pg_cron indisponível: %', sqlerrm; end $$;

-- ====================================================== REALTIME (telas ao vivo)
do $$
declare t text;
begin
  foreach t in array array['usuarios', 'sessoes_ativas', 'chamados', 'chamado_eventos', 'tarefas', 'tarefa_conclusoes',
                           'relatorios', 'maquinas',
                           'maquina_historico', 'itens_estoque', 'visitas',
                           'solucoes', 'agenda_eventos', 'notificacoes', 'links_uteis', 'qualitor_fila'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Faz a API do Supabase enxergar na hora as tabelas novas.
notify pgrst, 'reload schema';
select 'Help Desk Matriz: schema aplicado até o fim ✓' as resultado;
