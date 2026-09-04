// ==========================================================================
// LÓGICA DA TELA DE VISITAS TÉCNICAS
// ==========================================================================
// Qualquer pessoa logada pode registrar uma visita. Só o próprio autor ou
// um admin pode editar; só admin pode excluir.
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
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaVisitas = [];

const tabelaBody = document.getElementById("tabela-visitas");
const modal = document.getElementById("modal-visita");
const form = document.getElementById("form-visita");

const ROTULOS_TIPO = {
  instalacao: "Instalação",
  manutencao: "Manutenção",
  suporte: "Suporte técnico",
  vistoria: "Vistoria/Inspeção",
  outro: "Outro"
};
const ROTULOS_STATUS = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };
const CLASSES_STATUS = { agendada: "badge-status-andamento", realizada: "badge-status-resolvido", cancelada: "badge-status-aberto" };

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  observarVisitas();
});

function observarVisitas() {
  const q = query(collection(db, "visitas"), orderBy("data", "desc"));
  onSnapshot(q, (snap) => {
    listaVisitas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="10" class="vazio">Erro ao carregar visitas: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const busca = document.getElementById("filtro-busca-visita").value.trim().toLowerCase();
  const fStatus = document.getElementById("filtro-status-visita").value;
  const fEmpresa = document.getElementById("filtro-empresa-visita").value;

  const filtradas = listaVisitas.filter((v) => {
    if (fStatus && v.status !== fStatus) return false;
    if (fEmpresa && v.empresaResponsavel !== fEmpresa) return false;
    if (busca) {
      const alvo = `${v.cidade || ""} ${v.area || ""} ${v.recursoResponsavel || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  if (filtradas.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="10" class="vazio">Nenhuma visita encontrada.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtradas.map((v) => {
    const podeEditar = perfilAtual.papel === "admin" || v.criadoPorUid === usuarioAtual.uid;
    const podeExcluir = perfilAtual.papel === "admin";

    let acoes = "";
    if (podeEditar) acoes += `<button class="botao-secundario btn-editar-visita" data-id="${v.id}">Editar</button>`;
    if (podeExcluir) acoes += `<button class="botao-perigo btn-excluir-visita" data-id="${v.id}">Excluir</button>`;
    if (!podeEditar && !podeExcluir) acoes = '<span class="texto-suave">—</span>';

    return `
      <tr>
        <td>${escaparHTML(v.numero || "—")}</td>
        <td><strong>${escaparHTML(v.titulo)}</strong></td>
        <td>${escaparHTML(v.recursoResponsavel)}</td>
        <td>${escaparHTML(v.cidade || "—")}</td>
        <td>${formatarData(v.data)}</td>
        <td>${escaparHTML(v.area || "—")}</td>
        <td>${ROTULOS_TIPO[v.tipoAtendimento] || v.tipoAtendimento || "—"}</td>
        <td><span class="badge ${CLASSES_STATUS[v.status] || ""}">${ROTULOS_STATUS[v.status] || v.status || "—"}</span></td>
        <td>${escaparHTML(v.empresaResponsavel || "—")}</td>
        <td><div class="acoes-tabela">${acoes}</div></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".btn-editar-visita").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-visita").forEach((b) =>
    b.addEventListener("click", () => excluirVisita(b.dataset.id)));
}

["filtro-status-visita", "filtro-empresa-visita"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderizarTabela);
});
document.getElementById("filtro-busca-visita").addEventListener("input", renderizarTabela);

// -------------------- Modal --------------------
let modoAtual = "criar";
let visitaIdAtual = null;

document.getElementById("btn-nova-visita").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-visita").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, visitaId = null) {
  modoAtual = modo;
  visitaIdAtual = visitaId;
  document.getElementById("visita-erro").textContent = "";
  form.reset();
  document.getElementById("visita-id").value = visitaId || "";

  if (modo === "criar") {
    document.getElementById("modal-visita-titulo").textContent = "Nova visita";
    document.getElementById("visita-data").value = hojeISO();
    document.getElementById("visita-status").value = "agendada";
    document.getElementById("visita-empresa").value = "Equipe Interna";
  } else {
    const v = listaVisitas.find((x) => x.id === visitaId);
    document.getElementById("modal-visita-titulo").textContent = "Editar visita";
    document.getElementById("visita-numero").value = v.numero || "";
    document.getElementById("visita-titulo").value = v.titulo || "";
    document.getElementById("visita-recurso").value = v.recursoResponsavel || "";
    document.getElementById("visita-cidade").value = v.cidade || "";
    document.getElementById("visita-data").value = v.data || "";
    document.getElementById("visita-area").value = v.area || "";
    document.getElementById("visita-tipo").value = v.tipoAtendimento || "instalacao";
    document.getElementById("visita-status").value = v.status || "agendada";
    document.getElementById("visita-empresa").value = v.empresaResponsavel || "Equipe Interna";
    document.getElementById("visita-observacoes").value = v.observacoes || "";
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("visita-erro");
  erroEl.textContent = "";

  const dados = {
    numero: document.getElementById("visita-numero").value.trim(),
    titulo: document.getElementById("visita-titulo").value.trim(),
    recursoResponsavel: document.getElementById("visita-recurso").value.trim(),
    cidade: document.getElementById("visita-cidade").value.trim(),
    data: document.getElementById("visita-data").value,
    area: document.getElementById("visita-area").value.trim(),
    tipoAtendimento: document.getElementById("visita-tipo").value,
    status: document.getElementById("visita-status").value,
    empresaResponsavel: document.getElementById("visita-empresa").value,
    observacoes: document.getElementById("visita-observacoes").value.trim(),
    atualizadoEm: serverTimestamp()
  };

  const botao = document.getElementById("btn-salvar-visita");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      await addDoc(collection(db, "visitas"), {
        ...dados,
        criadoPorUid: usuarioAtual.uid,
        criadoPorNome: perfilAtual.nome,
        criadoEm: serverTimestamp()
      });
    } else {
      await updateDoc(doc(db, "visitas", visitaIdAtual), dados);
    }
    fecharModal();
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirVisita(id) {
  if (!confirm("Excluir esta visita? Essa ação não pode ser desfeita.")) return;
  try {
    await deleteDoc(doc(db, "visitas", id));
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
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
