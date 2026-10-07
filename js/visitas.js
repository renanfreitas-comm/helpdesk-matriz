// ==========================================================================
// LÓGICA DA TELA DE VISITAS TÉCNICAS
// ==========================================================================
// Qualquer pessoa logada pode registrar uma visita. Só o próprio autor ou
// um admin pode editar; só admin pode excluir.
//
// Laudos (PDF/DOCX) ficam no Supabase Storage, bucket privado "laudos",
// em "<id da visita>/<arquivo>". Os links são temporários e gerados na hora
// de abrir. Laudos antigos (de antes da migração) continuam como links do
// Google Drive no campo laudoUrl.
// E-mails de aviso continuam saindo pelo Google Apps Script.
// ==========================================================================
import { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN } from "./apps-script-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { exportarCSV, nomeArquivoComData } from "./csv-utils.js";
import { supabase, observar, inserir, atualizar, excluir, listarUsuarios } from "./db.js";

let usuarioAtual = null;
let perfilAtual = null;
let listaVisitas = [];
let listaUsuarios = []; // usado para montar os e-mails de aviso (colaboradores/admins)

const TIPOS_LAUDO_ACEITOS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];
const TAMANHO_MAX_LAUDO = 15 * 1024 * 1024; // 15 MB — limite razoável para um laudo em PDF/DOCX

const tabelaBody = document.getElementById("tabela-visitas");
const modal = document.getElementById("modal-visita");
const form = document.getElementById("form-visita");
const inputLaudo = document.getElementById("visita-laudo");
const laudoAtualEl = document.getElementById("visita-laudo-atual");

const ROTULOS_TIPO = {
  instalacao: "Instalação",
  manutencao: "Manutenção",
  suporte: "Suporte técnico",
  vistoria: "Vistoria/Inspeção",
  outro: "Outro"
};
const ROTULOS_STATUS = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };
const CLASSES_STATUS = { agendada: "badge-status-andamento", realizada: "badge-status-resolvido", cancelada: "badge-status-aberto" };

protegerPagina(async (user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil);

  listaUsuarios = await listarUsuarios();

  observarVisitas();
});

function observarVisitas() {
  observar("visitas", (q) => q.order("data", { ascending: false }).order("criado_em", { ascending: false }), (linhas) => {
    listaVisitas = linhas;
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="11" class="vazio">Erro ao carregar visitas: ${escaparHTML(erro.message)}</td></tr>`;
  });
}

function obterListaFiltrada() {
  const busca = document.getElementById("filtro-busca-visita").value.trim().toLowerCase();
  const fStatus = document.getElementById("filtro-status-visita").value;
  const fEmpresa = document.getElementById("filtro-empresa-visita").value;

  return listaVisitas.filter((v) => {
    if (fStatus && v.status !== fStatus) return false;
    if (fEmpresa && v.empresaResponsavel !== fEmpresa) return false;
    if (busca) {
      const alvo = `${v.cidade || ""} ${v.area || ""} ${v.recursoResponsavel || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

function renderizarTabela() {
  const filtradas = obterListaFiltrada();

  if (filtradas.length === 0) {
    tabelaBody.innerHTML = `<tr><td colspan="11" class="vazio">Nenhuma visita encontrada.</td></tr>`;
    return;
  }

  tabelaBody.innerHTML = filtradas.map((v) => {
    const podeEditar = perfilAtual.papel === "admin" || v.criadoPorUid === usuarioAtual.uid;
    const podeExcluir = perfilAtual.papel === "admin";

    let acoes = "";
    if (podeEditar) acoes += `<button class="botao-secundario btn-editar-visita" data-id="${v.id}">Editar</button>`;
    if (podeExcluir) acoes += `<button class="botao-perigo btn-excluir-visita" data-id="${v.id}">Excluir</button>`;
    if (!podeEditar && !podeExcluir) acoes = '<span class="texto-suave">—</span>';

    const laudo = v.laudoPath
      ? `<a href="#" class="link-laudo" data-path="${escaparHTML(v.laudoPath)}">${escaparHTML(v.laudoNome || "Abrir laudo")}</a>`
      : linkSeguro(v.laudoUrl)
      ? `<a href="${escaparHTML(v.laudoUrl)}" target="_blank" rel="noopener">${escaparHTML(v.laudoNome || "Abrir laudo")}</a>`
      : '<span class="texto-suave">—</span>';

    return `
      <tr>
        <td>${escaparHTML(v.numero || "—")}</td>
        <td><strong>${escaparHTML(v.titulo)}</strong></td>
        <td>${escaparHTML(v.recursoResponsavel)}</td>
        <td>${escaparHTML(v.cidade || "—")}</td>
        <td>${formatarData(v.data)}</td>
        <td>${escaparHTML(v.area || "—")}</td>
        <td>${ROTULOS_TIPO[v.tipoAtendimento] || v.tipoAtendimento || "—"}</td>
        <td><span class="badge ${CLASSES_STATUS[v.status] || ""}">${ROTULOS_STATUS[v.status] || v.status || "—"}</span></td>
        <td>${escaparHTML(v.empresaResponsavel || "—")}</td>
        <td>${laudo}</td>
        <td><div class="acoes-tabela">${acoes}</div></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".btn-editar-visita").forEach((b) =>
    b.addEventListener("click", () => abrirModal("editar", b.dataset.id)));
  document.querySelectorAll(".btn-excluir-visita").forEach((b) =>
    b.addEventListener("click", () => excluirVisita(b.dataset.id)));
  document.querySelectorAll(".link-laudo").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); abrirLaudo(a.dataset.path); }));
}

// Gera um link temporário (5 min) para o laudo e abre numa nova aba.
async function abrirLaudo(caminho) {
  const aba = window.open("", "_blank"); // abre já no clique, para o navegador não bloquear
  const { data, error } = await supabase.storage.from("laudos").createSignedUrl(caminho, 300);
  if (error || !data) {
    if (aba) aba.close();
    alert("Não foi possível abrir o laudo: " + (error ? error.message : "arquivo não encontrado"));
    return;
  }
  if (aba) aba.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

["filtro-status-visita", "filtro-empresa-visita"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderizarTabela);
});
document.getElementById("filtro-busca-visita").addEventListener("input", renderizarTabela);

// -------------------- Exportar CSV --------------------
// Exporta exatamente o que está sendo mostrado na tela (respeita os
// filtros/busca ativos no momento).
document.getElementById("btn-exportar-visitas").addEventListener("click", () => {
  const cabecalhos = [
    "Número", "Título", "Recurso Responsável", "Cidade", "Data da Visita", "Área",
    "Tipo de Atendimento", "Status", "Empresa Responsável", "Observações", "Link do Laudo", "Registrado por"
  ];

  const linhas = obterListaFiltrada().map((v) => [
    v.numero || "",
    v.titulo || "",
    v.recursoResponsavel || "",
    v.cidade || "",
    formatarData(v.data),
    v.area || "",
    ROTULOS_TIPO[v.tipoAtendimento] || v.tipoAtendimento || "",
    ROTULOS_STATUS[v.status] || v.status || "",
    v.empresaResponsavel || "",
    v.observacoes || "",
    v.laudoPath ? `Storage: laudos/${v.laudoPath}` : (v.laudoUrl || ""),
    v.criadoPorNome || ""
  ]);

  exportarCSV(nomeArquivoComData("visitas"), cabecalhos, linhas);
});

// -------------------- Modal --------------------
let modoAtual = "criar";
let visitaIdAtual = null;

document.getElementById("btn-nova-visita").addEventListener("click", () => abrirModal("criar"));
document.getElementById("btn-cancelar-visita").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });

function abrirModal(modo, visitaId = null) {
  modoAtual = modo;
  visitaIdAtual = visitaId;
  document.getElementById("visita-erro").textContent = "";
  form.reset();
  document.getElementById("visita-id").value = visitaId || "";
  laudoAtualEl.textContent = "";
  laudoAtualEl.dataset.temLaudo = "";

  if (modo === "criar") {
    document.getElementById("modal-visita-titulo").textContent = "Nova visita";
    document.getElementById("visita-data").value = hojeISO();
    document.getElementById("visita-status").value = "agendada";
    document.getElementById("visita-empresa").value = "Equipe Interna";
  } else {
    const v = listaVisitas.find((x) => x.id === visitaId);
    document.getElementById("modal-visita-titulo").textContent = "Editar visita";
    document.getElementById("visita-numero").value = v.numero || "";
    document.getElementById("visita-titulo").value = v.titulo || "";
    document.getElementById("visita-recurso").value = v.recursoResponsavel || "";
    document.getElementById("visita-cidade").value = v.cidade || "";
    document.getElementById("visita-data").value = v.data || "";
    document.getElementById("visita-area").value = v.area || "";
    document.getElementById("visita-tipo").value = v.tipoAtendimento || "instalacao";
    document.getElementById("visita-status").value = v.status || "agendada";
    document.getElementById("visita-empresa").value = v.empresaResponsavel || "Equipe Interna";
    document.getElementById("visita-observacoes").value = v.observacoes || "";

    if (v.laudoPath || v.laudoUrl) {
      laudoAtualEl.textContent = `Laudo já anexado: ${v.laudoNome || "arquivo"} (escolha outro arquivo acima só se quiser substituí-lo)`;
      laudoAtualEl.dataset.temLaudo = "sim";
    }
  }

  modal.classList.add("aberto");
}

function fecharModal() {
  modal.classList.remove("aberto");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erroEl = document.getElementById("visita-erro");
  erroEl.textContent = "";

  const dados = {
    numero: document.getElementById("visita-numero").value.trim(),
    titulo: document.getElementById("visita-titulo").value.trim(),
    recursoResponsavel: document.getElementById("visita-recurso").value.trim(),
    cidade: document.getElementById("visita-cidade").value.trim(),
    data: document.getElementById("visita-data").value,
    area: document.getElementById("visita-area").value.trim(),
    tipoAtendimento: document.getElementById("visita-tipo").value,
    status: document.getElementById("visita-status").value,
    empresaResponsavel: document.getElementById("visita-empresa").value,
    observacoes: document.getElementById("visita-observacoes").value.trim()
  };

  const arquivo = inputLaudo.files[0] || null;
  const jaTinhaLaudo = laudoAtualEl.dataset.temLaudo === "sim";

  // Laudo (PDF ou DOCX) é obrigatório para marcar a visita como Realizada —
  // precisa já existir um laudo anexado ou o usuário precisa escolher um agora.
  if (dados.status === "realizada" && !arquivo && !jaTinhaLaudo) {
    erroEl.textContent = "Para marcar como Realizada, anexe o laudo em PDF ou DOCX.";
    return;
  }

  if (arquivo) {
    if (!TIPOS_LAUDO_ACEITOS.includes(arquivo.type)) {
      erroEl.textContent = "O laudo precisa ser um arquivo PDF ou DOCX.";
      return;
    }
    if (arquivo.size > TAMANHO_MAX_LAUDO) {
      erroEl.textContent = "O laudo precisa ter até 15 MB.";
      return;
    }
  }

  const botao = document.getElementById("btn-salvar-visita");
  botao.disabled = true;
  botao.textContent = "Salvando...";

  const visitaIdAnterior = visitaIdAtual; // vazio = visita nova
  try {
    let visitaId = visitaIdAtual;
    let linkLaudoEmail = "";

    if (modoAtual === "criar") {
      const nova = await inserir("visitas", dados);
      visitaId = nova.id;
      visitaIdAtual = nova.id;
      modoAtual = "editar"; // se o laudo falhar, salvar de novo não duplica a visita
    } else {
      await atualizar("visitas", visitaId, dados);
    }

    if (arquivo) {
      botao.textContent = "Enviando laudo...";
      const anterior = listaVisitas.find((x) => x.id === visitaId);
      const caminho = `${visitaId}/${Date.now()}-${nomeArquivoSeguro(arquivo.name)}`;

      const { error: erroUpload } = await supabase.storage
        .from("laudos")
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (erroUpload) throw new Error("Falha ao enviar o laudo: " + erroUpload.message);

      await atualizar("visitas", visitaId, { laudoPath: caminho, laudoNome: arquivo.name, laudoUrl: null });

      // Remove o laudo anterior desta visita (se havia um no Storage).
      if (anterior && anterior.laudoPath && anterior.laudoPath !== caminho) {
        await supabase.storage.from("laudos").remove([anterior.laudoPath]);
      }

      // Link para o e-mail aos admins: válido por 7 dias.
      const { data: assinado } = await supabase.storage.from("laudos").createSignedUrl(caminho, 7 * 24 * 3600);
      linkLaudoEmail = assinado ? assinado.signedUrl : "";
    }

    fecharModal();

    // Os avisos por e-mail são automáticos (via Apps Script) — se o envio
    // falhar por algum motivo, a visita/laudo já foram salvos normalmente,
    // então só avisamos no console e seguimos, sem travar o usuário.
    if (!visitaIdAnterior && dados.status === "agendada") {
      enviarAvisoAutomatico({
        destinatarios: listaUsuarios.map((u) => u.email).filter(Boolean),
        assunto: `Nova visita técnica agendada — ${dados.titulo}`,
        corpo:
          `Uma nova visita técnica foi agendada:\n\n` +
          `Título: ${dados.titulo}\n` +
          `Recurso responsável: ${dados.recursoResponsavel}\n` +
          `Data: ${formatarData(dados.data)}\n` +
          `Cidade: ${dados.cidade || "—"}\n` +
          `Área: ${dados.area || "—"}\n` +
          `Empresa responsável: ${dados.empresaResponsavel}\n\n` +
          `Registrado por: ${perfilAtual.nome}`
      });
    } else if (dados.status === "realizada" && arquivo) {
      const emailsAdmins = listaUsuarios.filter((u) => u.papel === "admin").map((u) => u.email).filter(Boolean);
      enviarAvisoAutomatico({
        destinatarios: emailsAdmins,
        assunto: `Laudo da visita técnica realizada — ${dados.titulo}`,
        corpo:
          `A visita abaixo foi marcada como Realizada e o laudo já está anexado:\n\n` +
          `Título: ${dados.titulo}\n` +
          `Recurso responsável: ${dados.recursoResponsavel}\n` +
          `Data: ${formatarData(dados.data)}\n` +
          `Empresa responsável: ${dados.empresaResponsavel}\n\n` +
          `Link do laudo (${arquivo.name}, válido por 7 dias):\n` +
          (linkLaudoEmail || "abra a tela de Visitas no Help Desk para baixar.")
      });
    }
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

// -------------------- E-mails automáticos (Google Apps Script, sem custo) ----
// Veja js/apps-script-config.js e apps-script/Codigo.gs.
//
// O Apps Script não devolve o cabeçalho de CORS, então usamos "no-cors":
// o e-mail é enviado normalmente, só não conseguimos ler a resposta.
// O token de acesso do usuário logado vai junto para o Apps Script
// confirmar no Supabase que quem pediu o envio é alguém do time.
async function chamarAppsScript(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token: APPS_SCRIPT_TOKEN, accessToken: session ? session.access_token : "" })
  });
}

// Só aceita links https do Google (laudos antigos do Drive) — o link vai direto para um href.
function linkSeguro(url) {
  return typeof url === "string" && /^https:\/\/([a-z0-9-]+\.)*google\.com\//.test(url);
}

function nomeArquivoSeguro(nome) {
  const limpo = String(nome)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // tira acentos
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return limpo || "laudo";
}

async function enviarAvisoAutomatico({ destinatarios, assunto, corpo }) {
  if (!destinatarios || destinatarios.length === 0) return;
  try {
    await chamarAppsScript({ acao: "enviarEmail", destinatarios, assunto, corpo });
  } catch (err) {
    console.error("Erro ao enviar e-mail automático:", err);
  }
}

async function excluirVisita(id) {
  if (!confirm("Excluir esta visita? Essa ação não pode ser desfeita.")) return;
  try {
    const v = listaVisitas.find((x) => x.id === id);
    await excluir("visitas", id);
    // Apaga também o laudo do Storage (admin tem permissão para isso).
    if (v && v.laudoPath) await supabase.storage.from("laudos").remove([v.laudoPath]);
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
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}
