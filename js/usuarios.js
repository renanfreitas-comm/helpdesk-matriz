// ==========================================================================
// LÓGICA DA TELA DE USUÁRIOS (somente admin) — promover/rebaixar papéis
// ==========================================================================
import { protegerPagina, criarUsuarioComoAdmin, excluirUsuarioComoAdmin, definirSenhaComoAdmin } from "./auth.js";
import { montarNav } from "./nav.js";
import { atualizar, observar } from "./db.js";

let usuarioLogadoUid = null;
let listaUsuarios = [];

const tabelaBody = document.getElementById("tabela-usuarios");
const modal = document.getElementById("modal-usuario");
const form = document.getElementById("form-usuario");

protegerPagina((user, perfil) => {
  usuarioLogadoUid = user.uid;
  montarNav(perfil);

  observar("usuarios", (q) => q.order("nome"), (linhas) => {
    listaUsuarios = linhas.map((u) => ({ uid: u.id, ...u }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="4" class="vazio">Erro ao carregar usuários: ${escaparHTML(erro.message)}</td></tr>`;
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
    window.dispatchEvent(new CustomEvent("db-alterado", { detail: "usuarios" }));
    fecharModal();
    alert(`Usuário criado! Compartilhe com ${nome}:\n\nE-mail: ${email}\nSenha temporária: ${senha}`);
  } catch (err) {
    erroEl.textContent = traduzirErroCadastro(err);
  } finally {
    botao.disabled = false;
    botao.textContent = "Criar usuário";
  }
});

function traduzirErroCadastro(err) {
  const mapa = {
    email_existente: "Este e-mail já está cadastrado.",
    email_invalido: "E-mail inválido.",
    senha_fraca: "A senha precisa ter pelo menos 6 caracteres.",
    dados_invalidos: "Confira nome, e-mail e papel.",
    apenas_admin: "Só um supervisor/admin pode criar usuários.",
    funcao_indisponivel: "A função \"admin-usuarios\" não respondeu. Confira se ela foi publicada no Supabase (veja o README)."
  };
  return mapa[err && err.code] || (err && err.message) || "Erro ao criar usuário. Tente novamente.";
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
    if (ehVoce) {
      acao = `<span class="texto-suave" title="Peça a outro admin para alterar sua conta">Sua conta</span>`;
    } else if (ultimoAdmin) {
      acao = `<div class="acoes-tabela">${btnSenha(u)}<span class="texto-suave" title="Precisa haver pelo menos um admin">Único admin</span></div>`;
    } else if (u.papel === "admin") {
      acao = `
        <div class="acoes-tabela">
          <button class="botao-secundario btn-rebaixar" data-id="${u.uid}">Rebaixar a técnico</button>
          ${btnSenha(u)}
          <button class="botao-perigo btn-excluir-usuario" data-id="${u.uid}">Excluir</button>
        </div>`;
    } else {
      acao = `
        <div class="acoes-tabela">
          <button class="botao-secundario btn-promover" data-id="${u.uid}">Tornar admin</button>
          ${btnSenha(u)}
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
  document.querySelectorAll(".btn-nova-senha").forEach((b) =>
    b.addEventListener("click", () => novaSenha(b.dataset.id)));
}

async function alterarPapel(uid, novoPapel) {
  const rotulo = novoPapel === "admin" ? "supervisor/admin" : "técnico";
  if (!confirm(`Confirma alterar este usuário para ${rotulo}?`)) return;

  try {
    await atualizar("usuarios", uid, { papel: novoPapel });
  } catch (err) {
    alert("Erro ao atualizar papel: " + err.message);
  }
}

async function excluirUsuario(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  const nome = u ? u.nome : "este usuário";

  if (!confirm(`Excluir ${nome}?\n\nIsso remove o login e o perfil dele no sistema. Os chamados, relatórios e registros que ele criou continuam guardados.`)) return;

  try {
    await excluirUsuarioComoAdmin(uid);
    window.dispatchEvent(new CustomEvent("db-alterado", { detail: "usuarios" }));
  } catch (err) {
    alert("Erro ao excluir usuário: " + err.message);
  }
}

function btnSenha(u) {
  return `<button class="botao-secundario btn-nova-senha" data-id="${u.uid}">Nova senha</button>`;
}

// Define uma senha temporária nova para quem esqueceu a senha
// (alternativa ao e-mail de "Esqueci minha senha").
async function novaSenha(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  const nome = u ? u.nome : "este usuário";
  const senha = prompt(`Nova senha temporária para ${nome} (mínimo de 6 caracteres):`);
  if (senha === null) return;
  if (senha.length < 6) {
    alert("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }
  try {
    await definirSenhaComoAdmin(uid, senha);
    alert(`Senha alterada! Compartilhe com ${nome} por um canal seguro:\n\nE-mail: ${u ? u.email : ""}\nSenha temporária: ${senha}\n\nDepois a pessoa pode trocar em "Trocar senha", no topo do site.`);
  } catch (err) {
    alert("Erro ao trocar a senha: " + err.message);
  }
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
