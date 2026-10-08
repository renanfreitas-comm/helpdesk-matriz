// ==========================================================================
// LÓGICA DA TELA DE CHAMADOS
// ==========================================================================
// Pensada para o técnico resolver tudo com poucos cliques:
//  - atalhos "Em aberto / Meus / Sem responsável / Atrasados";
//  - botões rápidos Assumir / Iniciar / Resolver direto na lista;
//  - janela de detalhes com a linha do tempo e campo para anotar.
// Atalhos de endereço: chamados.html#novo (abre o formulário) e
// chamados.html#c=<id> (abre os detalhes de um chamado).
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, inserir, atualizar, excluir, listarUsuarios, paraDate } from "./db.js";
import { PRAZO_HORAS, badgePrazo, situacaoPrazo, ordenarPorPrazo } from "./sla.js";
import { botoesRapidos, ligarBotoesRapidos, mudarStatus, comentar } from "./acoes-chamado.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaUsuarios = [];   // { uid, nome, papel }
let listaChamados = [];
let visaoAtual = "ativos";
let pararEventos = null;
let detalheId = null;

const tabelaBody = document.getElementById("tabela-chamados");
const modal = document.getElementById("modal-chamado");
const form = document.getElementById("form-chamado");
const linhaAdmin = document.getElementById("linha-admin-chamado");
const selectResponsavel = document.getElementById("chamado-responsavel");
const selectFiltroResponsavel = document.getElementById("filtro-responsavel");
const modalDetalhe = document.getElementById("modal-detalhe");

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento", resolvido: "Resolvido" };

const ehAdmin = () => perfilAtual.papel === "admin";

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);

  // Técnico abre a tela já vendo os chamados dele.
  if (!ehAdmin()) definirVisao("meus", false);

  await carregarUsuarios();
  observarChamados();
});

// -------------------- Usuários --------------------
async function carregarUsuarios() {
  listaUsuarios = await listarUsuarios();
  const opcoes = listaUsuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
  selectFiltroResponsavel.innerHTML = `<option value="">Todos os responsáveis</option>${opcoes}`;
}

// -------------------- Dados em tempo real --------------------
let jaAbriuDoEndereco = false;
function observarChamados() {
  observar("chamados", (q) => q.order("criado_em", { ascending: false }), (linhas) => {
    listaChamados = linhas;
    preencherSugestoesDeArea();
    renderizarTabela();
    atualizarDetalheAberto();
    if (!jaAbriuDoEndereco) { jaAbriuDoEndereco = true; abrirPeloEndereco(); }
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="7" class="vazio">Erro ao carregar chamados: ${escaparHTML(erro.message)}</td></tr>`;
  });
  // Atualiza os textos de prazo ("vence em...") a cada minuto.
  setInterval(renderizarTabela, 60000);
}

function abrirPeloEndereco() {
  const h = window.location.hash;
  if (h === "#novo") abrirModal("criar");
  const m = h.match(/^#c=(.+)$/);
  if (m) abrirDetalhe(decodeURIComponent(m[1]));
}

// Sugere áreas já usadas, para o técnico não precisar digitar tudo.
function preencherSugestoesDeArea() {
  const areas = [...new Set(listaChamados.map((c) => (c.area || "").trim()).filter(Boolean))].sort();
  document.getElementById("lista-areas").innerHTML = areas.map((a) => `<option value="${escaparHTML(a)}">`).join("");
}

// -------------------- Visões rápidas + filtros --------------------
document.querySelectorAll("#abas-chamados .aba-rapida").forEach((b) =>
  b.addEventListener("click", () => definirVisao(b.dataset.visao)));

function definirVisao(visao, render = true) {
  visaoAtual = visao;
  document.querySelectorAll("#abas-chamados .aba-rapida").forEach((b) =>
    b.classList.toggle("ativa", b.dataset.visao === visao));
  if (render) renderizarTabela();
}

function passaNaVisao(c) {
  const aberto = c.status !== "resolvido";
  switch (visaoAtual) {
    case "ativos": return aberto;
    case "meus": return aberto && c.responsavelUid === usuarioAtual.uid;
    case "livres": return aberto && !c.responsavelUid;
    case "atrasados": return situacaoPrazo(c).atrasado;
    default: return true;
  }
}

function atualizarContadores() {
  const abertos = listaChamados.filter((c) => c.status !== "resolvido");
  document.getElementById("cont-ativos").textContent = abertos.length;
  document.getElementById("cont-meus").textContent = abertos.filter((c) => c.responsavelUid === usuarioAtual.uid).length;
  document.getElementById("cont-livres").textContent = abertos.filter((c) => !c.responsavelUid).length;
  document.getElementById("cont-atrasados").textContent = abertos.filter((c) => situacaoPrazo(c).atrasado).length;
}

function renderizarTabela() {
  if (!usuarioAtual) return;
  atualizarContadores();

  const busca = document.getElementById("filtro-busca").value.trim().toLowerCase();
  const fStatus = document.getElementById("filtro-status").value;
  const fPrioridade = document.getElementById("filtro-prioridade").value;
  const fResponsavel = selectFiltroResponsavel.value;

  let filtrados = listaChamados.filter((c) => {
    if (!passaNaVisao(c)) return false;
    if (fStatus && c.status !== fStatus) return false;
    if (fPrioridade && c.prioridade !== fPrioridade) return false;
    if (fResponsavel && c.responsavelUid !== fResponsavel) return false;
    if (busca) {
      const alvo = `${c.numero || ""} ${c.area || ""} ${c.atividade || ""} ${c.responsavelNome || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  // Em aberto: o que vence primeiro fica em cima. Resolvidos: mais recentes primeiro.
  if (visaoAtual !== "todos") filtrados.sort(ordenarPorPrazo);

  const rodape = document.getElementById("rodape-lista");
  rodape.textContent = `${filtrados.length} chamado(s). Prazos: alta ${PRAZO_HORAS.alta} h, média ${PRAZO_HORAS.media} h, baixa ${PRAZO_HORAS.baixa} h.`;

  if (filtrados.length === 0) {
    const vazio = { meus: "Nenhum chamado em aberto com você.", livres: "Nenhum chamado esperando responsável.", atrasados: "Nenhum chamado atrasado." }[visaoAtual] || "Nenhum chamado encontrado.";
    tabelaBody.innerHTML = `<tr><td colspan="7" class="vazio">${vazio}</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtrados.map((c) => {
    let acoes = botoesRapidos(c, usuarioAtual.uid, ehAdmin());
    acoes += `<button class="botao-secundario botao-pequeno btn-detalhe" data-id="${c.id}">Detalhes</button>`;
    if (ehAdmin()) {
      acoes += `<button class="botao-secundario botao-pequeno btn-editar" data-id="${c.id}">Editar</button>
                <button class="botao-perigo botao-pequeno btn-excluir" data-id="${c.id}">Excluir</button>`;
    }
    const meu = c.responsavelUid === usuarioAtual.uid;
    return `
      <tr class="${situacaoPrazo(c).atrasado ? "linha-atrasada" : ""}">
        <td data-rotulo="Chamado"><a href="#c=${encodeURIComponent(c.id)}" class="link-detalhe" data-id="${c.id}"><strong>${escaparHTML(c.numero || "(sem número)")}</strong></a><br><span class="texto-suave">${escaparHTML(truncar(c.atividade, 70))}</span></td>
        <td data-rotulo="Área">${escaparHTML(c.area || "—")}</td>
        <td data-rotulo="Prioridade"><span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade] || c.prioridade}</span></td>
        <td data-rotulo="Prazo">${badgePrazo(c)}</td>
        <td data-rotulo="Status"><span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status] || c.status}</span></td>
        <td data-rotulo="Responsável">${c.responsavelNome ? escaparHTML(c.responsavelNome) + (meu ? ' <span class="texto-suave">(você)</span>' : "") : '<span class="texto-suave">Não atribuído</span>'}</td>
        <td><div class="acoes-tabela">${acoes}</div></td>
      </tr>`;
  }).join("");

  ligarBotoesRapidos(tabelaBody, listaChamados, usuarioAtual.uid);
  tabelaBody.querySelectorAll(".btn-detalhe, .link-detalhe").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); abrirDetalhe(b.dataset.id); }));
  tabelaBody.querySelectorAll(".btn-editar").forEach((b) => b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  tabelaBody.querySelectorAll(".btn-excluir").forEach((b) => b.addEventListener("click", () => excluirChamado(b.dataset.id)));
}

["filtro-status", "filtro-prioridade", "filtro-responsavel"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderizarTabela));
document.getElementById("filtro-busca").addEventListener("input", () => {
  // Buscando, procura em todos (não só na aba atual).
  if (document.getElementById("filtro-busca").value.trim() && visaoAtual !== "todos") definirVisao("todos", false);
  renderizarTabela();
});

// -------------------- Modal: criar / editar --------------------
let modoAtual = "criar"; // "criar" | "editar"

document.getElementById("btn-novo-chamado").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-chamado").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

// Prioridade como 3 botões (mais rápido que um select no celular).
const seletorPrioridade = document.getElementById("seletor-prioridade");
seletorPrioridade.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => definirPrioridade(b.dataset.valor)));
function definirPrioridade(valor) {
  document.getElementById("chamado-prioridade").value = valor;
  seletorPrioridade.querySelectorAll("button").forEach((b) => b.classList.toggle("ativo", b.dataset.valor === valor));
  document.getElementById("dica-prazo").textContent = `Prazo para resolver: ${PRAZO_HORAS[valor]} horas.`;
}

function preencherSelectResponsavel() {
  // Admin escolhe qualquer pessoa; técnico só "eu" ou "sem responsável".
  const lista = ehAdmin() ? listaUsuarios : listaUsuarios.filter((u) => u.uid === usuarioAtual.uid);
  selectResponsavel.innerHTML = `<option value="">Sem responsável</option>` +
    lista.map((u) => `<option value="${u.uid}">${u.uid === usuarioAtual.uid ? "Eu (" + escaparHTML(u.nome) + ")" : escaparHTML(u.nome)}</option>`).join("");
}

function abrirModal(modo, chamadoId = null) {
  modoAtual = modo;
  document.getElementById("chamado-erro").textContent = "";
  form.reset();
  document.getElementById("chamado-id").value = chamadoId || "";
  preencherSelectResponsavel();
  linhaAdmin.style.display = "grid";

  if (modo === "criar") {
    document.getElementById("modal-titulo").textContent = "Novo chamado";
    definirPrioridade("media");
    // Na prática o técnico que registra é quem atende: já vem atribuído a ele.
    selectResponsavel.value = usuarioAtual.uid;
    document.getElementById("chamado-status").value = "andamento";
  } else {
    const c = listaChamados.find((x) => x.id === chamadoId);
    document.getElementById("modal-titulo").textContent = "Editar chamado";
    document.getElementById("chamado-numero").value = c.numero || "";
    document.getElementById("chamado-area").value = c.area || "";
    document.getElementById("chamado-atividade").value = c.atividade || "";
    definirPrioridade(c.prioridade || "media");
    document.getElementById("chamado-status").value = c.status;
    selectResponsavel.value = c.responsavelUid || "";
  }

  modal.classList.add("aberto");
  document.getElementById("chamado-numero").focus();
}

function fecharModal() {
  modal.classList.remove("aberto");
  if (window.location.hash === "#novo") history.replaceState(null, "", window.location.pathname);
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("chamado-erro");
  erroEl.textContent = "";

  const id = document.getElementById("chamado-id").value;
  const dados = {
    numero: document.getElementById("chamado-numero").value.trim(),
    area: document.getElementById("chamado-area").value.trim(),
    atividade: document.getElementById("chamado-atividade").value.trim(),
    prioridade: document.getElementById("chamado-prioridade").value,
    responsavelUid: selectResponsavel.value || null,
    status: document.getElementById("chamado-status").value || "aberto"
  };

  // Chamado já resolvido sem responsável não conta para ninguém.
  if (dados.status !== "aberto" && !dados.responsavelUid) {
    erroEl.textContent = "Escolha um responsável para marcar como Em andamento ou Resolvido.";
    return;
  }

  const botao = document.getElementById("btn-salvar-chamado");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    // Quem criou, datas, "resolvido em" e a linha do tempo são do banco.
    if (modoAtual === "criar") {
      await inserir("chamados", dados);
    } else {
      await atualizar("chamados", id, dados);
    }
    fecharModal();
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirChamado(id) {
  if (!confirm("Tem certeza que deseja excluir este chamado? Essa ação não pode ser desfeita.")) return;
  try {
    await excluir("chamados", id);
    if (detalheId === id) fecharDetalhe();
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

// -------------------- Detalhes + linha do tempo --------------------
document.getElementById("btn-fechar-detalhe").addEventListener("click", fecharDetalhe);
modalDetalhe.addEventListener("click", (e) => { if (e.target === modalDetalhe) fecharDetalhe(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (modalDetalhe.classList.contains("aberto")) fecharDetalhe();
  if (modal.classList.contains("aberto")) fecharModal();
});

function abrirDetalhe(id) {
  const c = listaChamados.find((x) => x.id === id);
  if (!c) return;
  detalheId = id;
  history.replaceState(null, "", `#c=${encodeURIComponent(id)}`);
  document.getElementById("comentario-texto").value = "";
  renderizarDetalhe();
  modalDetalhe.classList.add("aberto");

  if (pararEventos) pararEventos();
  pararEventos = observar("chamado_eventos",
    (q) => q.eq("chamado_id", id).order("criado_em", { ascending: true }),
    renderizarEventos,
    (erro) => { document.getElementById("detalhe-eventos").innerHTML = `<p class="texto-suave">Erro: ${escaparHTML(erro.message)}</p>`; },
    { filtroRealtime: `chamado_id=eq.${id}` });
}

function fecharDetalhe() {
  modalDetalhe.classList.remove("aberto");
  detalheId = null;
  if (pararEventos) { pararEventos(); pararEventos = null; }
  history.replaceState(null, "", window.location.pathname);
}

function atualizarDetalheAberto() {
  if (detalheId) renderizarDetalhe();
}

function renderizarDetalhe() {
  const c = listaChamados.find((x) => x.id === detalheId);
  if (!c) { fecharDetalhe(); return; }

  document.getElementById("detalhe-titulo").textContent = `Chamado ${c.numero || ""}`;
  document.getElementById("detalhe-badges").innerHTML = `
    <span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status] || c.status}</span>
    <span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade] || c.prioridade}</span>
    ${badgePrazo(c)}`;
  document.getElementById("detalhe-info").innerHTML = `
    <div><dt>Área</dt><dd>${escaparHTML(c.area || "—")}</dd></div>
    <div><dt>Responsável</dt><dd>${escaparHTML(c.responsavelNome || "Não atribuído")}</dd></div>
    <div><dt>Aberto por</dt><dd>${escaparHTML(c.criadoPorNome || "—")}</dd></div>
    <div><dt>Aberto em</dt><dd>${formatarDataHora(c.criadoEm)}</dd></div>
    ${c.resolvidoEm ? `<div><dt>Resolvido em</dt><dd>${formatarDataHora(c.resolvidoEm)}</dd></div>` : ""}`;
  document.getElementById("detalhe-atividade").textContent = c.atividade || "";

  // Ações: as mesmas da lista + reabrir (para o responsável/admin).
  const podeMexer = ehAdmin() || c.responsavelUid === usuarioAtual.uid;
  let acoes = botoesRapidos(c, usuarioAtual.uid, ehAdmin());
  if (c.status === "resolvido" && podeMexer) {
    acoes += `<button class="botao-secundario botao-pequeno" id="btn-reabrir">Reabrir</button>`;
  }
  if (ehAdmin()) acoes += `<button class="botao-secundario botao-pequeno" id="btn-editar-detalhe">Editar</button>`;
  const acoesEl = document.getElementById("detalhe-acoes");
  acoesEl.innerHTML = acoes;
  ligarBotoesRapidos(acoesEl, listaChamados, usuarioAtual.uid);
  const reabrir = document.getElementById("btn-reabrir");
  if (reabrir) reabrir.addEventListener("click", async () => {
    try { await mudarStatus(c, "andamento"); } catch (err) { alert("Erro: " + err.message); }
  });
  const editar = document.getElementById("btn-editar-detalhe");
  if (editar) editar.addEventListener("click", () => abrirModal("editar", c.id));
}

function renderizarEventos(eventos) {
  const el = document.getElementById("detalhe-eventos");
  if (eventos.length === 0) {
    el.innerHTML = '<p class="texto-suave">Sem registros ainda. Chamados abertos antes desta versão começam a linha do tempo a partir de agora.</p>';
    return;
  }
  el.innerHTML = eventos.map((ev) => `
    <div class="evento evento-${ev.tipo}">
      <span class="evento-ponto" aria-hidden="true"></span>
      <div>
        <div class="evento-texto">${escaparHTML(ev.texto)}</div>
        <div class="texto-suave evento-meta">${escaparHTML(ev.autorNome || "—")} · ${formatarDataHora(ev.criadoEm)}</div>
      </div>
    </div>`).join("");
  el.scrollTop = el.scrollHeight;
}

document.getElementById("form-comentario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const campo = document.getElementById("comentario-texto");
  const texto = campo.value.trim();
  if (!texto || !detalheId) return;
  const botao = document.getElementById("btn-comentar");
  botao.disabled = true;
  try {
    await comentar(detalheId, texto);
    campo.value = "";
  } catch (err) {
    alert("Não foi possível anotar: " + err.message);
  } finally {
    botao.disabled = false;
  }
});
// Ctrl+Enter também envia a anotação.
document.getElementById("comentario-texto").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) document.getElementById("form-comentario").requestSubmit();
});

// -------------------- Utilitários --------------------
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function truncar(texto, tamanho) {
  if (!texto) return "";
  return texto.length > tamanho ? texto.slice(0, tamanho) + "…" : texto;
}

function formatarDataHora(valor) {
  const d = paraDate(valor);
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

