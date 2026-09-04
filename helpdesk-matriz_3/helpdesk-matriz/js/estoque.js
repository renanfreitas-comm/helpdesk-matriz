// ==========================================================================
// LÓGICA DA TELA DE ESTOQUE (itens + movimentações de entrada/saída)
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
  where,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaItens = [];
let itemIdAtual = null;
let pararObservacaoMov = null;

const tabelaBody = document.getElementById("tabela-estoque");
const modal = document.getElementById("modal-item");
const form = document.getElementById("form-item");
const blocoMov = document.getElementById("bloco-movimentacao");

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  observarItens();
});

function observarItens() {
  const q = query(collection(db, "itensEstoque"), orderBy("nome"));
  onSnapshot(q, (snap) => {
    listaItens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="5" class="vazio">Erro ao carregar estoque: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const busca = document.getElementById("filtro-busca-item").value.trim().toLowerCase();
  const somenteBaixo = document.getElementById("filtro-somente-baixo").checked;

  const filtrados = listaItens.filter((i) => {
    if (busca) {
      const alvo = `${i.nome || ""} ${i.categoria || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    if (somenteBaixo && !(i.quantidadeAtual <= i.quantidadeMinima)) return false;
    return true;
  });

  if (filtrados.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum item encontrado.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtrados.map((i) => {
    const baixo = i.quantidadeAtual <= i.quantidadeMinima;
    return `
      <tr${baixo ? ' style="background:#fef2f2;"' : ""}>
        <td><strong>${escaparHTML(i.nome)}</strong></td>
        <td>${escaparHTML(i.categoria || "—")}</td>
        <td>${i.quantidadeAtual ?? 0} ${escaparHTML(i.unidade || "")} ${baixo ? '<span class="badge badge-status-aberto">baixo</span>' : ""}</td>
        <td>${i.quantidadeMinima ?? 0}</td>
        <td>
          <div class="acoes-tabela">
            <button class="botao-secundario btn-detalhes-item" data-id="${i.id}">Movimentar / Editar</button>
            ${perfilAtual.papel === "admin" ? `<button class="botao-perigo btn-excluir-item" data-id="${i.id}">Excluir</button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".btn-detalhes-item").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-item").forEach((b) =>
    b.addEventListener("click", () => excluirItem(b.dataset.id)));
}

document.getElementById("filtro-busca-item").addEventListener("input", renderizarTabela);
document.getElementById("filtro-somente-baixo").addEventListener("change", renderizarTabela);

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

  const linhaQtdInicial = document.getElementById("linha-qtd-inicial");

  if (modo === "criar") {
    document.getElementById("modal-item-titulo").textContent = "Novo item";
    linhaQtdInicial.style.display = "grid";
    blocoMov.style.display = "none";
  } else {
    const item = listaItens.find((x) => x.id === itemId);
    document.getElementById("modal-item-titulo").textContent = item.nome;
    document.getElementById("item-nome").value = item.nome || "";
    document.getElementById("item-categoria").value = item.categoria || "";
    document.getElementById("item-unidade").value = item.unidade || "";
    linhaQtdInicial.style.display = "none"; // quantidade só muda por movimentação, não por edição direta

    blocoMov.style.display = "block";
    document.getElementById("qtd-atual-label").textContent = `${item.quantidadeAtual ?? 0} ${item.unidade || ""}`;
    document.getElementById("mov-quantidade").value = 1;
    document.getElementById("mov-motivo").value = "";
    observarMovimentacoes(itemId);

    // Quantidade mínima continua editável mesmo depois de criado.
    document.getElementById("item-quantidade-minima").value = item.quantidadeMinima ?? 0;
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
  if (pararObservacaoMov) {
    pararObservacaoMov();
    pararObservacaoMov = null;
  }
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("item-erro");
  erroEl.textContent = "";

  const nome = document.getElementById("item-nome").value.trim();
  const categoria = document.getElementById("item-categoria").value.trim();
  const unidade = document.getElementById("item-unidade").value.trim();
  const quantidadeMinima = Number(document.getElementById("item-quantidade-minima").value) || 0;

  const botao = document.getElementById("btn-salvar-item");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      const quantidadeInicial = Number(document.getElementById("item-quantidade-inicial").value) || 0;
      await addDoc(collection(db, "itensEstoque"), {
        nome,
        categoria,
        unidade,
        quantidadeAtual: quantidadeInicial,
        quantidadeMinima,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      });
      fecharModal();
    } else {
      await updateDoc(doc(db, "itensEstoque", itemIdAtual), {
        nome,
        categoria,
        unidade,
        quantidadeMinima,
        atualizadoEm: serverTimestamp()
      });
      fecharModal();
    }
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirItem(id) {
  if (!confirm("Excluir este item do estoque? O histórico de movimentações dele deixará de aparecer.")) return;
  try {
    await deleteDoc(doc(db, "itensEstoque", id));
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

// -------------------- Movimentações --------------------
document.getElementById("btn-registrar-mov").addEventListener("click", async () => {
  const tipo = document.getElementById("mov-tipo").value;
  const quantidade = Number(document.getElementById("mov-quantidade").value);
  const motivo = document.getElementById("mov-motivo").value.trim();

  if (!quantidade || quantidade <= 0) {
    alert("Informe uma quantidade válida.");
    return;
  }

  const item = listaItens.find((x) => x.id === itemIdAtual);
  if (tipo === "saida" && quantidade > (item.quantidadeAtual ?? 0)) {
    if (!confirm(`Atenção: isso deixará o estoque negativo (${item.quantidadeAtual ?? 0} disponível). Confirma mesmo assim?`)) return;
  }

  const botao = document.getElementById("btn-registrar-mov");
  botao.disabled = true;
  botao.textContent = "Registrando...";

  try {
    await addDoc(collection(db, "movimentacoesEstoque"), {
      itemId: itemIdAtual,
      itemNome: item.nome,
      tipo,
      quantidade,
      motivo,
      responsavelUid: usuarioAtual.uid,
      responsavelNome: perfilAtual.nome,
      criadoEm: serverTimestamp()
    });

    await updateDoc(doc(db, "itensEstoque", itemIdAtual), {
      quantidadeAtual: increment(tipo === "entrada" ? quantidade : -quantidade),
      atualizadoEm: serverTimestamp()
    });

    document.getElementById("mov-quantidade").value = 1;
    document.getElementById("mov-motivo").value = "";
  } catch (err) {
    alert("Erro ao registrar movimentação: " + err.message);
  } finally {
    botao.disabled = false;
    botao.textContent = "Registrar";
  }
});

function observarMovimentacoes(itemId) {
  if (pararObservacaoMov) pararObservacaoMov();

  const q = query(
    collection(db, "movimentacoesEstoque"),
    where("itemId", "==", itemId),
    orderBy("criadoEm", "desc")
  );
  pararObservacaoMov = onSnapshot(q, (snap) => {
    const movs = snap.docs.map((d) => d.data());
    const listaEl = document.getElementById("lista-movimentacoes");

    // Mantém o rótulo de quantidade atual sincronizado em tempo real.
    const itemAtualizado = listaItens.find((x) => x.id === itemId);
    if (itemAtualizado) {
      document.getElementById("qtd-atual-label").textContent = `${itemAtualizado.quantidadeAtual ?? 0} ${itemAtualizado.unidade || ""}`;
    }

    if (movs.length === 0) {
      listaEl.innerHTML = '<p class="texto-suave">Nenhuma movimentação ainda.</p>';
      return;
    }

    listaEl.innerHTML = movs.map((m) => `
      <div style="padding:8px 0; border-bottom:1px solid var(--cor-borda); font-size:14px; display:flex; justify-content:space-between; gap:10px;">
        <div>
          <span class="badge ${m.tipo === "entrada" ? "badge-status-resolvido" : "badge-status-aberto"}">${m.tipo === "entrada" ? "Entrada" : "Saída"}</span>
          <strong style="margin-left:6px;">${m.quantidade}</strong>
          ${m.motivo ? `<span class="texto-suave"> — ${escaparHTML(m.motivo)}</span>` : ""}
          <div class="texto-suave" style="font-size:12px;">${escaparHTML(m.responsavelNome)} · ${formatarDataHora(m.criadoEm)}</div>
        </div>
      </div>
    `).join("");
  });
}

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
