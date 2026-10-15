// ==========================================================================
// MENU LATERAL COMUM A TODAS AS PÁGINAS INTERNAS
// ==========================================================================
// Cada página tem um <aside id="sidebar"> vazio; aqui ele é preenchido com
// os módulos (com ícones e contadores), o usuário logado e os botões
// "Trocar senha" e "Sair". No celular o menu vira uma gaveta que abre pelo
// botão ☰ da barra do topo.
// ==========================================================================
import { sair } from "./auth.js";
import { buscarTodos } from "./db.js";
import { valeNoDia, hojeISO } from "./tarefas-util.js";

// Ícones simples (traço), usados no menu e na tela inicial.
export const ICONES = {
  inicio: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/>',
  chamados: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  tarefas: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  relatorios: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 15h5M10 18h3"/>',
  visitas: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  maquinas: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  estoque: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  supervisao: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  usuarios: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.8 0 5 2.2 5 5"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  seta: '<path d="M9 6l6 6-6 6"/>',
  senha: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sair: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  tv: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4"/>'
};

export function icone(nome, classe = "ico") {
  return `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ""}</svg>`;
}

const ITENS = [
  { href: "dashboard.html", rotulo: "Início", icone: "inicio" },
  { href: "chamados.html", rotulo: "Chamados", icone: "chamados", contador: "chamados" },
  { href: "tarefas.html", rotulo: "Tarefas", icone: "tarefas", contador: "tarefas" },
  { href: "relatorios.html", rotulo: "Relatórios", icone: "relatorios" },
  { href: "visitas.html", rotulo: "Visitas", icone: "visitas" },
  { href: "maquinas.html", rotulo: "Máquinas", icone: "maquinas" },
  { href: "estoque.html", rotulo: "Estoque", icone: "estoque" },
  { secao: "Gestão", admin: true },
  { href: "supervisao.html", rotulo: "Supervisão", icone: "supervisao", admin: true },
  { href: "usuarios.html", rotulo: "Usuários", icone: "usuarios", admin: true },
  { href: "painel.html", rotulo: "Painel de TV", icone: "tv", admin: true }
];

/**
 * Monta o menu lateral. Chamada por todas as páginas internas logo depois
 * do login ser confirmado.
 * @param {object} perfil  { nome, papel }
 * @param {{ uid?: string }} [usuario]
 */
export function montarNav(perfil, usuario = null) {
  const ehAdmin = perfil.papel === "admin";
  const paginaAtual = window.location.pathname.split("/").pop() || "dashboard.html";

  let aside = document.getElementById("sidebar");
  if (!aside) {
    aside = document.createElement("aside");
    aside.id = "sidebar";
    document.body.prepend(aside);
  }
  aside.className = "sidebar";
  document.body.classList.add("com-menu");

  const iniciais = String(perfil.nome || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  aside.innerHTML = `
    <a class="sidebar-logo" href="dashboard.html"><img src="assets/logo-comm-branco.png" alt="Comm" /></a>
    <nav class="sidebar-nav" aria-label="Módulos">
      ${ITENS.filter((i) => !i.admin || ehAdmin).map((i) => i.secao
        ? `<div class="sidebar-secao">${i.secao}</div>`
        : `<a class="sidebar-link ${i.href === paginaAtual ? "ativo" : ""}" href="${i.href}">
             ${icone(i.icone)}<span>${i.rotulo}</span>
             ${i.contador ? `<span class="sidebar-contador" data-contador="${i.contador}" hidden></span>` : ""}
           </a>`).join("")}
    </nav>
    <div class="sidebar-usuario">
      <span class="avatar">${escaparHTML(iniciais)}</span>
      <span class="sidebar-usuario-info">
        <strong id="nav-nome">${escaparHTML(perfil.nome || "Usuário")}</strong>
        <small id="nav-papel">${ehAdmin ? "Supervisor/Admin" : "Técnico"}</small>
      </span>
    </div>
    <div class="sidebar-acoes">
      <a class="sidebar-link pequeno" id="nav-trocar-senha" href="redefinir-senha.html">${icone("senha")}<span>Trocar senha</span></a>
      <button type="button" class="sidebar-link pequeno" id="nav-sair">${icone("sair")}<span>Sair</span></button>
    </div>`;

  // Barra do topo no celular (☰ + logo).
  if (!document.getElementById("topo-celular")) {
    const topo = document.createElement("div");
    topo.id = "topo-celular";
    topo.className = "topo-celular";
    topo.innerHTML = `
      <button type="button" class="botao-menu" id="abrir-menu" aria-label="Abrir menu">${icone("menu")}</button>
      <a href="dashboard.html"><img src="assets/logo-comm.png" alt="Comm" /></a>
      <span class="avatar pequeno">${escaparHTML(iniciais)}</span>`;
    document.body.prepend(topo);
    const fundo = document.createElement("div");
    fundo.className = "sidebar-fundo";
    fundo.id = "sidebar-fundo";
    document.body.append(fundo);
    const alternar = (abrir) => document.body.classList.toggle("menu-aberto", abrir);
    topo.querySelector("#abrir-menu").addEventListener("click", () => alternar(true));
    fundo.addEventListener("click", () => alternar(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") alternar(false); });
  }

  document.getElementById("nav-sair").addEventListener("click", async () => {
    await sair();
    window.location.href = "index.html";
  });

  // Ctrl+K (ou Cmd+K) em qualquer página leva para a busca da tela inicial.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const campo = document.getElementById("busca-geral");
      if (campo) campo.focus();
      else window.location.href = "dashboard.html#buscar";
    }
  });

  if (usuario && usuario.uid) atualizarContadores(usuario.uid);
}

// -------------------- Contadores do menu --------------------
// Chamados: quantos em aberto estão com você. Tarefas: quantas suas faltam hoje.
let uidContadores = null;
async function atualizarContadores(uid) {
  uidContadores = uid;
  try {
    const hoje = hojeISO();
    const [chamados, tarefas, conclusoes] = await Promise.all([
      buscarTodos("chamados", (q) => q.eq("responsavel_uid", uid).neq("status", "resolvido"), "id"),
      buscarTodos("tarefas", (q) => q.eq("responsavel_uid", uid)),
      buscarTodos("tarefa_conclusoes", (q) => q.eq("data", hoje), "tarefa_id")
    ]);
    const feitas = new Set(conclusoes.map((c) => c.tarefaId));
    const pendentes = tarefas.filter((t) => valeNoDia(t, hoje) && !feitas.has(t.id)).length;
    mostrarContador("chamados", chamados.length);
    mostrarContador("tarefas", pendentes);
  } catch (err) {
    // Contador é só um atalho visual: se falhar, o menu continua funcionando.
    console.warn("Contadores do menu indisponíveis:", err.message);
  }
}

function mostrarContador(nome, valor) {
  const el = document.querySelector(`[data-contador="${nome}"]`);
  if (!el) return;
  el.textContent = valor;
  el.hidden = !valor;
}

let temporizadorContadores = null;
window.addEventListener("db-alterado", (e) => {
  if (!uidContadores || !["chamados", "tarefas", "tarefa_conclusoes"].includes(e.detail)) return;
  clearTimeout(temporizadorContadores);
  temporizadorContadores = setTimeout(() => atualizarContadores(uidContadores), 500);
});

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
