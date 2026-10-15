// ==========================================================================
// PAINEL DE TAREFAS PARA TV / MONITOR
// ==========================================================================
// Tela só de leitura, pensada para ficar aberta numa TV:
// - progresso do dia de cada técnico (tarefas feitas x pendentes);
// - chamados em aberto de cada um, com destaque para os atrasados no SLA;
// - lista das últimas tarefas concluídas e chamados resolvidos.
// Atualiza sozinha em tempo real, vira o dia à meia-noite e não desloga
// por inatividade. A conta de papel "painel" só enxerga esta tela; admins e
// técnicos também podem abri-la (painel.html) para conferir.
// ==========================================================================
import { protegerPagina, sair } from "./auth.js";
import { observar } from "./db.js";
import { situacaoPrazo, ordenarPorPrazo } from "./sla.js";
import { hojeISO, formatarDiaLongo, valeNoDia, horaCurta } from "./tarefas-util.js";

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento" };

let hoje = hojeISO();
let usuarios = [];
let tarefas = [];
let conclusoes = [];
let chamadosAbertos = [];
let resolvidosHoje = [];
let carregou = { usuarios: false, tarefas: false, conclusoes: false, chamados: false };
let pararDoDia = [];

const el = (id) => document.getElementById(id);

protegerPagina(() => {
  observar("usuarios", (q) => q.order("nome"), (linhas) => {
    usuarios = linhas.filter((u) => u.papel !== "painel");
    pronto("usuarios");
  }, mostrarErro);

  observar("tarefas", (q) => q.order("ordem").order("titulo"), (linhas) => {
    tarefas = linhas;
    pronto("tarefas");
  }, mostrarErro);

  observar("chamados", (q) => q.neq("status", "resolvido"), (linhas) => {
    chamadosAbertos = linhas.sort(ordenarPorPrazo);
    pronto("chamados");
  }, mostrarErro);

  observarDoDia();
  iniciarRelogio();
  iniciarRolagem();
  manterTelaLigada();
}, { paginaPainel: true });

// Conclusões e chamados resolvidos dependem do dia: refaz à meia-noite.
function observarDoDia() {
  pararDoDia.forEach((parar) => parar && parar());
  const dia = hoje;
  const inicioDoDia = new Date(dia + "T00:00:00").toISOString();
  pararDoDia = [
    observar("tarefa_conclusoes", (q) => q.eq("data", dia), (linhas) => {
      if (dia !== hoje) return;
      conclusoes = linhas;
      pronto("conclusoes");
    }, mostrarErro, { filtroRealtime: `data=eq.${dia}` }),
    observar("chamados", (q) => q.eq("status", "resolvido").gte("resolvido_em", inicioDoDia), (linhas) => {
      if (dia !== hoje) return;
      resolvidosHoje = linhas;
      renderizar();
    }, () => {})
  ];
}

function pronto(parte) {
  carregou[parte] = true;
  marcarConexao(true);
  renderizar();
}

function mostrarErro(erro) {
  marcarConexao(false);
  console.warn("Painel:", erro && erro.message);
}

// -------------------- Desenho --------------------
function renderizar() {
  if (!Object.values(carregou).every(Boolean)) return;

  const feitas = new Map(conclusoes.map((c) => [String(c.tarefaId), c]));
  const doDia = tarefas.filter((t) => valeNoDia(t, hoje));
  const agora = new Date();

  // Uma coluna por pessoa: técnicos sempre; admins só se tiverem algo hoje.
  const pessoas = usuarios.map((u) => {
    const minhas = doDia.filter((t) => t.responsavelUid === u.id);
    const chamados = chamadosAbertos.filter((c) => c.responsavelUid === u.id);
    return {
      u, chamados,
      pendentes: minhas.filter((t) => !feitas.has(String(t.id))),
      concluidas: minhas.filter((t) => feitas.has(String(t.id))),
      total: minhas.length
    };
  }).filter((p) => p.u.papel === "tecnico" || p.total > 0 || p.chamados.length > 0);

  // Topo: números gerais
  const total = pessoas.reduce((s, p) => s + p.total, 0);
  const feitasTotal = pessoas.reduce((s, p) => s + p.concluidas.length, 0);
  const pct = total ? Math.round((feitasTotal / total) * 100) : 0;
  const atrasados = chamadosAbertos.filter((c) => situacaoPrazo(c, agora).atrasado).length;
  el("tv-anel").style.setProperty("--p", pct);
  el("tv-percentual").textContent = total ? `${pct}%` : "—";
  el("tv-feitas").textContent = `${feitasTotal} de ${total} tarefa${total === 1 ? "" : "s"} feita${total === 1 ? "" : "s"}`;
  el("tv-faltam").textContent = !total ? "Nenhuma tarefa para hoje"
    : feitasTotal === total ? "Tudo feito hoje!" : `Faltam ${total - feitasTotal}`;
  el("tv-num-pendentes").textContent = total - feitasTotal;
  el("tv-num-chamados").textContent = chamadosAbertos.length;
  el("tv-num-atrasados").textContent = atrasados;
  el("tv-caixa-atrasados").classList.toggle("ativo", atrasados > 0);

  // Cards
  const semDono = chamadosAbertos.filter((c) => !c.responsavelUid);
  const cards = pessoas.map((p) => cardPessoa(p, agora));
  if (semDono.length) cards.push(cardSemResponsavel(semDono, agora));
  el("tv-equipe").innerHTML = cards.join("") || `<p class="tv-vazio">Nenhum técnico cadastrado.</p>`;
  el("tv-equipe").dataset.colunas = String(Math.min(Math.max(cards.length, 1), 4));

  renderizarFeed();
}

function cardPessoa(p, agora) {
  const pct = p.total ? Math.round((p.concluidas.length / p.total) * 100) : 0;
  const temAtraso = p.chamados.some((c) => situacaoPrazo(c, agora).atrasado);
  const completo = p.total > 0 && p.pendentes.length === 0;
  const iniciais = String(p.u.nome || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  const listaPendentes = p.pendentes.map((t) =>
    `<li class="tv-tarefa"><span class="tv-caixa"></span>${esc(t.titulo)}</li>`).join("");
  const listaFeitas = p.concluidas.map((t) =>
    `<li class="tv-tarefa feita"><span class="tv-caixa">✓</span><span class="tv-tarefa-titulo">${esc(t.titulo)}</span></li>`).join("");

  let corpo;
  if (!p.total) corpo = `<p class="tv-nada">Sem tarefas para hoje</p>`;
  else if (completo) corpo = `<p class="tv-tudo-feito">✓ Todas as tarefas feitas</p><ul class="tv-lista">${listaFeitas}</ul>`;
  else corpo = `<ul class="tv-lista">${listaPendentes}${listaFeitas}</ul>`;

  return `
    <article class="tv-card ${completo ? "completo" : ""} ${temAtraso ? "com-atraso" : ""}">
      <header class="tv-card-topo">
        <span class="tv-avatar">${esc(iniciais)}</span>
        <h3>${esc(p.u.nome)}</h3>
        <span class="tv-placar">${p.concluidas.length}/${p.total}</span>
      </header>
      <div class="tv-barra"><div style="width:${pct}%"></div></div>
      ${corpo}
      ${blocoChamados(p.chamados, agora)}
    </article>`;
}

function cardSemResponsavel(chamados, agora) {
  return `
    <article class="tv-card sem-dono">
      <header class="tv-card-topo">
        <span class="tv-avatar">?</span>
        <h3>Chamados sem responsável</h3>
        <span class="tv-placar">${chamados.length}</span>
      </header>
      ${blocoChamados(chamados, agora, true)}
    </article>`;
}

function blocoChamados(chamados, agora, semTitulo = false) {
  if (!chamados.length) return "";
  return `
    <div class="tv-chamados">
      ${semTitulo ? "" : `<h4>Chamados (${chamados.length})</h4>`}
      <ul>
        ${chamados.map((c) => {
          const s = situacaoPrazo(c, agora);
          return `
            <li class="tv-chamado prazo-${s.estado}">
              <span class="tv-prio prio-${esc(c.prioridade)}" title="Prioridade ${esc(ROTULOS_PRIORIDADE[c.prioridade] || c.prioridade)}"></span>
              <span class="tv-chamado-texto">
                <strong>#${esc(c.numero)}</strong> ${esc(c.area)} — ${esc(c.atividade)}
              </span>
              <span class="tv-prazo">${esc(s.texto)}${c.status === "andamento" ? ` · ${ROTULOS_STATUS.andamento}` : ""}</span>
            </li>`;
        }).join("")}
      </ul>
    </div>`;
}

function renderizarFeed() {
  const porId = new Map(tarefas.map((t) => [String(t.id), t]));
  const itens = [
    ...conclusoes.map((c) => {
      const t = porId.get(String(c.tarefaId));
      return {
        quando: c.concluidaEm, tipo: "tarefa",
        titulo: t ? t.titulo : "Tarefa",
        quem: (t && t.responsavelNome) || c.concluidaPorNome || ""
      };
    }),
    ...resolvidosHoje.map((c) => ({
      quando: c.resolvidoEm, tipo: "chamado",
      titulo: `Chamado #${c.numero} resolvido`,
      quem: c.responsavelNome || ""
    }))
  ].filter((i) => i.quando).sort((a, b) => String(b.quando).localeCompare(String(a.quando))).slice(0, 14);

  el("tv-feed").innerHTML = itens.length
    ? itens.map((i) => `
        <li class="tv-feed-item ${i.tipo}">
          <span class="tv-feed-hora">${horaCurta(i.quando)}</span>
          <span class="tv-feed-texto"><strong>${esc(i.titulo)}</strong><small>${esc(i.quem)}</small></span>
        </li>`).join("")
    : `<li class="tv-feed-vazio">Nada concluído ainda hoje.</li>`;
}

// -------------------- Relógio, dia e conexão --------------------
function iniciarRelogio() {
  const tique = () => {
    const agora = new Date();
    el("tv-hora").textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const novoDia = hojeISO();
    if (novoDia !== hoje) {
      hoje = novoDia;
      conclusoes = [];
      resolvidosHoje = [];
      observarDoDia();
    }
    el("tv-data").textContent = formatarDiaLongo(hoje);
  };
  tique();
  setInterval(tique, 1000);
  // Prazos de SLA mudam com o tempo, mesmo sem novos dados.
  setInterval(renderizar, 60000);
}

function marcarConexao(ok) {
  const c = el("tv-conexao");
  const online = ok && navigator.onLine;
  c.textContent = online ? "ao vivo" : "sem conexão";
  c.classList.toggle("offline", !online);
}
window.addEventListener("online", () => marcarConexao(true));
window.addEventListener("offline", () => marcarConexao(false));

// -------------------- Rolagem automática --------------------
// Se os cards não couberem na tela, rola devagar até o fim e volta.
function iniciarRolagem() {
  const area = el("tv-equipe");
  let pausaAte = Date.now() + 6000;
  let indo = 1;
  setInterval(() => {
    const sobra = area.scrollHeight - area.clientHeight;
    if (sobra <= 4 || Date.now() < pausaAte) return;
    area.scrollTop += indo;
    if (indo > 0 && area.scrollTop >= sobra - 1) { pausaAte = Date.now() + 6000; indo = -1; }
    else if (indo < 0 && area.scrollTop <= 0) { pausaAte = Date.now() + 6000; indo = 1; }
    if (indo < 0) area.scrollTop -= 3; // volta mais rápido
  }, 40);
}

// -------------------- TV: tela ligada, cursor e controles --------------------
let travaTela = null;
async function manterTelaLigada() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      travaTela = await navigator.wakeLock.request("screen");
    }
  } catch (e) { /* navegador não permite: tudo bem */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !travaTela) manterTelaLigada();
  if (document.visibilityState === "hidden") travaTela = null;
});

let esconderControles = null;
function mostrarControles() {
  document.body.classList.add("mostrando-controles");
  clearTimeout(esconderControles);
  esconderControles = setTimeout(() => document.body.classList.remove("mostrando-controles"), 4000);
}
["mousemove", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, mostrarControles, { passive: true }));

el("tv-tela-cheia").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", () => {
  el("tv-tela-cheia").textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
});
el("tv-sair").addEventListener("click", async () => {
  if (!confirm("Sair do painel?")) return;
  await sair();
  window.location.href = "index.html";
});

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
