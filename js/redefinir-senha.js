// ==========================================================================
// TELA "DEFINIR NOVA SENHA"
// ==========================================================================
// Usada em dois casos:
//   1) Pelo link do e-mail de "Esqueci minha senha" (o Supabase abre esta
//      página já com uma sessão temporária de recuperação).
//   2) Pelo link "Trocar senha" do cabeçalho, com o usuário já logado.
// ==========================================================================
import { supabase } from "./supabase-config.js";

const form = document.getElementById("form-senha");
const subtitulo = document.getElementById("senha-subtitulo");
const erroEl = document.getElementById("senha-erro");

const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  subtitulo.textContent = "O link expirou ou já foi usado. Volte para a tela de login e clique em \"Esqueci minha senha\" de novo.";
} else {
  subtitulo.textContent = `Conta: ${session.user.email}. Escolha uma senha com pelo menos 6 caracteres.`;
  form.style.display = "";
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.textContent = "";
  erroEl.style.color = "";

  const senha = document.getElementById("nova-senha").value;
  const confirma = document.getElementById("nova-senha-confirma").value;
  if (senha.length < 6) { erroEl.textContent = "A senha precisa ter pelo menos 6 caracteres."; return; }
  if (senha !== confirma) { erroEl.textContent = "As duas senhas não são iguais."; return; }

  const botao = form.querySelector("button");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) {
    erroEl.textContent = /same_password|different from the old/i.test(error.code || error.message)
      ? "A nova senha precisa ser diferente da atual."
      : /weak_password/i.test(error.code || "") ? "Senha fraca demais. Use uma senha mais longa." : "Não foi possível salvar: " + error.message;
    botao.disabled = false;
    botao.textContent = "Salvar nova senha";
    return;
  }

  erroEl.style.color = "#16a34a";
  erroEl.textContent = "Senha alterada! Entrando...";
  setTimeout(() => { window.location.href = "dashboard.html"; }, 1200);
});
