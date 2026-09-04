// ==========================================================================
// LÓGICA DA TELA DE ESTOQUE (controle de equipamentos: chegada, configuração e saída)
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
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaUsuarios = [];
let listaItens = [];
let itemIdAtual = null;

const tabelaBody = document.getElementById("tabela-estoque");
const modal = document.getElementById("modal-item");
const form = document.getElementById("form-item");
const selectTecnico = document.getElementById("item-tecnico");

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_SITUACAO = {
  recebido: "Recebido",
  em_configuracao: "Em configuração",
  aguardando_peca: "Aguardando peça",
  concluido: "Concluído",
  entregue: "Entregue"
};
const CLASSES_SITUACAO = {
  recebido: "badge-situacao-recebido",
  em_configuracao: "badge-situacao-em_configuracao",
  aguardando_peca: "badge-situacao-aguardando_peca",
  concluido: "badge-situacao-concluido",
  entregue: "badge-situacao-entregue"
};

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  carregarUsuarios().then(() => {
    observarItens();
  });
});

// -------------------- Carregar usuários (para o select de técnico) --------------------
async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  listaUsuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  const opcoes = listaUsuarios
    .map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`)
    .join("");

  selectTecnico.innerHTML = `<option value="">Sem técnico</option>${opcoes}`;
}

function nomeUsuario(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  return u ? u.nome : "—";
}

function observarItens() {
  const q = query(collection(db, "itensEstoque"), orderBy("equipamento"));
  onSnapshot(q, (snap) => {
    listaItens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="11" class="vazio">Erro ao carregar estoque: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const busca = document.getElementById("filtro-busca-item").value.trim().toLowerCase();
  const fSituacao = document.getElementById("filtro-situacao").value;

  const filtrados = listaItens.filter((i) => {
    if (fSituacao && i.situacao !== fSituacao) return false;
    if (busca) {
      const alvo = `${i.equipamento || ""} ${i.serial || ""} ${i.ativo || ""} ${i.lojaSetor || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  if (filtrados.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="11" class="vazio">Nenhum item encontrado.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtrados.map((i) => `
    <tr>
      <td><strong>${escaparHTML(i.equipamento)}</strong></td>
      <td>${escaparHTML(i.serial || "—")}</td>
      <td>${escaparHTML(i.ativo || "—")}</td>
      <td>${formatarData(i.chegada)}</td>
      <td>${escaparHTML(i.delegacao || "—")}</td>
      <td><span class="badge badge-prioridade-${i.prioridade || "media"}">${ROTULOS_PRIORIDADE[i.prioridade] || "—"}</span></td>
      <td>${formatarData(i.saida)}</td>
      <td>${i.tecnicoNome ? escaparHTML(i.tecnicoNome) : '<span class="texto-suave">—</span>'}</td>
      <td>${escaparHTML(i.lojaSetor || "—")}</td>
      <td><span class="badge ${CLASSES_SITUACAO[i.situacao] || ""}">${ROTULOS_SITUACAO[i.situacao] || i.situacao || "—"}</span></td>
      <td>
        <div class="acoes-tabela">
          <button class="botao-secundario btn-editar-item" data-id="${i.id}">Editar</button>
          ${perfilAtual.papel === "admin" ? `<button class="botao-perigo btn-excluir-item" data-id="${i.id}">Excluir</button>` : ""}
        </div>
      </td>
    </tr>`
  ).join("");

  document.querySelectorAll(".btn-editar-item").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-item").forEach((b) =>
    b.addEventListener("click", () => excluirItem(b.dataset.id)));
}

document.getElementById("filtro-busca-item").addEventListener("input", renderizarTabela);
document.getElementById("filtro-situacao").addEventListener("change", renderizarTabela);

// -------------------- Modal --------------------
let modoAtual = "criar";

document.getElementById("btn-novo-item").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-item").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, itemId = null) {
  modoAtual = modo;
  itemIdAtual = itemId;
  document.getElementById("item-erro").textContent = "";
  form.reset();
  document.getElementById("item-id").value = itemId || "";

  if (modo === "criar") {
    document.getElementById("modal-item-titulo").textContent = "Novo item";
    document.getElementById("item-prioridade").value = "media";
    document.getElementById("item-situacao").value = "recebido";
  } else {
    const item = listaItens.find((x) => x.id === itemId);
    document.getElementById("modal-item-titulo").textContent = item.equipamento;
    document.getElementById("item-equipamento").value = item.equipamento || "";
    document.getElementById("item-serial").value = item.serial || "";
    document.getElementById("item-ativo").value = item.ativo || "";
    document.getElementById("item-chegada").value = item.chegada || "";
    document.getElementById("item-saida").value = item.saida || "";
    document.getElementById("item-delegacao").value = item.delegacao || "";
    document.getElementById("item-loja-setor").value = item.lojaSetor || "";
    document.getElementById("item-prioridade").value = item.prioridade || "media";
    selectTecnico.value = item.tecnicoUid || "";
    document.getElementById("item-situacao").value = item.situacao || "recebido";
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("item-erro");
  erroEl.textContent = "";

  const equipamento = document.getElementById("item-equipamento").value.trim();
  const serial = document.getElementById("item-serial").value.trim();
  const ativo = document.getElementById("item-ativo").value.trim();
  const chegada = document.getElementById("item-chegada").value;
  const saida = document.getElementById("item-saida").value;
  const delegacao = document.getElementById("item-delegacao").value.trim();
  const lojaSetor = document.getElementById("item-loja-setor").value.trim();
  const prioridade = document.getElementById("item-prioridade").value;
  const tecnicoUid = selectTecnico.value || null;
  const situacao = document.getElementById("item-situacao").value;

  const dados = {
    equipamento,
    serial,
    ativo,
    chegada,
    saida,
    delegacao,
    lojaSetor,
    prioridade,
    tecnicoUid,
    tecnicoNome: tecnicoUid ? nomeUsuario(tecnicoUid) : null,
    situacao,
    atualizadoEm: serverTimestamp()
  };

  const botao = document.getElementById("btn-salvar-item");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      await addDoc(collection(db, "itensEstoque"), {
        ...dados,
        criadoPorUid: usuarioAtual.uid,
        criadoPorNome: perfilAtual.nome,
        criadoEm: serverTimestamp()
      });
    } else {
      await updateDoc(doc(db, "itensEstoque", itemIdAtual), dados);
    }
    fecharModal();
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirItem(id) {
  if (!confirm("Excluir este item do estoque? Essa ação não pode ser desfeita.")) return;
  try {
    await deleteDoc(doc(db, "itensEstoque", id));
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

function formatarData(iso) {
  if (!iso) return '<span class="texto-suave">—</span>';
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
