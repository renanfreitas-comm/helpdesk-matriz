// ==========================================================================
// LÓGICA DA TELA DE RELATÓRIOS DIÁRIOS DE ATIVIDADES
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { exportarCSV, nomeArquivoComData } from "./csv-utils.js";
import { observar, inserir, atualizar, excluir, listarUsuarios, buscarTodos } from "./db.js";

let usuarioAtual = null;
let perfilAtual = null;
let abrirHojeQuandoCarregar = false;
let listaRelatorios = [];   // cache local: só os próprios (técnico) ou de todo o time (admin)
let listaUsuarios = [];     // usado só pelo filtro de técnico, visível apenas para admin

const listaEl = document.getElementById("lista-relatorios");
const modal = document.getElementById("modal-relatorio");
const form = document.getElementById("form-relatorio");
const linhasAtividadesEl = document.getElementById("linhas-atividades");
const selectFiltroTecnico = document.getElementById("filtro-tecnico-relatorio");

export const ROTULOS_STATUS_ATIVIDADE = { concluido: "Concluído", andamento: "Em andamento", pendente: "Pendente" };
const CLASSES_STATUS_ATIVIDADE = { concluido: "badge-status-resolvido", andamento: "badge-status-andamento", pendente: "badge-status-aberto" };

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);

  const ehAdmin = perfil.papel === "admin";
  document.getElementById("titulo-relatorios").textContent = ehAdmin
    ? "Relatórios diários da equipe"
    : "Meus relatórios diários";
  document.getElementById("subtitulo-relatorios").textContent = ehAdmin
    ? "Como admin, você vê os relatórios de todo o time aqui. Use o filtro por técnico para focar em uma pessoa."
    : "Registre um resumo do que você fez a cada dia. O supervisor acompanha os relatórios de todo o time na página Supervisão.";

  if (ehAdmin) {
    selectFiltroTecnico.style.display = "";
    listaUsuarios = await listarUsuarios();
    selectFiltroTecnico.innerHTML = '<option value="">Todos os técnicos</option>' +
      listaUsuarios.map((u) => `<option value="${u.uid}">${escaparHTML(u.nome)}</option>`).join("");
    selectFiltroTecnico.addEventListener("change", renderizarLista);
  }

  observarRelatorios();

  // Atalho vindo do Dashboard: relatorios.html#novo
  if (window.location.hash === "#novo") {
    history.replaceState(null, "", window.location.pathname);
    abrirHojeQuandoCarregar = true; // espera a lista chegar para saber se já existe
  }
});

// -------------------- Linhas de atividade (dinâmicas) --------------------
function criarLinhaAtividade(dados = {}) {
  const linha = document.createElement("div");
  linha.className = "linha-atividade";
  linha.innerHTML = `
    <input type="text" class="at-categoria" placeholder="Ex: Suporte, Manutenção" value="${escaparAtributo(dados.categoria)}" />
    <input type="text" class="at-atividade" placeholder="Descreva a atividade" value="${escaparAtributo(dados.atividade)}" />
    <input type="text" class="at-quantidade" placeholder="Ex: 3 ou Financeiro" value="${escaparAtributo(dados.quantidadeArea)}" />
    <select class="at-status">
      <option value="concluido"${dados.status === "concluido" || !dados.status ? " selected" : ""}>Concluído</option>
      <option value="andamento"${dados.status === "andamento" ? " selected" : ""}>Em andamento</option>
      <option value="pendente"${dados.status === "pendente" ? " selected" : ""}>Pendente</option>
    </select>
    <button type="button" class="btn-remover-atividade" title="Remover linha">&times;</button>
  `;
  linha.querySelector(".btn-remover-atividade").addEventListener("click", () => {
    // Sempre deixa pelo menos uma linha no formulário.
    if (linhasAtividadesEl.children.length > 1) {
      linha.remove();
    } else {
      linha.querySelectorAll("input").forEach((i) => i.value = "");
    }
  });
  linhasAtividadesEl.appendChild(linha);
}

document.getElementById("btn-add-atividade").addEventListener("click", () => criarLinhaAtividade());

// -------------------- Preencher sozinho com o que o técnico fez no dia --------------------
// Junta, da data escolhida no relatório:
//  - chamados em que você é o responsável e que foram atualizados ou resolvidos;
//  - registros que você fez no histórico de manutenção das máquinas;
//  - visitas técnicas que você registrou para esse dia.
// Linhas que já estão no relatório não são repetidas.
document.getElementById("btn-preencher-dia").addEventListener("click", preencherComMeuDia);

async function preencherComMeuDia() {
  const botao = document.getElementById("btn-preencher-dia");
  const dica = document.getElementById("dica-preencher");
  const data = document.getElementById("relatorio-data").value || hojeISO();
  const inicio = new Date(data + "T00:00:00");
  const fim = new Date(inicio.getTime() + 24 * 3600 * 1000);
  const noDia = (v) => v && new Date(v) >= inicio && new Date(v) < fim;

  botao.disabled = true;
  botao.textContent = "Buscando...";
  dica.textContent = "";
  try {
    const uid = usuarioAtual.uid;
    const [chamados, historico, visitas] = await Promise.all([
      buscarTodos("chamados", (q) => q.eq("responsavel_uid", uid).gte("atualizado_em", inicio.toISOString())),
      buscarTodos("maquina_historico", (q) => q.eq("tecnico_uid", uid).gte("criado_em", inicio.toISOString()).lt("criado_em", fim.toISOString())),
      buscarTodos("visitas", (q) => q.eq("criado_por_uid", uid).eq("data", data))
    ]);

    const novas = [];
    const STATUS_CHAMADO = { resolvido: "concluido", andamento: "andamento", aberto: "pendente" };
    chamados
      .filter((c) => noDia(c.atualizadoEm) || noDia(c.resolvidoEm))
      .forEach((c) => novas.push({
        categoria: "Chamado",
        atividade: `${c.numero ? c.numero + " — " : ""}${c.atividade || ""}`.slice(0, 300),
        quantidadeArea: c.area || "",
        status: c.status === "resolvido" && !noDia(c.resolvidoEm) ? "concluido" : STATUS_CHAMADO[c.status] || "andamento"
      }));

    if (historico.length) {
      const ids = [...new Set(historico.map((h) => h.maquinaId))];
      const maquinas = await buscarTodos("maquinas", (q) => q.in("id", ids), "id,nome");
      const nomeMaquina = Object.fromEntries(maquinas.map((m) => [m.id, m.nome]));
      historico.forEach((h) => novas.push({
        categoria: "Manutenção",
        atividade: `${nomeMaquina[h.maquinaId] || "Máquina"}: ${h.descricao}`.slice(0, 300),
        quantidadeArea: "",
        status: "concluido"
      }));
    }

    const STATUS_VISITA = { realizada: "concluido", agendada: "pendente" };
    visitas
      .filter((v) => v.status !== "cancelada")
      .forEach((v) => novas.push({
        categoria: "Visita técnica",
        atividade: v.titulo || "",
        quantidadeArea: [v.cidade, v.area].filter(Boolean).join(" / "),
        status: STATUS_VISITA[v.status] || "pendente"
      }));

    // Não repete o que já está na tabela; reaproveita linha vazia.
    const existentes = new Set(coletarAtividades().map((a) => (a.categoria + "|" + a.atividade).toLowerCase()));
    const paraAdicionar = novas.filter((a) => !existentes.has((a.categoria + "|" + a.atividade).toLowerCase()));
    if (paraAdicionar.length && coletarAtividades().length === 0) linhasAtividadesEl.innerHTML = "";
    paraAdicionar.forEach((a) => criarLinhaAtividade(a));

    dica.textContent = paraAdicionar.length
      ? `${paraAdicionar.length} atividade(s) adicionada(s). Confira e ajuste antes de salvar.`
      : (novas.length ? "Tudo do dia já está no relatório." : "Não encontrei chamados, manutenções ou visitas seus nesta data.");
  } catch (err) {
    dica.textContent = "Não foi possível buscar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Preencher com o que fiz no dia";
  }
}

// Abre o relatório de hoje: edita se já existir, senão cria um novo.
function abrirRelatorioDeHoje() {
  const existente = listaRelatorios.find((r) => r.tecnicoUid === usuarioAtual.uid && r.data === hojeISO());
  if (existente) abrirModal("editar", existente.id);
  else abrirModal("criar");
}

function coletarAtividades() {
  return Array.from(linhasAtividadesEl.querySelectorAll(".linha-atividade")).map((linha) => ({
    categoria: linha.querySelector(".at-categoria").value.trim(),
    atividade: linha.querySelector(".at-atividade").value.trim(),
    quantidadeArea: linha.querySelector(".at-quantidade").value.trim(),
    status: linha.querySelector(".at-status").value
  })).filter((a) => a.categoria || a.atividade || a.quantidadeArea);
}

// -------------------- Observar relatórios (próprios, ou de todos se admin) --------------------
function observarRelatorios() {
  // Admin vê todos; técnico só os próprios (as regras do banco garantem
  // isso de qualquer forma — o filtro aqui só deixa a consulta mais leve).
  const ehAdmin = perfilAtual.papel === "admin";
  observar("relatorios", (q) => {
    const base = ehAdmin ? q : q.eq("tecnico_uid", usuarioAtual.uid);
    return base.order("data", { ascending: false }).order("criado_em", { ascending: false });
  }, (linhas) => {
    listaRelatorios = linhas;
    if (abrirHojeQuandoCarregar) { abrirHojeQuandoCarregar = false; abrirRelatorioDeHoje(); }
    renderizarLista();
  }, (erro) => {
    listaEl.innerHTML = `<p class="vazio">Erro ao carregar relatórios: ${escaparHTML(erro.message)}</p>`;
  });
}

function renderizarTabelaAtividades(atividades) {
  if (!atividades || atividades.length === 0) return "";
  return `
    <div class="tabela-atividades" style="margin-top:8px;">
      <div class="linha-atividade-cabecalho">
        <span>Categoria</span>
        <span>Atividade</span>
        <span>Quantidade / Área</span>
        <span>Status</span>
        <span></span>
      </div>
      ${atividades.map((a) => `
        <div class="linha-atividade linha-atividade-leitura">
          <span>${escaparHTML(a.categoria) || "—"}</span>
          <span>${escaparHTML(a.atividade) || "—"}</span>
          <span>${escaparHTML(a.quantidadeArea) || "—"}</span>
          <span><span class="badge ${CLASSES_STATUS_ATIVIDADE[a.status] || ""}">${ROTULOS_STATUS_ATIVIDADE[a.status] || a.status || "—"}</span></span>
          <span></span>
        </div>
      `).join("")}
    </div>`;
}

// Relatórios que passam pelos filtros da tela (data e, para admin, técnico).
// Usado pela lista e pelo "Exportar CSV".
function obterListaFiltrada() {
  const ehAdmin = perfilAtual.papel === "admin";
  const filtroData = document.getElementById("filtro-data").value;
  const filtroTecnico = ehAdmin ? selectFiltroTecnico.value : "";

  return listaRelatorios.filter((r) => {
    if (filtroData && r.data !== filtroData) return false;
    if (filtroTecnico && r.tecnicoUid !== filtroTecnico) return false;
    return true;
  });
}

function renderizarLista() {
  const ehAdmin = perfilAtual.papel === "admin";
  const filtrados = obterListaFiltrada();

  if (filtrados.length === 0) {
    listaEl.innerHTML = '<p class="vazio">Nenhum relatório encontrado.</p>';
    return;
  }

  listaEl.innerHTML = filtrados.map((r) => `
    <div class="painel">
      <div class="topo-pagina" style="margin-bottom:10px;">
        <strong>${formatarData(r.data)}</strong>${ehAdmin ? ` <span class="texto-suave">— ${escaparHTML(r.tecnicoNome)}</span>` : ""}
        <div class="acoes-tabela">
          <button class="botao-secundario btn-editar-relatorio" data-id="${r.id}">Editar</button>
          <button class="botao-perigo btn-excluir-relatorio" data-id="${r.id}">Excluir</button>
        </div>
      </div>
      ${renderizarTabelaAtividades(r.atividades)}
      ${r.resumo ? `<p style="white-space:pre-wrap; margin:12px 0 0;">${escaparHTML(r.resumo)}</p>` : ""}
    </div>
  `).join("");

  document.querySelectorAll(".btn-editar-relatorio").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-relatorio").forEach((b) =>
    b.addEventListener("click", () => excluirRelatorio(b.dataset.id)));
}

document.getElementById("filtro-data").addEventListener("change", renderizarLista);
document.getElementById("btn-limpar-filtro").addEventListener("click", () => {
  document.getElementById("filtro-data").value = "";
  renderizarLista();
});

// -------------------- Exportar CSV --------------------
// Exporta exatamente o que está sendo mostrado na tela (respeita o filtro
// de data e, para admin, o filtro por técnico). Cada linha do CSV é uma
// atividade — como um relatório pode ter várias atividades, a data, o
// técnico e o resumo do dia se repetem em cada linha do mesmo relatório.
document.getElementById("btn-exportar-relatorios").addEventListener("click", () => {
  const cabecalhos = ["Data", "Técnico", "Categoria", "Atividade", "Quantidade / Área", "Status", "Resumo do dia"];

  const linhas = [];
  obterListaFiltrada().forEach((r) => {
    const atividades = r.atividades && r.atividades.length > 0 ? r.atividades : [{}];
    atividades.forEach((a) => {
      linhas.push([
        formatarData(r.data),
        r.tecnicoNome || "",
        a.categoria || "",
        a.atividade || "",
        a.quantidadeArea || "",
        ROTULOS_STATUS_ATIVIDADE[a.status] || a.status || "",
        r.resumo || ""
      ]);
    });
  });

  exportarCSV(nomeArquivoComData("relatorios"), cabecalhos, linhas);
});

// -------------------- Modal --------------------
let modoAtual = "criar";

document.getElementById("btn-novo-relatorio").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-relatorio").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, relatorioId = null) {
  modoAtual = modo;
  document.getElementById("relatorio-erro").textContent = "";
  form.reset();
  document.getElementById("relatorio-id").value = relatorioId || "";
  linhasAtividadesEl.innerHTML = "";
  document.getElementById("dica-preencher").textContent = "";

  if (modo === "criar") {
    document.getElementById("modal-relatorio-titulo").textContent = "Novo relatório do dia";
    document.getElementById("relatorio-data").value = hojeISO();
    criarLinhaAtividade();
  } else {
    const r = listaRelatorios.find((x) => x.id === relatorioId);
    document.getElementById("modal-relatorio-titulo").textContent = "Editar relatório";
    document.getElementById("relatorio-data").value = r.data;
    document.getElementById("relatorio-resumo").value = r.resumo || "";
    if (r.atividades && r.atividades.length > 0) {
      r.atividades.forEach((a) => criarLinhaAtividade(a));
    } else {
      criarLinhaAtividade();
    }
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("relatorio-erro");
  erroEl.textContent = "";

  const id = document.getElementById("relatorio-id").value;
  const data = document.getElementById("relatorio-data").value;
  const resumo = document.getElementById("relatorio-resumo").value.trim();
  const atividades = coletarAtividades();

  if (atividades.length === 0) {
    erroEl.textContent = "Adicione ao menos uma atividade com categoria ou descrição preenchida.";
    return;
  }

  const botao = document.getElementById("btn-salvar-relatorio");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    if (modoAtual === "criar") {
      // O banco grava o relatório sempre em nome de quem está logado.
      await inserir("relatorios", { data, atividades, resumo });
    } else {
      await atualizar("relatorios", id, { data, atividades, resumo });
    }
    fecharModal();
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

async function excluirRelatorio(id) {
  if (!confirm("Excluir este relatório?")) return;
  try {
    await excluir("relatorios", id);
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
  }
}

// -------------------- Utilitários --------------------
function hojeISO() {
  const hoje = new Date();
  const offset = hoje.getTimezoneOffset();
  const local = new Date(hoje.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function escaparAtributo(texto) {
  return (texto ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
