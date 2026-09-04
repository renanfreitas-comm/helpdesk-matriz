// ==========================================================================
// LÓGICA DA TELA DE SUPERVISÃO (somente admin)
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarios = [];
let relatorios = [];
let chamados = [];

protegerPagina(async (user, perfil) => {
  montarNav(perfil);

  const usuariosSnap = await getDocs(collection(db, "usuarios"));
  usuarios = usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  popularSelectTecnicos();
  definirPeriodoPadrao();

  onSnapshot(collection(db, "relatorios"), (snap) => {
    relatorios = snap.docs.map((d) => d.data());
    renderizarTudo();
  });

  onSnapshot(collection(db, "chamados"), (snap) => {
    chamados = snap.docs.map((d) => d.data());
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
  if (!timestamp || !timestamp.toDate) return null;
  return paraISO(timestamp.toDate());
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
    const dataChamado = timestampParaISO(c.atualizadoEm);
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
    tbody.innerHTML = `<tr><td colspan="3" class="vazio">Nenhum usuário cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = alvo.map((u) => {
    const qtdChamados = chamadosResolvidosFiltrados.filter((c) => c.responsavelUid === u.uid).length;
    const qtdRelatorios = relatoriosFiltrados.filter((r) => r.tecnicoUid === u.uid).length;
    return `
      <tr>
        <td>${escaparHTML(u.nome)}</td>
        <td>${qtdChamados}</td>
        <td>${qtdRelatorios}</td>
      </tr>`;
  }).join("");
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
      <p style="white-space:pre-wrap; margin:0 0 8px;">${escaparHTML(r.resumo)}</p>
      ${
        r.chamadosTitulos && r.chamadosTitulos.length > 0
          ? `<p class="texto-suave" style="margin:0;">Chamados atendidos: ${r.chamadosTitulos.map(escaparHTML).join(", ")}</p>`
          : ""
      }
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
