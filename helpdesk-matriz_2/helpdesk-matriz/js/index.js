// ==========================================================================
// LÓGICA DA TELA DE LOGIN / CADASTRO
// ==========================================================================
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { entrar, cadastrarUsuario } from "./auth.js";

// Se já houver uma sessão ativa, pula direto para o dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
});

// ---------- Alternância entre as abas Entrar / Criar conta ----------
const abas = document.querySelectorAll(".auth-tab");
const formularios = document.querySelectorAll(".auth-form");

abas.forEach((aba) => {
  aba.addEventListener("click", () => {
    abas.forEach((a) => a.classList.remove("ativo"));
    formularios.forEach((f) => f.classList.remove("ativo"));

    aba.classList.add("ativo");
    document.getElementById(aba.dataset.alvo).classList.add("ativo");
  });
});

// ---------- Mensagens de erro traduzidas ----------
function traduzirErro(codigo) {
  const mapa = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um instante e tente de novo."
  };
  return mapa[codigo] || "Ocorreu um erro. Tente novamente.";
}

// ---------- Login ----------
document.getElementById("form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("login-erro");
  erroEl.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  const senha = document.getElementById("login-senha").value;
  const botao = evento.target.querySelector("button");

  botao.disabled = true;
  botao.textContent = "Entrando...";

  try {
    await entrar(email, senha);
    window.location.href = "dashboard.html";
  } catch (err) {
    erroEl.textContent = traduzirErro(err.code);
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

// ---------- Cadastro ----------
document.getElementById("form-cadastro").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("cadastro-erro");
  erroEl.textContent = "";

  const nome = document.getElementById("cad-nome").value.trim();
  const email = document.getElementById("cad-email").value.trim();
  const senha = document.getElementById("cad-senha").value;
  const botao = evento.target.querySelector("button");

  botao.disabled = true;
  botao.textContent = "Criando conta...";

  try {
    await cadastrarUsuario(nome, email, senha);
    window.location.href = "dashboard.html";
  } catch (err) {
    erroEl.textContent = traduzirErro(err.code);
    botao.disabled = false;
    botao.textContent = "Criar conta";
  }
});
