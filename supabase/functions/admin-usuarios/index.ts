// ==========================================================================
// EDGE FUNCTION "admin-usuarios" — Help Desk Matriz
// ==========================================================================
// Roda no servidor do Supabase. Só atende supervisores/admins logados.
// Ações (campo "acao" no corpo JSON):
//   - criar        { nome, email, senha, papel }  -> cria login + perfil
//   - excluir      { uid }                        -> apaga login + perfil
//   - definirSenha { uid, senha }                 -> nova senha temporária
//
// Como publicar (sem instalar nada): Supabase > Edge Functions >
// "Deploy a new function" > "Via Editor" > nome: admin-usuarios > cole este
// arquivo > Deploy. Deixe "Verify JWT" LIGADO.
//
// A chave "service_role" fica só aqui no servidor (o Supabase já fornece
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY automaticamente) — nunca no site.
// ==========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function erro(codigo: string, mensagem: string, status = 200) {
  return resposta({ erro: codigo, mensagem }, status);
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro("metodo_invalido", "Use POST.", 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // ---- Quem está chamando? Precisa ser admin.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quem, error: erroQuem } = await admin.auth.getUser(token);
  if (erroQuem || !quem?.user) return erro("nao_autenticado", "Sessão inválida. Entre novamente.", 401);

  const { data: perfil } = await admin.from("usuarios").select("papel").eq("id", quem.user.id).maybeSingle();
  if (perfil?.papel !== "admin") return erro("apenas_admin", "Apenas o supervisor/admin pode fazer isso.", 403);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro("dados_invalidos", "Corpo da requisição inválido.");
  }

  try {
    switch (corpo.acao) {
      // ------------------------------------------------------------ CRIAR
      case "criar": {
        const nome = String(corpo.nome ?? "").trim();
        const email = String(corpo.email ?? "").trim().toLowerCase();
        const senha = String(corpo.senha ?? "");
        const papel = String(corpo.papel ?? "tecnico");

        if (!nome || nome.length > 120 || !["tecnico", "admin"].includes(papel)) {
          return erro("dados_invalidos", "Confira nome e papel.");
        }
        if (!EMAIL_VALIDO.test(email)) return erro("email_invalido", "E-mail inválido.");
        if (senha.length < 6) return erro("senha_fraca", "A senha precisa ter pelo menos 6 caracteres.");

        const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
          email,
          password: senha,
          email_confirm: true, // já entra confirmado (não depende de e-mail)
          user_metadata: { nome },
        });
        if (erroCriar || !criado?.user) {
          const msg = erroCriar?.message ?? "";
          if (erroCriar?.code === "email_exists" || /already|registered|exists/i.test(msg)) {
            return erro("email_existente", "Este e-mail já está cadastrado.");
          }
          if (erroCriar?.code === "weak_password" || /password/i.test(msg)) {
            return erro("senha_fraca", "Senha fraca demais. Use uma senha mais longa.");
          }
          return erro("erro_auth", msg || "Erro ao criar o login.");
        }

        const { error: erroPerfil } = await admin.from("usuarios").insert({
          id: criado.user.id, nome, email, papel,
        });
        if (erroPerfil) {
          // Desfaz o login para não sobrar conta sem perfil.
          await admin.auth.admin.deleteUser(criado.user.id);
          return erro("erro_perfil", "Erro ao criar o perfil: " + erroPerfil.message);
        }
        return resposta({ ok: true, uid: criado.user.id });
      }

      // ---------------------------------------------------------- EXCLUIR
      case "excluir": {
        const uid = String(corpo.uid ?? "");
        if (!uid) return erro("dados_invalidos", "Usuário não informado.");
        if (uid === quem.user.id) return erro("proprio_usuario", "Você não pode excluir a sua própria conta.");

        const { data: alvo } = await admin.from("usuarios").select("papel").eq("id", uid).maybeSingle();
        if (alvo?.papel === "admin") {
          const { count } = await admin.from("usuarios").select("id", { count: "exact", head: true }).eq("papel", "admin");
          if ((count ?? 0) <= 1) return erro("ultimo_admin", "Não é possível excluir o único supervisor/admin.");
        }

        // Apagar o login apaga o perfil junto (on delete cascade).
        const { error: erroExcluir } = await admin.auth.admin.deleteUser(uid);
        if (erroExcluir && !/not found/i.test(erroExcluir.message)) {
          return erro("erro_auth", "Erro ao excluir o login: " + erroExcluir.message);
        }
        // Se por algum motivo só existia o perfil, remove também.
        await admin.from("usuarios").delete().eq("id", uid);
        return resposta({ ok: true });
      }

      // ---------------------------------------------------- DEFINIR SENHA
      case "definirSenha": {
        const uid = String(corpo.uid ?? "");
        const senha = String(corpo.senha ?? "");
        if (!uid) return erro("dados_invalidos", "Usuário não informado.");
        if (senha.length < 6) return erro("senha_fraca", "A senha precisa ter pelo menos 6 caracteres.");

        const { error: erroSenha } = await admin.auth.admin.updateUserById(uid, { password: senha });
        if (erroSenha) return erro("erro_auth", "Erro ao trocar a senha: " + erroSenha.message);
        return resposta({ ok: true });
      }

      default:
        return erro("acao_invalida", "Ação desconhecida.");
    }
  } catch (e) {
    console.error(e);
    return erro("erro_interno", "Erro inesperado: " + (e instanceof Error ? e.message : String(e)), 500);
  }
});
