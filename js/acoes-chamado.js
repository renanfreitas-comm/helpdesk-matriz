// ==========================================================================
// AÇÕES RÁPIDAS DE CHAMADO (usadas no Dashboard e na tela de Chamados)
// ==========================================================================
import { atualizar, inserir } from "./db.js";
import { abrirResolver } from "./solucoes-util.js";

/** O técnico assume um chamado sem responsável e já começa o atendimento. */
export async function assumirChamado(chamado, uid) {
  await atualizar("chamados", chamado.id, {
    responsavelUid: uid,
    status: chamado.status === "aberto" ? "andamento" : chamado.status
  });
}

/**
 * Muda o status. Ao resolver, abre a janela "Resolver chamado": a pessoa
 * conta como resolveu (vai para a linha do tempo) e pode salvar na Base de
 * soluções. Devolve false se a pessoa cancelar.
 * "extra" permite mudar outros campos junto (ex.: assumir e resolver).
 */
export async function mudarStatus(chamado, novoStatus, { perguntarNota = true, extra = {} } = {}) {
  const gravar = async (nota) => {
    await atualizar("chamados", chamado.id, { ...extra, status: novoStatus });
    if (nota) await comentar(chamado.id, nota);
  };
  if (novoStatus === "resolvido" && perguntarNota) {
    return abrirResolver(chamado, ({ nota }) => gravar(nota));
  }
  await gravar("");
  return true;
}

export async function comentar(chamadoId, texto) {
  const t = String(texto || "").trim();
  if (!t) return;
  await inserir("chamado_eventos", { chamadoId, tipo: "comentario", texto: t.slice(0, 2000) });
}

/**
 * Botões de ação rápida para um chamado, de acordo com quem está vendo.
 * Use junto com ligarBotoesRapidos().
 */
export function botoesRapidos(c, uid, ehAdmin) {
  const meu = c.responsavelUid === uid;
  const semDono = !c.responsavelUid;
  let html = "";
  if (c.status !== "resolvido") {
    if (semDono) {
      html += `<button class="botao-primario botao-pequeno js-assumir" data-id="${c.id}">Assumir</button>`;
    } else if (meu || ehAdmin) {
      if (c.status === "aberto") html += `<button class="botao-secundario botao-pequeno js-status" data-id="${c.id}" data-status="andamento">Iniciar</button>`;
      html += `<button class="botao-primario botao-pequeno js-status" data-id="${c.id}" data-status="resolvido">Resolver</button>`;
    }
  }
  return html;
}

/** Liga os cliques dos botões criados por botoesRapidos(). */
export function ligarBotoesRapidos(raiz, lista, uid) {
  const achar = (id) => lista.find((x) => x.id === id);
  raiz.querySelectorAll(".js-assumir").forEach((b) => b.addEventListener("click", () =>
    executar(b, () => assumirChamado(achar(b.dataset.id), uid))));
  raiz.querySelectorAll(".js-status").forEach((b) => b.addEventListener("click", () =>
    executar(b, () => mudarStatus(achar(b.dataset.id), b.dataset.status))));
}

async function executar(botao, acao) {
  const texto = botao.textContent;
  botao.disabled = true;
  botao.textContent = "...";
  try {
    await acao();
  } catch (err) {
    alert("Não foi possível concluir: " + err.message);
  } finally {
    botao.disabled = false;
    botao.textContent = texto;
  }
}
