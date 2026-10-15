// ==========================================================================
// TELA INICIAL (Início)
// ==========================================================================
// - Busca geral (Ctrl+K): chamados, máquinas, estoque, visitas e pessoas.
// - Ações rápidas: abrir chamado, minhas tarefas, relatório do dia...
// - Cartões dos módulos, agrupados, cada um com informações ao vivo.
// - "Meu dia": minhas tarefas de hoje + meus chamados em aberto.
// - Indicadores do time (cards e gráficos).
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav, icone } from "./nav.js";
import { observar, listarUsuarios, buscarTodos } from "./db.js";
import { badgePrazo, situacaoPrazo, ordenarPorPrazo, tempoMedioResolucao } from "./sla.js";
import { botoesRapidos, ligarBotoesRapidos, mudarStatus } from "./acoes-chamado.js";
import { hojeISO, valeNoDia, marcarTarefa, desmarcarTarefa, horaCurta, somarDias } from "./tarefas-util.js";
import { AUSENCIAS } from "./agenda-util.js";

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento", resolvido: "Resolvido" };
const TRINTA_DIAS = 30 * 24 * 3600 * 1000;

let usuarioAtual = null;
let perfilAtual = null;
let usuarios = [];
// Dados que alimentam a tela (cada um atualiza sozinho).
const dados = {
  chamados: [], tarefas: [], conclusoes: [], maquinas: [], estoque: [], visitas: [], meuRelatorioHoje: null,
  agenda: [], solucoes: []
};

const ehAdmin = () => perfilAtual && perfilAtual.papel === "admin";

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil, user);
  document.getElementById("saudacao").textContent = `${saudacao()}, ${primeiroNome(perfil.nome)}`;
  desenharAcoesRapidas();

  usuarios = await listarUsuarios();
  const hoje = hojeISO();

  observar("chamados", (q) => q, (linhas) => {
    dados.chamados = linhas;
    atualizarTudo();
    atualizarIndicadores();
  });
  observar("tarefas", (q) => q, (linhas) => { dados.tarefas = linhas; atualizarTudo(); });
  observar("tarefa_conclusoes", (q) => q.eq("data", hoje), (linhas) => { dados.conclusoes = linhas; atualizarTudo(); },
    undefined, { filtroRealtime: `data=eq.${hoje}` });
  observar("maquinas", (q) => q, (linhas) => { dados.maquinas = linhas; desenharModulos(); });
  observar("itens_estoque", (q) => q, (linhas) => { dados.estoque = linhas; desenharModulos(); });
  observar("visitas", (q) => q, (linhas) => {
    dados.visitas = linhas;
    desenharModulos();
    atualizarBarrasPorEmpresaVisita(linhas);
  });
  observar("relatorios", (q) => q.eq("tecnico_uid", user.uid).eq("data", hoje), (linhas) => {
    dados.meuRelatorioHoje = linhas[0] || null;
    desenharModulos();
  });

  // Agenda (quem está fora/de plantão hoje) e Base de soluções: se o banco
  // ainda não tiver essas tabelas, os cards só ficam zerados.
  observar("agenda_eventos", (q) => q.lte("inicio", hoje).gte("fim", hoje), (linhas) => { dados.agenda = linhas; desenharModulos(); }, () => {});
  observar("solucoes", (q) => q, (linhas) => { dados.solucoes = linhas; desenharModulos(); }, () => {});

  // Prazos ("vence em...") mudam com o tempo.
  setInterval(atualizarTudo, 60000);

  if (window.location.hash === "#buscar") {
    history.replaceState(null, "", window.location.pathname);
    document.getElementById("busca-geral").focus();
  }
});

function atualizarTudo() {
  if (!usuarioAtual) return;
  desenharResumo();
  desenharModulos();
  desenharMeuDia();
  desenharSemResponsavel();
}

// -------------------- Ações rápidas --------------------
function desenharAcoesRapidas() {
  const acoes = [
    { href: "chamados.html#novo", icone: "mais", texto: "Abrir chamado", destaque: true },
    { href: "tarefas.html#minhas", icone: "tarefas", texto: "Minhas tarefas" },
    { href: "relatorios.html#novo", icone: "relatorios", texto: "Relatório do dia" },
    { href: "visitas.html#novo", icone: "visitas", texto: "Registrar visita" },
    { href: "estoque.html#novo", icone: "estoque", texto: "Entrada no estoque" }
  ];
  document.getElementById("acoes-rapidas").innerHTML = acoes.map((a) => `
    <a class="acao-rapida ${a.destaque ? "destaque" : ""}" href="${a.href}">
      <span class="acao-icone">${icone(a.icone)}</span><span>${a.texto}</span>
    </a>`).join("");
}

// -------------------- Resumo do dia (abaixo da saudação) --------------------
function minhasTarefasHoje() {
  const hoje = hojeISO();
  const feitas = new Set(dados.conclusoes.map((c) => c.tarefaId));
  const lista = dados.tarefas.filter((t) => t.responsavelUid === usuarioAtual.uid && valeNoDia(t, hoje));
  return { lista, feitas, pendentes: lista.filter((t) => !feitas.has(t.id)) };
}

function meusChamadosAbertos() {
  return dados.chamados
    .filter((c) => c.status !== "resolvido" && c.responsavelUid === usuarioAtual.uid)
    .sort(ordenarPorPrazo);
}

function desenharResumo() {
  const data = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const t = minhasTarefasHoje().pendentes.length;
  const c = meusChamadosAbertos().length;
  const partes = [];
  if (c) partes.push(`${c} chamado${c > 1 ? "s" : ""}`);
  if (t) partes.push(`${t} tarefa${t > 1 ? "s" : ""}`);
  document.getElementById("resumo-dia").textContent =
    data.charAt(0).toUpperCase() + data.slice(1) + " · " +
    (partes.length ? `você tem ${partes.join(" e ")} pendente${c + t > 1 ? "s" : ""}` : "nada pendente com você");
}

// -------------------- Cartões dos módulos --------------------
function desenharModulos() {
  if (!usuarioAtual) return;
  const hoje = hojeISO();
  const abertos = dados.chamados.filter((c) => c.status !== "resolvido");
  const atrasados = abertos.filter((c) => situacaoPrazo(c).atrasado).length;
  const meus = abertos.filter((c) => c.responsavelUid === usuarioAtual.uid).length;

  const minhas = minhasTarefasHoje();
  const feitasTime = new Set(dados.conclusoes.map((c) => c.tarefaId));
  const tarefasTime = dados.tarefas.filter((t) => valeNoDia(t, hoje));

  const daquiUmaSemana = somarDias(hoje, 7);
  const visitasSemana = dados.visitas.filter((v) => v.status === "agendada" && v.data >= hoje && v.data <= daquiUmaSemana).length;
  const visitasHoje = dados.visitas.filter((v) => v.status === "agendada" && v.data === hoje).length;

  const emManutencao = dados.maquinas.filter((m) => m.status === "manutencao").length;
  const emConfig = dados.estoque.filter((i) => i.situacao === "em_configuracao").length;
  const aguardandoPeca = dados.estoque.filter((i) => i.situacao === "aguardando_peca").length;

  const resolvidos30 = dados.chamados.filter((c) => c.status === "resolvido" && c.resolvidoEm && Date.now() - new Date(c.resolvidoEm) <= TRINTA_DIAS);
  const noPrazo = resolvidos30.length
    ? Math.round(100 * resolvidos30.filter((c) => situacaoPrazo(c).estado === "cumprido").length / resolvidos30.length) + "%"
    : "—";

  const fora = dados.agenda.filter((e) => AUSENCIAS.includes(e.tipo));
  const plantao = dados.agenda.filter((e) => e.tipo === "plantao");
  const nomes = (l) => [...new Set(l.map((e) => String(e.usuarioNome || "").split(" ")[0]))].filter(Boolean).join(", ");
  const semanaAtras = Date.now() - 7 * 864e5;
  const solucoesNovas = dados.solucoes.filter((x) => new Date(x.criadoEm) >= semanaAtras).length;

  const grupos = [
    { titulo: "Atendimento", itens: [
      { href: "chamados.html", icone: "chamados", cor: "vermelho", nome: "Chamados",
        info: [[abertos.length, "em aberto"], [atrasados, "atrasado" + (atrasados === 1 ? "" : "s"), atrasados ? "alerta" : ""]],
        rodape: meus ? `${meus} com você` : "Nenhum com você" },
      { href: "tarefas.html", icone: "tarefas", cor: "verde", nome: "Tarefas",
        info: [[`${minhas.lista.length - minhas.pendentes.length}/${minhas.lista.length}`, "suas hoje"]],
        rodape: tarefasTime.length ? `Time: ${tarefasTime.filter((t) => feitasTime.has(t.id)).length} de ${tarefasTime.length} feitas` : "Sem tarefas hoje" },
      { href: "visitas.html", icone: "visitas", cor: "azul", nome: "Visitas técnicas",
        info: [[visitasSemana, "próximos 7 dias"]],
        rodape: visitasHoje ? `${visitasHoje} hoje` : "Nenhuma hoje" },
      { href: "agenda.html", icone: "agenda", cor: "verde", nome: "Agenda da equipe",
        info: [[fora.length, fora.length === 1 ? "fora hoje" : "fora hoje", fora.length ? "aviso" : ""]],
        rodape: [fora.length ? nomes(fora) + " fora" : "Todo o time disponível", plantao.length ? "plantão: " + nomes(plantao) : ""].filter(Boolean).join(" · ") }
    ]},
    { titulo: "Inventário", itens: [
      { href: "maquinas.html", icone: "maquinas", cor: "roxo", nome: "Máquinas",
        info: [[dados.maquinas.length, "cadastradas"]],
        rodape: `${emManutencao} em manutenção` },
      { href: "estoque.html", icone: "estoque", cor: "amarelo", nome: "Estoque",
        info: [[emConfig, "em configuração"]],
        rodape: `${aguardandoPeca} aguardando peça` }
    ]},
    { titulo: "Registros e gestão", itens: [
      { href: "solucoes.html", icone: "solucoes", cor: "amarelo", nome: "Soluções",
        info: [[dados.solucoes.length, "soluções salvas"]],
        rodape: solucoesNovas ? `${solucoesNovas} nova${solucoesNovas === 1 ? "" : "s"} na semana` : "Salve ao resolver um chamado" },
      { href: "relatorios.html", icone: "relatorios", cor: "laranja", nome: "Relatórios",
        info: [[dados.meuRelatorioHoje ? "Enviado" : "Pendente", "hoje", dados.meuRelatorioHoje ? "ok" : "aviso"]],
        rodape: dados.meuRelatorioHoje ? "Seu relatório de hoje está salvo" : "Preencha com 1 clique" },
      ...(ehAdmin() ? [
        { href: "supervisao.html", icone: "supervisao", cor: "cinza", nome: "Indicadores",
          info: [[noPrazo, "no prazo (30 dias)"]], rodape: `${resolvidos30.length} resolvidos em 30 dias` },
        { href: "usuarios.html", icone: "usuarios", cor: "cinza", nome: "Usuários",
          info: [[usuarios.length, "pessoas"]], rodape: `${usuarios.filter((u) => u.papel === "admin").length} admin(s)` }
      ] : [])
    ]}
  ];

  document.getElementById("modulos").innerHTML = grupos.map((g) => `
    <h2 class="grupo-titulo">${g.titulo}</h2>
    <div class="grade-modulos">
      ${g.itens.map((m) => `
        <a class="cartao-modulo" href="${m.href}">
          <span class="modulo-icone cor-${m.cor}">${icone(m.icone)}</span>
          <span class="modulo-nome">${m.nome}</span>
          <span class="modulo-info">${m.info.map(([v, r, tom]) =>
            `<span class="modulo-num ${tom ? "tom-" + tom : ""}"><strong>${escaparHTML(String(v))}</strong> ${escaparHTML(r)}</span>`).join("")}</span>
          <span class="modulo-rodape">${escaparHTML(m.rodape)} ${icone("seta", "ico ico-seta")}</span>
        </a>`).join("")}
    </div>`).join("");
}

// -------------------- Meu dia --------------------
function desenharMeuDia() {
  const { lista, feitas } = minhasTarefasHoje();
  const chamados = meusChamadosAbertos();
  const conclusaoDe = Object.fromEntries(dados.conclusoes.map((c) => [c.tarefaId, c]));

  const total = lista.length + chamados.length;
  const feitasQtd = lista.filter((t) => feitas.has(t.id)).length;
  document.getElementById("meu-dia-resumo").textContent = total ? `${feitasQtd + 0}/${lista.length} tarefas · ${chamados.length} chamado(s)` : "";
  document.getElementById("meu-dia-barra").style.width = lista.length ? `${Math.round(100 * feitasQtd / lista.length)}%` : "0%";

  const el = document.getElementById("meu-dia");
  if (total === 0) {
    el.innerHTML = '<li class="texto-suave vazio-curto">Nada pendente com você hoje. Veja abaixo se há chamados para assumir.</li>';
    return;
  }

  el.innerHTML =
    lista.map((t) => {
      const c = conclusaoDe[t.id];
      return `
        <li class="tarefa ${c ? "feita" : ""}">
          <label class="tarefa-check">
            <input type="checkbox" class="js-tarefa" data-id="${t.id}" ${c ? `data-conclusao="${c.id}" checked` : ""} />
            <span class="tarefa-texto"><span class="tarefa-titulo">${escaparHTML(t.titulo)}</span>
              ${t.descricao ? `<span class="tarefa-descricao">${escaparHTML(t.descricao)}</span>` : ""}</span>
          </label>
          <span class="tarefa-meta">${c ? "Feita " + horaCurta(c.concluidaEm) : ""}</span>
        </li>`;
    }).join("") +
    chamados.map((c) => `
      <li class="tarefa tarefa-chamado">
        <label class="tarefa-check" title="Marcar = resolver o chamado">
          <input type="checkbox" class="js-resolver" data-id="${c.id}" />
          <span class="tarefa-texto">
            <span class="tarefa-titulo"><a href="chamados.html#c=${encodeURIComponent(c.id)}">Chamado ${escaparHTML(c.numero || "")}</a> · ${escaparHTML(c.area || "")}</span>
            <span class="tarefa-descricao">${escaparHTML(truncar(c.atividade, 90))}</span>
          </span>
        </label>
        <span class="tarefa-meta">
          <span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade] || ""}</span>
          <span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status] || ""}</span>
          ${badgePrazo(c)}
        </span>
      </li>`).join("");

  el.querySelectorAll(".js-tarefa").forEach((cb) => cb.addEventListener("change", async () => {
    cb.disabled = true;
    try {
      if (cb.checked) await marcarTarefa(cb.dataset.id, hojeISO());
      else await desmarcarTarefa(cb.dataset.conclusao);
    } catch (err) {
      cb.checked = !cb.checked;
      alert("Não foi possível salvar: " + err.message);
    } finally { cb.disabled = false; }
  }));
  el.querySelectorAll(".js-resolver").forEach((cb) => cb.addEventListener("change", async () => {
    const c = dados.chamados.find((x) => x.id === cb.dataset.id);
    cb.disabled = true;
    try {
      if (!(await mudarStatus(c, "resolvido"))) cb.checked = false;
    } catch (err) {
      cb.checked = false;
      alert("Não foi possível resolver: " + err.message);
    } finally { cb.disabled = false; }
  }));
}

// -------------------- Esperando alguém assumir --------------------
function desenharSemResponsavel() {
  const livres = dados.chamados.filter((c) => c.status !== "resolvido" && !c.responsavelUid).sort(ordenarPorPrazo);
  document.getElementById("qtd-livres").textContent = livres.length;
  const el = document.getElementById("sem-responsavel");
  if (livres.length === 0) {
    el.innerHTML = '<p class="texto-suave">Nenhum chamado esperando responsável.</p>';
    return;
  }
  const visiveis = livres.slice(0, 5);
  el.innerHTML = `<ul class="fila">${visiveis.map((c) => `
    <li class="fila-item ${situacaoPrazo(c).atrasado ? "linha-atrasada" : ""}">
      <a class="fila-info" href="chamados.html#c=${encodeURIComponent(c.id)}">
        <strong>${escaparHTML(c.numero || "(sem número)")}</strong>
        <span class="texto-suave">${escaparHTML(c.area || "")}</span>
        <span class="fila-badges">${badgePrazo(c)}</span>
        <span class="fila-atividade">${escaparHTML(truncar(c.atividade, 80))}</span>
      </a>
      <div class="acoes-tabela">${botoesRapidos(c, usuarioAtual.uid, ehAdmin())}</div>
    </li>`).join("")}</ul>
    ${livres.length > visiveis.length ? `<a class="link-suave" href="chamados.html">+ ${livres.length - visiveis.length} outro(s)</a>` : ""}`;
  ligarBotoesRapidos(el, dados.chamados, usuarioAtual.uid);
}

// -------------------- Indicadores do time --------------------
function atualizarIndicadores() {
  const chamados = dados.chamados;
  const agora = Date.now();
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const abertos = chamados.filter((c) => c.status !== "resolvido");
  const resolvidos30 = chamados.filter((c) => c.status === "resolvido" && c.resolvidoEm && agora - new Date(c.resolvidoEm) <= TRINTA_DIAS);

  document.getElementById("card-aberto").textContent = chamados.filter((c) => c.status === "aberto").length;
  document.getElementById("card-andamento").textContent = chamados.filter((c) => c.status === "andamento").length;
  document.getElementById("card-atrasados").textContent = abertos.filter((c) => situacaoPrazo(c).atrasado).length;
  document.getElementById("card-resolvidos-hoje").textContent =
    chamados.filter((c) => c.status === "resolvido" && c.resolvidoEm && new Date(c.resolvidoEm) >= inicioHoje).length;
  document.getElementById("card-tempo-medio").textContent = tempoMedioResolucao(resolvidos30);
  document.getElementById("card-no-prazo").textContent = resolvidos30.length
    ? Math.round(100 * resolvidos30.filter((c) => situacaoPrazo(c).estado === "cumprido").length / resolvidos30.length) + "%"
    : "—";

  atualizarBarras("barras-prioridade", contarPor(abertos, "prioridade", ["alta", "media", "baixa"]), ROTULOS_PRIORIDADE);
  atualizarBarrasPorTecnico(abertos, usuarios);
}

// -------------------- Busca geral --------------------
// Carrega um índice leve na primeira vez que a pessoa usa a busca e
// procura em tudo localmente (rápido, sem esperar a cada letra).
const campoBusca = document.getElementById("busca-geral");
const caixaResultados = document.getElementById("busca-resultados");
let indiceBusca = null;
let carregandoIndice = null;
let selecionado = 0;

function semAcento(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function carregarIndice() {
  if (indiceBusca) return indiceBusca;
  if (!carregandoIndice) {
    carregandoIndice = Promise.all([
      buscarTodos("chamados", (q) => q, "id,numero,area,atividade,status,responsavel_nome"),
      buscarTodos("maquinas", (q) => q, "id,nome,setor,responsavel_uso,so"),
      buscarTodos("itens_estoque", (q) => q, "id,equipamento,serial,ativo,loja_setor,situacao"),
      buscarTodos("visitas", (q) => q, "id,titulo,cidade,area,data,recurso_responsavel")
    ]).then(([chamados, maquinas, itens, visitas]) => {
      const itensIndice = [];
      chamados.forEach((c) => itensIndice.push({ tipo: "Chamado", icone: "chamados", titulo: `${c.numero || "(sem nº)"} · ${c.area || ""}`,
        detalhe: `${ROTULOS_STATUS[c.status] || ""} · ${c.atividade || ""}`, href: `chamados.html#c=${encodeURIComponent(c.id)}`,
        texto: semAcento(`${c.numero} ${c.area} ${c.atividade} ${c.responsavelNome}`) }));
      // Na tela de Máquinas: setor = Serial, responsavelUso = Ativo, so = Setor destino.
      maquinas.forEach((m) => itensIndice.push({ tipo: "Máquina", icone: "maquinas", titulo: m.nome,
        detalhe: [m.setor && "S/N " + m.setor, m.responsavelUso && "Ativo " + m.responsavelUso, m.so].filter(Boolean).join(" · "),
        href: `maquinas.html#m=${encodeURIComponent(m.id)}`, texto: semAcento(`${m.nome} ${m.setor} ${m.responsavelUso} ${m.so}`) }));
      itens.forEach((i) => itensIndice.push({ tipo: "Estoque", icone: "estoque", titulo: i.equipamento,
        detalhe: [i.serial && "S/N " + i.serial, i.ativo && "Ativo " + i.ativo, i.lojaSetor].filter(Boolean).join(" · "),
        href: `estoque.html#i=${encodeURIComponent(i.id)}`, texto: semAcento(`${i.equipamento} ${i.serial} ${i.ativo} ${i.lojaSetor}`) }));
      visitas.forEach((v) => itensIndice.push({ tipo: "Visita", icone: "visitas", titulo: v.titulo,
        detalhe: [v.data && v.data.split("-").reverse().join("/"), v.cidade, v.recursoResponsavel].filter(Boolean).join(" · "),
        href: `visitas.html#v=${encodeURIComponent(v.id)}`, texto: semAcento(`${v.titulo} ${v.cidade} ${v.area} ${v.recursoResponsavel}`) }));
      usuarios.forEach((u) => itensIndice.push({ tipo: "Pessoa", icone: "usuarios", titulo: u.nome, detalhe: u.email,
        href: ehAdmin() ? "usuarios.html" : "tarefas.html", texto: semAcento(`${u.nome} ${u.email}`) }));
      indiceBusca = itensIndice;
      return itensIndice;
    }).catch((err) => { carregandoIndice = null; throw err; });
  }
  return carregandoIndice;
}

campoBusca.addEventListener("focus", () => { carregarIndice().catch(() => {}); });
campoBusca.addEventListener("input", buscar);
campoBusca.addEventListener("keydown", (e) => {
  const itens = caixaResultados.querySelectorAll(".resultado");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!itens.length) return;
    selecionado = (selecionado + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens.forEach((el, i) => el.classList.toggle("selecionado", i === selecionado));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (itens[selecionado]) window.location.href = itens[selecionado].getAttribute("href");
  } else if (e.key === "Escape") {
    caixaResultados.hidden = true;
    campoBusca.blur();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".busca-geral")) caixaResultados.hidden = true;
});

async function buscar() {
  const termo = semAcento(campoBusca.value.trim());
  if (termo.length < 2) { caixaResultados.hidden = true; return; }
  caixaResultados.hidden = false;
  if (!indiceBusca) caixaResultados.innerHTML = '<div class="resultado-vazio">Carregando...</div>';
  let indice;
  try { indice = await carregarIndice(); } catch (err) {
    caixaResultados.innerHTML = `<div class="resultado-vazio">Erro na busca: ${escaparHTML(err.message)}</div>`;
    return;
  }
  if (semAcento(campoBusca.value.trim()) !== termo) return; // digitou mais enquanto carregava

  const palavras = termo.split(/\s+/);
  const achados = indice.filter((i) => palavras.every((p) => i.texto.includes(p))).slice(0, 10);
  selecionado = 0;
  caixaResultados.innerHTML = achados.length
    ? achados.map((r, n) => `
        <a class="resultado ${n === 0 ? "selecionado" : ""}" href="${r.href}">
          <span class="resultado-icone">${icone(r.icone)}</span>
          <span class="resultado-texto"><strong>${escaparHTML(r.titulo)}</strong><small>${escaparHTML(truncar(r.detalhe, 90))}</small></span>
          <span class="resultado-tipo">${r.tipo}</span>
        </a>`).join("")
    : `<div class="resultado-vazio">Nada encontrado para "${escaparHTML(campoBusca.value.trim())}".</div>`;
}

function contarPor(chamados, campo, ordemChaves) {
  const contagem = {};
  ordemChaves.forEach((k) => contagem[k] = 0);
  chamados.forEach((c) => {
    const chave = c[campo];
    if (chave in contagem) contagem[chave]++;
  });
  return contagem;
}

function atualizarBarras(containerId, contagem, rotulos) {
  const total = Object.values(contagem).reduce((a, b) => a + b, 0) || 1;
  const container = document.getElementById(containerId);

  if (Object.values(contagem).every((v) => v === 0)) {
    container.innerHTML = '<p class="texto-suave">Nenhum chamado em aberto.</p>';
    return;
  }

  container.innerHTML = Object.entries(contagem).map(([chave, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="barra-linha">
        <span>${rotulos[chave] || chave}</span>
        <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <span>${valor}</span>
      </div>`;
  }).join("");
}

function atualizarBarrasPorEmpresaVisita(visitas) {
  const container = document.getElementById("barras-visitas-empresa");

  if (visitas.length === 0) {
    container.innerHTML = '<p class="texto-suave">Nenhuma visita técnica cadastrada ainda.</p>';
    return;
  }

  // "Equipe Interna" e "FindUp" sempre aparecem primeiro (para comparação
  // direta), mesmo com contagem zero; qualquer outra empresa cadastrada
  // aparece em seguida.
  const contagem = { "Equipe Interna": 0, "FindUp": 0 };
  visitas.forEach((v) => {
    const chave = v.empresaResponsavel || "Não informado";
    contagem[chave] = (contagem[chave] || 0) + 1;
  });

  const total = visitas.length || 1;
  container.innerHTML = Object.entries(contagem).map(([chave, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="barra-linha">
        <span>${escaparHTML(chave)}</span>
        <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <span>${valor}</span>
      </div>`;
  }).join("");
}

function atualizarBarrasPorTecnico(chamados, usuarios) {
  const contagem = {};
  usuarios.forEach((u) => contagem[u.uid] = 0);
  let semResponsavel = 0;

  chamados.forEach((c) => {
    if (c.responsavelUid && c.responsavelUid in contagem) {
      contagem[c.responsavelUid]++;
    } else {
      semResponsavel++;
    }
  });

  const rotulos = {};
  usuarios.forEach((u) => rotulos[u.uid] = u.nome);

  const container = document.getElementById("barras-tecnico");
  const total = chamados.length || 1;
  const entradas = Object.entries(contagem).concat(semResponsavel > 0 ? [["_sem", semResponsavel]] : []);
  rotulos["_sem"] = "Não atribuído";

  if (chamados.length === 0) {
    container.innerHTML = '<p class="texto-suave">Nenhum chamado em aberto.</p>';
    return;
  }

  container.innerHTML = entradas.map(([uid, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="barra-linha">
        <span>${escaparHTML(rotulos[uid] || "—")}</span>
        <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <span>${valor}</span>
      </div>`;
  }).join("");
}

// -------------------- Utilitários --------------------
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

function truncar(texto, tamanho) {
  if (!texto) return "";
  return texto.length > tamanho ? texto.slice(0, tamanho) + "…" : texto;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
