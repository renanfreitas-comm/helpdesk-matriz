// ==========================================================================
// LÓGICA DA TELA DE SUPERVISÃO (somente admin)
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, listarUsuarios, paraDate } from "./db.js";
import { situacaoPrazo } from "./sla.js";

let usuarios = [];
let relatorios = [];
let chamados = [];

const ROTULOS_STATUS_ATIVIDADE = { concluido: "Concluído", andamento: "Em andamento", pendente: "Pendente" };
const CLASSES_STATUS_ATIVIDADE = { concluido: "badge-status-resolvido", andamento: "badge-status-andamento", pendente: "badge-status-aberto" };

protegerPagina(async (user, perfil) => {
  montarNav(perfil);

  usuarios = await listarUsuarios();
  popularSelectTecnicos();
  definirPeriodoPadrao();

  observar("relatorios", (q) => q, (linhas) => {
    relatorios = linhas;
    renderizarTudo();
  });

  observar("chamados", (q) => q.eq("status", "resolvido"), (linhas) => {
    chamados = linhas;
    renderizarTudo();
  });

  ["filtro-tecnico", "filtro-data-inicio", "filtro-data-fim"].forEach((id) => {
    document.getElementById(id).addEventListener("change", renderizarTudo);
  });
}, { apenasAdmin: true });

function popularSelectTecnicos() {
  const select = document.getElementById("filtro-tecnico");
  select.innerHTML = '<option value="">Todos os técnicos</option>' +
    usuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
}

function definirPeriodoPadrao() {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  document.getElementById("filtro-data-inicio").value = paraISO(inicioMes);
  document.getElementById("filtro-data-fim").value = paraISO(hoje);
}

function paraISO(data) {
  const offset = data.getTimezoneOffset();
  const local = new Date(data.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function timestampParaISO(timestamp) {
  const d = paraDate(timestamp);
  return d ? paraISO(d) : null;
}

function renderizarTudo() {
  const tecnicoFiltro = document.getElementById("filtro-tecnico").value;
  const dataInicio = document.getElementById("filtro-data-inicio").value;
  const dataFim = document.getElementById("filtro-data-fim").value;

  const relatoriosFiltrados = relatorios.filter((r) => {
    if (tecnicoFiltro && r.tecnicoUid !== tecnicoFiltro) return false;
    if (dataInicio && r.data < dataInicio) return false;
    if (dataFim && r.data > dataFim) return false;
    return true;
  });

  const chamadosResolvidosFiltrados = chamados.filter((c) => {
    if (c.status !== "resolvido") return false;
    if (tecnicoFiltro && c.responsavelUid !== tecnicoFiltro) return false;
    // Usa a data real de resolução; chamados antigos (sem resolvidoEm) caem
    // na data da última atualização, como antes.
    const dataChamado = timestampParaISO(c.resolvidoEm || c.atualizadoEm);
    if (dataInicio && (!dataChamado || dataChamado < dataInicio)) return false;
    if (dataFim && (!dataChamado || dataChamado > dataFim)) return false;
    return true;
  });

  renderizarProdutividade(relatoriosFiltrados, chamadosResolvidosFiltrados, tecnicoFiltro);
  renderizarListaRelatorios(relatoriosFiltrados);
}

function renderizarProdutividade(relatoriosFiltrados, chamadosResolvidosFiltrados, tecnicoFiltro) {
  const tbody = document.getElementById("tabela-produtividade");
  const alvo = tecnicoFiltro ? usuarios.filter((u) => u.uid === tecnicoFiltro) : usuarios;

  if (alvo.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum usuário cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = alvo.map((u) => {
    const resolvidosDele = chamadosResolvidosFiltrados.filter((c) => c.responsavelUid === u.uid);
    const qtdChamados = resolvidosDele.length;
    const noPrazo = qtdChamados
      ? Math.round(100 * resolvidosDele.filter((c) => situacaoPrazo(c).estado === "cumprido").length / qtdChamados) + "%"
      : "—";
    const qtdRelatorios = relatoriosFiltrados.filter((r) => r.tecnicoUid === u.uid).length;
    return `
      <tr>
        <td>${escaparHTML(u.nome)}</td>
        <td>${qtdChamados}</td>
        <td>${noPrazo}</td>
        <td>${qtdRelatorios}</td>
      </tr>`;
  }).join("");
}

function renderizarTabelaAtividades(atividades) {
  if (!atividades || atividades.length === 0) return "";
  return `
    <div class="tabela-atividades" style="margin-top:4px;">
      <div class="linha-atividade-cabecalho">
        <span>Categoria</span>
        <span>Atividade</span>
        <span>Quantidade / Área</span>
        <span>Status</span>
        <span></span>
      </div>
      ${atividades.map((a) => `
        <div class="linha-atividade linha-atividade-leitura">
          <span>${escaparHTML(a.categoria) || "—"}</span>
          <span>${escaparHTML(a.atividade) || "—"}</span>
          <span>${escaparHTML(a.quantidadeArea) || "—"}</span>
          <span><span class="badge ${CLASSES_STATUS_ATIVIDADE[a.status] || ""}">${ROTULOS_STATUS_ATIVIDADE[a.status] || a.status || "—"}</span></span>
          <span></span>
        </div>
      `).join("")}
    </div>`;
}

function renderizarListaRelatorios(relatoriosFiltrados) {
  const container = document.getElementById("lista-relatorios-supervisao");

  if (relatoriosFiltrados.length === 0) {
    container.innerHTML = '<p class="vazio">Nenhum relatório no período selecionado.</p>';
    return;
  }

  const ordenados = [...relatoriosFiltrados].sort((a, b) => (a.data < b.data ? 1 : -1));

  container.innerHTML = ordenados.map((r) => `
    <div class="painel" style="box-shadow:none; border:1px solid var(--cor-borda);">
      <div class="topo-pagina" style="margin-bottom:10px;">
        <strong>${escaparHTML(r.tecnicoNome)}</strong>
        <span class="texto-suave">${formatarData(r.data)}</span>
      </div>
      ${renderizarTabelaAtividades(r.atividades)}
      ${r.resumo ? `<p style="white-space:pre-wrap; margin:12px 0 0;">${escaparHTML(r.resumo)}</p>` : ""}
    </div>
  `).join("");
}

// -------------------- Utilitários --------------------
function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
