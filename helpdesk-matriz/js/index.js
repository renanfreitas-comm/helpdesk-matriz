// ==========================================================================
// LÓGICA DA TELA DE LOGIN
// ==========================================================================
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { entrar, redefinirSenha } from "./auth.js";

// Se já houver uma sessão ativa, pula direto para o dashboard.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
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
  erroEl.style.color = "";

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

// ---------- Esqueci minha senha ----------
document.getElementById("link-esqueci-senha").addEventListener("click", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("login-erro");
  erroEl.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  if (!email) {
    erroEl.textContent = "Digite seu e-mail no campo acima e clique em \"Esqueci minha senha\" de novo.";
    return;
  }

  try {
    await redefinirSenha(email);
    erroEl.style.color = "#16a34a";
    erroEl.textContent = "Enviamos um e-mail com o link para redefinir sua senha.";
  } catch (err) {
    erroEl.style.color = "";
    erroEl.textContent = traduzirErro(err.code);
  }
});
