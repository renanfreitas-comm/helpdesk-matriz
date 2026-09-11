// ==========================================================================
// LÓGICA DA TELA DE CONFIGURAÇÃO DE MÁQUINAS
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { exportarCSV, nomeArquivoComData } from "./csv-utils.js";
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

const ROTULOS_STATUS = { ativa: "Configuração", manutencao: "Manutenção", baixada: "Estoque", entregue: "Entregue"  };
const CLASSES_STATUS = { ativa: "badge-status-andamento", manutencao: "badge-status-andamento", baixada: "badge-status-andamento" };

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

function obterListaFiltrada() {
  const fStatus = document.getElementById("filtro-status-maquina").value;
  const busca = document.getElementById("filtro-busca-maquina").value.trim().toLowerCase();

  return listaMaquinas.filter((m) => {
    if (fStatus && m.status !== fStatus) return false;
    if (busca) {
      const alvo = `${m.nome || ""} ${m.setor || ""} ${m.responsavelUso || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderizarTabela() {
  const filtradas = obterListaFiltrada();

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
      <td>${escaparHTML(m.ip || "—")}</td>
      <td>${escaparHTML(m.processador || "—")}</td>
      <td>${escaparHTML(m.memoriaRam || "—")}</td>
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

// -------------------- Exportar CSV --------------------
// Exporta exatamente o que está sendo mostrado na tela (respeita os
// filtros/busca ativos no momento). O histórico de manutenções não entra
// no CSV (fica só dentro dos detalhes de cada máquina no site).
document.getElementById("btn-exportar-maquinas").addEventListener("click", () => {
  const cabecalhos = [
    "Equipamento", "S/N", "Ativo", "Delegação", "Setor",
    "Chamado", "Chegada", "Saida", "Situação", "Observações"
  ];

  const linhas = obterListaFiltrada().map((m) => [
    m.nome || "",
    m.setor || "",
    m.responsavelUso || "",
    ROTULOS_STATUS[m.status] || m.status || "",
    m.so || "",
    m.ip || "",
    m.processador || "",
    m.memoriaRam || "",
    m.armazenamento || "",
    m.observacoes || ""
  ]);

  exportarCSV(nomeArquivoComData("maquinas"), cabecalhos, linhas);
});

// -------------------- Modal --------------------
let modoAtual = "criar";
let maquinaIdAtual = null;

document.getElementById("btn-nova-maquina").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-maquina").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

const CAMPOS = ["Equipamento", "S/N", "Ativo", "Delegação", "Setoe", "Chamado", "Chegada", "Saida", "Situação", "observacoes"];

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
    document.getElementById("maquina-status").value = m.status || "";
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
// -------------------- Enviar ao estoque --------------------
// Cria um item novo em Estoque já preenchido com os dados desta máquina.
// Não mexe no status da máquina (ela continua Ativa/Manutenção/Baixada
// normalmente) — é só uma cópia inicial dos dados pro Estoque.
document.getElementById("btn-enviar-estoque").addEventListener("click", async () => {
  const m = listaMaquinas.find((x) => x.id === maquinaIdAtual);
  if (!m) return;

  if (!confirm(`Enviar "${m.nome}" para o Estoque? Um novo item será criado lá com os dados desta máquina já preenchidos.`)) return;

  const botao = document.getElementById("btn-enviar-estoque");
  botao.disabled = true;
  botao.textContent = "Enviando...";

  try {
    // Tenta casar o "usuário responsável" da máquina (texto livre) com um
    // usuário cadastrado do mesmo nome, pra já vincular o técnico no
    // Estoque também. Se não achar, deixa o campo em branco (dá pra
    // escolher manualmente na tela de Estoque).
    let tecnicoUid = null;
    let tecnicoNome = null;
    if (m.responsavelUso) {
      const snap = await getDocs(collection(db, "usuarios"));
      const usuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      const encontrado = usuarios.find(
        (u) => (u.nome || "").trim().toLowerCase() === m.responsavelUso.trim().toLowerCase()
      );
      if (encontrado) {
        tecnicoUid = encontrado.uid;
        tecnicoNome = encontrado.nome;
      }
    }

    const observacoes = [
      `Enviado do módulo de Máquinas em ${new Date().toLocaleDateString("pt-BR")} por ${perfilAtual.nome}.`,
      m.observacoes ? `Observações da máquina: ${m.observacoes}` : ""
    ].filter(Boolean).join(" ");

    await addDoc(collection(db, "itensEstoque"), {
      equipamento: m.nome || "",
      serial: "",
      ativo: m.nome || "",
      chegada: hojeISO(),
      saida: "",
      delegacao: "",
      lojaSetor: m.setor || "",
      prioridade: "media",
      tecnicoUid,
      tecnicoNome,
      situacao: "recebido",
      observacoes,
      criadoPorUid: usuarioAtual.uid,
      criadoPorNome: perfilAtual.nome,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    alert("Item criado no Estoque com os dados desta máquina! Abra a tela Estoque para completar o restante (S/N, técnico responsável etc.).");
  } catch (err) {
    alert("Erro ao enviar ao estoque: " + err.message);
  } finally {
    botao.disabled = false;
    botao.textContent = "Enviar ao estoque";
  }
});

function hojeISO() {
  const hoje = new Date();
  const offset = hoje.getTimezoneOffset();
  const local = new Date(hoje.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
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
