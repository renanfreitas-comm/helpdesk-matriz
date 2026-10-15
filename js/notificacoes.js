// ==========================================================================
// NOTIFICAÇÕES (sino do menu)
// ==========================================================================
// Duas fontes:
//  1. Avisos gravados pelo banco (tabela notificacoes): chamado passado para
//     você, menção com @nome, comentário no seu chamado, chamado que você
//     abriu foi resolvido, tarefa nova, chamado novo sem responsável.
//  2. Alertas calculados na hora: seus chamados vencendo ou atrasados.
// Aviso novo aparece no canto da tela e, se a pessoa permitir, também como
// notificação do navegador (quando a aba está em segundo plano).
// ==========================================================================
import { supabase, observar } from "./db.js";
import { situacaoPrazo } from "./sla.js";

const ICONE_TIPO = {
  atribuicao: ["👤", "amarelo"], mencao: ["💬", "azul"], comentario: ["💬", "azul"],
  resolvido: ["✓", "verde"], tarefa: ["☑", "roxo"], novo_chamado: ["🔔", "laranja"],
  prazo: ["⏰", "vermelho"]
};

let uid = null;
let lista = [];
let alertas = [];
let jaCarregou = false;
let vistos = new Set();
let filtro = "todas";
let botoes = [];
let painel = null;

/** Liga o sino. "ancoras" são os elementos onde o botão do sino entra. */
export function iniciarNotificacoes(usuarioId, ancoras) {
  uid = usuarioId;
  botoes = ancoras.filter(Boolean).map((ancora) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sino-botao";
    b.setAttribute("aria-label", "Notificações");
    b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><b class="sino-contador" hidden></b>`;
    b.addEventListener("click", (e) => { e.stopPropagation(); alternarPainel(b); });
    ancora.append(b);
    return b;
  });

  observar("notificacoes", (q) => q.eq("usuario_id", uid).order("criado_em", { ascending: false }), (linhas) => {
    const novas = linhas.filter((n) => !vistos.has(n.id));
    linhas.forEach((n) => vistos.add(n.id));
    lista = linhas.slice(0, 60);
    if (jaCarregou) novas.filter((n) => !n.lida).slice(0, 3).forEach(avisar);
    jaCarregou = true;
    atualizar();
  }, () => {
    // Banco ainda sem a tabela: esconde o sino em vez de mostrar erro.
    botoes.forEach((b) => (b.hidden = true));
  }, { filtroRealtime: `usuario_id=eq.${uid}` });
}

/** Chamados abertos da pessoa (vem do menu): gera os alertas de prazo. */
export function atualizarAlertasDePrazo(meusChamados) {
  alertas = meusChamados.map((c) => ({ c, s: situacaoPrazo(c) }))
    .filter((x) => x.s.estado === "perto" || x.s.atrasado)
    .sort((a, b) => Number(b.s.atrasado) - Number(a.s.atrasado))
    .map(({ c, s }) => ({
      id: "prazo-" + c.id, tipo: "prazo", lida: false, alerta: true,
      titulo: s.atrasado ? `Chamado ${c.numero || ""} está atrasado` : `Chamado ${c.numero || ""} ${s.texto.toLowerCase()}`,
      texto: [c.area, c.atividade].filter(Boolean).join(" · ").slice(0, 120),
      link: "chamados.html#c=" + encodeURIComponent(c.id)
    }));
  atualizar();
}

function naoLidas() { return lista.filter((n) => !n.lida).length + alertas.length; }

function atualizar() {
  const n = naoLidas();
  botoes.forEach((b) => {
    const c = b.querySelector(".sino-contador");
    c.textContent = n > 9 ? "9+" : n;
    c.hidden = !n;
    b.classList.toggle("tem", n > 0);
  });
  if (painel && !painel.hidden) desenharPainel();
}

// -------------------- Painel --------------------
function alternarPainel(botao) {
  if (!painel) criarPainel();
  if (!painel.hidden) { painel.hidden = true; return; }
  const r = botao.getBoundingClientRect();
  const largura = Math.min(420, window.innerWidth - 16);
  painel.style.width = largura + "px";
  painel.style.top = Math.min(r.bottom + 8, window.innerHeight - 200) + "px";
  painel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) + "px";
  painel.hidden = false;
  desenharPainel();
}

function criarPainel() {
  painel = document.createElement("div");
  painel.className = "sino-painel";
  painel.hidden = true;
  painel.setAttribute("role", "dialog");
  painel.setAttribute("aria-label", "Notificações");
  document.body.append(painel);
  document.addEventListener("click", (e) => { if (!painel.hidden && !painel.contains(e.target)) painel.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") painel.hidden = true; });
}

function desenharPainel() {
  const todas = [...alertas, ...lista];
  const visiveis = todas.filter((n) => filtro === "todas" || (filtro === "naolidas" && !n.lida) || (filtro === "mencoes" && n.tipo === "mencao"));
  const podeAtivar = "Notification" in window && Notification.permission === "default";
  painel.innerHTML = `
    <header><h3>Notificações</h3>${lista.some((n) => !n.lida) ? `<button type="button" class="link-suave js-todas-lidas">Marcar todas como lidas</button>` : ""}</header>
    <div class="sino-abas">
      ${[["todas", "Todas"], ["naolidas", `Não lidas (${naoLidas()})`], ["mencoes", "Menções"]].map(([v, r]) =>
        `<button type="button" class="chip ${filtro === v ? "on" : ""}" data-filtro="${v}">${r}</button>`).join("")}
    </div>
    <div class="sino-lista">
      ${visiveis.length ? visiveis.map((n) => {
        const [emoji, cor] = ICONE_TIPO[n.tipo] || ["🔔", "cinza"];
        return `<a class="sino-item ${n.lida ? "" : "nova"} ${n.alerta ? "alerta" : ""}" href="${esc(n.link || "#")}" data-id="${esc(n.id)}">
          <span class="modulo-icone cor-${cor}">${emoji}</span>
          <span class="sino-texto"><b>${esc(n.titulo)}</b><small>${esc([n.texto, n.criadoEm ? tempoAtras(n.criadoEm) : n.alerta ? "agora" : ""].filter(Boolean).join(" · "))}</small></span>
        </a>`;
      }).join("") : `<p class="sino-vazio">${filtro === "mencoes" ? "Ninguém mencionou você ainda. Nos comentários, use @nome para avisar alguém." : "Nada por aqui. 🎉"}</p>`}
    </div>
    <footer>
      ${podeAtivar ? `<button type="button" class="link-suave js-ativar">Avisar também quando o site estiver em segundo plano</button>`
        : "Notification" in window && Notification.permission === "granted" ? `<span>Avisos do navegador ligados</span>` : `<span>Avisos ficam aqui no sino</span>`}
    </footer>`;
  painel.querySelectorAll("[data-filtro]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); filtro = b.dataset.filtro; desenharPainel(); }));
  const todasLidas = painel.querySelector(".js-todas-lidas");
  if (todasLidas) todasLidas.addEventListener("click", (e) => { e.stopPropagation(); marcarTodasLidas(); });
  const ativar = painel.querySelector(".js-ativar");
  if (ativar) ativar.addEventListener("click", async (e) => { e.stopPropagation(); try { await Notification.requestPermission(); } catch (er) { /* ignora */ } desenharPainel(); });
  painel.querySelectorAll(".sino-item").forEach((a) => a.addEventListener("click", () => marcarLida(a.dataset.id)));
}

async function marcarLida(id) {
  const n = lista.find((x) => String(x.id) === String(id));
  if (!n || n.lida) return;
  n.lida = true;
  atualizar();
  await supabase.from("notificacoes").update({ lida: true }).eq("id", n.id);
}

async function marcarTodasLidas() {
  lista.forEach((n) => (n.lida = true));
  atualizar();
  await supabase.from("notificacoes").update({ lida: true }).eq("usuario_id", uid).eq("lida", false);
}

// -------------------- Aviso no canto + navegador --------------------
function avisar(n) {
  let pilha = document.getElementById("avisos-tela");
  if (!pilha) {
    pilha = document.createElement("div");
    pilha.id = "avisos-tela";
    pilha.className = "avisos-tela";
    pilha.setAttribute("aria-live", "polite");
    document.body.append(pilha);
  }
  const [emoji] = ICONE_TIPO[n.tipo] || ["🔔"];
  const el = document.createElement("div");
  el.className = "aviso-tela";
  el.innerHTML = `<span class="aviso-emoji">${emoji}</span>
    <div><b>${esc(n.titulo)}</b><small>${esc(n.texto || "")}</small>
      <div class="aviso-acoes">${n.link ? `<a class="botao-primario botao-pequeno" href="${esc(n.link)}">Abrir</a>` : ""}<button type="button" class="botao-secundario botao-pequeno">Fechar</button></div></div>`;
  el.querySelector("button").addEventListener("click", () => el.remove());
  const abrir = el.querySelector("a");
  if (abrir) abrir.addEventListener("click", () => marcarLida(n.id));
  pilha.append(el);
  setTimeout(() => el.remove(), 12000);

  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try {
      const sistema = new Notification(n.titulo, { body: n.texto || "", tag: "hd-" + n.id, icon: "assets/logo-comm.png" });
      sistema.onclick = () => { window.focus(); if (n.link) window.location.href = n.link; sistema.close(); };
    } catch (e) { /* alguns navegadores não deixam: fica só o aviso na tela */ }
  }
}

function tempoAtras(valor) {
  const min = Math.round((Date.now() - new Date(valor)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
