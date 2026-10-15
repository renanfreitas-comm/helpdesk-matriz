// ==========================================================================
// HELP DESK MATRIZ — ENVIO DE E-MAILS (GOOGLE APPS SCRIPT, GRATUITO)
// ==========================================================================
// Envia os e-mails automáticos do módulo de Visitas Técnicas.
// (Os laudos agora ficam no Supabase Storage — este script não mexe mais
// com o Google Drive.)
//
// COMO PUBLICAR / ATUALIZAR
//   1. https://script.google.com > abra o projeto (ou crie um novo) e cole
//      TODO este arquivo no lugar do Codigo.gs.
//   2. Preencha as configurações abaixo. TOKEN_SECRETO precisa ser IGUAL ao
//      APPS_SCRIPT_TOKEN de js/apps-script-config.js; SUPABASE_URL e
//      SUPABASE_ANON_KEY são os mesmos de js/supabase-config.js.
//   3. Rode uma vez a função "autorizar" (menu Executar) e aceite as
//      permissões do Google (Gmail e acesso externo).
//   4. Implantar > Gerenciar implantações > lápis (Editar) > Versão:
//      "Nova versão" > Implantar. Executar como: Eu | Quem pode acessar:
//      Qualquer pessoa. (Editando a implantação existente, a URL continua
//      a mesma.)
//
// SEGURANÇA
//   O token fica visível no código do site, então sozinho não protege nada.
//   Por isso o site envia também o token de acesso do usuário logado: este
//   script confere no Supabase que a pessoa está logada e tem perfil em
//   "usuarios", e só envia e-mail para endereços cadastrados lá.
// ==========================================================================

// ------------------------------------------------------------ CONFIGURAÇÃO
const TOKEN_SECRETO = "CommcenterInfra2026";

const SUPABASE_URL = "https://etcxtrtfnasdsgngnwxr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0Y3h0cnRmbmFzZHNnbmdud3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTIyMDAsImV4cCI6MjEwNjk2ODIwMH0.UJquMGB-ZE1iiI0mx6WAxcNrZVVxdFDWx_dIR1UNWYg";

const NOME_REMETENTE = "Help Desk Matriz";

// Endereço do site (vai como link nos e-mails).
const SITE_URL = "https://renanfreitas-comm.github.io/helpdesk-matriz/";

// Relatório de pendências do fim do dia: veja a seção "RELATÓRIO DE
// PENDÊNCIAS" no fim do arquivo.
const HORA_RELATORIO_PENDENCIAS = 18;        // 18h (horário de Brasília)
const RELATORIO_SO_DIAS_UTEIS = true;        // false = envia também sáb/dom

// Backup diário (opcional, recomendado): veja a seção "BACKUP" no fim do arquivo.
const NOME_PASTA_BACKUP = "Help Desk Matriz - Backups";
const DIAS_GUARDAR_BACKUP = 30;
const MAX_EMAILS_POR_HORA_POR_USUARIO = 30;

// ------------------------------------------------------------ ENTRADA HTTP

/** POST (fetch no-cors do site): acao = "enviarEmail" */
function doPost(e) {
  try {
    const dados = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (dados.token !== TOKEN_SECRETO) throw new Error("Não autorizado.");
    if (dados.acao !== "enviarEmail") throw new Error("Ação desconhecida.");

    const usuario = autenticar_(dados.accessToken);
    return json_(enviarEmail_(dados, usuario));
  } catch (err) {
    console.error(err);
    return json_({ erro: err.message });
  }
}

function doGet() {
  return json_({ ok: true, servico: "Help Desk Matriz - e-mails", versao: "2026-10" });
}

// ------------------------------------------------------------ AÇÃO

function enviarEmail_(dados, usuario) {
  const permitidos = usuario.emailsCadastrados;
  let destinatarios = Array.isArray(dados.destinatarios) ? dados.destinatarios : [];
  destinatarios = destinatarios
    .map(function (x) { return String(x || "").trim().toLowerCase(); })
    .filter(function (x, i, arr) { return permitidos[x] && arr.indexOf(x) === i; });

  if (destinatarios.length === 0) return { ok: true, enviados: 0 };

  limitarTaxa_(usuario.id);
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error("Cota diária de e-mails do Google esgotada.");
  }

  const assunto = String(dados.assunto || "").slice(0, 250) || "Aviso do Help Desk Matriz";
  const corpo = String(dados.corpo || "").slice(0, 20000);

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
 * Confere o token de acesso no Supabase e devolve
 * { id, email, emailsCadastrados } — só para quem tem perfil em "usuarios".
 */
function autenticar_(accessToken) {
  if (!accessToken) throw new Error("Sessão expirada. Faça login novamente no site.");

  const cabecalhos = { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + accessToken };

  // 1) Quem é o usuário (valida o token no Supabase Auth).
  const respUser = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/user",
    { headers: cabecalhos, muteHttpExceptions: true });
  if (respUser.getResponseCode() !== 200) throw new Error("Sessão inválida. Faça login novamente.");
  const user = JSON.parse(respUser.getContentText());

  // 2) Lista de usuários do sistema, lida COM o token do próprio usuário
  //    (as regras do banco valem aqui: quem não é do time não lê nada).
  const respLista = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/usuarios?select=id,email",
    { headers: cabecalhos, muteHttpExceptions: true });
  if (respLista.getResponseCode() !== 200) throw new Error("Não foi possível ler os usuários.");
  const lista = JSON.parse(respLista.getContentText());

  const emails = {};
  let temPerfil = false;
  lista.forEach(function (u) {
    if (u.email) emails[String(u.email).toLowerCase()] = true;
    if (u.id === user.id) temPerfil = true;
  });
  if (!temPerfil) throw new Error("Usuário sem perfil no Help Desk.");

  return { id: user.id, email: user.email, emailsCadastrados: emails };
}

// ------------------------------------------------------------ UTILITÁRIOS

function limitarTaxa_(uid) {
  const cache = CacheService.getScriptCache();
  const chave = "taxaEmail_" + uid;
  const atual = Number(cache.get(chave) || 0);
  if (atual >= MAX_EMAILS_POR_HORA_POR_USUARIO) throw new Error("Limite de e-mails por hora atingido.");
  cache.put(chave, String(atual + 1), 3600);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Rode UMA vez pelo editor para o Google pedir as permissões. */
function autorizar() {
  UrlFetchApp.fetch("https://www.google.com", { muteHttpExceptions: true });
  console.log("Cota de e-mails restante hoje: " + MailApp.getRemainingDailyQuota());
}

// ==========================================================================
// BACKUP DIÁRIO + "MANTER O SUPABASE ACORDADO"
// ==========================================================================
// Todo dia de madrugada, copia todas as tabelas do Supabase para um arquivo
// .json numa pasta do seu Google Drive e apaga backups com mais de 30 dias.
// Como isso acessa o banco todo dia, o plano gratuito não pausa o projeto
// por inatividade.
//
// COMO LIGAR (uma vez só):
//   1. No editor do Apps Script: ⚙️ Configurações do projeto > Propriedades
//      do script > Adicionar propriedade:
//         Propriedade: SUPABASE_SERVICE_KEY
//         Valor:       a chave service_role / secret do Supabase
//      (Fica guardada só na sua conta Google — não aparece no site nem no
//      GitHub. Nunca cole essa chave no código.)
//   2. Escolha a função "instalarBackupDiario" e clique em Executar.
//      Aceite a permissão do Google Drive. Pronto: ele já faz o primeiro
//      backup na hora e depois roda sozinho todo dia por volta das 3h.
// ==========================================================================

const TABELAS_BACKUP = [
  "usuarios", "chamados", "chamado_eventos", "tarefas", "tarefa_conclusoes", "relatorios", "maquinas",
  "maquina_historico", "itens_estoque", "visitas"
];

function instalarBackupDiario() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "backupDiario"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("backupDiario").timeBased().everyDays(1).atHour(3).create();
  backupDiario();
  console.log("Backup diário instalado. Pasta: " + pastaBackup_().getUrl());
}

function cabecalhosServico_() {
  const chave = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_KEY");
  if (!chave) throw new Error('Falta a propriedade do script "SUPABASE_SERVICE_KEY" (veja as instruções da seção BACKUP).');
  const cabecalhos = { apikey: chave };
  if (chave.indexOf("eyJ") === 0) cabecalhos.Authorization = "Bearer " + chave; // chave service_role antiga (JWT)
  return cabecalhos;
}

function backupDiario() {
  const cabecalhos = cabecalhosServico_();

  const backup = { geradoEm: new Date().toISOString(), projeto: SUPABASE_URL, tabelas: {} };
  TABELAS_BACKUP.forEach(function (tabela) {
    const linhas = [];
    for (let inicio = 0; ; inicio += 1000) {
      const url = SUPABASE_URL + "/rest/v1/" + tabela + "?select=*&order=id.asc&limit=1000&offset=" + inicio;
      const resp = UrlFetchApp.fetch(url, { headers: cabecalhos, muteHttpExceptions: true });
      if (resp.getResponseCode() === 404) break; // tabela ainda não existe
      if (resp.getResponseCode() !== 200) {
        throw new Error("Erro lendo " + tabela + " (" + resp.getResponseCode() + "): " + resp.getContentText().slice(0, 200));
      }
      const pagina = JSON.parse(resp.getContentText());
      Array.prototype.push.apply(linhas, pagina);
      if (pagina.length < 1000) break;
    }
    backup.tabelas[tabela] = linhas;
  });

  const nome = "backup-helpdesk-" + Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd") + ".json";
  const pasta = pastaBackup_();
  const existentes = pasta.getFilesByName(nome);
  while (existentes.hasNext()) existentes.next().setTrashed(true); // um arquivo por dia
  pasta.createFile(nome, JSON.stringify(backup), "application/json");

  // Limpa backups antigos.
  const limite = Date.now() - DIAS_GUARDAR_BACKUP * 24 * 3600 * 1000;
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) {
    const f = arquivos.next();
    if (f.getName().indexOf("backup-helpdesk-") === 0 && f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }

  const resumo = TABELAS_BACKUP.map(function (t) { return t + ": " + (backup.tabelas[t] || []).length; }).join(", ");
  console.log("Backup salvo (" + nome + ") — " + resumo);
}

function pastaBackup_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("pastaBackupId");
  if (id) {
    try {
      const pasta = DriveApp.getFolderById(id);
      if (!pasta.isTrashed()) return pasta;
    } catch (e) { /* pasta apagada: cria outra */ }
  }
  const achadas = DriveApp.getFoldersByName(NOME_PASTA_BACKUP);
  const pasta = achadas.hasNext() ? achadas.next() : DriveApp.createFolder(NOME_PASTA_BACKUP);
  props.setProperty("pastaBackupId", pasta.getId());
  return pasta;
}

// ==========================================================================
// RELATÓRIO DE PENDÊNCIAS DO FIM DO DIA
// ==========================================================================
// De segunda a sexta, às 18h (ajuste em HORA_RELATORIO_PENDENCIAS e
// RELATORIO_SO_DIAS_UTEIS no topo):
//   - cada técnico com pendências recebe um e-mail só com as dele
//     (tarefas do dia não concluídas + chamados em aberto);
//   - os admins recebem um resumo com as pendências de todo o time.
//
// COMO LIGAR (uma vez só) — usa a mesma SUPABASE_SERVICE_KEY do backup:
//   1. Confira em ⚙️ Configurações do projeto que o fuso horário é
//      "(GMT-03:00) Horário de Brasília" (America/Sao_Paulo).
//   2. Para ver como fica, execute "testarRelatorioPendencias": manda o
//      relatório de hoje SÓ para você, sem incomodar o time.
//   3. Execute "instalarRelatorioPendencias". Pronto: roda sozinho todo dia.
// ==========================================================================

function instalarRelatorioPendencias() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "relatorioPendencias"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("relatorioPendencias").timeBased()
    .everyDays(1).atHour(HORA_RELATORIO_PENDENCIAS).inTimezone("America/Sao_Paulo").create();
  console.log("Relatório de pendências agendado para todo dia por volta das " + HORA_RELATORIO_PENDENCIAS + "h.");
}

/** Envia o relatório de hoje só para quem está executando (teste). */
function testarRelatorioPendencias() {
  relatorioPendencias_({ soPara: Session.getEffectiveUser().getEmail(), ignorarFimDeSemana: true });
}

/** Chamada pelo agendamento diário. */
function relatorioPendencias() {
  relatorioPendencias_({});
}

function relatorioPendencias_(opcoes) {
  const fuso = "America/Sao_Paulo";
  const agora = new Date();
  const diaSemana = Number(Utilities.formatDate(agora, fuso, "u")); // 1 = seg ... 7 = dom
  if (RELATORIO_SO_DIAS_UTEIS && diaSemana >= 6 && !opcoes.ignorarFimDeSemana) {
    console.log("Fim de semana: relatório não enviado.");
    return;
  }
  const dataISO = Utilities.formatDate(agora, fuso, "yyyy-MM-dd");
  const dataBR = Utilities.formatDate(agora, fuso, "dd/MM/yyyy");

  // Pendências calculadas no banco (função relatorio_pendencias).
  const resp = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/rpc/relatorio_pendencias", {
    method: "post",
    contentType: "application/json",
    headers: cabecalhosServico_(),
    payload: JSON.stringify({ p_data: dataISO }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error("Erro ao buscar pendências (" + resp.getResponseCode() + "): " + resp.getContentText().slice(0, 300) +
      " — o supabase/schema.sql atualizado já foi rodado no SQL Editor?");
  }
  const pessoas = JSON.parse(resp.getContentText());

  const comPendencia = pessoas.filter(function (p) {
    return p.tarefas_pendentes.length > 0 || p.chamados_abertos.length > 0;
  });
  const admins = pessoas.filter(function (p) { return p.papel === "admin" && p.email; });

  let enviados = 0;
  const enviar = function (para, assunto, texto, html) {
    const destino = opcoes.soPara || para;
    if (!destino) return;
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error("Cota diária de e-mails do Google esgotada.");
    MailApp.sendEmail({
      to: destino,
      subject: (opcoes.soPara ? "[TESTE] " : "") + assunto,
      body: texto,
      htmlBody: html,
      name: NOME_REMETENTE
    });
    enviados++;
  };

  // 1) Um e-mail para cada técnico com pendências (no teste, só o primeiro).
  const individuais = opcoes.soPara ? comPendencia.slice(0, 1) : comPendencia;
  individuais.forEach(function (p) {
    if (!p.email) return;
    const corpo = blocoPessoa_(p, false);
    enviar(p.email,
      "Suas pendências de hoje (" + dataBR + ") — Help Desk Matriz",
      "Olá, " + primeiroNome_(p.nome) + ".\n\nAinda está pendente para hoje:\n\n" + corpo.texto +
        "\nAbra o site para concluir: " + SITE_URL + "tarefas.html\n",
      '<p>Olá, ' + esc_(primeiroNome_(p.nome)) + '.</p><p>Ainda está pendente para hoje:</p>' + corpo.html +
        '<p><a href="' + SITE_URL + 'tarefas.html">Abrir as tarefas no Help Desk</a></p>');
  });

  // 2) Resumo de todo o time para os admins.
  const totalTarefas = pessoas.reduce(function (s, p) { return s + p.tarefas_total; }, 0);
  const totalPendentes = pessoas.reduce(function (s, p) { return s + p.tarefas_pendentes.length; }, 0);
  const totalChamados = pessoas.reduce(function (s, p) { return s + p.chamados_abertos.length; }, 0);
  const cabecalho = (totalTarefas - totalPendentes) + " de " + totalTarefas + " tarefas concluídas hoje · " +
    totalChamados + " chamado(s) em aberto com responsável.";

  let texto = "Relatório de pendências — " + dataBR + "\n" + cabecalho + "\n\n";
  let html = '<h2 style="margin:0 0 4px">Pendências do time — ' + dataBR + '</h2><p style="color:#555;margin:0 0 16px">' + esc_(cabecalho) + '</p>';
  if (comPendencia.length === 0) {
    texto += "Ninguém com pendências. Tudo concluído!\n";
    html += "<p><strong>Ninguém com pendências. Tudo concluído!</strong></p>";
  } else {
    comPendencia.forEach(function (p) {
      const b = blocoPessoa_(p, true);
      texto += "== " + p.nome + " ==\n" + b.texto + "\n";
      html += '<h3 style="margin:18px 0 4px">' + esc_(p.nome) + '</h3>' + b.html;
    });
  }
  const semPendencia = pessoas.filter(function (p) { return p.tarefas_total > 0 && comPendencia.indexOf(p) === -1; });
  if (semPendencia.length) {
    const nomes = semPendencia.map(function (p) { return p.nome; }).join(", ");
    texto += "Concluíram tudo: " + nomes + "\n";
    html += '<p style="color:#15803d">Concluíram tudo: ' + esc_(nomes) + '</p>';
  }
  texto += "\n" + SITE_URL + "tarefas.html\n";
  html += '<p><a href="' + SITE_URL + 'tarefas.html">Abrir as tarefas no Help Desk</a></p>';

  const emailsAdmins = admins.map(function (p) { return p.email; }).join(",");
  enviar(emailsAdmins, "Pendências do time — " + dataBR + " — Help Desk Matriz", texto, html);

  console.log("Relatório de pendências enviado: " + enviados + " e-mail(s); " + comPendencia.length + " pessoa(s) com pendências.");
}

function blocoPessoa_(p, mostrarProgresso) {
  const PRIORIDADE = { alta: "Alta", media: "Média", baixa: "Baixa" };
  const STATUS = { aberto: "Aberto", andamento: "Em andamento" };
  let texto = "";
  let html = "";
  if (mostrarProgresso && p.tarefas_total > 0) {
    const feitas = p.tarefas_total - p.tarefas_pendentes.length;
    texto += "Tarefas: " + feitas + "/" + p.tarefas_total + " concluídas\n";
    html += '<p style="margin:0 0 4px;color:#555">Tarefas: ' + feitas + '/' + p.tarefas_total + ' concluídas</p>';
  }
  if (p.tarefas_pendentes.length) {
    texto += "Tarefas pendentes:\n";
    html += "<p style=\"margin:6px 0 2px\"><strong>Tarefas pendentes</strong></p><ul style=\"margin:0\">";
    p.tarefas_pendentes.forEach(function (t) {
      texto += "  [ ] " + t.titulo + "\n";
      html += "<li>" + esc_(t.titulo) + (t.descricao ? ' <span style="color:#777">— ' + esc_(t.descricao) + "</span>" : "") + "</li>";
    });
    html += "</ul>";
  }
  if (p.chamados_abertos.length) {
    texto += "Chamados em aberto:\n";
    html += "<p style=\"margin:6px 0 2px\"><strong>Chamados em aberto</strong></p><ul style=\"margin:0\">";
    p.chamados_abertos.forEach(function (c) {
      const linha = (c.numero || "(sem nº)") + " · " + (c.area || "") + " · " + (PRIORIDADE[c.prioridade] || c.prioridade) +
        " · " + (STATUS[c.status] || c.status);
      texto += "  - " + linha + "\n";
      html += "<li>" + esc_(linha) + (c.atividade ? ' <span style="color:#777">— ' + esc_(c.atividade) + "</span>" : "") + "</li>";
    });
    html += "</ul>";
  }
  return { texto: texto, html: html };
}

function primeiroNome_(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

function esc_(t) {
  return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
