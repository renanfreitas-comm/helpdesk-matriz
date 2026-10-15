// ==========================================================================
// CONTROLE DE SESSÃO — UMA MÁQUINA POR VEZ
// ==========================================================================
// Cada navegador recebe um identificador próprio (guardado nele mesmo).
// Ao entrar, o site "ocupa a vaga" da conta para este navegador; se outra
// máquina estiver ativa, o login é recusado. Enquanto a página está
// aberta, um "sinal de vida" vai ao banco a cada 30 s. Sem sinal por
// 2 minutos (navegador fechado, PC desligado), a vaga é liberada.
// As regras de verdade ficam no banco (supabase/schema.sql): só a sessão
// registrada consegue ler ou gravar dados.
// ==========================================================================
import { supabase } from "./supabase-config.js";

// Depois de quanto tempo sem mexer no site a sessão é encerrada sozinha
// (protege quem esquece o PC ligado). 0 = nunca.
export const MINUTOS_INATIVIDADE = 60;

const INTERVALO_SINAL_MS = 30 * 1000;
const CHAVE_DISPOSITIVO = "hd-dispositivo-id";

/** Identificador deste navegador (criado na primeira vez). */
export function idDispositivo() {
  let id = null;
  try { id = localStorage.getItem(CHAVE_DISPOSITIVO); } catch (e) { /* navegação privada */ }
  if (!id || id.length < 8) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    try { localStorage.setItem(CHAVE_DISPOSITIVO, id); } catch (e) { /* ignora */ }
  }
  return id;
}

/** Nome amigável da máquina, ex.: "Chrome no Windows". */
export function nomeDispositivo() {
  const ua = navigator.userAgent;
  const navegador = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const sistema = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad"
    : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  return `${navegador} no ${sistema}`;
}

/**
 * Tenta ocupar a vaga da conta para este navegador.
 * Devolve { ok: true } ou { ok: false, motivo, dispositivo, desde, ultimo_sinal }.
 */
export async function reivindicarSessao() {
  const { data, error } = await supabase.rpc("reivindicar_sessao", {
    p_dispositivo: idDispositivo(),
    p_nome: nomeDispositivo()
  });
  if (error) {
    // Banco ainda sem o controle de sessão (schema.sql antigo): não bloqueia.
    if (error.code === "PGRST202" || /reivindicar_sessao/.test(error.message || "")) {
      console.warn("Controle de sessão ainda não instalado no banco (rode o supabase/schema.sql).");
      return { ok: true, semControle: true };
    }
    throw error;
  }
  return data || { ok: false, motivo: "erro" };
}

/** Libera a vaga (usado no "Sair"). Não trava a saída se falhar. */
export async function liberarSessao() {
  try {
    await supabase.rpc("encerrar_sessao", { p_dispositivo: idDispositivo() });
  } catch (e) { /* segue saindo */ }
}

/** Texto explicando que a conta está em uso em outra máquina. */
export function mensagemEmUso(r) {
  const onde = r && r.dispositivo ? ` (${r.dispositivo})` : "";
  const desde = r && r.desde ? `, conectada desde ${new Date(r.desde).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  return `Esta conta já está em uso em outra máquina${onde}${desde}. ` +
    `Clique em "Sair" naquele computador, peça a um admin para desconectar, ` +
    `ou aguarde 2 minutos depois que o navegador de lá for fechado.`;
}

/**
 * Mantém a sessão viva e vigia se ela continua válida. Chama aoPerder(motivo)
 * quando esta máquina perde a vaga ("desconectado") ou fica parada demais
 * ("inatividade").
 */
export function iniciarMonitorSessao(aoPerder) {
  let ultimaAtividade = Date.now();
  let encerrado = false;
  const marcarAtividade = () => { ultimaAtividade = Date.now(); };
  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((ev) =>
    window.addEventListener(ev, marcarAtividade, { passive: true }));

  const verificar = async () => {
    if (encerrado) return;
    if (MINUTOS_INATIVIDADE > 0 && Date.now() - ultimaAtividade > MINUTOS_INATIVIDADE * 60000) {
      encerrado = true;
      aoPerder("inatividade");
      return;
    }
    try {
      const { data, error } = await supabase.rpc("sinal_sessao", { p_dispositivo: idDispositivo() });
      if (error) {
        if (error.code === "PGRST202") { encerrado = true; return; } // banco sem controle de sessão
        return; // falha de rede: tenta de novo no próximo ciclo
      }
      if (data === false) {
        encerrado = true;
        aoPerder("desconectado");
      }
    } catch (e) { /* sem internet: tenta de novo depois */ }
  };

  const timer = setInterval(verificar, INTERVALO_SINAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { marcarAtividade(); verificar(); }
  });
  return () => { encerrado = true; clearInterval(timer); };
}
