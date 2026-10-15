// ==========================================================================
// LÓGICA DA TELA DE TAREFAS DO DIA
// ==========================================================================
// - Todos veem as tarefas de todos, separadas por pessoa.
// - Cada técnico marca as SUAS como feitas (só no dia de hoje).
// - Só admin cria, edita, pausa e exclui tarefas (e pode marcar/desmarcar
//   qualquer uma, em qualquer data).
// - Os chamados em aberto de cada pessoa aparecem como tarefas também:
//   "concluir" um deles é resolver o chamado.
// As regras de verdade ficam no banco (supabase/schema.sql); aqui só
// escondemos o que a pessoa não pode fazer.
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, inserir, atualizar, excluir, listarUsuarios } from "./db.js";
import { badgePrazo, ordenarPorPrazo } from "./sla.js";
import { mudarStatus, assumirChamado } from "./acoes-chamado.js";
import {
  hojeISO, somarDias, formatarDiaLongo, valeNoDia, descreverRecorrencia,
  marcarTarefa, desmarcarTarefa, horaCurta
} from "./tarefas-util.js";

let usuarioAtual = null;
let perfilAtual = null;
let usuarios = [];
let tarefas = [];
let conclusoes = [];        // do dia escolhido
let chamadosAbertos = [];
let diaEscolhido = hojeISO();
let visao = "todos";
let pararConclusoes = null;

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento" };

const ehAdmin = () => perfilAtual && perfilAtual.papel === "admin";
const quadro = document.getElementById("quadro-tarefas");
const inputDia = document.getElementById("dia-escolhido");

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil, user);
  if (ehAdmin()) document.querySelectorAll(".apenas-admin").forEach((el) => el.style.display = "");

  usuarios = await listarUsuarios();
  inputDia.value = diaEscolhido;

  // Atalho da tela inicial: tarefas.html#minhas abre em "Só as minhas".
  if (window.location.hash === "#minhas") {
    history.replaceState(null, "", window.location.pathname);
    visao = "meus";
    document.querySelectorAll("#abas-tarefas .aba-rapida").forEach((x) => x.classList.toggle("ativa", x.dataset.visao === "meus"));
  }

  observar("tarefas", (q) => q.order("ordem").order("titulo"), (linhas) => {
    tarefas = linhas;
    renderizar();
    renderizarGerenciar();
  }, mostrarErro);

  observar("chamados", (q) => q.neq("status", "resolvido"), (linhas) => {
    chamadosAbertos = linhas.sort(ordenarPorPrazo);
    renderizar();
  }, mostrarErro);

  observarConclusoes();
  setInterval(() => {
    // Virou o dia com a tela aberta: acompanha.
    if (diaEscolhido !== hojeISO() && inputDia.dataset.eraHoje === "1") trocarDia(hojeISO());
    renderizar();
  }, 60000);
});

function mostrarErro(erro) {
  quadro.innerHTML = `<p class="vazio">Erro ao carregar: ${escaparHTML(erro.message)}</p>`;
}

function observarConclusoes() {
  if (pararConclusoes) pararConclusoes();
  const dia = diaEscolhido;
  pararConclusoes = observar("tarefa_conclusoes", (q) => q.eq("data", dia), (linhas) => {
    if (dia !== diaEscolhido) return;
    conclusoes = linhas;
    renderizar();
  }, mostrarErro, { filtroRealtime: `data=eq.${dia}` });
}

// -------------------- Navegação por dia --------------------
function trocarDia(iso) {
  if (!iso) return;
  diaEscolhido = iso;
  inputDia.value = iso;
  conclusoes = [];
  observarConclusoes();
  renderizar();
}
inputDia.addEventListener("change", () => trocarDia(inputDia.value));
document.getElementById("dia-anterior").addEventListener("click", () => trocarDia(somarDias(diaEscolhido, -1)));
document.getElementById("dia-seguinte").addEventListener("click", () => trocarDia(somarDias(diaEscolhido, 1)));
document.getElementById("dia-hoje").addEventListener("click", () => trocarDia(hojeISO()));

document.querySelectorAll("#abas-tarefas .aba-rapida").forEach((b) => b.addEventListener("click", () => {
  visao = b.dataset.visao;
  document.querySelectorAll("#abas-tarefas .aba-rapida").forEach((x) => x.classList.toggle("ativa", x === b));
  renderizar();
}));
document.getElementById("mostrar-chamados").addEventListener("change", renderizar);

// -------------------- Quadro por pessoa --------------------
function renderizar() {
  if (!usuarioAtual) return;
  const hoje = hojeISO();
  const ehHoje = diaEscolhido === hoje;
  inputDia.dataset.eraHoje = ehHoje ? "1" : "0";
  const mostrarChamados = document.getElementById("mostrar-chamados").checked && ehHoje;

  document.getElementById("dia-titulo").textContent = (ehHoje ? "Hoje — " : "") + formatarDiaLongo(diaEscolhido);
  const aviso = document.getElementById("aviso-dia");
  aviso.textContent = diaEscolhido < hoje
    ? (ehAdmin() ? "Dia anterior: como admin, você ainda pode marcar ou desmarcar." : "Dia anterior: só para consulta.")
    : diaEscolhido > hoje ? "Dia futuro: as tarefas só podem ser marcadas no próprio dia." : "";
  if (!ehHoje && document.getElementById("mostrar-chamados").checked) {
    aviso.textContent += (aviso.textContent ? " " : "") + "Chamados em aberto aparecem só no dia de hoje.";
  }

  const conclusaoDe = Object.fromEntries(conclusoes.map((c) => [c.tarefaId, c]));
  const doDia = tarefas.filter((t) => valeNoDia(t, diaEscolhido));

  // Monta um cartão por pessoa (quem tem tarefas no dia ou chamados abertos).
  let pessoas = usuarios.map((u) => {
    const minhas = doDia.filter((t) => t.responsavelUid === u.uid);
    const chamados = mostrarChamados ? chamadosAbertos.filter((c) => c.responsavelUid === u.uid) : [];
    const feitas = minhas.filter((t) => conclusaoDe[t.id]).length;
    return { u, minhas, chamados, feitas, total: minhas.length };
  }).filter((p) => p.minhas.length || p.chamados.length);

  // Totais gerais (antes dos filtros de visão).
  const total = pessoas.reduce((s, p) => s + p.total, 0);
  const feitas = pessoas.reduce((s, p) => s + p.feitas, 0);
  document.getElementById("resumo-geral").textContent = total
    ? `${feitas} de ${total} tarefas concluídas no time`
    : "Nenhuma tarefa para este dia";
  document.getElementById("barra-geral").style.width = total ? `${Math.round(100 * feitas / total)}%` : "0%";

  if (visao === "meus") pessoas = pessoas.filter((p) => p.u.uid === usuarioAtual.uid);
  if (visao === "pendentes") {
    pessoas = pessoas
      .map((p) => ({ ...p, minhas: p.minhas.filter((t) => !conclusaoDe[t.id]) }))
      .filter((p) => p.minhas.length || p.chamados.length);
  }

  // Você primeiro; depois quem tem mais pendências.
  pessoas.sort((a, b) => {
    if (a.u.uid === usuarioAtual.uid) return -1;
    if (b.u.uid === usuarioAtual.uid) return 1;
    const pa = a.total - a.feitas + a.chamados.length;
    const pb = b.total - b.feitas + b.chamados.length;
    return pb - pa || a.u.nome.localeCompare(b.u.nome);
  });

  if (pessoas.length === 0) {
    const vazio = visao === "pendentes" ? "Nenhuma pendência. Tudo concluído!"
      : visao === "meus" ? "Você não tem tarefas neste dia."
      : ehAdmin() ? "Nenhuma tarefa para este dia. Use \"+ Nova tarefa\" para cadastrar."
      : "Nenhuma tarefa para este dia.";
    quadro.innerHTML = `<p class="vazio">${vazio}</p>`;
    return;
  }

  quadro.innerHTML = pessoas.map((p) => cartaoPessoa(p, conclusaoDe)).join("");
  ligarEventos();
}

function cartaoPessoa({ u, minhas, chamados, feitas, total }, conclusaoDe) {
  const eu = u.uid === usuarioAtual.uid;
  const totalTarefas = total; // total do dia (mesmo com o filtro "Só pendentes")
  const pct = totalTarefas ? Math.round(100 * feitas / totalTarefas) : 0;
  const completo = totalTarefas > 0 && feitas === totalTarefas;

  const itensTarefas = minhas.map((t) => {
    const c = conclusaoDe[t.id];
    const pode = c ? podeDesmarcar(c) : podeMarcar(t);
    return `
      <li class="tarefa ${c ? "feita" : ""}">
        <label class="tarefa-check ${pode ? "" : "bloqueada"}">
          <input type="checkbox" class="js-tarefa" data-id="${t.id}" ${c ? `data-conclusao="${c.id}" checked` : ""} ${pode ? "" : "disabled"} />
          <span class="tarefa-texto">
            <span class="tarefa-titulo">${escaparHTML(t.titulo)}</span>
            ${t.descricao ? `<span class="tarefa-descricao">${escaparHTML(t.descricao)}</span>` : ""}
          </span>
        </label>
        <span class="tarefa-meta">${c
          ? `Feita ${horaCurta(c.concluidaEm)}${c.concluidaPorUid !== t.responsavelUid ? " por " + escaparHTML(c.concluidaPorNome || "") : ""}`
          : `<span class="texto-suave">${escaparHTML(descreverRecorrencia(t))}</span>`}</span>
      </li>`;
  }).join("");

  const itensChamados = chamados.map((c) => {
    const pode = ehAdmin() || c.responsavelUid === usuarioAtual.uid;
    return `
      <li class="tarefa tarefa-chamado">
        <label class="tarefa-check ${pode ? "" : "bloqueada"}" title="${pode ? "Marcar = resolver o chamado" : ""}">
          <input type="checkbox" class="js-resolver-chamado" data-id="${c.id}" ${pode ? "" : "disabled"} />
          <span class="tarefa-texto">
            <span class="tarefa-titulo"><a href="chamados.html#c=${encodeURIComponent(c.id)}">Chamado ${escaparHTML(c.numero || "")}</a> · ${escaparHTML(c.area || "")}</span>
            <span class="tarefa-descricao">${escaparHTML(truncar(c.atividade, 110))}</span>
          </span>
        </label>
        <span class="tarefa-meta">
          <span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade] || ""}</span>
          <span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status] || c.status}</span>
          ${badgePrazo(c)}
        </span>
      </li>`;
  }).join("");

  return `
    <section class="cartao-pessoa ${eu ? "cartao-eu" : ""} ${completo ? "cartao-completo" : ""}">
      <header class="cartao-pessoa-topo">
        <div>
          <strong>${escaparHTML(u.nome)}</strong>${eu ? ' <span class="texto-suave">(você)</span>' : ""}
          <div class="texto-suave cartao-pessoa-resumo">
            ${totalTarefas ? `${feitas}/${totalTarefas} tarefas` : "Sem tarefas no dia"}${chamados.length ? ` · ${chamados.length} chamado(s) em aberto` : ""}
          </div>
        </div>
        ${totalTarefas ? `<span class="badge ${completo ? "badge-status-resolvido" : "badge-status-andamento"}">${completo ? "Concluído" : pct + "%"}</span>` : ""}
      </header>
      ${totalTarefas ? `<div class="barra-fundo barra-fina"><div class="barra-preenchida" style="width:${pct}%"></div></div>` : ""}
      ${itensTarefas ? `<ul class="lista-tarefas">${itensTarefas}</ul>` : ""}
      ${itensChamados ? `<div class="subtitulo-chamados">Chamados em aberto</div><ul class="lista-tarefas">${itensChamados}</ul>` : ""}
    </section>`;
}

function podeMarcar(t) {
  if (ehAdmin()) return true;
  return t.responsavelUid === usuarioAtual.uid && diaEscolhido === hojeISO();
}

function podeDesmarcar(c) {
  if (ehAdmin()) return true;
  return c.concluidaPorUid === usuarioAtual.uid && diaEscolhido === hojeISO();
}

function ligarEventos() {
  quadro.querySelectorAll(".js-tarefa").forEach((cb) => cb.addEventListener("change", async () => {
    cb.disabled = true;
    try {
      if (cb.checked) await marcarTarefa(cb.dataset.id, diaEscolhido);
      else await desmarcarTarefa(cb.dataset.conclusao);
    } catch (err) {
      cb.checked = !cb.checked;
      alert("Não foi possível salvar: " + err.message);
    } finally {
      cb.disabled = false;
    }
  }));

  quadro.querySelectorAll(".js-resolver-chamado").forEach((cb) => cb.addEventListener("change", async () => {
    const c = chamadosAbertos.find((x) => x.id === cb.dataset.id);
    cb.disabled = true;
    try {
      // Admin "concluindo" chamado de alguém sem responsável: assume antes.
      if (!c.responsavelUid) await assumirChamado(c, usuarioAtual.uid);
      const feito = await mudarStatus(c, "resolvido");
      if (!feito) cb.checked = false; // cancelou a pergunta
    } catch (err) {
      cb.checked = false;
      alert("Não foi possível resolver o chamado: " + err.message);
    } finally {
      cb.disabled = false;
    }
  }));
}

// -------------------- Admin: nova / editar tarefa --------------------
const modalTarefa = document.getElementById("modal-tarefa");
const formTarefa = document.getElementById("form-tarefa");
const selectRecorrencia = document.getElementById("tarefa-recorrencia");

document.getElementById("btn-nova-tarefa").addEventListener("click", () => abrirModalTarefa());
document.getElementById("btn-cancelar-tarefa").addEventListener("click", () => modalTarefa.classList.remove("aberto"));
modalTarefa.addEventListener("click", (e) => { if (e.target === modalTarefa) modalTarefa.classList.remove("aberto"); });
selectRecorrencia.addEventListener("change", ajustarCamposRecorrencia);
document.querySelectorAll("#tarefa-dias button").forEach((b) => b.addEventListener("click", () => b.classList.toggle("ativo")));

function ajustarCamposRecorrencia() {
  document.getElementById("campo-dias").style.display = selectRecorrencia.value === "semanal" ? "" : "none";
  document.getElementById("campo-data-unica").style.display = selectRecorrencia.value === "unica" ? "" : "none";
}

function abrirModalTarefa(id = null) {
  formTarefa.reset();
  document.getElementById("tarefa-erro").textContent = "";
  document.getElementById("tarefa-id").value = id || "";
  document.querySelectorAll("#tarefa-dias button").forEach((b) => b.classList.remove("ativo"));

  const novo = !id;
  document.getElementById("campo-responsaveis").style.display = novo ? "" : "none";
  document.getElementById("campo-responsavel-unico").style.display = novo ? "none" : "";
  document.getElementById("modal-tarefa-titulo").textContent = novo ? "Nova tarefa" : "Editar tarefa";

  if (novo) {
    document.getElementById("tarefa-responsaveis").innerHTML =
      `<label class="alternar"><input type="checkbox" id="marcar-todos-tecnicos" /> <strong>Todos os técnicos</strong></label>` +
      usuarios.map((u) => `<label class="alternar"><input type="checkbox" class="js-resp" value="${u.uid}" data-papel="${u.papel}" /> ${escaparHTML(u.nome)}</label>`).join("");
    document.getElementById("marcar-todos-tecnicos").addEventListener("change", (e) => {
      document.querySelectorAll(".js-resp").forEach((cb) => { if (cb.dataset.papel === "tecnico") cb.checked = e.target.checked; });
    });
    selectRecorrencia.value = "dias_uteis";
    document.getElementById("tarefa-data-unica").value = diaEscolhido >= hojeISO() ? diaEscolhido : hojeISO();
  } else {
    const t = tarefas.find((x) => x.id === id);
    document.getElementById("tarefa-responsavel").innerHTML =
      usuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
    document.getElementById("tarefa-titulo").value = t.titulo;
    document.getElementById("tarefa-descricao").value = t.descricao || "";
    document.getElementById("tarefa-responsavel").value = t.responsavelUid || "";
    selectRecorrencia.value = t.recorrencia;
    (t.diasSemana || []).forEach((d) => {
      const b = document.querySelector(`#tarefa-dias button[data-dia="${d}"]`);
      if (b) b.classList.add("ativo");
    });
    document.getElementById("tarefa-data-unica").value = t.dataUnica || "";
    document.getElementById("tarefa-ativa").checked = t.ativa;
  }
  ajustarCamposRecorrencia();
  modalTarefa.classList.add("aberto");
  document.getElementById("tarefa-titulo").focus();
}

formTarefa.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erroEl = document.getElementById("tarefa-erro");
  erroEl.textContent = "";
  const id = document.getElementById("tarefa-id").value;

  const recorrencia = selectRecorrencia.value;
  const diasSemana = [...document.querySelectorAll("#tarefa-dias button.ativo")].map((b) => Number(b.dataset.dia));
  const dataUnica = document.getElementById("tarefa-data-unica").value || null;
  if (recorrencia === "semanal" && diasSemana.length === 0) { erroEl.textContent = "Escolha pelo menos um dia da semana."; return; }
  if (recorrencia === "unica" && !dataUnica) { erroEl.textContent = "Escolha a data."; return; }

  const dados = {
    titulo: document.getElementById("tarefa-titulo").value.trim(),
    descricao: document.getElementById("tarefa-descricao").value.trim(),
    recorrencia,
    diasSemana: recorrencia === "semanal" ? diasSemana : [],
    dataUnica: recorrencia === "unica" ? dataUnica : null,
    ativa: document.getElementById("tarefa-ativa").checked
  };

  const botao = document.getElementById("btn-salvar-tarefa");
  botao.disabled = true;
  botao.textContent = "Salvando...";
  try {
    if (id) {
      await atualizar("tarefas", id, { ...dados, responsavelUid: document.getElementById("tarefa-responsavel").value || null });
    } else {
      const responsaveis = [...document.querySelectorAll(".js-resp:checked")].map((cb) => cb.value);
      if (responsaveis.length === 0) { erroEl.textContent = "Escolha pelo menos uma pessoa."; return; }
      for (const uid of responsaveis) await inserir("tarefas", { ...dados, responsavelUid: uid });
    }
    modalTarefa.classList.remove("aberto");
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

// -------------------- Admin: gerenciar todas as tarefas --------------------
const modalGerenciar = document.getElementById("modal-gerenciar");
document.getElementById("btn-gerenciar-tarefas").addEventListener("click", () => {
  const filtro = document.getElementById("gerenciar-filtro-pessoa");
  const atual = filtro.value;
  filtro.innerHTML = '<option value="">Todas as pessoas</option>' +
    usuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
  filtro.value = atual;
  renderizarGerenciar();
  modalGerenciar.classList.add("aberto");
});
document.getElementById("btn-fechar-gerenciar").addEventListener("click", () => modalGerenciar.classList.remove("aberto"));
modalGerenciar.addEventListener("click", (e) => { if (e.target === modalGerenciar) modalGerenciar.classList.remove("aberto"); });
document.getElementById("gerenciar-filtro-pessoa").addEventListener("change", renderizarGerenciar);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  modalTarefa.classList.remove("aberto");
  modalGerenciar.classList.remove("aberto");
});

function renderizarGerenciar() {
  if (!ehAdmin()) return;
  const tbody = document.getElementById("tabela-gerenciar");
  const pessoa = document.getElementById("gerenciar-filtro-pessoa").value;
  const lista = tarefas
    .filter((t) => !pessoa || t.responsavelUid === pessoa)
    .sort((a, b) => (a.responsavelNome || "").localeCompare(b.responsavelNome || "") || a.titulo.localeCompare(b.titulo));
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="vazio">Nenhuma tarefa cadastrada.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map((t) => `
    <tr>
      <td><strong>${escaparHTML(t.titulo)}</strong>${t.descricao ? `<br><span class="texto-suave">${escaparHTML(truncar(t.descricao, 80))}</span>` : ""}</td>
      <td>${t.responsavelNome ? escaparHTML(t.responsavelNome) : '<span class="texto-suave">Sem responsável</span>'}</td>
      <td>${escaparHTML(descreverRecorrencia(t))}</td>
      <td><span class="badge ${t.ativa ? "badge-status-resolvido" : ""}">${t.ativa ? "Ativa" : "Pausada"}</span></td>
      <td><div class="acoes-tabela">
        <button class="botao-secundario botao-pequeno js-editar-tarefa" data-id="${t.id}">Editar</button>
        <button class="botao-secundario botao-pequeno js-pausar-tarefa" data-id="${t.id}">${t.ativa ? "Pausar" : "Ativar"}</button>
        <button class="botao-perigo botao-pequeno js-excluir-tarefa" data-id="${t.id}">Excluir</button>
      </div></td>
    </tr>`).join("");

  tbody.querySelectorAll(".js-editar-tarefa").forEach((b) => b.addEventListener("click", () => abrirModalTarefa(b.dataset.id)));
  tbody.querySelectorAll(".js-pausar-tarefa").forEach((b) => b.addEventListener("click", async () => {
    const t = tarefas.find((x) => x.id === b.dataset.id);
    try { await atualizar("tarefas", t.id, { ativa: !t.ativa }); } catch (err) { alert("Erro: " + err.message); }
  }));
  tbody.querySelectorAll(".js-excluir-tarefa").forEach((b) => b.addEventListener("click", async () => {
    const t = tarefas.find((x) => x.id === b.dataset.id);
    if (!confirm(`Excluir a tarefa "${t.titulo}" de ${t.responsavelNome || "—"}?\n\nO histórico de conclusões dela também será apagado. Para só parar de cobrar, use "Pausar".`)) return;
    try { await excluir("tarefas", t.id); } catch (err) { alert("Erro: " + err.message); }
  }));
}

// -------------------- Utilitários --------------------
function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function truncar(texto, tamanho) {
  if (!texto) return "";
  return texto.length > tamanho ? texto.slice(0, tamanho) + "…" : texto;
}
