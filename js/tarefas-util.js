// ==========================================================================
// TAREFAS DIÁRIAS — FUNÇÕES COMPARTILHADAS (tela Tarefas e Dashboard)
// ==========================================================================
// A regra de "a tarefa vale neste dia?" é a mesma da função
// tarefa_vale_no_dia() do banco (supabase/schema.sql).
// ==========================================================================
import { inserir, excluir } from "./db.js";

export const NOMES_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Data de hoje (AAAA-MM-DD) no fuso do computador. */
export function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function somarDias(iso, dias) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function formatarDiaLongo(iso) {
  const d = new Date(iso + "T12:00:00");
  const txt = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function diaDaCriacao(t) {
  if (!t.criadoEm) return "0000-00-00";
  const d = new Date(t.criadoEm);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A tarefa deve ser feita na data (AAAA-MM-DD)? */
export function valeNoDia(t, iso) {
  if (!t.ativa) return false;
  if (t.recorrencia === "unica") return t.dataUnica === iso;
  if (diaDaCriacao(t) > iso) return false;
  const dow = new Date(iso + "T12:00:00").getDay(); // 0 = domingo
  switch (t.recorrencia) {
    case "diaria": return true;
    case "dias_uteis": return dow >= 1 && dow <= 5;
    case "semanal": return (t.diasSemana || []).map(Number).includes(dow);
    default: return false;
  }
}

/** Texto curto da repetição, ex.: "Seg a sex", "Seg, Qua", "Só em 20/10". */
export function descreverRecorrencia(t) {
  switch (t.recorrencia) {
    case "diaria": return "Todo dia";
    case "dias_uteis": return "Seg a sex";
    case "semanal": return (t.diasSemana || []).map(Number).sort().map((d) => NOMES_DIAS[d]).join(", ") || "—";
    case "unica": {
      if (!t.dataUnica) return "Data única";
      const [a, m, d] = t.dataUnica.split("-");
      return `Só em ${d}/${m}/${a}`;
    }
    default: return "—";
  }
}

/** Marca a tarefa como feita na data. */
export function marcarTarefa(tarefaId, data) {
  return inserir("tarefa_conclusoes", { tarefaId, data });
}

/** Desfaz a conclusão (pelo id da conclusão). */
export function desmarcarTarefa(conclusaoId) {
  // O id vem da página como texto; no banco ele é número.
  const id = /^\d+$/.test(String(conclusaoId)) ? Number(conclusaoId) : conclusaoId;
  return excluir("tarefa_conclusoes", id);
}

export function horaCurta(valor) {
  if (!valor) return "";
  const d = new Date(valor);
  return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
