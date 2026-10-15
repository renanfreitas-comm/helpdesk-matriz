// ==========================================================================
// LÓGICA DA TELA DE USUÁRIOS (somente admin) — promover/rebaixar papéis
// ==========================================================================
import { protegerPagina, criarUsuarioComoAdmin, excluirUsuarioComoAdmin, definirSenhaComoAdmin } from "./auth.js";
import { montarNav } from "./nav.js";
import { atualizar, observar, supabase } from "./db.js";

let usuarioLogadoUid = null;
let listaUsuarios = [];
let sessoes = {};          // usuario_id -> sessão ativa (uma máquina por vez)

const tabelaBody = document.getElementById("tabela-usuarios");
const modal = document.getElementById("modal-usuario");
const form = document.getElementById("form-usuario");

protegerPagina((user, perfil) => {
  usuarioLogadoUid = user.uid;
  montarNav(perfil, user);

  // Quem está conectado e em qual máquina (atualiza sozinho).
  observar("sessoes_ativas", (q) => q, (linhas) => {
    sessoes = Object.fromEntries(linhas.map((s) => [s.usuarioId, s]));
    renderizarTabela();
  });
  // "Online há x min" muda com o tempo.
  setInterval(renderizarTabela, 30000);

  observar("usuarios", (q) => q.order("nome"), (linhas) => {
    listaUsuarios = linhas.map((u) => ({ uid: u.id, ...u }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="5" class="vazio">Erro ao carregar usuários: ${escaparHTML(erro.message)}</td></tr>`;
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

const ROTULO_PAPEL = { tecnico: "Técnico", admin: "Supervisor/Admin", painel: "Painel de TV" };

function renderizarTabela() {
  if (listaUsuarios.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  const totalAdmins = listaUsuarios.filter((u) => u.papel === "admin").length;

  tabelaBody.innerHTML = listaUsuarios.map((u) => {
    const ehVoce = u.uid === usuarioLogadoUid;
    const ultimoAdmin = u.papel === "admin" && totalAdmins <= 1;
    const rotuloPapel = ROTULO_PAPEL[u.papel] || "Técnico";
    const classePapel = "badge-" + (ROTULO_PAPEL[u.papel] ? u.papel : "tecnico");

    let acao;
    if (ehVoce) {
      acao = `<span class="texto-suave" title="Peça a outro admin para alterar sua conta">Sua conta</span>`;
    } else if (ultimoAdmin) {
      acao = `<div class="acoes-tabela">${btnSenha(u)}<span class="texto-suave" title="Precisa haver pelo menos um admin">Único admin</span></div>`;
    } else {
      acao = `
        <div class="acoes-tabela">
          <select class="sel-papel" data-id="${u.uid}" aria-label="Papel de ${escaparHTML(u.nome)}">
            ${Object.entries(ROTULO_PAPEL).map(([v, r]) => `<option value="${v}" ${v === u.papel ? "selected" : ""}>${r}</option>`).join("")}
          </select>
          ${btnSenha(u)}
          <button class="botao-perigo btn-excluir-usuario" data-id="${u.uid}">Excluir</button>
        </div>`;
    }

    return `
      <tr>
        <td>${escaparHTML(u.nome)}${ehVoce ? ' <span class="texto-suave">(você)</span>' : ""}</td>
        <td>${escaparHTML(u.email)}</td>
        <td><span class="badge ${classePapel}">${rotuloPapel}</span></td>
        <td>${celulaSessao(u, ehVoce)}</td>
        <td>${acao}</td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".sel-papel").forEach((sel) =>
    sel.addEventListener("change", () => alterarPapel(sel.dataset.id, sel.value, sel)));
  document.querySelectorAll(".btn-excluir-usuario").forEach((b) =>
    b.addEventListener("click", () => excluirUsuario(b.dataset.id)));
  document.querySelectorAll(".btn-nova-senha").forEach((b) =>
    b.addEventListener("click", () => novaSenha(b.dataset.id)));
  document.querySelectorAll(".btn-desconectar").forEach((b) =>
    b.addEventListener("click", () => desconectar(b.dataset.id)));
}

async function alterarPapel(uid, novoPapel, seletor) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  const aviso = novoPapel === "painel"
    ? "\n\nA conta de painel só enxerga o painel de Tarefas (para TV), não grava nada e não recebe tarefas nem chamados."
    : "";
  if (!confirm(`Confirma alterar ${u ? u.nome : "este usuário"} para ${ROTULO_PAPEL[novoPapel]}?${aviso}`)) {
    if (seletor && u) seletor.value = u.papel;
    return;
  }

  try {
    await atualizar("usuarios", uid, { papel: novoPapel });
  } catch (err) {
    alert("Erro ao atualizar papel: " + err.message);
    if (seletor && u) seletor.value = u.papel;
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

// -------------------- Sessões (uma máquina por vez) --------------------
const LIMITE_ONLINE_MS = 2 * 60 * 1000; // mesmo prazo do banco

function celulaSessao(u, ehVoce) {
  const s = sessoes[u.uid];
  if (!s) return '<span class="texto-suave">Desconectado</span>';
  const online = Date.now() - new Date(s.ultimoSinal) < LIMITE_ONLINE_MS;
  const desde = new Date(s.iniciadaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `
    <div class="sessao-celula">
      <span class="badge ${online ? "badge-status-resolvido" : ""}">${online ? "● Online" : "Sem sinal"}</span>
      <small class="texto-suave">${escaparHTML(s.dispositivoNome || "Máquina desconhecida")} · desde ${desde}</small>
      ${!ehVoce ? `<button class="botao-secundario botao-pequeno btn-desconectar" data-id="${u.uid}">Desconectar</button>` : ""}
    </div>`;
}

async function desconectar(uid) {
  const u = listaUsuarios.find((x) => x.uid === uid);
  if (!confirm(`Desconectar ${u ? u.nome : "este usuário"}?\n\nA sessão dele termina na hora e ele poderá entrar em outra máquina.`)) return;
  const { error } = await supabase.rpc("derrubar_sessao", { p_usuario: uid });
  if (error) { alert("Erro ao desconectar: " + error.message); return; }
  delete sessoes[uid];
  renderizarTabela();
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
