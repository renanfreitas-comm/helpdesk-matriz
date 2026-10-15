// ==========================================================================
// LÓGICA DA TELA DE SUPERVISÃO (somente admin)
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, listarUsuarios, paraDate } from "./db.js";
import { situacaoPrazo } from "./sla.js";
import { desenharIndicadores } from "./indicadores.js";
import { somarDias } from "./tarefas-util.js";

let usuarios = [];
let relatorios = [];
let chamados = [];       // todos (indicadores); a aba de relatórios usa só os resolvidos
let tarefas = [];
let conclusoes = [];
let abaAtual = "indicadores";
let pararConclusoes = null;

const ROTULOS_STATUS_ATIVIDADE = { concluido: "Concluído", andamento: "Em andamento", pendente: "Pendente" };
const CLASSES_STATUS_ATIVIDADE = { concluido: "badge-status-resolvido", andamento: "badge-status-andamento", pendente: "badge-status-aberto" };

protegerPagina(async (user, perfil) => {
  montarNav(perfil, user);

  usuarios = await listarUsuarios();
  popularSelectTecnicos();
  aplicarPeriodo("mes");

  observar("relatorios", (q) => q, (linhas) => { relatorios = linhas; renderizarTudo(); });
  observar("chamados", (q) => q, (linhas) => { chamados = linhas; renderizarTudo(); });
  observar("tarefas", (q) => q, (linhas) => { tarefas = linhas; renderizarTudo(); });
  observarConclusoes();

  document.getElementById("filtro-tecnico").addEventListener("change", renderizarTudo);
  ["filtro-data-inicio", "filtro-data-fim"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
    document.querySelectorAll("#atalhos-periodo .chip").forEach((c) => c.classList.remove("on"));
    observarConclusoes();
    renderizarTudo();
  }));
  document.querySelectorAll("#atalhos-periodo .chip").forEach((c) => c.addEventListener("click", () => {
    aplicarPeriodo(c.dataset.periodo);
    observarConclusoes();
    renderizarTudo();
  }));
  document.querySelectorAll("#abas-supervisao .aba-rapida").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
  document.getElementById("btn-exportar-pdf").addEventListener("click", () => window.print());
  if (window.location.hash === "#relatorios") trocarAba("relatorios");
}, { apenasAdmin: true });

function trocarAba(aba) {
  abaAtual = aba;
  document.querySelectorAll("#abas-supervisao .aba-rapida").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === aba));
  document.getElementById("aba-indicadores").hidden = aba !== "indicadores";
  document.getElementById("aba-relatorios").hidden = aba !== "relatorios";
  renderizarTudo();
}

// Conclusões de tarefas: período escolhido + o anterior (para comparar).
function observarConclusoes() {
  if (pararConclusoes) pararConclusoes();
  const ini = document.getElementById("filtro-data-inicio").value;
  const fim = document.getElementById("filtro-data-fim").value;
  if (!ini || !fim) return;
  const tamanho = Math.round((new Date(fim) - new Date(ini)) / 864e5) + 1;
  pararConclusoes = observar("tarefa_conclusoes", (q) => q.gte("data", somarDias(ini, -tamanho)).lte("data", fim),
    (linhas) => { conclusoes = linhas; renderizarTudo(); });
}

function aplicarPeriodo(tipo) {
  const hoje = new Date();
  let ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim = hoje;
  if (tipo === "semana") { ini = new Date(hoje); ini.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7)); }
  if (tipo === "mes-passado") { ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); }
  if (tipo === "30") { ini = new Date(hoje); ini.setDate(hoje.getDate() - 29); }
  document.getElementById("filtro-data-inicio").value = paraISO(ini);
  document.getElementById("filtro-data-fim").value = paraISO(fim);
  document.querySelectorAll("#atalhos-periodo .chip").forEach((c) => c.classList.toggle("on", c.dataset.periodo === tipo));
}

function popularSelectTecnicos() {
  const select = document.getElementById("filtro-tecnico");
  select.innerHTML = '<option value="">Todos os técnicos</option>' +
    usuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
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

  const sel = document.getElementById("filtro-tecnico");
  document.getElementById("subtitulo-periodo").textContent =
    `${sel.value ? sel.options[sel.selectedIndex].text : "Todo o time"} · ${formatarData(dataInicio)} a ${formatarData(dataFim)} · comparado com o período anterior de mesmo tamanho.`;

  if (abaAtual === "indicadores") {
    if (!dataInicio || !dataFim || dataFim < dataInicio) {
      document.getElementById("indicadores").innerHTML = `<p class="vazio">Escolha um período válido.</p>`;
      return;
    }
    desenharIndicadores(document.getElementById("indicadores"), {
      chamados, tarefas, conclusoes, usuarios, ini: dataInicio, fim: dataFim, tecnico: tecnicoFiltro
    });
    return;
  }
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
