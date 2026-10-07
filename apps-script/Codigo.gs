// ==========================================================================
// HELP DESK MATRIZ — BACKEND GRATUITO NO GOOGLE APPS SCRIPT
// ==========================================================================
// Faz duas coisas para o módulo de Visitas Técnicas:
//   1) Guarda o laudo (PDF/DOCX) de cada visita no Google Drive.
//   2) Envia os e-mails automáticos de aviso.
//
// COMO PUBLICAR / ATUALIZAR
//   1. https://script.google.com > abra o projeto (ou crie um novo) e cole
//      TODO este arquivo no lugar do Codigo.gs.
//   2. Confira as configurações logo abaixo (TOKEN_SECRETO precisa ser
//      IGUAL ao APPS_SCRIPT_TOKEN de js/apps-script-config.js).
//   3. Rode uma vez a função "autorizar" (menu Executar) e aceite as
//      permissões do Google (Drive, Gmail e acesso externo).
//   4. Implantar > Gerenciar implantações > lápis (Editar) > Versão:
//      "Nova versão" > Implantar.  Executar como: Eu | Quem pode acessar:
//      Qualquer pessoa.  (Editando a implantação existente, a URL
//      continua a mesma e não precisa mexer no site.)
//
// SEGURANÇA
//   O token fica visível no código do site, então ele sozinho não protege
//   nada. Por isso cada chamada também leva o "idToken" do Firebase do
//   usuário logado: este script confere esse idToken no próprio Firestore
//   e só atende quem tem perfil em /usuarios. E-mails só saem para
//   endereços que estão cadastrados em /usuarios.
// ==========================================================================

// ------------------------------------------------------------ CONFIGURAÇÃO
const TOKEN_SECRETO = "CommcenterInfra2026";

// Mesmos valores de js/firebase-config.js
const FIREBASE_PROJECT_ID = "helpdesk-matriz-58813";
const FIREBASE_API_KEY = "AIzaSyCHH5J6doAU8TAUbCT1znOoOZM73ppvjis";

// true  = exige usuário logado no site com perfil em /usuarios (recomendado)
// false = aceita só o TOKEN_SECRETO (modo antigo, menos seguro)
const EXIGIR_LOGIN_FIREBASE = true;

// Pasta do Drive (de quem publicou o script) onde os laudos ficam.
const NOME_PASTA_LAUDOS = "Help Desk Matriz - Laudos";

// Quem consegue abrir o link do laudo:
//   "LINK"    = qualquer pessoa com o link (funciona para todo mundo)
//   "DOMINIO" = só contas do mesmo Google Workspace (ex.: @commcenter.com.br)
const COMPARTILHAMENTO_LAUDO = "LINK";

const NOME_REMETENTE = "Help Desk Matriz";
const TAMANHO_MAX_LAUDO = 15 * 1024 * 1024; // 15 MB (igual ao site)
const TIPOS_LAUDO_ACEITOS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];
const MAX_EMAILS_POR_HORA_POR_USUARIO = 30;

// ------------------------------------------------------------ ENTRADAS HTTP

/** POST (fetch no-cors do site): uploadLaudo | enviarEmail */
function doPost(e) {
  let dados = {};
  try {
    dados = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const usuario = autenticar_(dados.token, dados.idToken);

    switch (dados.acao) {
      case "uploadLaudo":
        return json_(uploadLaudo_(dados, usuario));
      case "enviarEmail":
        return json_(enviarEmail_(dados, usuario));
      default:
        throw new Error("Ação desconhecida.");
    }
  } catch (err) {
    console.error(err);
    // Como o site não consegue ler a resposta do POST, guardamos o erro do
    // upload para o buscarLaudo devolver uma mensagem útil.
    if (dados && dados.acao === "uploadLaudo" && idValido_(dados.visitaId)) {
      salvarErroLaudo_(dados.visitaId, err.message);
    }
    return json_({ erro: err.message });
  }
}

/** GET via JSONP (tag <script>): buscarLaudo */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = p.callback || "";
  let resultado;

  try {
    autenticar_(p.token, p.idToken);
    if (p.acao !== "buscarLaudo") throw new Error("Ação desconhecida.");
    resultado = buscarLaudo_(p.visitaId);
  } catch (err) {
    resultado = { erro: err.message };
  }

  // Só aceita nomes de função simples (evita injeção de código via callback).
  if (/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(resultado) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(resultado);
}

// ------------------------------------------------------------ AÇÕES

function uploadLaudo_(dados, usuario) {
  const visitaId = dados.visitaId;
  if (!idValido_(visitaId)) throw new Error("Visita inválida.");

  const mimeType = String(dados.mimeType || "");
  if (TIPOS_LAUDO_ACEITOS.indexOf(mimeType) === -1) {
    throw new Error("O laudo precisa ser um arquivo PDF ou DOCX.");
  }

  const nomeArquivo = limparNomeArquivo_(dados.nomeArquivo || "laudo");
  const bytes = Utilities.base64Decode(String(dados.conteudoBase64 || ""));
  if (bytes.length === 0) throw new Error("Arquivo do laudo vazio.");
  if (bytes.length > TAMANHO_MAX_LAUDO) throw new Error("O laudo precisa ter até 15 MB.");

  // Confere se a visita existe e se o usuário pode vê-la (as regras do
  // Firestore são aplicadas com o idToken do próprio usuário).
  if (usuario) {
    const visita = firestoreGet_("visitas/" + visitaId, usuario.idToken);
    if (!visita) throw new Error("Visita não encontrada no banco.");
  }

  const pasta = obterPastaLaudos_();
  const blob = Utilities.newBlob(bytes, mimeType, visitaId + " - " + nomeArquivo);
  const arquivo = pasta.createFile(blob);
  arquivo.setDescription("Laudo da visita " + visitaId +
    (usuario ? " — enviado por " + usuario.email : ""));
  compartilhar_(arquivo);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    // Se a visita já tinha um laudo, manda o antigo para a lixeira.
    const anterior = lerJSON_(props.getProperty("laudo_" + visitaId));
    if (anterior && anterior.fileId && anterior.fileId !== arquivo.getId()) {
      try { DriveApp.getFileById(anterior.fileId).setTrashed(true); } catch (e) { /* já removido */ }
    }
    props.setProperty("laudo_" + visitaId, JSON.stringify({
      fileId: arquivo.getId(),
      url: arquivo.getUrl(),
      nome: nomeArquivo,
      em: Date.now()
    }));
    props.deleteProperty("erroLaudo_" + visitaId);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, url: arquivo.getUrl(), nome: nomeArquivo };
}

function buscarLaudo_(visitaId) {
  if (!idValido_(visitaId)) throw new Error("Visita inválida.");
  const props = PropertiesService.getScriptProperties();
  const laudo = lerJSON_(props.getProperty("laudo_" + visitaId));
  const erro = lerJSON_(props.getProperty("erroLaudo_" + visitaId));

  if (erro && (!laudo || erro.em > laudo.em)) {
    return { erro: "Falha ao salvar o laudo: " + erro.mensagem };
  }
  if (laudo) return { url: laudo.url, nome: laudo.nome };

  // Plano B: procura na pasta (laudos enviados antes desta versão).
  const it = obterPastaLaudos_().searchFiles(
    "title contains '" + visitaId + "' and trashed = false");
  let maisRecente = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!maisRecente || f.getDateCreated() > maisRecente.getDateCreated()) maisRecente = f;
  }
  if (maisRecente) return { url: maisRecente.getUrl(), nome: maisRecente.getName() };

  return { erro: "Laudo ainda não encontrado." };
}

function enviarEmail_(dados, usuario) {
  let destinatarios = Array.isArray(dados.destinatarios) ? dados.destinatarios : [];
  destinatarios = destinatarios
    .map(function (x) { return String(x || "").trim().toLowerCase(); })
    .filter(function (x) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x); });

  // Só envia para quem está cadastrado no sistema (evita uso como spam).
  if (usuario) {
    const permitidos = emailsCadastrados_(usuario.idToken);
    destinatarios = destinatarios.filter(function (x) { return permitidos[x]; });
    limitarTaxa_(usuario.uid);
  }
  // Remove duplicados
  destinatarios = destinatarios.filter(function (x, i, arr) { return arr.indexOf(x) === i; });
  if (destinatarios.length === 0) return { ok: true, enviados: 0 };

  const assunto = String(dados.assunto || "").slice(0, 250) || "Aviso do Help Desk Matriz";
  const corpo = String(dados.corpo || "").slice(0, 20000);

  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error("Cota diária de e-mails do Google esgotada.");
  }

  MailApp.sendEmail({
    to: destinatarios.join(","),
    subject: assunto,
    body: corpo + "\n\n—\nMensagem automática do Help Desk Matriz.",
    name: NOME_REMETENTE
  });

  return { ok: true, enviados: destinatarios.length };
}

// ------------------------------------------------------------ AUTENTICAÇÃO

/**
 * Confere o token fixo e (se EXIGIR_LOGIN_FIREBASE) o idToken do Firebase.
 * Devolve { uid, email, papel, idToken } ou null (modo sem login).
 */
function autenticar_(token, idToken) {
  if (token !== TOKEN_SECRETO) throw new Error("Não autorizado.");
  if (!EXIGIR_LOGIN_FIREBASE) return null;
  if (!idToken) throw new Error("Sessão expirada. Faça login novamente no site.");

  const cache = CacheService.getScriptCache();
  const chave = "auth_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const emCache = lerJSON_(cache.get(chave));
  if (emCache) return Object.assign(emCache, { idToken: idToken });

  // 1) Valida o idToken no Firebase Authentication.
  const resp = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true
    });
  if (resp.getResponseCode() !== 200) throw new Error("Sessão inválida. Faça login novamente.");
  const conta = (JSON.parse(resp.getContentText()).users || [])[0];
  if (!conta || !conta.localId) throw new Error("Sessão inválida.");

  // 2) Confere se a pessoa tem perfil no sistema (/usuarios/{uid}).
  const perfil = firestoreGet_("usuarios/" + conta.localId, idToken);
  if (!perfil) throw new Error("Usuário sem perfil no Help Desk.");

  const usuario = {
    uid: conta.localId,
    email: (conta.email || "").toLowerCase(),
    papel: valorCampo_(perfil.fields && perfil.fields.papel)
  };
  cache.put(chave, JSON.stringify(usuario), 300); // 5 min
  return Object.assign(usuario, { idToken: idToken });
}

// ------------------------------------------------------------ FIRESTORE (REST)
// As chamadas usam o idToken do usuário, então as MESMAS regras de
// firestore.rules valem aqui — o script não tem nenhum poder extra.

function firestoreGet_(caminho, idToken) {
  const url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID +
    "/databases/(default)/documents/" + caminho;
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + idToken },
    muteHttpExceptions: true
  });
  const codigo = resp.getResponseCode();
  if (codigo === 200) return JSON.parse(resp.getContentText());
  if (codigo === 404 || codigo === 403) return null;
  throw new Error("Erro ao consultar o banco (" + codigo + ").");
}

function emailsCadastrados_(idToken) {
  const cache = CacheService.getScriptCache();
  const emCache = lerJSON_(cache.get("emailsCadastrados"));
  if (emCache) return emCache;

  const mapa = {};
  let pageToken = "";
  do {
    const url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID +
      "/databases/(default)/documents/usuarios?pageSize=300&mask.fieldPaths=email" +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + idToken },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) throw new Error("Não foi possível ler a lista de usuários.");
    const corpo = JSON.parse(resp.getContentText());
    (corpo.documents || []).forEach(function (d) {
      const email = valorCampo_(d.fields && d.fields.email);
      if (email) mapa[String(email).toLowerCase()] = true;
    });
    pageToken = corpo.nextPageToken || "";
  } while (pageToken);

  cache.put("emailsCadastrados", JSON.stringify(mapa), 600); // 10 min
  return mapa;
}

function valorCampo_(campo) {
  if (!campo) return null;
  return campo.stringValue !== undefined ? campo.stringValue : null;
}

// ------------------------------------------------------------ UTILITÁRIOS

function obterPastaLaudos_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("pastaLaudosId");
  if (id) {
    try {
      const pasta = DriveApp.getFolderById(id);
      if (!pasta.isTrashed()) return pasta;
    } catch (e) { /* pasta apagada: cria outra */ }
  }
  const existentes = DriveApp.getFoldersByName(NOME_PASTA_LAUDOS);
  const pasta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(NOME_PASTA_LAUDOS);
  props.setProperty("pastaLaudosId", pasta.getId());
  return pasta;
}

function compartilhar_(arquivo) {
  const acesso = COMPARTILHAMENTO_LAUDO === "DOMINIO"
    ? DriveApp.Access.DOMAIN_WITH_LINK
    : DriveApp.Access.ANYONE_WITH_LINK;
  try {
    arquivo.setSharing(acesso, DriveApp.Permission.VIEW);
  } catch (e) {
    // Alguns Workspaces bloqueiam compartilhamento externo: tenta o domínio.
    try { arquivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) { /* mantém privado */ }
  }
}

function limitarTaxa_(uid) {
  const cache = CacheService.getScriptCache();
  const chave = "taxaEmail_" + uid;
  const atual = Number(cache.get(chave) || 0);
  if (atual >= MAX_EMAILS_POR_HORA_POR_USUARIO) {
    throw new Error("Limite de e-mails por hora atingido.");
  }
  cache.put(chave, String(atual + 1), 3600);
}

function salvarErroLaudo_(visitaId, mensagem) {
  try {
    PropertiesService.getScriptProperties().setProperty("erroLaudo_" + visitaId,
      JSON.stringify({ mensagem: String(mensagem || "erro desconhecido").slice(0, 300), em: Date.now() }));
  } catch (e) { /* ignora */ }
}

function idValido_(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function limparNomeArquivo_(nome) {
  return String(nome).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "laudo";
}

function lerJSON_(texto) {
  if (!texto) return null;
  try { return JSON.parse(texto); } catch (e) { return null; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Rode esta função UMA vez pelo editor (Executar > autorizar) para o Google
 * pedir as permissões de Drive, Gmail e acesso externo antes de publicar.
 */
function autorizar() {
  obterPastaLaudos_();
  UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
  console.log("Cota de e-mails restante hoje: " + MailApp.getRemainingDailyQuota());
  console.log("Pasta de laudos: " + obterPastaLaudos_().getUrl());
}
