// ==========================================================================
// LÓGICA DO DASHBOARD (indicadores)
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, listarUsuarios } from "./db.js";
import { badgePrazo, situacaoPrazo, ordenarPorPrazo, tempoMedioResolucao } from "./sla.js";
import { botoesRapidos, ligarBotoesRapidos } from "./acoes-chamado.js";

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };
const ROTULOS_STATUS = { aberto: "Aberto", andamento: "Em andamento", resolvido: "Resolvido" };
const TRINTA_DIAS = 30 * 24 * 3600 * 1000;

let usuarioAtual = null;
let perfilAtual = null;
let chamadosAtuais = [];

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);
  document.getElementById("saudacao").textContent = `${saudacao()}, ${primeiroNome(perfil.nome)}`;

  const usuarios = await listarUsuarios();

  observar("chamados", (q) => q, (chamados) => {
    chamadosAtuais = chamados;
    renderizarFilas();
    atualizarCards(chamados);
    const abertos = chamados.filter((c) => c.status !== "resolvido");
    atualizarBarras("barras-prioridade", contarPor(abertos, "prioridade", ["alta", "media", "baixa"]), ROTULOS_PRIORIDADE);
    atualizarBarrasPorTecnico(abertos, usuarios);
  });

  observar("visitas", (q) => q, (visitas) => {
    atualizarBarrasPorEmpresaVisita(visitas);
  });

  // Mantém os prazos ("vence em...") atualizados.
  setInterval(renderizarFilas, 60000);
});

// -------------------- Filas do técnico --------------------
function renderizarFilas() {
  if (!usuarioAtual) return;
  const abertos = chamadosAtuais.filter((c) => c.status !== "resolvido").sort(ordenarPorPrazo);
  const meus = abertos.filter((c) => c.responsavelUid === usuarioAtual.uid);
  const livres = abertos.filter((c) => !c.responsavelUid);

  desenharLista("minha-fila", meus, "Nada pendente com você. Veja ao lado se há chamados para assumir.");
  desenharLista("sem-responsavel", livres, "Nenhum chamado esperando responsável.");
  document.getElementById("qtd-livres").textContent = livres.length;
}

function desenharLista(idEl, lista, vazio) {
  const el = document.getElementById(idEl);
  if (lista.length === 0) {
    el.innerHTML = `<p class="texto-suave">${vazio}</p>`;
    return;
  }
  const visiveis = lista.slice(0, 8);
  el.innerHTML = `<ul class="fila">${visiveis.map((c) => `
    <li class="fila-item ${situacaoPrazo(c).atrasado ? "linha-atrasada" : ""}">
      <a class="fila-info" href="chamados.html#c=${encodeURIComponent(c.id)}">
        <strong>${escaparHTML(c.numero || "(sem número)")}</strong>
        <span class="texto-suave">${escaparHTML(c.area || "")}</span>
        <span class="fila-badges">
          <span class="badge badge-prioridade-${c.prioridade}">${ROTULOS_PRIORIDADE[c.prioridade] || ""}</span>
          <span class="badge badge-status-${c.status}">${ROTULOS_STATUS[c.status] || ""}</span>
          ${badgePrazo(c)}
        </span>
        <span class="fila-atividade">${escaparHTML(truncar(c.atividade, 90))}</span>
      </a>
      <div class="acoes-tabela">${botoesRapidos(c, usuarioAtual.uid, perfilAtual.papel === "admin")}</div>
    </li>`).join("")}</ul>
    ${lista.length > visiveis.length ? `<a class="link-suave" href="chamados.html">+ ${lista.length - visiveis.length} outro(s)</a>` : ""}`;
  ligarBotoesRapidos(el, chamadosAtuais, usuarioAtual.uid);
}

// -------------------- Indicadores --------------------
function atualizarCards(chamados) {
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
