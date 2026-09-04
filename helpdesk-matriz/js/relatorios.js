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
let meusChamados = [];     // chamados onde o usuário é responsável (para o checklist)
let meusRelatorios = [];   // cache local dos relatórios do próprio usuário

const listaEl = document.getElementById("lista-relatorios");
const modal = document.getElementById("modal-relatorio");
const form = document.getElementById("form-relatorio");

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  carregarMeusChamados();
  observarRelatorios();
});

// -------------------- Chamados do próprio técnico (para vincular) --------------------
async function carregarMeusChamados() {
  const q = query(collection(db, "chamados"), where("responsavelUid", "==", usuarioAtual.uid));
  const snap = await getDocs(q);
  meusChamados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderizarChecklistChamados(idsMarcados = []) {
  const container = document.getElementById("lista-chamados-checkbox");
  if (meusChamados.length === 0) {
    container.innerHTML = '<p class="texto-suave">Você ainda não é responsável por nenhum chamado.</p>';
    return;
  }
  container.innerHTML = meusChamados.map((c) => `
    <label style="display:flex; align-items:center; gap:8px; padding:6px 0; font-size:14px; font-weight:normal;">
      <input type="checkbox" value="${c.id}" data-titulo="${escaparAtributo(c.titulo)}" ${idsMarcados.includes(c.id) ? "checked" : ""} style="width:auto;" />
      ${escaparHTML(c.titulo)}
    </label>
  `).join("");
}

// -------------------- Observar relatórios do próprio usuário --------------------
function observarRelatorios() {
  const q = query(
    collection(db, "relatorios"),
    where("tecnicoUid", "==", usuarioAtual.uid),
    orderBy("data", "desc")
  );
  onSnapshot(q, (snap) => {
    meusRelatorios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarLista();
  }, (erro) => {
    listaEl.innerHTML = `<p class="vazio">Erro ao carregar relatórios: ${erro.message}</p>`;
  });
}

function renderizarLista() {
  const filtroData = document.getElementById("filtro-data").value;
  const filtrados = filtroData ? meusRelatorios.filter((r) => r.data === filtroData) : meusRelatorios;

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<p class="vazio">Nenhum relatório encontrado.</p>';
    return;
  }

  listaEl.innerHTML = filtrados.map((r) => `
    <div class="painel">
      <div class="topo-pagina" style="margin-bottom:10px;">
        <strong>${formatarData(r.data)}</strong>
        <div class="acoes-tabela">
          <button class="botao-secundario btn-editar-relatorio" data-id="${r.id}">Editar</button>
          <button class="botao-perigo btn-excluir-relatorio" data-id="${r.id}">Excluir</button>
        </div>
      </div>
      <p style="white-space:pre-wrap; margin:0 0 10px;">${escaparHTML(r.resumo)}</p>
      ${
        r.chamadosTitulos && r.chamadosTitulos.length > 0
          ? `<p class="texto-suave" style="margin:0;">Chamados atendidos: ${r.chamadosTitulos.map(escaparHTML).join(", ")}</p>`
          : ""
      }
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

  if (modo === "criar") {
    document.getElementById("modal-relatorio-titulo").textContent = "Novo relatório do dia";
    document.getElementById("relatorio-data").value = hojeISO();
    renderizarChecklistChamados([]);
  } else {
    const r = meusRelatorios.find((x) => x.id === relatorioId);
    document.getElementById("modal-relatorio-titulo").textContent = "Editar relatório";
    document.getElementById("relatorio-data").value = r.data;
    document.getElementById("relatorio-resumo").value = r.resumo;
    renderizarChecklistChamados(r.chamadosIds || []);
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

  const checkboxesMarcados = Array.from(
    document.querySelectorAll('#lista-chamados-checkbox input[type="checkbox"]:checked')
  );
  const chamadosIds = checkboxesMarcados.map((c) => c.value);
  const chamadosTitulos = checkboxesMarcados.map((c) => c.dataset.titulo);

  const botao = document.getElementById("btn-salvar-relatorio");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      await addDoc(collection(db, "relatorios"), {
        tecnicoUid: usuarioAtual.uid,
        tecnicoNome: perfilAtual.nome,
        data,
        resumo,
        chamadosIds,
        chamadosTitulos,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
    } else {
      await updateDoc(doc(db, "relatorios", id), {
        data,
        resumo,
        chamadosIds,
        chamadosTitulos,
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
