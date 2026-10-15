// ==========================================================================
// INDICADORES DO TIME (aba "Indicadores" da tela de Supervisão)
// ==========================================================================
// Tudo é calculado no navegador a partir dos chamados, tarefas e conclusões.
// Cada número é comparado com o período anterior de mesmo tamanho.
// Cores dos gráficos (validadas para daltonismo e contraste):
//   abertos #5b7fd1 · resolvidos / no prazo #b77f00 · fora do prazo #b91c1c
// ==========================================================================
import { situacaoPrazo, PRAZO_HORAS } from "./sla.js";
import { valeNoDia, somarDias, hojeISO } from "./tarefas-util.js";

const COR = { abertos: "#5b7fd1", resolvidos: "#b77f00", fora: "#b91c1c", area: "#5b7fd1" };
const META_SLA = 90;
const NOMES_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const diaLocal = (valor) => {
  if (!valor) return null;
  const d = new Date(valor);
  if (isNaN(d)) return null;
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const dias = (ini, fim) => { const l = []; for (let d = ini; d <= fim; d = somarDias(d, 1)) l.push(d); return l; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);

/** Calcula os números de um período. */
function calcular({ chamados, tarefas, conclusoes, ini, fim, tecnico }) {
  const doTec = (c) => !tecnico || c.responsavelUid === tecnico;
  const resolvidos = chamados.filter((c) => c.status === "resolvido" && doTec(c) && between(diaLocal(c.resolvidoEm || c.atualizadoEm), ini, fim));
  const abertos = chamados.filter((c) => doTec(c) && between(diaLocal(c.criadoEm), ini, fim));
  const noPrazo = resolvidos.filter((c) => situacaoPrazo(c).estado === "cumprido");
  const tempos = resolvidos.map((c) => new Date(c.resolvidoEm) - new Date(c.criadoEm)).filter((ms) => ms > 0);
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;

  // Tarefas: só dias até hoje (o futuro ainda não aconteceu).
  const ate = fim < hojeISO() ? fim : hojeISO();
  const feitas = new Set(conclusoes.map((c) => `${c.tarefaId}|${c.data}`));
  let previstas = 0, cumpridas = 0;
  const porDiaSemana = Array.from({ length: 7 }, () => ({ p: 0, c: 0 }));
  if (ini <= ate) {
    for (const d of dias(ini, ate)) {
      const dow = new Date(d + "T12:00:00").getDay();
      for (const t of tarefas) {
        if (tecnico && t.responsavelUid !== tecnico) continue;
        if (!t.responsavelUid || !valeNoDia(t, d)) continue;
        previstas++; porDiaSemana[dow].p++;
        if (feitas.has(`${t.id}|${d}`)) { cumpridas++; porDiaSemana[dow].c++; }
      }
    }
  }
  return { resolvidos, abertos, noPrazo, tempoMedio, previstas, cumpridas, porDiaSemana };
}
function between(d, ini, fim) { return d && d >= ini && d <= fim; }

/**
 * Desenha a aba de indicadores.
 * @param {HTMLElement} el
 * @param {{chamados, tarefas, conclusoes, usuarios, ini, fim, tecnico}} dados
 */
export function desenharIndicadores(el, dados) {
  const { ini, fim, usuarios } = dados;
  const tamanho = dias(ini, fim).length;
  const antIni = somarDias(ini, -tamanho), antFim = somarDias(ini, -1);
  const atual = calcular(dados);
  const anterior = calcular({ ...dados, ini: antIni, fim: antFim });

  const slaAtual = pct(atual.noPrazo.length, atual.resolvidos.length);
  const slaAnt = pct(anterior.noPrazo.length, anterior.resolvidos.length);
  const tarAtual = pct(atual.cumpridas, atual.previstas);
  const tarAnt = pct(anterior.cumpridas, anterior.previstas);

  const kpis = [
    kpi("Chamados resolvidos", String(atual.resolvidos.length), variacao(atual.resolvidos.length, anterior.resolvidos.length, "num")),
    kpi("Resolvidos no prazo (SLA)", slaAtual === null ? "—" : `${slaAtual}%`,
      variacao(slaAtual, slaAnt, "pp") + (slaAtual === null ? "" : ` · meta ${META_SLA}% ${slaAtual >= META_SLA ? "✓" : "✗"}`),
      slaAtual !== null && slaAtual < META_SLA),
    kpi("Tempo médio de resolução", atual.tempoMedio ? duracao(atual.tempoMedio) : "—", variacaoTempo(atual.tempoMedio, anterior.tempoMedio)),
    kpi("Tarefas diárias cumpridas", tarAtual === null ? "—" : `${tarAtual}%`, variacao(tarAtual, tarAnt, "pp") + (atual.previstas ? ` · ${atual.cumpridas} de ${atual.previstas}` : ""))
  ].join("");

  el.innerHTML = `
    <div class="kpis">${kpis}</div>
    <div class="ind-grade">
      <div class="card ind-card">
        <h3>Chamados abertos × resolvidos</h3>
        <p class="sub">${tamanho > 31 ? "Por semana" : "Por dia"} · ${fmt(ini)} a ${fmt(fim)}</p>
        ${graficoDiario(dados.chamados, ini, fim, dados.tecnico)}
        <h3 style="margin-top:18px">Prazo cumprido por prioridade</h3>
        <p class="sub">Chamados resolvidos no período</p>
        ${slaPorPrioridade(atual.resolvidos)}
      </div>
      <div class="card ind-card">
        <h3>Carga por técnico</h3>
        <p class="sub">Chamados resolvidos no período</p>
        ${cargaPorTecnico(atual.resolvidos, usuarios, dados.tecnico)}
        <h3 style="margin-top:18px">Áreas que mais abrem chamado</h3>
        <p class="sub">Chamados abertos no período</p>
        ${areas(atual.abertos)}
        ${leitura(atual, slaAtual, usuarios)}
      </div>
    </div>`;
}

function kpi(rotulo, valor, detalhe, alerta = false) {
  return `<div class="card kpi ${alerta ? "kpi-alerta" : ""}"><small>${rotulo}</small><strong>${valor}</strong><em>${detalhe || "&nbsp;"}</em></div>`;
}
function variacao(a, b, tipo) {
  if (a === null || b === null || b === undefined) return `<span class="neutro">sem base de comparação</span>`;
  const dif = a - b;
  if (tipo === "num") {
    if (!b) return dif ? `<span class="sobe">▲ ${dif} vs. anterior</span>` : `<span class="neutro">= anterior</span>`;
    const p = Math.round((100 * dif) / b);
    return p === 0 ? `<span class="neutro">= anterior</span>` : `<span class="${p > 0 ? "sobe" : "desce"}">${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% vs. anterior</span>`;
  }
  return dif === 0 ? `<span class="neutro">= anterior</span>` : `<span class="${dif > 0 ? "sobe" : "desce"}">${dif > 0 ? "▲" : "▼"} ${Math.abs(dif)} p.p. vs. anterior</span>`;
}
function variacaoTempo(a, b) {
  if (!a || !b) return `<span class="neutro">sem base de comparação</span>`;
  const dif = a - b;
  if (Math.abs(dif) < 60000) return `<span class="neutro">= anterior</span>`;
  return dif < 0 ? `<span class="sobe">▼ ${duracao(-dif)} mais rápido</span>` : `<span class="desce">▲ ${duracao(dif)} mais lento</span>`;
}
function duracao(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  return `${Math.round(h / 24)} dias`;
}
const fmt = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

// ---------- Gráfico de barras agrupadas (abertos × resolvidos) ----------
function graficoDiario(chamados, ini, fim, tecnico) {
  const todos = dias(ini, fim);
  const porSemana = todos.length > 31;
  const grupos = [];
  if (porSemana) {
    for (let i = 0; i < todos.length; i += 7) grupos.push({ rotulo: fmt(todos[i]), dias: todos.slice(i, i + 7) });
  } else {
    todos.forEach((d) => grupos.push({ rotulo: todos.length > 14 ? d.slice(8) : `${NOMES_DIA[new Date(d + "T12:00:00").getDay()]} ${d.slice(8)}`, dias: [d] }));
  }
  const doTec = (c) => !tecnico || c.responsavelUid === tecnico;
  const dados = grupos.map((g) => {
    const set = new Set(g.dias);
    return {
      rotulo: g.rotulo, periodo: g.dias.length > 1 ? `${fmt(g.dias[0])} a ${fmt(g.dias[g.dias.length - 1])}` : fmt(g.dias[0]),
      a: chamados.filter((c) => doTec(c) && set.has(diaLocal(c.criadoEm))).length,
      r: chamados.filter((c) => doTec(c) && c.status === "resolvido" && set.has(diaLocal(c.resolvidoEm))).length
    };
  });
  const max = Math.max(1, ...dados.flatMap((d) => [d.a, d.r]));
  const W = 640, H = 200, base = H - 26, topo = 14, esq = 28;
  const largGrupo = (W - esq) / dados.length;
  const larg = Math.max(3, Math.min(22, (largGrupo - 6) / 2));
  const y = (v) => base - (v / max) * (base - topo);
  const passo = max <= 5 ? 1 : Math.ceil(max / 4);
  const linhas = []; for (let v = 0; v <= max; v += passo) linhas.push(v);
  const barra = (x, v, cor) => {
    if (!v) return "";
    const h = base - y(v), r = Math.min(4, h / 2, larg / 2);
    return `<path d="M${x},${base} V${y(v) + r} q0,-${r} ${r},-${r} h${larg - 2 * r} q${r},0 ${r},${r} V${base} Z" fill="${cor}"/>`;
  };
  const mostrarRotulo = (i) => dados.length <= 16 || i % Math.ceil(dados.length / 12) === 0;
  const svg = `
    <svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chamados abertos e resolvidos ${porSemana ? "por semana" : "por dia"}">
      ${linhas.map((v) => `<line x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${esq - 6}" y="${y(v) + 4}" text-anchor="end" class="eixo">${v}</text>`).join("")}
      ${dados.map((d, i) => {
        const x0 = esq + i * largGrupo + (largGrupo - (2 * larg + 2)) / 2;
        return `<g class="grupo-barra"><title>${d.periodo}: ${d.a} aberto(s), ${d.r} resolvido(s)</title>
          <rect x="${esq + i * largGrupo}" y="${topo}" width="${largGrupo}" height="${base - topo}" fill="transparent"/>
          ${barra(x0, d.a, COR.abertos)}${barra(x0 + larg + 2, d.r, COR.resolvidos)}
          ${mostrarRotulo(i) ? `<text x="${esq + i * largGrupo + largGrupo / 2}" y="${H - 8}" text-anchor="middle" class="eixo">${d.rotulo}</text>` : ""}</g>`;
      }).join("")}
      <line x1="${esq}" x2="${W}" y1="${base}" y2="${base}" stroke="#d1d5db"/>
    </svg>`;
  const totA = dados.reduce((s, d) => s + d.a, 0), totR = dados.reduce((s, d) => s + d.r, 0);
  return svg + `<div class="legenda-grafico"><span style="--c:${COR.abertos}">Abertos (${totA})</span><span style="--c:${COR.resolvidos}">Resolvidos (${totR})</span></div>`;
}

function slaPorPrioridade(resolvidos) {
  return `<div class="sla-prio">${["alta", "media", "baixa"].map((p) => {
    const l = resolvidos.filter((c) => c.prioridade === p);
    const v = pct(l.filter((c) => situacaoPrazo(c).estado === "cumprido").length, l.length);
    return `<div class="${v !== null && v < META_SLA ? "abaixo" : ""}"><b>${v === null ? "—" : v + "%"}</b>${{ alta: "Alta", media: "Média", baixa: "Baixa" }[p]} (${PRAZO_HORAS[p]} h)<small>${l.length} chamado${l.length === 1 ? "" : "s"}</small></div>`;
  }).join("")}</div>`;
}

function cargaPorTecnico(resolvidos, usuarios, tecnico) {
  const pessoas = usuarios.filter((u) => !tecnico || u.uid === tecnico).map((u) => {
    const dele = resolvidos.filter((c) => c.responsavelUid === u.uid);
    const ok = dele.filter((c) => situacaoPrazo(c).estado === "cumprido").length;
    return { nome: u.nome, total: dele.length, ok, fora: dele.length - ok };
  }).filter((p) => p.total || !tecnico).sort((a, b) => b.total - a.total);
  if (!pessoas.some((p) => p.total)) return `<p class="vazio-curto">Nenhum chamado resolvido no período.</p>`;
  const max = Math.max(...pessoas.map((p) => p.total));
  return pessoas.map((p) => `
    <div class="carga" title="${esc(p.nome)}: ${p.ok} no prazo, ${p.fora} fora do prazo">
      <span>${esc(p.nome.split(" ")[0])}</span>
      <div class="trilho">${p.ok ? `<i style="width:${(100 * p.ok) / max}%;background:${COR.resolvidos}"></i>` : ""}${p.fora ? `<i style="width:${(100 * p.fora) / max}%;background:${COR.fora}"></i>` : ""}</div>
      <b>${p.total}${p.fora ? ` <small>(${p.fora} fora)</small>` : ""}</b>
    </div>`).join("") +
    `<div class="legenda-grafico"><span style="--c:${COR.resolvidos}">No prazo</span><span style="--c:${COR.fora}">Fora do prazo</span></div>`;
}

function areas(abertos) {
  const cont = {};
  abertos.forEach((c) => { const a = (c.area || "Sem área").trim(); cont[a] = (cont[a] || 0) + 1; });
  const lista = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!lista.length) return `<p class="vazio-curto">Nenhum chamado aberto no período.</p>`;
  const max = lista[0][1];
  return lista.map(([a, n]) => `<div class="carga"><span title="${esc(a)}">${esc(a)}</span><div class="trilho"><i style="width:${(100 * n) / max}%;background:${COR.area}"></i></div><b>${n}</b></div>`).join("");
}

// Frases curtas com o que merece atenção.
function leitura(atual, sla, usuarios) {
  const frases = [];
  if (sla !== null) frases.push(sla >= META_SLA ? `SLA em ${sla}%, dentro da meta de ${META_SLA}%.` : `SLA em ${sla}%, abaixo da meta de ${META_SLA}%.`);
  const prios = ["alta", "media", "baixa"].map((p) => {
    const l = atual.resolvidos.filter((c) => c.prioridade === p);
    return { p, n: l.length, v: pct(l.filter((c) => situacaoPrazo(c).estado === "cumprido").length, l.length) };
  }).filter((x) => x.n >= 2 && x.v < META_SLA).sort((a, b) => a.v - b.v);
  if (prios.length) frases.push(`Prioridade ${{ alta: "alta", media: "média", baixa: "baixa" }[prios[0].p]} é a mais atrasada (${prios[0].v}% no prazo).`);
  const fora = {};
  atual.resolvidos.filter((c) => situacaoPrazo(c).estado !== "cumprido").forEach((c) => { fora[c.responsavelUid] = (fora[c.responsavelUid] || 0) + 1; });
  const pior = Object.entries(fora).sort((a, b) => b[1] - a[1])[0];
  if (pior && pior[1] >= 2) {
    const u = usuarios.find((x) => x.uid === pior[0]);
    if (u) frases.push(`${u.nome.split(" ")[0]} concentra ${pior[1]} dos chamados fora do prazo.`);
  }
  const cont = {};
  atual.abertos.forEach((c) => { const a = (c.area || "").trim(); if (a) cont[a] = (cont[a] || 0) + 1; });
  const topo = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  if (topo && atual.abertos.length >= 5) frases.push(`${topo[0]} abriu ${pct(topo[1], atual.abertos.length)}% dos chamados.`);
  const fracos = atual.porDiaSemana.map((x, i) => ({ i, v: pct(x.c, x.p), p: x.p })).filter((x) => x.p >= 3).sort((a, b) => a.v - b.v);
  if (fracos.length >= 2 && fracos[0].v < 80) frases.push(`${{ 0: "Aos domingos", 1: "Às segundas", 2: "Às terças", 3: "Às quartas", 4: "Às quintas", 5: "Às sextas", 6: "Aos sábados" }[fracos[0].i]} as tarefas diárias ficam mais para trás (${fracos[0].v}% cumpridas).`);
  if (!frases.length) return "";
  return `<div class="leitura"><b>💡 Para olhar</b><ul>${frases.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
}

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
