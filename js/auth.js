// ==========================================================================
// AUTENTICAÇÃO E PERFIL DO USUÁRIO (SUPABASE AUTH)
// ==========================================================================
import { supabase } from "./supabase-config.js";
import { mensagemErro } from "./db.js";

/**
 * Chama a Edge Function "admin-usuarios" (só admins). Ela usa a chave de
 * serviço do lado do servidor para criar/excluir contas e trocar senhas,
 * sem nunca expor essa chave no site. Veja supabase/functions/admin-usuarios.
 */
async function chamarAdminUsuarios(corpo) {
  const { data, error } = await supabase.functions.invoke("admin-usuarios", { body: corpo });
  if (error) {
    let detalhe = null;
    try { detalhe = await error.context.json(); } catch (e) { /* sem corpo */ }
    const e = new Error((detalhe && detalhe.mensagem) || "Não foi possível falar com a função admin-usuarios. Ela foi publicada no Supabase?");
    e.code = (detalhe && detalhe.erro) || "funcao_indisponivel";
    throw e;
  }
  if (data && data.erro) {
    const e = new Error(data.mensagem || data.erro);
    e.code = data.erro;
    throw e;
  }
  return data;
}

/** Cria um usuário novo (login + perfil). Só funciona para admins. */
export function criarUsuarioComoAdmin(nome, email, senha, papel) {
  return chamarAdminUsuarios({ acao: "criar", nome, email, senha, papel });
}

/** Exclui a conta de login E o perfil de um usuário. Só admins. */
export function excluirUsuarioComoAdmin(uid) {
  return chamarAdminUsuarios({ acao: "excluir", uid });
}

/** Define uma nova senha temporária para outro usuário. Só admins. */
export function definirSenhaComoAdmin(uid, senha) {
  return chamarAdminUsuarios({ acao: "definirSenha", uid, senha });
}

/** Envia o e-mail de "esqueci minha senha" com link para redefinir-senha.html. */
export async function redefinirSenha(email) {
  const destino = new URL("redefinir-senha.html", window.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: destino });
  if (error) throw error;
}

/** Efetua login com e-mail e senha. */
export async function entrar(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

/** Encerra a sessão do usuário atual. */
export async function sair() {
  await supabase.auth.signOut();
}

/** Busca o perfil (nome/papel) de um usuário pelo id. */
export async function obterPerfil(uid) {
  const { data, error } = await supabase.from("usuarios").select("*").eq("id", uid).maybeSingle();
  if (error) throw new Error(mensagemErro(error));
  return data;
}

/**
 * Protege uma página: só libera o conteúdo se houver um usuário logado
 * E com perfil cadastrado. Caso contrário, volta para a tela de login.
 *
 * O callback recebe (user, perfil), onde user = { uid, email }.
 *
 * @param {(user: {uid:string,email:string}, perfil: object) => void} callback
 * @param {{ apenasAdmin?: boolean }} opcoes
 */
export async function protegerPagina(callback, opcoes = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return;
  }

  let perfil = null;
  try {
    perfil = await obterPerfil(session.user.id);
  } catch (err) {
    console.error("Erro ao carregar perfil:", err);
  }
  if (!perfil) {
    alert("Não foi possível carregar seu perfil. Faça login novamente.");
    await sair();
    window.location.href = "index.html";
    return;
  }

  if (opcoes.apenasAdmin && perfil.papel !== "admin") {
    alert("Apenas o supervisor/admin pode acessar esta página.");
    window.location.href = "dashboard.html";
    return;
  }

  // Se a sessão terminar em outra aba (ou expirar), volta para o login.
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") window.location.href = "index.html";
  });

  callback({ uid: session.user.id, email: session.user.email }, perfil);
}
