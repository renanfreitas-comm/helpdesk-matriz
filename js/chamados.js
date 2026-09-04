// ==========================================================================
// LÓGICA DA TELA DE CHAMADOS (listar, criar, editar, atribuir, excluir)
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
  serverTimestamp,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaUsuarios = [];   // { uid, nome, papel }
let listaChamados = [];   // cache local para reaplicar filtros sem nova leitura

const tabelaBody = document.getElementById("tabela-chamados");
const modal = document.getElementById("modal-chamado");
const form = document.getElementById("form-chamado");
const linhaAdmin = document.getElementById("linha-admin-chamado");
const selectResponsavel = document.getElementById("chamado-responsavel");
const selectFiltroResponsavel = document.getElementById("filtro-responsavel");

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento", resolvido: "Resolvido" };

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  carregarUsuarios().then(() => {
    observarChamados();
  });
});

// -------------------- Carregar usuários (para selects de responsável) --------------------
async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  listaUsuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  const opcoesResponsavel = listaUsuarios
    .map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`)
    .join("");

  selectResponsavel.innerHTML = `<option value="">Sem responsável</option>${opcoesResponsavel}`;
  selectFiltroResponsavel.innerHTML = `<option value="">Todos os responsáveis</option>${opcoesResponsavel}`;
}

function nomeUsuario(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  return u ? u.nome : "—";
}

// -------------------- Observar chamados em tempo real --------------------
function observarChamados() {
  const q = query(collection(db, "chamados"), orderBy("criadoEm", "desc"));
  onSnapshot(q, (snap) => {
    listaChamados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="6" class="vazio">Erro ao carregar chamados: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const fStatus = document.getElementById("filtro-status").value;
  const fPrioridade = document.getElementById("filtro-prioridade").value;
  const fResponsavel = document.getElementById("filtro-responsavel").value;

  const filtrados = listaChamados.filter((c) => {
    if (fStatus && c.status !== fStatus) return false;
    if (fPrioridade && c.prioridade !== fPrioridade) return false;
    if (fResponsavel && c.responsavelUid !== fResponsavel) return false;
    return true;
  });

  if (filtrados.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum chamado encontrado.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtrados.map((c) => {
    const ehResponsavel = c.responsavelUid === usuarioAtual.uid;
    const ehAdmin = perfilAtual.papel === "admin";

    let acoes = "";
    if (ehAdmin) {
      acoes = `
        <button class="botao-secundario btn-editar" data-id="${c.id}">Editar</button>
        <button class="botao-perigo btn-excluir" data-id="${c.id}">Excluir</button>`;
    } else if (ehResponsavel) {
      acoes = `<button class="botao-secundario btn-status" data-id="${c.id}">Atualizar status</button>`;
    } else {
      acoes = `<span class="texto-suave">—</span>`;
    }

    return `
      <tr>
        <td><strong>${escaparHTML(c.numero)}</strong><br><span class="texto-suave">${escaparHTML(truncar(c.atividade, 60))}</span></td>
        <td>${escaparHTML(c.area)}</td>
        <td><span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade]}</span></td>
        <td><span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status]}</span></td>
        <td>${c.responsavelNome ? escaparHTML(c.responsavelNome) : '<span class="texto-suave">Não atribuído</span>'}</td>
        <td><div class="acoes-tabela">${acoes}</div></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".btn-editar").forEach((b) => b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-status").forEach((b) => b.addEventListener("click", () => abrirModal("status", b.dataset.id)));
  document.querySelectorAll(".btn-excluir").forEach((b) => b.addEventListener("click", () => excluirChamado(b.dataset.id)));
}

["filtro-status", "filtro-prioridade", "filtro-responsavel"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderizarTabela);
});

// -------------------- Modal: criar / editar / atualizar status --------------------
let modoAtual = "criar"; // "criar" | "editar" | "status"

document.getElementById("btn-novo-chamado").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-chamado").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, chamadoId = null) {
  modoAtual = modo;
  document.getElementById("chamado-erro").textContent = "";
  form.reset();
  document.getElementById("chamado-id").value = chamadoId || "";

  const camposBasicos = ["chamado-numero", "chamado-area", "chamado-atividade", "chamado-prioridade"];

  if (modo === "criar") {
    document.getElementById("modal-titulo").textContent = "Novo chamado";
    linhaAdmin.style.display = perfilAtual.papel === "admin" ? "grid" : "none";
    camposBasicos.forEach((id) => document.getElementById(id).disabled = false);
    document.getElementById("chamado-status").disabled = false;
    selectResponsavel.disabled = false;
  }

  if (modo === "editar") {
    const c = listaChamados.find((x) => x.id === chamadoId);
    document.getElementById("modal-titulo").textContent = "Editar chamado";
    document.getElementById("chamado-numero").value = c.numero;
    document.getElementById("chamado-area").value = c.area;
    document.getElementById("chamado-atividade").value = c.atividade;
    document.getElementById("chamado-prioridade").value = c.prioridade;
    document.getElementById("chamado-status").value = c.status;
    selectResponsavel.value = c.responsavelUid || "";
    linhaAdmin.style.display = "grid";
    camposBasicos.forEach((id) => document.getElementById(id).disabled = false);
    document.getElementById("chamado-status").disabled = false;
    selectResponsavel.disabled = false;
  }

  if (modo === "status") {
    const c = listaChamados.find((x) => x.id === chamadoId);
    document.getElementById("modal-titulo").textContent = "Atualizar status do chamado";
    document.getElementById("chamado-numero").value = c.numero;
    document.getElementById("chamado-area").value = c.area;
    document.getElementById("chamado-atividade").value = c.atividade;
    document.getElementById("chamado-prioridade").value = c.prioridade;
    document.getElementById("chamado-status").value = c.status;
    selectResponsavel.value = c.responsavelUid || "";

    // Técnico só pode alterar o status; demais campos ficam bloqueados.
    camposBasicos.forEach((id) => document.getElementById(id).disabled = true);
    selectResponsavel.disabled = true;
    linhaAdmin.style.display = "grid";
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("chamado-erro");
  erroEl.textContent = "";

  const id = document.getElementById("chamado-id").value;
  const numero = document.getElementById("chamado-numero").value.trim();
  const area = document.getElementById("chamado-area").value.trim();
  const atividade = document.getElementById("chamado-atividade").value.trim();
  const prioridade = document.getElementById("chamado-prioridade").value;
  const responsavelUid = selectResponsavel.value || null;
  const status = document.getElementById("chamado-status").value || "aberto";

  const botao = document.getElementById("btn-salvar-chamado");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      await addDoc(collection(db, "chamados"), {
        numero,
        area,
        atividade,
        prioridade,
        status: perfilAtual.papel === "admin" ? status : "aberto",
        responsavelUid: perfilAtual.papel === "admin" ? responsavelUid : null,
        responsavelNome: perfilAtual.papel === "admin" && responsavelUid ? nomeUsuario(responsavelUid) : null,
        criadoPorUid: usuarioAtual.uid,
        criadoPorNome: perfilAtual.nome,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
    } else if (modoAtual === "editar") {
      await updateDoc(doc(db, "chamados", id), {
        numero,
        area,
        atividade,
        prioridade,
        status,
        responsavelUid,
        responsavelNome: responsavelUid ? nomeUsuario(responsavelUid) : null,
        atualizadoEm: serverTimestamp()
      });
    } else if (modoAtual === "status") {
      await updateDoc(doc(db, "chamados", id), {
        status,
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

async function excluirChamado(id) {
  if (!confirm("Tem certeza que deseja excluir este chamado? Essa ação não pode ser desfeita.")) return;
  try {
    await deleteDoc(doc(db, "chamados", id));
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

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
