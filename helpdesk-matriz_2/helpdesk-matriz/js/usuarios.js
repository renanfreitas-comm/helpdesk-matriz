// ==========================================================================
// LÓGICA DA TELA DE USUÁRIOS (somente admin) — promover/rebaixar papéis
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  doc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioLogadoUid = null;
let listaUsuarios = [];

const tabelaBody = document.getElementById("tabela-usuarios");

protegerPagina((user, perfil) => {
  usuarioLogadoUid = user.uid;
  montarNav(perfil);

  onSnapshot(collection(db, "usuarios"), (snap) => {
    listaUsuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    renderizarTabela();
  });
}, { apenasAdmin: true });

function renderizarTabela() {
  if (listaUsuarios.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  const totalAdmins = listaUsuarios.filter((u) => u.papel === "admin").length;

  tabelaBody.innerHTML = listaUsuarios.map((u) => {
    const ehVoce = u.uid === usuarioLogadoUid;
    const ultimoAdmin = u.papel === "admin" && totalAdmins <= 1;
    const rotuloPapel = u.papel === "admin" ? "Supervisor/Admin" : "Técnico";
    const classePapel = u.papel === "admin" ? "badge-admin" : "badge-tecnico";

    let acao;
    if (ultimoAdmin) {
      acao = `<span class="texto-suave" title="Precisa haver pelo menos um admin">Único admin</span>`;
    } else if (u.papel === "admin") {
      acao = `<button class="botao-secundario btn-rebaixar" data-id="${u.uid}">Tornar técnico</button>`;
    } else {
      acao = `<button class="botao-secundario btn-promover" data-id="${u.uid}">Tornar admin</button>`;
    }

    return `
      <tr>
        <td>${escaparHTML(u.nome)}${ehVoce ? ' <span class="texto-suave">(você)</span>' : ""}</td>
        <td>${escaparHTML(u.email)}</td>
        <td><span class="badge ${classePapel}">${rotuloPapel}</span></td>
        <td>${acao}</td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".btn-promover").forEach((b) =>
    b.addEventListener("click", () => alterarPapel(b.dataset.id, "admin")));
  document.querySelectorAll(".btn-rebaixar").forEach((b) =>
    b.addEventListener("click", () => alterarPapel(b.dataset.id, "tecnico")));
}

async function alterarPapel(uid, novoPapel) {
  const rotulo = novoPapel === "admin" ? "supervisor/admin" : "técnico";
  if (!confirm(`Confirma alterar este usuário para ${rotulo}?`)) return;

  try {
    await updateDoc(doc(db, "usuarios", uid), { papel: novoPapel });
  } catch (err) {
    alert("Erro ao atualizar papel: " + err.message);
  }
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
