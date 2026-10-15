// ==========================================================================
// AGENDA — FUNÇÕES COMPARTILHADAS (Agenda, Painel de TV, Tarefas, Início)
// ==========================================================================
import { buscarTodos } from "./db.js";
import { hojeISO } from "./tarefas-util.js";

export const TIPOS_AGENDA = {
  ferias: { rotulo: "Férias", emoji: "🌴" },
  atestado: { rotulo: "Atestado", emoji: "🏥" },
  folga: { rotulo: "Folga", emoji: "🛋" },
  plantao: { rotulo: "Plantão", emoji: "🛡" },
  treinamento: { rotulo: "Treinamento", emoji: "🎓" },
  outro: { rotulo: "Outro", emoji: "📌" }
};

/** Tipos que tiram a pessoa do atendimento no dia. */
export const AUSENCIAS = ["ferias", "atestado", "folga"];

/**
 * Quem está fora no dia: Map(uid -> tipo). Se a tabela ainda não existir
 * (banco não atualizado), devolve vazio e o resto do site segue normal.
 */
export async function ausentesNoDia(dia = hojeISO()) {
  try {
    const linhas = await buscarTodos("agenda_eventos",
      (q) => q.in("tipo", AUSENCIAS).lte("inicio", dia).gte("fim", dia), "usuario_id,tipo");
    return new Map(linhas.map((l) => [l.usuarioId, l.tipo]));
  } catch (e) {
    return new Map();
  }
}
