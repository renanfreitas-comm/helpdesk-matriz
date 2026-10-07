// ==========================================================================
// ACESSO AO BANCO (SUPABASE) — FUNÇÕES COMPARTILHADAS PELAS TELAS
// ==========================================================================
// No banco as colunas usam snake_case (criado_por_nome); nas telas o código
// usa camelCase (criadoPorNome). As funções abaixo convertem nos dois
// sentidos, então as telas não precisam se preocupar com isso.
//
// "Quem criou", "quando criou/atualizou" e "quando foi resolvido" são
// preenchidos pelo próprio banco (gatilhos em supabase/schema.sql) — as
// telas não enviam esses campos.
// ==========================================================================
import { supabase } from "./supabase-config.js";

export { supabase };

const paraSnake = (k) => k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const paraCamel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Converte uma linha do banco para camelCase (só o primeiro nível). */
export function linhaParaTela(linha) {
  if (!linha) return linha;
  const saida = {};
  for (const [k, v] of Object.entries(linha)) saida[paraCamel(k)] = v;
  return saida;
}

/** Converte um objeto da tela para as colunas do banco. */
export function dadosParaBanco(obj) {
  const saida = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    saida[paraSnake(k)] = v;
  }
  return saida;
}

/** Traduz os erros mais comuns do banco para mensagens em português. */
export function mensagemErro(erro) {
  if (!erro) return "Erro desconhecido.";
  const codigo = erro.code || "";
  if (codigo === "42501" && /row-level security|permission denied/i.test(erro.message || "")) {
    return "Você não tem permissão para fazer isso.";
  }
  if (codigo === "23514") return "Algum campo está com valor inválido ou longo demais.";
  if (codigo === "23505") return "Já existe um registro com esses dados.";
  if (codigo === "23503") return "Este registro está ligado a outro que não existe mais.";
  if (codigo === "PGRST301" || /JWT expired/i.test(erro.message || "")) {
    return "Sua sessão expirou. Recarregue a página e entre novamente.";
  }
  if (/Failed to fetch|NetworkError/i.test(erro.message || "")) {
    return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  }
  return erro.message || String(erro);
}

function falhar(erro) {
  const e = new Error(mensagemErro(erro));
  e.code = erro && erro.code;
  throw e;
}

function avisarAlteracao(tabela) {
  window.dispatchEvent(new CustomEvent("db-alterado", { detail: tabela }));
}

/** Insere um registro e devolve a linha criada (em camelCase). */
export async function inserir(tabela, dados) {
  const { data, error } = await supabase.from(tabela).insert(dadosParaBanco(dados)).select().single();
  if (error) falhar(error);
  avisarAlteracao(tabela);
  return linhaParaTela(data);
}

/**
 * Atualiza um registro pelo id. Se as regras de acesso bloquearem, o banco
 * não dá erro (só não altera nada) — por isso conferimos se alguma linha
 * voltou e avisamos o usuário.
 */
export async function atualizar(tabela, id, dados) {
  const { data, error } = await supabase.from(tabela).update(dadosParaBanco(dados)).eq("id", id).select();
  if (error) falhar(error);
  if (!data || data.length === 0) {
    throw new Error("Você não tem permissão para alterar este registro (ou ele não existe mais).");
  }
  avisarAlteracao(tabela);
  return linhaParaTela(data[0]);
}

/** Exclui um registro pelo id (com a mesma checagem de permissão). */
export async function excluir(tabela, id) {
  const { data, error } = await supabase.from(tabela).delete().eq("id", id).select("id");
  if (error) falhar(error);
  if (!data || data.length === 0) {
    throw new Error("Você não tem permissão para excluir este registro (ou ele já foi excluído).");
  }
  avisarAlteracao(tabela);
}

/**
 * Busca TODAS as linhas de uma consulta, de 1000 em 1000 (o Supabase
 * devolve no máximo 1000 por vez). "montar" recebe o construtor da tabela
 * e devolve a consulta com filtros/ordem, ex.:
 *   buscarTodos("chamados", (q) => q.order("criado_em", { ascending: false }))
 */
export async function buscarTodos(tabela, montar = (q) => q, colunas = "*") {
  const PAGINA = 1000;
  let inicio = 0;
  const todas = [];
  for (;;) {
    const { data, error } = await montar(supabase.from(tabela).select(colunas)).range(inicio, inicio + PAGINA - 1);
    if (error) falhar(error);
    todas.push(...data);
    if (data.length < PAGINA) break;
    inicio += PAGINA;
  }
  return todas.map(linhaParaTela);
}

/**
 * Mantém uma lista sempre atualizada (equivalente ao antigo onSnapshot):
 * carrega os dados, e recarrega sozinho quando algo muda na tabela
 * (Realtime), quando a própria tela grava algo, ou quando a aba volta a
 * ficar visível. Devolve uma função para parar de observar.
 *
 * @param {string} tabela
 * @param {(q:any)=>any} montar  filtros/ordem da consulta
 * @param {(linhas:object[])=>void} aoReceber
 * @param {(erro:Error)=>void} [aoErrar]
 * @param {{ filtroRealtime?: string }} [opcoes]  ex.: "maquina_id=eq.123"
 */
export function observar(tabela, montar, aoReceber, aoErrar, opcoes = {}) {
  let ativo = true;
  let temporizador = null;

  const carregar = async () => {
    try {
      const linhas = await buscarTodos(tabela, montar);
      if (ativo) aoReceber(linhas);
    } catch (err) {
      if (!ativo) return;
      if (aoErrar) aoErrar(err); else console.error(`Erro ao carregar ${tabela}:`, err);
    }
  };
  const agendar = () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(carregar, 300);
  };

  const filtro = { event: "*", schema: "public", table: tabela };
  if (opcoes.filtroRealtime) filtro.filter = opcoes.filtroRealtime;
  const canal = supabase
    .channel(`rt-${tabela}-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", filtro, agendar)
    .subscribe();

  const aoAlterarLocal = (e) => { if (e.detail === tabela) agendar(); };
  const aoVoltar = () => { if (document.visibilityState === "visible") agendar(); };
  window.addEventListener("db-alterado", aoAlterarLocal);
  document.addEventListener("visibilitychange", aoVoltar);

  carregar();

  return () => {
    ativo = false;
    clearTimeout(temporizador);
    window.removeEventListener("db-alterado", aoAlterarLocal);
    document.removeEventListener("visibilitychange", aoVoltar);
    supabase.removeChannel(canal);
  };
}

/** Lista de usuários no formato usado pelas telas: { uid, nome, email, papel }. */
export async function listarUsuarios() {
  const linhas = await buscarTodos("usuarios", (q) => q.order("nome"));
  return linhas.map((u) => ({ uid: u.id, ...u }));
}

/** Converte data/hora do banco (texto ISO) em Date, ou null. */
export function paraDate(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}
