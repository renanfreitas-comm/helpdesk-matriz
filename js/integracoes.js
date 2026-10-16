// ==========================================================================
// TELA INTEGRAÇÕES — QUALITOR (só admin)
// ==========================================================================
// Mostra a situação da integração, salva a configuração (qualitor_config),
// chama a Edge Function "qualitor" (testar, sincronizar, explorar campos) e
// lista a fila de envios com os erros e o botão Reenviar.
// O login e a senha do Qualitor NÃO ficam aqui: só nos Secrets da função.
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { supabase, observar, buscarTodos, listarUsuarios } from "./db.js";
import { SUPABASE_URL } from "./supabase-config.js";

const $ = (id) => document.getElementById(id);
let cfg = null;
let fila = [];
let chamadosDaFila = {};
let logs = [];
let tecnicos = [];
let codigos = {};
const CODIGOS = [
  ["cdcliente", "Cliente"], ["cdcontato", "Contato (solicitante padrão)"], ["cdtipochamado", "Tipo de chamado"],
  ["cdcategoria", "Categoria"], ["cdequipe", "Equipe Matriz (fila da TI)"]
];
const TIPOS = { abrir: "Abrir no Qualitor", acompanhar: "Acompanhamento", encerrar: "Encerrar", atribuir: "Atribuir responsável", iniciar: "Iniciar atendimento", prioridade: "Mudar prioridade", reabrir: "Reabrir" };
const SITUACOES = { pendente: "Na fila", processando: "Enviando", ok: "Enviado", erro: "Falhou" };

protegerPagina((user, perfil) => {
  montarNav(perfil, user);
  observar("qualitor_config", (q) => q.eq("id", 1), (linhas) => {
    const primeira = !cfg;
    cfg = linhas[0] || null;
    if (!cfg) { $("integ-titulo").textContent = "Rode o supabase/schema.sql atualizado para criar a integração."; return; }
    desenharStatus();
    if (primeira) preencherForm();
    desenharSeguranca();
  }, (err) => { $("integ-titulo").textContent = "Não foi possível carregar: " + err.message; });
  observar("qualitor_fila", (q) => q.order("criado_em", { ascending: false }).limit(50), async (linhas) => {
    fila = linhas;
    const ids = [...new Set(linhas.map((l) => l.chamadoId))].filter((id) => !chamadosDaFila[id]);
    if (ids.length) {
      const cs = await buscarTodos("chamados", (q) => q.in("id", ids), "id,numero,qualitor_numero").catch(() => []);
      cs.forEach((c) => (chamadosDaFila[c.id] = c));
    }
    desenharFila();
    desenharStatus();
  }, () => {});
  observar("qualitor_config_log", (q) => q.order("quando", { ascending: false }).limit(20), (linhas) => {
    logs = linhas; desenharLog();
  }, () => { $("tabela-log").innerHTML = `<tr><td colspan="3" class="vazio">Rode o supabase/schema.sql atualizado.</td></tr>`; });
  carregarTecnicos();
  setInterval(desenharStatus, 30000);
}, { apenasAdmin: true });

// -------------------- Situação --------------------
function desenharStatus() {
  if (!cfg) return;
  const pendentes = fila.filter((f) => f.status === "pendente" || f.status === "processando").length;
  const erros = fila.filter((f) => f.status === "erro").length;
  const minutos = cfg.ultimaSinc ? Math.round((Date.now() - new Date(cfg.ultimaSinc)) / 60000) : null;
  let estado = "desligado", titulo = "Integração desligada", detalhe = "Configure abaixo e ligue quando o teste de conexão passar.";
  if (!temEscopo(cfg)) { estado = cfg.ativo ? "erro" : "desligado"; titulo = cfg.ativo ? "Ligada, mas sem escopo" : titulo; detalhe = "Defina a equipe permitida em Escopo: sem ela, o site não lê nenhum chamado do Qualitor."; }
  else if (cfg.ativo) {
    if (cfg.ultimoErro) { estado = "erro"; titulo = "Ligada, com erro na última sincronização"; detalhe = cfg.ultimoErro; }
    else if (minutos === null) { estado = "aviso"; titulo = "Ligada, aguardando a primeira sincronização"; detalhe = "Clique em Sincronizar agora ou espere até 5 minutos."; }
    else if (minutos > 15) { estado = "aviso"; titulo = `Ligada, mas sem sincronizar há ${minutos} min`; detalhe = "Confira o endereço da Edge Function e se o agendamento (pg_cron) está ativo."; }
    else { estado = "ok"; titulo = cfg.modoValidacao !== false ? "Funcionando em modo validação (só leitura)" : "Funcionando"; detalhe = `Última sincronização há ${minutos} min.`; }
  }
  $("integ-luz").className = "integ-luz " + estado;
  $("integ-titulo").textContent = titulo;
  $("integ-detalhe").textContent = detalhe;
  $("integ-ativo").checked = cfg.ativo;
  $("integ-numeros").innerHTML = `
    <span><strong>${pendentes}</strong> na fila</span>
    <span class="${erros ? "tem-erro" : ""}"><strong>${erros}</strong> com falha</span>
    <span><strong>${fila.filter((f) => f.status === "ok").length}</strong> enviados (últimos 50)</span>`;
}

$("integ-ativo").addEventListener("change", async (e) => {
  if (e.target.checked && !cfg.funcaoUrl) {
    alert("Preencha o endereço da Edge Function (botão \"Usar o padrão\") e salve antes de ligar.");
    e.target.checked = false; return;
  }
  if (e.target.checked && !temEscopo(cfg)) {
    alert("Defina a equipe permitida em \"Escopo\" (ou o código da equipe) e salve antes de ligar.");
    e.target.checked = false; return;
  }
  if (e.target.checked && !confirm("Ligar a integração?\n\nA partir de agora, todo chamado aberto no site (inclusive portal e manutenção) é aberto também no Qualitor.")) { e.target.checked = false; return; }
  await salvarCampos({ ativo: e.target.checked });
});

async function chamarFuncao(corpo, saida) {
  const el = $(saida);
  el.hidden = false;
  el.textContent = "Aguarde...";
  try {
    const { data, error } = await supabase.functions.invoke("qualitor", { body: corpo });
    if (error) throw error;
    el.textContent = formatar(data);
    el.classList.toggle("erro", Boolean(data && (data.erro || data.ok === false)));
    return data;
  } catch (err) {
    el.classList.add("erro");
    el.textContent = "Não foi possível chamar a função \"qualitor\": " + (err.message || err) + "\n\nConfira se ela foi publicada no Supabase com o nome qualitor.";
    return null;
  }
}
function formatar(d) {
  if (!d) return "";
  if (d.erro) return "❌ " + d.erro;
  if (d.mensagem) return "✅ " + d.mensagem + (d.versao ? "\nVersão: " + d.versao : "");
  if (d.importacao || d.fila) {
    const l = [];
    if (d.fila && d.fila.validacao) l.push(`Modo validação: nada enviado ao Qualitor${d.fila.aguardando ? ` (${d.fila.aguardando} aguardando liberação)` : ""}`);
    else if (d.fila) l.push(`Fila: ${d.fila.enviados} enviado(s), ${d.fila.erros} erro(s)${d.fila.aguardando ? `, ${d.fila.aguardando} aguardando` : ""}`);
    if (d.ligados) l.push(`Chamados ligados: ${d.ligados.consultados} consultado(s), ${d.ligados.atualizados} atualizado(s)`);
    if (d.importacao) l.push(`Fila da equipe no Qualitor: ${d.importacao.encontrados} encontrado(s), ${d.importacao.importados} novo(s) trazido(s)${d.importacao.foraDoEscopo ? `, ${d.importacao.foraDoEscopo} de outras equipes ignorado(s)` : ""}`);
    return "✅ " + l.join("\n");
  }
  return JSON.stringify(d, null, 2);
}

$("btn-testar").addEventListener("click", () => chamarFuncao({ acao: "testar" }, "integ-saida"));
$("btn-sincronizar").addEventListener("click", async () => {
  const b = $("btn-sincronizar"); b.disabled = true;
  await chamarFuncao({ acao: "sincronizar" }, "integ-saida");
  b.disabled = false;
});

// -------------------- Configuração --------------------
$("cfg-codigos").innerHTML = CODIGOS.map(([k, r]) => `<div class="campo"><label for="cod-${k}">${r} <code>{{${k}}}</code></label><input type="text" id="cod-${k}" data-codigo="${k}" /></div>`).join("");

function preencherForm() {
  $("cfg-url-ws").value = cfg.urlWs || "";
  $("cfg-url-chamado").value = cfg.urlChamado || "";
  $("cfg-funcao-url").value = cfg.funcaoUrl || "";
  document.querySelectorAll("[data-codigo]").forEach((i) => (i.value = (cfg.codigos || {})[i.dataset.codigo] || ""));
  $("cfg-escopo-equipes").value = ((cfg.escopo || {}).equipes || []).join(", ");
  $("cfg-escopo-locais").value = ((cfg.escopo || {}).locais || []).join(", ");
  $("cfg-importar").checked = cfg.importar;
  $("cfg-anotacoes").checked = cfg.enviarAnotacoes;
  $("cfg-encerrar").checked = cfg.encerrarAoResolver;
  $("cfg-portal-triagem").checked = cfg.portalTriagem !== false;
  $("cfg-acoes").checked = cfg.enviarAcoes !== false;
  $("cfg-xml-atribuir").value = cfg.xmlAtribuir || "";
  $("cfg-xml-iniciar").value = cfg.xmlIniciar || "";
  $("cfg-xml-prioridade").value = cfg.xmlPrioridade || "";
  $("cfg-xml-reabrir").value = cfg.xmlReabrir || "";
  $("cfg-xml-abertura").value = cfg.xmlAbertura || "";
  $("cfg-xml-acomp").value = cfg.xmlAcompanhamento || "";
  $("cfg-xml-encerrar").value = cfg.xmlEncerramento || "";
  $("cfg-xml-consulta").value = cfg.xmlConsulta || "";
  $("cfg-xml-busca").value = cfg.xmlBusca || "";
  $("cfg-mapa-prioridade").value = JSON.stringify(cfg.mapaPrioridade || {}, null, 1);
  $("cfg-mapa-situacao").value = JSON.stringify(cfg.mapaSituacao || {}, null, 1);
  if (!cfg.funcaoUrl) $("integ-passos").open = true;
}

$("btn-funcao-padrao").addEventListener("click", () => {
  $("cfg-funcao-url").value = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/qualitor";
});

$("form-integ").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("cfg-erro").textContent = "";
  let mapaPrioridade, mapaSituacao;
  try { mapaPrioridade = JSON.parse($("cfg-mapa-prioridade").value || "{}"); mapaSituacao = JSON.parse($("cfg-mapa-situacao").value || "{}"); }
  catch (err) { $("cfg-erro").textContent = "Os mapas precisam ser JSON válido: " + err.message; return; }
  const codigos = {};
  document.querySelectorAll("[data-codigo]").forEach((i) => (codigos[i.dataset.codigo] = i.value.trim()));
  for (const id of ["cfg-xml-abertura", "cfg-xml-acomp", "cfg-xml-encerrar", "cfg-xml-consulta", "cfg-xml-busca", "cfg-xml-atribuir", "cfg-xml-iniciar", "cfg-xml-prioridade", "cfg-xml-reabrir"]) {
    if (!/<wsqualitor[\s>][\s\S]*<\/wsqualitor>|<wsqualitor\/>/.test($(id).value)) { $("cfg-erro").textContent = "Os modelos precisam ter a raiz <wsqualitor>...</wsqualitor>."; return; }
  }
  await salvarCampos({
    url_ws: $("cfg-url-ws").value.trim(), url_chamado: $("cfg-url-chamado").value.trim(), funcao_url: $("cfg-funcao-url").value.trim(),
    codigos, escopo: { equipes: separar($("cfg-escopo-equipes").value), locais: separar($("cfg-escopo-locais").value) },
    importar: $("cfg-importar").checked, enviar_anotacoes: $("cfg-anotacoes").checked, encerrar_ao_resolver: $("cfg-encerrar").checked,
    portal_triagem: $("cfg-portal-triagem").checked, enviar_acoes: $("cfg-acoes").checked,
    xml_atribuir: $("cfg-xml-atribuir").value, xml_iniciar: $("cfg-xml-iniciar").value,
    xml_prioridade: $("cfg-xml-prioridade").value, xml_reabrir: $("cfg-xml-reabrir").value,
    xml_abertura: $("cfg-xml-abertura").value, xml_acompanhamento: $("cfg-xml-acomp").value, xml_encerramento: $("cfg-xml-encerrar").value,
    xml_consulta: $("cfg-xml-consulta").value, xml_busca: $("cfg-xml-busca").value,
    mapa_prioridade: mapaPrioridade, mapa_situacao: mapaSituacao, atualizado_em: new Date().toISOString()
  }, "Configuração salva.");
});

const separar = (t) => String(t || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const temEscopo = (c) => Boolean(((c.escopo || {}).equipes || []).length || (c.codigos || {}).cdequipe);

async function salvarCampos(campos, aviso) {
  const { data, error } = await supabase.from("qualitor_config").update(campos).eq("id", 1).select();
  if (error || !data || !data.length) {
    const msg = "Não foi possível salvar: " + (error ? error.message : "sem permissão");
    if (aviso) $("cfg-erro").textContent = msg; else alert(msg);
    if (cfg) { $("integ-ativo").checked = cfg.ativo; }
    return false;
  }
  window.dispatchEvent(new CustomEvent("db-alterado", { detail: "qualitor_config" }));
  if (aviso) { $("cfg-erro").textContent = ""; $("btn-salvar-cfg").textContent = "Salvo ✓"; setTimeout(() => ($("btn-salvar-cfg").textContent = "Salvar configuração"), 1800); }
  return true;
}

// -------------------- Segurança --------------------
// O banco recusa configurações inseguras; aqui mostramos o porquê, antes.
function verificacoes(c) {
  let host = "", https = false;
  try { const u = new URL(c.urlWs); host = u.hostname; https = u.protocol === "https:"; } catch (e) { /* inválido */ }
  const equipes = ((c.escopo || {}).equipes || []);
  const funcaoOk = !c.funcaoUrl || /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/qualitor$/.test(c.funcaoUrl);
  return [
    { ok: https, txt: https ? `Senha trafega só por https (${host})` : "O webservice precisa usar https://", grave: true },
    { ok: equipes.length > 0 || Boolean((c.codigos || {}).cdequipe), txt: equipes.length ? `Escopo travado em: ${equipes.join(", ")}` : (c.codigos || {}).cdequipe ? `Escopo pelo código da equipe: ${c.codigos.cdequipe}` : "Sem escopo: defina a equipe permitida", grave: true },
    { ok: funcaoOk && Boolean(c.funcaoUrl), txt: c.funcaoUrl ? (funcaoOk ? "Edge Function é a do seu projeto Supabase" : "Endereço da Edge Function não é do Supabase") : "Endereço da Edge Function não preenchido", grave: !funcaoOk },
    { ok: c.modoValidacao === false ? Boolean(c.contaServicoConfirmadaPor) : true, txt: c.modoValidacao === false ? `Escrita liberada por ${c.contaServicoConfirmadaPor || "?"} (conta de serviço confirmada)` : "Modo validação: o site ainda não escreve no Qualitor" },
    { ok: c.portalTriagem !== false, txt: c.portalTriagem !== false ? "Portal sem login passa por triagem antes de ir ao Qualitor" : "Portal sem login envia direto ao Qualitor (risco de chamados falsos)" },
    { ok: true, txt: "Segredo interno e senha do Qualitor fora do alcance do site (nem admin lê)" }
  ];
}
function desenharSeguranca() {
  if (!cfg) return;
  const v = verificacoes(cfg);
  const graves = v.filter((x) => !x.ok && x.grave).length, alertas = v.filter((x) => !x.ok).length;
  $("seg-resumo").textContent = graves ? `${graves} bloqueio(s)` : alertas ? `${alertas} alerta(s)` : "Tudo certo";
  $("seg-resumo").className = "badge " + (graves ? "badge-prioridade-alta" : alertas ? "badge-prioridade-media" : "badge-prioridade-baixa");
  $("seg-lista").innerHTML = v.map((x) => `<li class="${x.ok ? "ok" : x.grave ? "grave" : "alerta"}"><span aria-hidden="true">${x.ok ? "✓" : x.grave ? "✕" : "!"}</span> ${esc(x.txt)}</li>`).join("");
  const validacao = cfg.modoValidacao !== false;
  $("modo-titulo").textContent = validacao ? "Modo validação: só leitura" : "Escrita liberada no Qualitor";
  $("modo-detalhe").textContent = validacao
    ? "O site lê e mostra os chamados da equipe, mas não abre, não anota e não encerra nada no Qualitor."
    : `Liberada por ${cfg.contaServicoConfirmadaPor || "—"} em ${cfg.contaServicoConfirmadaEm ? new Date(cfg.contaServicoConfirmadaEm).toLocaleString("pt-BR") : "—"}.`;
  $("integ-modo").classList.toggle("liberado", !validacao);
  $("modo-acao").innerHTML = validacao
    ? `<label class="alternar integ-confirma"><input type="checkbox" id="chk-conta-servico"> <span>Confirmo que os Secrets usam um <strong>usuário de integração dedicado</strong> (não uma conta pessoal), com acesso só à equipe da TI</span></label>
       <button type="button" class="botao-primario" id="btn-liberar" disabled>Liberar escrita</button>`
    : `<button type="button" class="botao-secundario" id="btn-voltar-validacao">Voltar para só leitura</button>`;
  if (validacao) {
    $("chk-conta-servico").addEventListener("change", (e) => ($("btn-liberar").disabled = !e.target.checked));
    $("btn-liberar").addEventListener("click", async () => {
      if (!confirm("Liberar a escrita?\n\nA partir de agora o site abre, anota e encerra chamados no Qualitor com o usuário dos Secrets. Sua confirmação fica registrada e os outros admins são avisados.")) return;
      await salvarCampos({ modo_validacao: false });
    });
  } else {
    $("btn-voltar-validacao").addEventListener("click", () => salvarCampos({ modo_validacao: true }));
  }
}
$("btn-trocar-segredo").addEventListener("click", async () => {
  if (!confirm("Gerar um novo segredo interno?\n\nUse se suspeitar de vazamento. O banco passa a usar o novo na hora; nada mais precisa ser mudado.")) return;
  const { error } = await supabase.rpc("qualitor_trocar_segredo");
  alert(error ? "Não foi possível: " + error.message : "Segredo trocado.");
  window.dispatchEvent(new CustomEvent("db-alterado", { detail: "qualitor_config_log" }));
});

function desenharLog() {
  const tb = $("tabela-log");
  if (!logs.length) { tb.innerHTML = `<tr><td colspan="3" class="vazio">Nenhuma alteração ainda.</td></tr>`; return; }
  tb.innerHTML = logs.map((l) => `<tr>
    <td>${new Date(l.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
    <td>${esc(l.usuarioNome || "sistema")}</td>
    <td><small>${esc(l.resumo || (l.campos || []).join(", "))}</small></td>
  </tr>`).join("");
}

// -------------------- Técnicos no Qualitor --------------------
async function carregarTecnicos() {
  try {
    tecnicos = (await listarUsuarios()).filter((u) => u.papel === "tecnico" || u.papel === "admin");
    const { data, error } = await supabase.from("qualitor_usuarios").select("usuario_id, cdusuario");
    if (error) throw error;
    codigos = Object.fromEntries((data || []).map((m) => [m.usuario_id, m.cdusuario]));
    desenharTecnicos();
  } catch (err) {
    $("tabela-tecnicos").innerHTML = `<tr><td colspan="3" class="vazio">Não foi possível carregar: ${esc(err.message)}</td></tr>`;
  }
}
function desenharTecnicos() {
  const tb = $("tabela-tecnicos");
  if (!tecnicos.length) { tb.innerHTML = `<tr><td colspan="3" class="vazio">Nenhum técnico cadastrado.</td></tr>`; return; }
  tb.innerHTML = tecnicos.map((u) => `<tr>
    <td>${esc(u.nome)}</td>
    <td><input type="text" class="js-cd-tecnico" data-id="${esc(u.id)}" value="${esc(codigos[u.id] || "")}" maxlength="40" placeholder="Ex.: 1234" style="max-width:160px" /></td>
    <td><small class="texto-suave js-cd-status" data-id="${esc(u.id)}">${codigos[u.id] ? "✓ ligado" : "sem código"}</small></td>
  </tr>`).join("");
  tb.querySelectorAll(".js-cd-tecnico").forEach((inp) => inp.addEventListener("change", async () => {
    const id = inp.dataset.id, cd = inp.value.trim();
    const st = tb.querySelector(`.js-cd-status[data-id="${id}"]`);
    if (cd && !/^[0-9A-Za-z_.-]{1,40}$/.test(cd)) { st.textContent = "use só letras, números, . _ -"; return; }
    const { error } = cd
      ? await supabase.from("qualitor_usuarios").upsert({ usuario_id: id, cdusuario: cd, atualizado_em: new Date().toISOString() })
      : await supabase.from("qualitor_usuarios").delete().eq("usuario_id", id);
    if (error) { st.textContent = "erro: " + error.message; return; }
    if (cd) codigos[id] = cd; else delete codigos[id];
    st.textContent = cd ? "✓ salvo" : "sem código";
  }));
}

// -------------------- Explorar --------------------
$("btn-explorar").addEventListener("click", async () => {
  const metodo = $("exp-metodo").value;
  const n = $("exp-cdchamado").value.trim();
  const cdchamado = n.replace(/[^0-9A-Za-z_-]/g, "");
  const el = $("exp-saida");
  el.hidden = false; el.textContent = "Consultando...";
  const { data, error } = await supabase.functions.invoke("qualitor", { body: { acao: "consultar", metodo, cdchamado } }).catch((e) => ({ error: e }));
  if (error || !data) { el.textContent = "Erro: " + ((error && error.message) || "sem resposta"); return; }
  if (data.erro) { el.textContent = "❌ " + data.erro; return; }
  el.textContent = (data.ok ? "✅ " : "⚠️ ") + (data.msg || "") + "\n\nCampos encontrados:\n" +
    (data.ocultos ? `(${data.ocultos} chamado(s) de outras equipes ocultado(s) pelo escopo)\n` : "") +
    (data.itens || []).slice(0, 5).map((i, n) => `— item ${n + 1}\n` + Object.entries(i).map(([k, v]) => `  ${k}: ${v}`).join("\n")).join("\n") +
    "\n\nResposta completa:\n" + data.bruto;
});

// -------------------- Fila --------------------
function desenharFila() {
  const tb = $("tabela-fila");
  if (!fila.length) { tb.innerHTML = `<tr><td colspan="5" class="vazio">Nada enviado ainda.</td></tr>`; return; }
  tb.innerHTML = fila.map((f) => {
    const c = chamadosDaFila[f.chamadoId];
    return `<tr>
      <td>${new Date(f.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
      <td><a href="chamados.html#c=${encodeURIComponent(f.chamadoId)}">${esc(c ? c.numero : "—")}</a>${c && c.qualitorNumero ? ` <span class="texto-suave">→ Qualitor ${esc(c.qualitorNumero)}</span>` : ""}</td>
      <td>${TIPOS[f.tipo] || f.tipo}</td>
      <td><span class="badge fila-${f.status}">${SITUACOES[f.status] || f.status}</span>${f.erro ? `<br><small class="texto-suave">${esc(f.erro)}${f.tentativas ? ` (tentativa ${f.tentativas})` : ""}</small>` : ""}</td>
      <td>${f.status === "erro" ? `<button type="button" class="botao-secundario botao-pequeno js-reenviar" data-id="${esc(f.chamadoId)}">Reenviar</button>` : ""}</td>
    </tr>`;
  }).join("");
  tb.querySelectorAll(".js-reenviar").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    const { error } = await supabase.rpc("qualitor_reenviar", { p_chamado: b.dataset.id });
    if (error) { alert("Não foi possível: " + error.message); b.disabled = false; return; }
    window.dispatchEvent(new CustomEvent("db-alterado", { detail: "qualitor_fila" }));
  }));
}

function esc(t) { const d = document.createElement("div"); d.textContent = t ?? ""; return d.innerHTML.replace(/"/g, "&quot;"); }
