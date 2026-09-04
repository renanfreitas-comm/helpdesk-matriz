// ==========================================================================
// BOOTSTRAP DO PRIMEIRO ADMIN — uso único, direto do navegador
// ==========================================================================
// Cria a conta de autenticação do primeiro admin e o respectivo documento
// em /usuarios já com papel "admin", sem precisar mexer manualmente no
// Console do Firebase. Só funciona uma vez: depois que o documento
// /config/bootstrap for marcado como concluído, as regras de segurança
// fecham essa brecha automaticamente (veja firestore.rules).
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const form = document.getElementById("form-bootstrap");
const erroEl = document.getElementById("bootstrap-erro");
const sucessoEl = document.getElementById("bootstrap-sucesso");
const botao = document.getElementById("btn-bootstrap");

document.getElementById("bootstrap-mostrar-senha").addEventListener("change", (e) => {
  document.getElementById("bootstrap-senha").type = e.target.checked ? "text" : "password";
});

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.textContent = "";
  sucessoEl.style.display = "none";

  const nome = document.getElementById("bootstrap-nome").value.trim();
  const email = document.getElementById("bootstrap-email").value.trim();
  const senha = document.getElementById("bootstrap-senha").value;

  botao.disabled = true;
  botao.textContent = "Criando...";

  try {
    const credencial = await createUserWithEmailAndPassword(auth, email, senha);
    const uid = credencial.user.uid;

    await setDoc(doc(db, "usuarios", uid), {
      nome,
      email: email.toLowerCase(),
      papel: "admin",
      criadoEm: serverTimestamp()
    });

    await setDoc(doc(db, "config", "bootstrap"), {
      adminCriado: true,
      criadoEm: serverTimestamp()
    });

    form.style.display = "none";
    sucessoEl.style.display = "block";
    sucessoEl.textContent = "Conta criada! Você já está logado como admin. Redirecionando para o painel...";
    setTimeout(() => { window.location.href = "dashboard.html"; }, 1800);
  } catch (err) {
    erroEl.textContent = traduzirErro(err);
    botao.disabled = false;
    botao.textContent = "Criar conta de admin";
  }
});

function traduzirErro(err) {
  const codigo = err.code || "";

  if (codigo === "auth/email-already-in-use") {
    return "Essa conta já existe. Se você já concluiu este passo antes, é só entrar pela tela de login normalmente.";
  }
  if (codigo === "auth/weak-password") {
    return "Senha muito curta — use pelo menos 6 caracteres.";
  }
  if (codigo === "auth/invalid-email") {
    return "E-mail inválido.";
  }
  if (codigo === "auth/operation-not-allowed") {
    return "O login por e-mail/senha ainda não está ativado no seu projeto Firebase (veja o Passo 2 do README).";
  }
  if (codigo === "permission-denied" || codigo === "firestore/permission-denied") {
    return "Não foi possível concluir o cadastro: ou já existe um admin neste projeto, ou este e-mail não é o autorizado para o bootstrap. Veja o Passo 8 do README para o cadastro manual alternativo.";
  }
  return "Erro ao criar a conta: " + (err.message || "tente novamente.");
}
