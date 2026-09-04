// ==========================================================================
// LÓGICA DA TELA DE CONFIGURAÇÃO DE MÁQUINAS
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

let perfilAtual = null;
let usuarioAtual = null;
let listaMaquinas = [];
let pararObservacaoHistorico = null; // função para cancelar o listener do histórico ao trocar de máquina/fechar modal

const tabelaBody = document.getElementById("tabela-maquinas");
const modal = document.getElementById("modal-maquina");
const form = document.getElementById("form-maquina");
const blocoHistorico = document.getElementById("bloco-historico");

const ROTULOS_STATUS = { ativa: "Ativa", manutencao: "Em manutenção", baixada: "Baixada" };
const CLASSES_STATUS = { ativa: "badge-status-resolvido", manutencao: "badge-status-andamento", baixada: "badge-status-aberto" };

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  observarMaquinas();
});

function observarMaquinas() {
  const q = query(collection(db, "maquinas"), orderBy("nome"));
  onSnapshot(q, (snap) => {
    listaMaquinas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="6" class="vazio">Erro ao carregar máquinas: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const fStatus = document.getElementById("filtro-status-maquina").value;
  const busca = document.getElementById("filtro-busca-maquina").value.trim().toLowerCase();

  const filtradas = listaMaquinas.filter((m) => {
    if (fStatus && m.status !== fStatus) return false;
    if (busca) {
      const alvo = `${m.nome || ""} ${m.setor || ""} ${m.responsavelUso || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  if (filtradas.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="6" class="vazio">Nenhuma máquina encontrada.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtradas.map((m) => `
    <tr>
      <td><strong>${escaparHTML(m.nome)}</strong></td>
      <td>${escaparHTML(m.setor || "—")}</td>
      <td>${escaparHTML(m.responsavelUso || "—")}</td>
      <td>${escaparHTML(m.so || "—")}</td>
      <td><span class="badge ${CLASSES_STATUS[m.status] || ""}">${ROTULOS_STATUS[m.status] || m.status}</span></td>
      <td>
        <div class="acoes-tabela">
          <button class="botao-secundario btn-detalhes-maquina" data-id="${m.id}">Detalhes</button>
          ${perfilAtual.papel === "admin" ? `<button class="botao-perigo btn-excluir-maquina" data-id="${m.id}">Excluir</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".btn-detalhes-maquina").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-maquina").forEach((b) =>
    b.addEventListener("click", () => excluirMaquina(b.dataset.id)));
}

["filtro-status-maquina"].forEach((id) => document.getElementById(id).addEventListener("change", renderizarTabela));
document.getElementById("filtro-busca-maquina").addEventListener("input", renderizarTabela);

// -------------------- Modal --------------------
let modoAtual = "criar";
let maquinaIdAtual = null;

document.getElementById("btn-nova-maquina").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-maquina").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

const CAMPOS = ["nome", "setor", "responsavel", "status", "so", "ip", "processador", "memoria", "armazenamento", "observacoes"];

function abrirModal(modo, maquinaId = null) {
  modoAtual = modo;
  maquinaIdAtual = maquinaId;
  document.getElementById("maquina-erro").textContent = "";
  form.reset();
  document.getElementById("maquina-id").value = maquinaId || "";

  if (modo === "criar") {
    document.getElementById("modal-maquina-titulo").textContent = "Nova máquina";
    blocoHistorico.style.display = "none";
  } else {
    const m = listaMaquinas.find((x) => x.id === maquinaId);
    document.getElementById("modal-maquina-titulo").textContent = m.nome;
    document.getElementById("maquina-nome").value = m.nome || "";
    document.getElementById("maquina-setor").value = m.setor || "";
    document.getElementById("maquina-responsavel").value = m.responsavelUso || "";
    document.getElementById("maquina-status").value = m.status || "ativa";
    document.getElementById("maquina-so").value = m.so || "";
    document.getElementById("maquina-ip").value = m.ip || "";
    document.getElementById("maquina-processador").value = m.processador || "";
    document.getElementById("maquina-memoria").value = m.memoriaRam || "";
    document.getElementById("maquina-armazenamento").value = m.armazenamento || "";
    document.getElementById("maquina-observacoes").value = m.observacoes || "";

    blocoHistorico.style.display = "block";
    observarHistorico(maquinaId);
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
  if (pararObservacaoHistorico) {
    pararObservacaoHistorico();
    pararObservacaoHistorico = null;
  }
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("maquina-erro");
  erroEl.textContent = "";

  const dados = {
    nome: document.getElementById("maquina-nome").value.trim(),
    setor: document.getElementById("maquina-setor").value.trim(),
    responsavelUso: document.getElementById("maquina-responsavel").value.trim(),
    status: document.getElementById("maquina-status").value,
    so: document.getElementById("maquina-so").value.trim(),
    ip: document.getElementById("maquina-ip").value.trim(),
    processador: document.getElementById("maquina-processador").value.trim(),
    memoriaRam: document.getElementById("maquina-memoria").value.trim(),
    armazenamento: document.getElementById("maquina-armazenamento").value.trim(),
    observacoes: document.getElementById("maquina-observacoes").value.trim(),
    atualizadoEm: serverTimestamp()
  };

  const botao = document.getElementById("btn-salvar-maquina");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      const novo = await addDoc(collection(db, "maquinas"), { ...dados, criadoEm: serverTimestamp() });
      // Passa a editar a máquina recém-criada para permitir já adicionar histórico.
      abrirModal("editar", novo.id);
    } else {
      await updateDoc(doc(db, "maquinas", maquinaIdAtual), dados);
      fecharModal();
    }
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirMaquina(id) {
  if (!confirm("Excluir esta máquina do cadastro? O histórico dela também será perdido da listagem.")) return;
  try {
    await deleteDoc(doc(db, "maquinas", id));
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

// -------------------- Histórico de manutenções --------------------
function observarHistorico(maquinaId) {
  if (pararObservacaoHistorico) pararObservacaoHistorico();

  const q = query(collection(db, "maquinas", maquinaId, "historico"), orderBy("criadoEm", "desc"));
  pararObservacaoHistorico = onSnapshot(q, (snap) => {
    const registros = snap.docs.map((d) => d.data());
    const listaEl = document.getElementById("lista-historico");

    if (registros.length === 0) {
      listaEl.innerHTML = '<p class="texto-suave">Nenhum registro ainda.</p>';
      return;
    }

    listaEl.innerHTML = registros.map((r) => `
      <div style="padding:8px 0; border-bottom:1px solid var(--cor-borda); font-size:14px;">
        <strong>${escaparHTML(r.tecnicoNome)}</strong>
        <span class="texto-suave"> — ${formatarDataHora(r.criadoEm)}</span>
        <p style="margin:4px 0 0;">${escaparHTML(r.descricao)}</p>
      </div>
    `).join("");
  });
}

document.getElementById("btn-add-historico").addEventListener("click", async () => {
  const input = document.getElementById("novo-historico-texto");
  const texto = input.value.trim();
  if (!texto || !maquinaIdAtual) return;

  try {
    await addDoc(collection(db, "maquinas", maquinaIdAtual, "historico"), {
      descricao: texto,
      tecnicoNome: perfilAtual.nome,
      tecnicoUid: usuarioAtual.uid,
      criadoEm: serverTimestamp()
    });
    input.value = "";
  } catch (err) {
    alert("Erro ao adicionar histórico: " + err.message);
  }
});

// -------------------- Utilitários --------------------
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function formatarDataHora(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const d = timestamp.toDate();
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
