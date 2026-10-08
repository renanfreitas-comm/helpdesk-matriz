// ==========================================================================
// PRAZOS DE ATENDIMENTO (SLA) POR PRIORIDADE
// ==========================================================================
// Ajuste aqui quantas horas cada prioridade tem para ser resolvida, contadas
// a partir da abertura do chamado (horas corridas).
// ==========================================================================
export const PRAZO_HORAS = { alta: 4, media: 24, baixa: 72 };

const HORA = 3600 * 1000;

export function prazoDe(c) {
  const criado = c.criadoEm ? new Date(c.criadoEm) : null;
  if (!criado || isNaN(criado)) return null;
  const horas = PRAZO_HORAS[c.prioridade] ?? PRAZO_HORAS.media;
  return new Date(criado.getTime() + horas * HORA);
}

function duracao(ms) {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * Situação do prazo de um chamado:
 *  estado: "ok" | "perto" | "atrasado" (em aberto) ou "cumprido" | "estourado" (resolvido)
 *  texto: frase curta para mostrar na tela
 */
export function situacaoPrazo(c, agora = new Date()) {
  const prazo = prazoDe(c);
  if (!prazo) return { estado: "ok", texto: "—", atrasado: false };

  if (c.status === "resolvido") {
    const fim = c.resolvidoEm ? new Date(c.resolvidoEm) : agora;
    return fim <= prazo
      ? { estado: "cumprido", texto: "No prazo", atrasado: false }
      : { estado: "estourado", texto: "Fora do prazo", atrasado: false };
  }

  const resta = prazo - agora;
  if (resta < 0) return { estado: "atrasado", texto: `Atrasado ${duracao(resta)}`, atrasado: true };
  const janela = (PRAZO_HORAS[c.prioridade] ?? PRAZO_HORAS.media) * HORA;
  const perto = resta < Math.min(janela * 0.25, 2 * HORA) || resta < HORA;
  return { estado: perto ? "perto" : "ok", texto: `Vence em ${duracao(resta)}`, atrasado: false };
}

export function badgePrazo(c) {
  const s = situacaoPrazo(c);
  return `<span class="badge badge-prazo-${s.estado}" title="Prazo: ${PRAZO_HORAS[c.prioridade] ?? "?"} h para prioridade ${c.prioridade}">${s.texto}</span>`;
}

/** Ordena: atrasados primeiro, depois quem vence antes. */
export function ordenarPorPrazo(a, b) {
  return (prazoDe(a)?.getTime() ?? Infinity) - (prazoDe(b)?.getTime() ?? Infinity);
}

/** Tempo médio de resolução (em texto) dos chamados resolvidos informados. */
export function tempoMedioResolucao(resolvidos) {
  const tempos = resolvidos
    .filter((c) => c.criadoEm && c.resolvidoEm)
    .map((c) => new Date(c.resolvidoEm) - new Date(c.criadoEm))
    .filter((ms) => ms >= 0);
  if (tempos.length === 0) return "—";
  return duracao(tempos.reduce((a, b) => a + b, 0) / tempos.length);
}
