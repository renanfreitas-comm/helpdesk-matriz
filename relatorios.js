// ==========================================================================
// LÓGICA DA TELA DE RELATÓRIOS DIÁRIOS DE ATIVIDADES
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaRelatorios = [];   // cache local: só os próprios (técnico) ou de todo o time (admin)
let listaUsuarios = [];     // usado só pelo filtro de técnico, visível apenas para admin

const listaEl = document.getElementById("lista-relatorios");
const modal = document.getElementById("modal-relatorio");
const form = document.getElementById("form-relatorio");
const linhasAtividadesEl = document.getElementById("linhas-atividades");
const selectFiltroTecnico = document.getElementById("filtro-tecnico-relatorio");

export const ROTULOS_STATUS_ATIVIDADE = { concluido: "Concluído", andamento: "Em andamento", pendente: "Pendente" };
const CLASSES_STATUS_ATIVIDADE = { concluido: "badge-status-resolvido", andamento: "badge-status-andamento", pendente: "badge-status-aberto" };

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);

  const ehAdmin = perfil.papel === "admin";
  document.getElementById("titulo-relatorios").textContent = ehAdmin
    ? "Relatórios diários da equipe"
    : "Meus relatórios diários";
  document.getElementById("subtitulo-relatorios").textContent = ehAdmin
    ? "Como admin, você vê os relatórios de todo o time aqui. Use o filtro por técnico para focar em uma pessoa."
    : "Registre um resumo do que você fez a cada dia. O supervisor acompanha os relatórios de todo o time na página Supervisão.";

  if (ehAdmin) {
    selectFiltroTecnico.style.display = "";
    const snap = await getDocs(collection(db, "usuarios"));
    listaUsuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    selectFiltroTecnico.innerHTML = '<option value="">Todos os técnicos</option>' +
      listaUsuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
    selectFiltroTecnico.addEventListener("change", renderizarLista);
  }

  observarRelatorios();
});

// -------------------- Linhas de atividade (dinâmicas) --------------------
function criarLinhaAtividade(dados = {}) {
  const linha = document.createElement("div");
  linha.className = "linha-atividade";
  linha.innerHTML = `
    <input type="text" class="at-categoria" placeholder="Ex: Suporte, Manutenção" value="${escaparAtributo(dados.categoria)}" />
    <input type="text" class="at-atividade" placeholder="Descreva a atividade" value="${escaparAtributo(dados.atividade)}" />
    <input type="text" class="at-quantidade" placeholder="Ex: 3 ou Financeiro" value="${escaparAtributo(dados.quantidadeArea)}" />
    <select class="at-status">
      <option value="concluido"${dados.status === "concluido" || !dados.status ? " selected" : ""}>Concluído</option>
      <option value="andamento"${dados.status === "andamento" ? " selected" : ""}>Em andamento</option>
      <option value="pendente"${dados.status === "pendente" ? " selected" : ""}>Pendente</option>
    </select>
    <button type="button" class="btn-remover-atividade" title="Remover linha">&times;</button>
  `;
  linha.querySelector(".btn-remover-atividade").addEventListener("click", () => {
    // Sempre deixa pelo menos uma linha no formulário.
    if (linhasAtividadesEl.children.length > 1) {
      linha.remove();
    } else {
      linha.querySelectorAll("input").forEach((i) => i.value = "");
    }
  });
  linhasAtividadesEl.appendChild(linha);
}

document.getElementById("btn-add-atividade").addEventListener("click", () => criarLinhaAtividade());

function coletarAtividades() {
  return Array.from(linhasAtividadesEl.querySelectorAll(".linha-atividade")).map((linha) => ({
    categoria: linha.querySelector(".at-categoria").value.trim(),
    atividade: linha.querySelector(".at-atividade").value.trim(),
    quantidadeArea: linha.querySelector(".at-quantidade").value.trim(),
    status: linha.querySelector(".at-status").value
  })).filter((a) => a.categoria || a.atividade || a.quantidadeArea);
}

// -------------------- Observar relatórios (próprios, ou de todos se admin) --------------------
function observarRelatorios() {
  // Admin vê a coleção inteira (ordenada por data); técnico vê só os seus
  // próprios (filtrados por tecnicoUid + ordenados por data — essa combinação
  // exige um índice composto, veja o README).
  const q = perfilAtual.papel === "admin"
    ? query(collection(db, "relatorios"), orderBy("data", "desc"))
    : query(
        collection(db, "relatorios"),
        where("tecnicoUid", "==", usuarioAtual.uid),
        orderBy("data", "desc")
      );

  onSnapshot(q, (snap) => {
    listaRelatorios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarLista();
  }, (erro) => {
    listaEl.innerHTML = `<p class="vazio">Erro ao carregar relatórios: ${erro.message}</p>`;
  });
}

function renderizarTabelaAtividades(atividades) {
  if (!atividades || atividades.length === 0) return "";
  return `
    <div class="tabela-atividades" style="margin-top:8px;">
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

function renderizarLista() {
  const ehAdmin = perfilAtual.papel === "admin";
  const filtroData = document.getElementById("filtro-data").value;
  const filtroTecnico = ehAdmin ? selectFiltroTecnico.value : "";

  const filtrados = listaRelatorios.filter((r) => {
    if (filtroData && r.data !== filtroData) return false;
    if (filtroTecnico && r.tecnicoUid !== filtroTecnico) return false;
    return true;
  });

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<p class="vazio">Nenhum relatório encontrado.</p>';
    return;
  }

  listaEl.innerHTML = filtrados.map((r) => `
    <div class="painel">
      <div class="topo-pagina" style="margin-bottom:10px;">
        <strong>${formatarData(r.data)}</strong>${ehAdmin ? ` <span class="texto-suave">— ${escaparHTML(r.tecnicoNome)}</span>` : ""}
        <div class="acoes-tabela">
          <button class="botao-secundario btn-editar-relatorio" data-id="${r.id}">Editar</button>
          <button class="botao-perigo btn-excluir-relatorio" data-id="${r.id}">Excluir</button>
        </div>
      </div>
      ${renderizarTabelaAtividades(r.atividades)}
      ${r.resumo ? `<p style="white-space:pre-wrap; margin:12px 0 0;">${escaparHTML(r.resumo)}</p>` : ""}
    </div>
  `).join("");

  document.querySelectorAll(".btn-editar-relatorio").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-relatorio").forEach((b) =>
    b.addEventListener("click", () => excluirRelatorio(b.dataset.id)));
}

document.getElementById("filtro-data").addEventListener("change", renderizarLista);
document.getElementById("btn-limpar-filtro").addEventListener("click", () => {
  document.getElementById("filtro-data").value = "";
  renderizarLista();
});

// -------------------- Modal --------------------
let modoAtual = "criar";

document.getElementById("btn-novo-relatorio").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-relatorio").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, relatorioId = null) {
  modoAtual = modo;
  document.getElementById("relatorio-erro").textContent = "";
  form.reset();
  document.getElementById("relatorio-id").value = relatorioId || "";
  linhasAtividadesEl.innerHTML = "";

  if (modo === "criar") {
    document.getElementById("modal-relatorio-titulo").textContent = "Novo relatório do dia";
    document.getElementById("relatorio-data").value = hojeISO();
    criarLinhaAtividade();
  } else {
    const r = listaRelatorios.find((x) => x.id === relatorioId);
    document.getElementById("modal-relatorio-titulo").textContent = "Editar relatório";
    document.getElementById("relatorio-data").value = r.data;
    document.getElementById("relatorio-resumo").value = r.resumo || "";
    if (r.atividades && r.atividades.length > 0) {
      r.atividades.forEach((a) => criarLinhaAtividade(a));
    } else {
      criarLinhaAtividade();
    }
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("relatorio-erro");
  erroEl.textContent = "";

  const id = document.getElementById("relatorio-id").value;
  const data = document.getElementById("relatorio-data").value;
  const resumo = document.getElementById("relatorio-resumo").value.trim();
  const atividades = coletarAtividades();

  if (atividades.length === 0) {
    erroEl.textContent = "Adicione ao menos uma atividade com categoria ou descrição preenchida.";
    return;
  }

  const botao = document.getElementById("btn-salvar-relatorio");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      await addDoc(collection(db, "relatorios"), {
        tecnicoUid: usuarioAtual.uid,
        tecnicoNome: perfilAtual.nome,
        data,
        atividades,
        resumo,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
    } else {
      await updateDoc(doc(db, "relatorios", id), {
        data,
        atividades,
        resumo,
        atualizadoEm: serverTimestamp()
      });
    }
    fecharModal();
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirRelatorio(id) {
  if (!confirm("Excluir este relatório?")) return;
  try {
    await deleteDoc(doc(db, "relatorios", id));
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

// -------------------- Utilitários --------------------
function hojeISO() {
  const hoje = new Date();
  const offset = hoje.getTimezoneOffset();
  const local = new Date(hoje.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

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

function escaparAtributo(texto) {
  return (texto ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
