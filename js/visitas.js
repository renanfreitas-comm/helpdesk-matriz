// ==========================================================================
// LÓGICA DA TELA DE VISITAS TÉCNICAS
// ==========================================================================
// Qualquer pessoa logada pode registrar uma visita. Só o próprio autor ou
// um admin pode editar; só admin pode excluir.
// ==========================================================================
import { db } from "./firebase-config.js";
import { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN } from "./apps-script-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

  const snapUsuarios = await getDocs(collection(db, "usuarios"));
  listaUsuarios = snapUsuarios.docs.map((d) => ({ uid: d.id, ...d.data() }));

  observarVisitas();
});

function observarVisitas() {
  const q = query(collection(db, "visitas"), orderBy("data", "desc"));
  onSnapshot(q, (snap) => {
    listaVisitas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarTabela();
  }, (erro) => {
    tabelaBody.innerHTML = `<tr><td colspan="11" class="vazio">Erro ao carregar visitas: ${erro.message}</td></tr>`;
  });
}

function renderizarTabela() {
  const busca = document.getElementById("filtro-busca-visita").value.trim().toLowerCase();
  const fStatus = document.getElementById("filtro-status-visita").value;
  const fEmpresa = document.getElementById("filtro-empresa-visita").value;

  const filtradas = listaVisitas.filter((v) => {
    if (fStatus && v.status !== fStatus) return false;
    if (fEmpresa && v.empresaResponsavel !== fEmpresa) return false;
    if (busca) {
      const alvo = `${v.cidade || ""} ${v.area || ""} ${v.recursoResponsavel || ""}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

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

    const laudo = v.laudoUrl
      ? `<a href="${v.laudoUrl}" target="_blank" rel="noopener">${escaparHTML(v.laudoNome || "Abrir laudo")}</a>`
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
}

["filtro-status-visita", "filtro-empresa-visita"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderizarTabela);
});
document.getElementById("filtro-busca-visita").addEventListener("input", renderizarTabela);

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
  laudoAtualEl.dataset.laudoUrl = "";
  laudoAtualEl.dataset.laudoNome = "";

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

    if (v.laudoUrl) {
      laudoAtualEl.textContent = `Laudo já anexado: ${v.laudoNome || "arquivo"} (escolha outro arquivo acima só se quiser substituí-lo)`;
      laudoAtualEl.dataset.laudoUrl = v.laudoUrl;
      laudoAtualEl.dataset.laudoNome = v.laudoNome || "";
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
    observacoes: document.getElementById("visita-observacoes").value.trim(),
    atualizadoEm: serverTimestamp()
  };

  const arquivo = inputLaudo.files[0] || null;
  const jaTinhaLaudo = !!laudoAtualEl.dataset.laudoUrl;

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

  try {
    let visitaId = visitaIdAtual;
    let laudoUrlFinal = laudoAtualEl.dataset.laudoUrl || "";

    if (modoAtual === "criar") {
      const novoDoc = await addDoc(collection(db, "visitas"), {
        ...dados,
        criadoPorUid: usuarioAtual.uid,
        criadoPorNome: perfilAtual.nome,
        criadoEm: serverTimestamp()
      });
      visitaId = novoDoc.id;
    } else {
      await updateDoc(doc(db, "visitas", visitaId), dados);
    }

    if (arquivo) {
      botao.textContent = "Enviando laudo...";
      const conteudoBase64 = await arquivoParaBase64(arquivo);
      // O navegador não consegue ler a resposta desta chamada (veja o
      // comentário em chamarAppsScript), mas ela já deixa o laudo salvo no
      // Drive. Por isso buscamos o link certo logo depois, separadamente.
      await chamarAppsScript({
        acao: "uploadLaudo",
        visitaId,
        nomeArquivo: arquivo.name,
        mimeType: arquivo.type,
        conteudoBase64
      });

      botao.textContent = "Confirmando laudo...";
      const resultado = await buscarLaudoComRetentativa(visitaId);
      if (resultado.erro) throw new Error(resultado.erro);
      laudoUrlFinal = resultado.url;
      await updateDoc(doc(db, "visitas", visitaId), { laudoUrl: laudoUrlFinal, laudoNome: arquivo.name });
    }

    fecharModal();

    // Os avisos por e-mail são automáticos (via Apps Script) — se o envio
    // falhar por algum motivo, a visita/laudo já foram salvos normalmente,
    // então só avisamos no console e seguimos, sem travar o usuário.
    if (modoAtual === "criar" && dados.status === "agendada") {
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
          `Link do laudo (${arquivo.name}):\n` +
          laudoUrlFinal
      });
    }
  } catch (err) {
    erroEl.textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar";
  }
});

// -------------------- Integração com o Google Apps Script (sem custo) ------
// Guarda o laudo no Drive e dispara os e-mails automáticos. Veja
// js/apps-script-config.js e apps-script/Codigo.gs.
//
// IMPORTANTE: o Google Apps Script não devolve o cabeçalho de CORS que o
// navegador exige pra LER a resposta de uma chamada feita de outro site —
// então usamos "mode: no-cors": a ação roda normalmente do lado do Google
// (o laudo é salvo, o e-mail é enviado), só não conseguimos ler o que ele
// respondeu. Por isso esta função não devolve nada; quando precisamos ler
// alguma informação de volta (o link do laudo), usamos
// buscarLaudoComRetentativa() logo abaixo, que contorna essa limitação
// com uma tag <script> (técnica conhecida como JSONP).
async function chamarAppsScript(payload) {
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token: APPS_SCRIPT_TOKEN })
  });
}

// Busca o link do laudo recém-enviado via JSONP (uma tag <script>, que não
// passa pela restrição de CORS). Tenta algumas vezes com um pequeno
// intervalo, caso a busca aconteça uma fração de segundo antes de o Google
// terminar de indexar o arquivo no Drive.
async function buscarLaudoComRetentativa(visitaId, tentativas = 3) {
  let ultimoResultado = { erro: "Não foi possível buscar o link do laudo." };
  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    ultimoResultado = await buscarLaudoViaJsonp(visitaId);
    if (!ultimoResultado.erro) return ultimoResultado;
  }
  return ultimoResultado;
}

let contadorJsonp = 0;
function buscarLaudoViaJsonp(visitaId) {
  return new Promise((resolve) => {
    const nomeCallback = `__laudoCallback${Date.now()}_${contadorJsonp++}`;

    const limpar = () => {
      clearTimeout(temporizador);
      delete window[nomeCallback];
      script.remove();
    };

    const temporizador = setTimeout(() => {
      limpar();
      resolve({ erro: "Tempo esgotado buscando o link do laudo." });
    }, 15000);

    window[nomeCallback] = (dados) => {
      limpar();
      resolve(dados);
    };

    const params = new URLSearchParams({
      acao: "buscarLaudo",
      visitaId,
      token: APPS_SCRIPT_TOKEN,
      callback: nomeCallback
    });
    const script = document.createElement("script");
    script.src = `${APPS_SCRIPT_URL}?${params.toString()}`;
    script.onerror = () => {
      limpar();
      resolve({ erro: "Não foi possível buscar o link do laudo." });
    };
    document.body.appendChild(script);
  });
}

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result.split(",")[1] || "");
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
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
    await deleteDoc(doc(db, "visitas", id));
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
