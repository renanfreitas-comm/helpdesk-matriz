// ==========================================================================
// LÓGICA DA TELA DE USUÁRIOS (somente admin) — promover/rebaixar papéis
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina, criarUsuarioComoAdmin } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let usuarioLogadoUid = null;
let listaUsuarios = [];

const tabelaBody = document.getElementById("tabela-usuarios");
const modal = document.getElementById("modal-usuario");
const form = document.getElementById("form-usuario");

protegerPagina((user, perfil) => {
  usuarioLogadoUid = user.uid;
  montarNav(perfil);

  onSnapshot(collection(db, "usuarios"), (snap) => {
    listaUsuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    renderizarTabela();
  });
}, { apenasAdmin: true });

// -------------------- Modal: novo usuário --------------------
document.getElementById("btn-novo-usuario").addEventListener("click", () => {
  form.reset();
  document.getElementById("novo-usuario-erro").textContent = "";
  modal.classList.add("aberto");
});

document.getElementById("btn-cancelar-usuario").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("novo-usuario-erro");
  erroEl.textContent = "";

  const nome = document.getElementById("novo-usuario-nome").value.trim();
  const email = document.getElementById("novo-usuario-email").value.trim();
  const senha = document.getElementById("novo-usuario-senha").value;
  const papel = document.getElementById("novo-usuario-papel").value;

  const botao = document.getElementById("btn-salvar-usuario");
  botao.disabled = true;
  botao.textContent = "Criando...";

  try {
    await criarUsuarioComoAdmin(nome, email, senha, papel);
    fecharModal();
    alert(`Usuário criado! Compartilhe com ${nome}:\n\nE-mail: ${email}\nSenha temporária: ${senha}`);
  } catch (err) {
    erroEl.textContent = traduzirErroCadastro(err.code);
  } finally {
    botao.disabled = false;
    botao.textContent = "Criar usuário";
  }
});

function traduzirErroCadastro(codigo) {
  const mapa = {
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres."
  };
  return mapa[codigo] || "Erro ao criar usuário. Tente novamente.";
}

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
      acao = `
        <div class="acoes-tabela">
          <button class="botao-secundario btn-promover" data-id="${u.uid}">Tornar admin</button>
          <button class="botao-perigo btn-excluir-usuario" data-id="${u.uid}">Excluir</button>
        </div>`;
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
  document.querySelectorAll(".btn-excluir-usuario").forEach((b) =>
    b.addEventListener("click", () => excluirUsuario(b.dataset.id)));
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

async function excluirUsuario(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  const nome = u ? u.nome : "este usuário";

  if (!confirm(`Excluir o técnico ${nome}?\n\nIsso remove o acesso e o perfil dele no sistema. O e-mail dele continuará cadastrado no login (Firebase Authentication) — se quiser liberar totalmente o e-mail, remova-o também em Authentication → Users no Console do Firebase.`)) return;

  try {
    await deleteDoc(doc(db, "usuarios", uid));
  } catch (err) {
    alert("Erro ao excluir usuário: " + err.message);
  }
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
