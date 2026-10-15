// ==========================================================================
// TELA AGENDA DA EQUIPE
// ==========================================================================
// Semana por pessoa: férias, atestados, folgas, plantões e treinamentos
// (tabela agenda_eventos), mais as visitas técnicas e as tarefas do dia, que
// vêm dos módulos Visitas e Tarefas.
// Cada um lança na própria linha; o admin lança para qualquer pessoa.
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, inserir, atualizar, excluir } from "./db.js";
import { hojeISO, somarDias, valeNoDia } from "./tarefas-util.js";
import { TIPOS_AGENDA, AUSENCIAS } from "./agenda-util.js";

let usuarioAtual = null;
let perfilAtual = null;
let pessoas = [];
let eventos = [];
let visitas = [];
let tarefas = [];
let conclusoes = [];
let inicioSemana = segundaDe(hojeISO());
let pararSemana = [];

const ehAdmin = () => perfilAtual && perfilAtual.papel === "admin";
const grade = document.getElementById("grade-agenda");
const modal = document.getElementById("modal-evento");
const form = document.getElementById("form-evento");
const NOMES_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function segundaDe(iso) {
  const d = new Date(iso + "T12:00:00");
  const recuo = (d.getDay() + 6) % 7; // segunda = 0
  return somarDias(iso, -recuo);
}
function diasDaSemana() {
  const fds = document.getElementById("mostrar-fds").checked;
  return Array.from({ length: fds ? 7 : 5 }, (_, i) => somarDias(inicioSemana, i));
}

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil, user);

  observar("usuarios", (q) => q.order("nome"), (linhas) => {
    pessoas = linhas.filter((u) => u.papel !== "painel");
    preencherPessoas();
    renderizar();
  });
  observar("agenda_eventos", (q) => q.order("inicio"), (linhas) => { eventos = linhas; renderizar(); }, mostrarErro);
  observar("tarefas", (q) => q, (linhas) => { tarefas = linhas; renderizar(); });
  observarSemana();
});

function mostrarErro(erro) {
  grade.innerHTML = `<p class="vazio">Não foi possível carregar a agenda: ${esc(erro.message)}<br><small>Se acabou de atualizar o site, rode o supabase/schema.sql de novo no Supabase.</small></p>`;
}

// Visitas e conclusões dependem da semana: troca a observação junto.
function observarSemana() {
  pararSemana.forEach((p) => p && p());
  const ini = inicioSemana, fim = somarDias(inicioSemana, 6);
  pararSemana = [
    observar("visitas", (q) => q.gte("data", ini).lte("data", fim).order("data"), (linhas) => { visitas = linhas.filter((v) => v.status !== "cancelada"); renderizar(); }),
    observar("tarefa_conclusoes", (q) => q.gte("data", ini).lte("data", fim), (linhas) => { conclusoes = linhas; renderizar(); })
  ];
}

function trocarSemana(novoInicio) {
  inicioSemana = novoInicio;
  visitas = []; conclusoes = [];
  observarSemana();
  renderizar();
}
document.getElementById("semana-anterior").addEventListener("click", () => trocarSemana(somarDias(inicioSemana, -7)));
document.getElementById("semana-seguinte").addEventListener("click", () => trocarSemana(somarDias(inicioSemana, 7)));
document.getElementById("semana-hoje").addEventListener("click", () => trocarSemana(segundaDe(hojeISO())));
document.getElementById("mostrar-fds").addEventListener("change", renderizar);

// -------------------- Desenho --------------------
function eventosDe(uid, dia) {
  return eventos.filter((e) => e.usuarioId === uid && e.inicio <= dia && e.fim >= dia);
}

function renderizar() {
  if (!usuarioAtual) return;
  const hoje = hojeISO();
  const dias = diasDaSemana();
  const [, mi, di] = dias[0].split("-");
  const [, mf, df] = dias[dias.length - 1].split("-");
  document.getElementById("titulo-semana").textContent = `Semana de ${di}/${mi} a ${df}/${mf}`;
  renderizarResumo(hoje);

  const feitas = new Set(conclusoes.map((c) => `${c.tarefaId}|${c.data}`));
  grade.style.gridTemplateColumns = `170px repeat(${dias.length}, minmax(120px, 1fr))`;

  let html = `<div class="ag-cab">Pessoa</div>` + dias.map((d) => {
    const dt = new Date(d + "T12:00:00");
    return `<div class="ag-cab ${d === hoje ? "hoje" : ""}">${NOMES_DIA[dt.getDay()]} ${d.slice(8)}${d === hoje ? " · hoje" : ""}</div>`;
  }).join("");

  // Linha das visitas técnicas (do módulo Visitas)
  html += `<div class="ag-pessoa"><span class="modulo-icone cor-azul ag-ic">📍</span><span>Visitas<small>do módulo Visitas</small></span></div>` +
    dias.map((d) => {
      const doDia = visitas.filter((v) => v.data === d);
      return `<div class="ag-dia ${d === hoje ? "hoje" : ""}">${doDia.map((v) =>
        `<a class="ev ev-visita" href="visitas.html#v=${encodeURIComponent(v.id)}" title="${esc(v.titulo)}">📍 ${esc(v.titulo)}<small>${esc([v.recursoResponsavel, v.cidade].filter(Boolean).join(" · "))}</small></a>`).join("")}</div>`;
    }).join("");

  html += pessoas.map((p) => {
    const iniciais = String(p.nome || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
    const podeLancar = ehAdmin() || p.id === usuarioAtual.uid;
    return `<div class="ag-pessoa"><span class="avatar">${esc(iniciais)}</span><span>${esc(p.nome)}<small>${p.papel === "admin" ? "Supervisão" : "Técnico"}</small></span></div>` +
      dias.map((d) => {
        const evs = eventosDe(p.id, d);
        const ausente = evs.some((e) => AUSENCIAS.includes(e.tipo));
        const minhas = tarefas.filter((t) => t.responsavelUid === p.id && valeNoDia(t, d));
        let tarefaHtml = "";
        if (minhas.length && !ausente) {
          const ok = minhas.filter((t) => feitas.has(`${t.id}|${d}`)).length;
          tarefaHtml = d <= hoje
            ? `<span class="ev ev-tarefas ${ok === minhas.length ? "completo" : ""}">☑ ${ok} de ${minhas.length} tarefa${minhas.length === 1 ? "" : "s"}</span>`
            : `<span class="ev ev-tarefas futuro">☑ ${minhas.length} tarefa${minhas.length === 1 ? "" : "s"}</span>`;
        }
        return `<div class="ag-dia ${d === hoje ? "hoje" : ""} ${podeLancar ? "pode" : ""}" data-pessoa="${p.id}" data-dia="${d}">
          ${evs.map((e) => {
            const t = TIPOS_AGENDA[e.tipo] || TIPOS_AGENDA.outro;
            const editavel = ehAdmin() || e.usuarioId === usuarioAtual.uid;
            return `<button type="button" class="ev ev-${e.tipo}" data-evento="${e.id}" ${editavel ? "" : "disabled"} title="${esc(t.rotulo)}${e.observacao ? " — " + esc(e.observacao) : ""}">${t.emoji} ${t.rotulo}${e.observacao ? `<small>${esc(e.observacao)}</small>` : ""}</button>`;
          }).join("")}
          ${tarefaHtml}
        </div>`;
      }).join("");
  }).join("");

  grade.innerHTML = html;
  grade.querySelectorAll("button.ev[data-evento]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); abrirModal({ id: b.dataset.evento }); }));
  grade.querySelectorAll(".ag-dia.pode").forEach((c) => c.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    abrirModal({ pessoa: c.dataset.pessoa, dia: c.dataset.dia });
  }));
}

function renderizarResumo(hoje) {
  const fora = pessoas.filter((p) => eventosDe(p.id, hoje).some((e) => AUSENCIAS.includes(e.tipo)));
  const plantao = pessoas.filter((p) => eventosDe(p.id, hoje).some((e) => e.tipo === "plantao"));
  const visitasHoje = visitas.filter((v) => v.data === hoje);
  const primeiro = (l) => l.map((p) => p.nome.split(" ")[0]).join(", ");
  document.getElementById("resumo-hoje").innerHTML = `
    <div class="card"><span class="modulo-icone cor-verde">✓</span><span><strong>${pessoas.length - fora.length}</strong><small>disponíveis hoje</small></span></div>
    <div class="card"><span class="modulo-icone cor-azul">📍</span><span><strong>${visitasHoje.length}</strong><small>visita${visitasHoje.length === 1 ? "" : "s"} hoje</small></span></div>
    <div class="card"><span class="modulo-icone cor-vermelho">🌴</span><span><strong>${fora.length ? esc(primeiro(fora)) : "0"}</strong><small>${fora.length ? "fora hoje" : "ninguém fora hoje"}</small></span></div>
    <div class="card"><span class="modulo-icone cor-roxo">🛡</span><span><strong>${plantao.length ? esc(primeiro(plantao)) : "—"}</strong><small>de plantão hoje</small></span></div>`;
}

// -------------------- Modal --------------------
const tiposEl = document.getElementById("evento-tipos");
tiposEl.innerHTML = Object.entries(TIPOS_AGENDA).map(([v, t]) => `<button type="button" class="chip" data-valor="${v}">${t.emoji} ${t.rotulo}</button>`).join("");
tiposEl.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => marcarTipo(b.dataset.valor)));
function marcarTipo(v) {
  tiposEl.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.valor === v));
  document.getElementById("evento-aviso").textContent = AUSENCIAS.includes(v)
    ? "Enquanto estiver fora: não aparece para receber chamados novos, some do Painel de TV e não recebe o relatório das 18h."
    : "";
}

function preencherPessoas() {
  const sel = document.getElementById("evento-pessoa");
  const lista = ehAdmin() ? pessoas : pessoas.filter((p) => p.id === usuarioAtual.uid);
  sel.innerHTML = lista.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("");
}

document.getElementById("btn-novo-evento").addEventListener("click", () => abrirModal({}));
document.getElementById("btn-cancelar-evento").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("aberto")) fecharModal(); });

function abrirModal({ id = null, pessoa = null, dia = null }) {
  const ev = id ? eventos.find((e) => e.id === id) : null;
  form.reset();
  document.getElementById("evento-erro").textContent = "";
  document.getElementById("evento-id").value = ev ? ev.id : "";
  document.getElementById("evento-modal-titulo").textContent = ev ? "Editar lançamento" : "Lançar ausência / plantão";
  document.getElementById("evento-pessoa").value = ev ? ev.usuarioId : (pessoa || usuarioAtual.uid);
  document.getElementById("evento-pessoa").disabled = Boolean(ev) || !ehAdmin();
  const d = dia || hojeISO();
  document.getElementById("evento-inicio").value = ev ? ev.inicio : d;
  document.getElementById("evento-fim").value = ev ? ev.fim : d;
  document.getElementById("evento-obs").value = ev ? ev.observacao : "";
  marcarTipo(ev ? ev.tipo : "ferias");
  document.getElementById("btn-excluir-evento").hidden = !ev;
  modal.classList.add("aberto");
}

function fecharModal() { modal.classList.remove("aberto"); }

document.getElementById("evento-inicio").addEventListener("change", (e) => {
  const fim = document.getElementById("evento-fim");
  if (!fim.value || fim.value < e.target.value) fim.value = e.target.value;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = document.getElementById("evento-erro");
  const id = document.getElementById("evento-id").value;
  const dados = {
    usuarioId: document.getElementById("evento-pessoa").value,
    tipo: tiposEl.querySelector(".chip.on")?.dataset.valor || "outro",
    inicio: document.getElementById("evento-inicio").value,
    fim: document.getElementById("evento-fim").value,
    observacao: document.getElementById("evento-obs").value.trim()
  };
  if (dados.fim < dados.inicio) { erro.textContent = "A data final não pode ser antes da inicial."; return; }
  const botao = document.getElementById("btn-salvar-evento");
  botao.disabled = true; botao.textContent = "Salvando...";
  try {
    if (id) await atualizar("agenda_eventos", id, dados);
    else await inserir("agenda_eventos", dados);
    fecharModal();
  } catch (err) {
    erro.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false; botao.textContent = "Salvar";
  }
});

document.getElementById("btn-excluir-evento").addEventListener("click", async () => {
  const id = document.getElementById("evento-id").value;
  if (!id || !confirm("Excluir este lançamento?")) return;
  try { await excluir("agenda_eventos", id); fecharModal(); } catch (err) { alert("Erro ao excluir: " + err.message); }
});

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
