// ==========================================================================
// LÓGICA DA TELA DE LOGIN
// ==========================================================================
import { supabase } from "./supabase-config.js";
import { entrar, redefinirSenha } from "./auth.js";

// Se já houver uma sessão ativa, pula direto para o dashboard.
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = "dashboard.html";
});

// ---------- Por que a pessoa voltou para o login ----------
(() => {
  const motivo = new URLSearchParams(window.location.search).get("motivo");
  if (!motivo) return;
  const textos = {
    "outra-maquina": sessionStorage.getItem("hd-em-uso") || "Esta conta está em uso em outra máquina.",
    "desconectado": "Sua sessão foi encerrada: um admin desconectou você, ou a conta foi acessada em outra máquina depois que esta ficou sem conexão.",
    "inatividade": "Sua sessão foi encerrada por inatividade. Entre novamente."
  };
  sessionStorage.removeItem("hd-em-uso");
  const el = document.getElementById("login-erro");
  if (el && textos[motivo]) el.textContent = textos[motivo];
  history.replaceState(null, "", window.location.pathname);
})();

// ---------- Mensagens de erro traduzidas ----------
function traduzirErro(err) {
  if (err && err.code === "em_uso") return err.message;
  const codigo = (err && (err.code || err.message)) || "";
  if (/invalid_credentials|Invalid login credentials/i.test(codigo)) return "E-mail ou senha incorretos.";
  if (/email_not_confirmed|Email not confirmed/i.test(codigo)) return "E-mail ainda não confirmado. Peça ao admin para verificar sua conta.";
  if (/over_request_rate_limit|over_email_send_rate_limit|rate limit/i.test(codigo)) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (/validation_failed|invalid.*email/i.test(codigo)) return "E-mail inválido.";
  if (/Failed to fetch|NetworkError/i.test(codigo)) return "Sem conexão com o servidor. Verifique a internet.";
  return "Ocorreu um erro. Tente novamente.";
}

// ---------- Login ----------
document.getElementById("form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("login-erro");
  erroEl.textContent = "";
  erroEl.style.color = "";

  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const senha = document.getElementById("login-senha").value;
  const botao = evento.target.querySelector("button");

  botao.disabled = true;
  botao.textContent = "Entrando...";

  try {
    await entrar(email, senha);
    window.location.href = "dashboard.html";
  } catch (err) {
    erroEl.textContent = traduzirErro(err);
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

// ---------- Esqueci minha senha ----------
document.getElementById("link-esqueci-senha").addEventListener("click", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("login-erro");
  erroEl.textContent = "";

  const email = document.getElementById("login-email").value.trim().toLowerCase();
  if (!email) {
    erroEl.textContent = "Digite seu e-mail no campo acima e clique em \"Esqueci minha senha\" de novo.";
    return;
  }

  try {
    await redefinirSenha(email);
    erroEl.style.color = "#16a34a";
    erroEl.textContent = "Se o e-mail estiver cadastrado, você vai receber um link para redefinir a senha. Se não chegar, peça ao admin uma senha temporária.";
  } catch (err) {
    erroEl.style.color = "";
    erroEl.textContent = traduzirErro(err);
  }
});
