// deno-lint-ignore-file no-explicit-any
// ==========================================================================
// EDGE FUNCTION "qualitor" — integração Help Desk Matriz ⇄ Qualitor
// ==========================================================================
// Conversa com o webservice SOAP do Qualitor (WSTicket) pelo servidor do
// Supabase. O login/senha do Qualitor ficam só nos Secrets da função:
//   QUALITOR_LOGIN, QUALITOR_SENHA, QUALITOR_EMPRESA
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já fornece.)
//
// Ações (campo "acao" no corpo JSON):
//   processar    envia a fila do site → Qualitor (abrir, acompanhar, encerrar,
//                atribuir, iniciar, prioridade, reabrir)
//   sincronizar  processar + atualiza situação dos chamados ligados + importa
//                os chamados novos da fila da equipe no Qualitor
//   testar       login + versão do Qualitor (botão "Testar conexão")
//   consultar    chama um método de LEITURA e devolve a resposta (para
//                descobrir os campos/códigos do seu Qualitor)
//
// ESCOPO: mesmo que o usuário do Qualitor enxergue mais coisas, a função só
// deixa passar chamados da(s) equipe(s) configuradas em qualitor_config.escopo
// (ex.: o time Matriz da TI). O que estiver fora é descartado aqui dentro e
// nunca chega ao banco nem à tela. Sem equipe configurada, nada é lido.
//
// Quem pode chamar: o banco (pg_net/pg_cron, com o "segredo" da tabela
// qualitor_segredo, que ninguém lê pelo site) ou um admin logado no site.
//
// Travas de segurança:
//  - a senha do Qualitor só é enviada para os servidores do Secret
//    QUALITOR_HOSTS (padrão: portal.vantix.com.br e qualitor.vantix.com.br), sempre por https;
//  - em "modo validação" a função só lê: nada é aberto, anotado ou encerrado;
//  - a resposta do Qualitor precisa ser do chamado pedido (cdchamado igual).
// Publicar: Edge Functions > Deploy a new function > Via Editor > nome
// "qualitor" > cole este arquivo > Deploy. DESLIGUE "Verify JWT" (o banco
// chama sem login; a própria função confere o segredo ou o admin).
// ==========================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
type Obj = Record<string, any>;
type Banco = ReturnType<typeof criarBanco>;
type Cliente = ReturnType<typeof criarCliente>;
type Fetch = typeof fetch;
/** Comparação em tempo constante (não revela o segredo por tempo de resposta). */
function iguais(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** O webservice configurado é um servidor autorizado (https + host na lista)? */
export function servidorPermitido(urlWs: string, hosts: string | undefined): string | null {
  const lista = String(hosts || "portal.vantix.com.br,qualitor.vantix.com.br").split(/[,\s]+/).map((h) => h.trim().toLowerCase()).filter(Boolean);
  let u: URL;
  try { u = new URL(urlWs); } catch { return "Endereço do webservice inválido."; }
  if (u.protocol !== "https:") return "O webservice precisa usar https://.";
  if (!lista.includes(u.hostname.toLowerCase())) {
    return `Servidor ${u.hostname} não autorizado. A senha do Qualitor só é enviada para: ${lista.join(", ")} (Secret QUALITOR_HOSTS).`;
  }
  return null;
}
/** A resposta é mesmo do chamado pedido? */
const mesmoChamado = (item: Obj | undefined, numero: string) =>
  Boolean(item) && String(item!.cdchamado ?? "").trim() === String(numero).trim();
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

const METODOS_LEITURA = ["getVersion", "getTicketData", "getTicketsData", "getTicketHistoryData", "getTeams", "getSeverities"];
// Métodos que só devolvem cadastros (sem dados de chamados).
const METODOS_CADASTRO = ["getVersion", "getTeams", "getSeverities"];
const MAX_TENTATIVAS = 5;
// Ação da fila → [método do WebService, modelo XML da configuração]
const ACOES: Record<string, [string, string]> = {
  acompanhar: ["addTicketHistory", "xml_acompanhamento"],
  encerrar: ["closeTicket", "xml_encerramento"],
  atribuir: ["transferTicketResponsible", "xml_atribuir"],
  iniciar: ["startTicket", "xml_iniciar"],
  prioridade: ["changeTicketSeverity", "xml_prioridade"],
  reabrir: ["reopenTicket", "xml_reabrir"]
};
const LOTE_FILA = 20;
const LOTE_CONSULTA = 40;

// ---------------------------------------------------------------- utilitários
export function escXml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function desescXml(v: unknown): string {
  return String(v ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
const semAcento = (t: unknown) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const cdata = (t: string) => String(t).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_: string, x: string) => escXml(x));

/** Preenche {{variavel}} no modelo, com os valores já escapados para XML. */
export function preencher(modelo: string, vars: Obj): string {
  return String(modelo).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_: string, k: string) => escXml(vars[k] ?? ""));
}

/** Lê <tag>valor</tag> simples (sem atributos importantes). */
function tag(xml: string, nome: string): string | null {
  const m = String(xml).match(new RegExp(`<(?:[a-z0-9_]+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9_]+:)?${nome}>`, "i"));
  return m ? m[1] : null;
}

/** Converte a resposta interna do Qualitor em { ok, msg, itens:[{campo:valor}] }. */
export function lerRespostaQualitor(xml: string) {
  const texto = cdata(String(xml || ""));
  const status = (tag(texto, "status") || "").trim();
  const msg = desescXml((tag(texto, "msg") || "").trim());
  const itens: Obj[] = [];
  const blocos = texto.match(/<dataitem\b[^>]*>[\s\S]*?<\/dataitem>/gi) || [];
  const fontes = blocos.length ? blocos : [tag(texto, "response_data") || ""];
  for (const b of fontes) {
    const o: Obj = {};
    for (const m of b.matchAll(/<([a-z0-9_]+)\b[^>]*>([^<]*)<\/\1>/gi)) {
      const k = m[1].toLowerCase();
      if (k === "dataitem" || k === "response_data") continue;
      if (!(k in o)) o[k] = desescXml(m[2]).trim();
    }
    if (Object.keys(o).length) itens.push(o);
  }
  return { ok: status === "1" || status.toLowerCase() === "true", status, msg, itens };
}

function primeiro(o: Obj, nomes: string[]): string {
  for (const n of nomes) if (o[n] !== undefined && o[n] !== "") return o[n];
  return "";
}
const CAMPOS = {
  numero: ["cdchamado"],
  situacao: ["nmsituacao", "dssituacao", "nmsituacaochamado", "nmstatus", "dsstatus", "nmetapa", "idsituacao"],
  responsavel: ["nmresponsavel", "nmusuarioresponsavel", "nmatendente", "nmtecnico", "nmusuario"],
  cdResponsavel: ["cdresponsavel", "cdusuarioresponsavel", "cdatendente", "cdtecnico"],
  titulo: ["nmtitulochamado", "nmtitulo", "dstitulo", "nmassunto"],
  descricao: ["dschamado", "dsdescricao", "dsproblema"],
  solicitante: ["nmcontato", "nmsolicitante", "nmusuariosolicitante"],
  setor: ["nmlocalidade", "nmdepartamento", "nmcliente", "nmunidade"],
  severidade: ["nmseveridade", "dsseveridade", "cdseveridade", "nmprioridade"],
  abertura: ["dtchamado", "dtabertura", "dtinicio"],
  equipe: ["cdequipe", "nmequipe", "nmequipeatendimento", "nmequiperesponsavel", "cdequiperesponsavel", "nmgrupo", "nmfila"],
  localSolicitante: ["nmlocalidade", "nmlocalidadecontato", "nmdepartamento", "nmdepartamentocontato", "nmunidade", "nmcliente"]
};

// ---------------------------------------------------------------- escopo
const lista = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]/)).map((x) => String(x).trim()).filter(Boolean);

/** Equipes e locais permitidos. Sem equipe em "escopo", usa o código da equipe. */
export function escopoDe(cfg: Obj) {
  const e = cfg.escopo || {};
  const equipes = lista(e.equipes);
  if (!equipes.length && cfg.codigos?.cdequipe) equipes.push(String(cfg.codigos.cdequipe).trim());
  return { equipes, locais: lista(e.locais) };
}

/** O chamado do Qualitor é da equipe permitida (e do local, se configurado)? */
export function dentroDoEscopo(item: Obj, esc: { equipes: string[]; locais: string[] }): boolean {
  if (!esc.equipes.length) return false;
  const equipes = esc.equipes.map(semAcento);
  const valoresEquipe = CAMPOS.equipe.map((c) => semAcento(item[c]).trim()).filter(Boolean);
  if (!valoresEquipe.some((v) => equipes.includes(v))) return false;
  if (esc.locais.length) {
    const locais = esc.locais.map(semAcento);
    const valoresLocal = CAMPOS.localSolicitante.map((c) => semAcento(item[c])).filter(Boolean);
    if (!valoresLocal.some((v) => locais.some((l) => v.includes(l)))) return false;
  }
  return true;
}
/** A resposta traz alguma informação de equipe? */
const temEquipe = (item: Obj) => CAMPOS.equipe.some((c) => String(item[c] ?? "").trim() !== "");
const SEM_ESCOPO = "Defina a equipe que a aplicação pode ver (Integrações > Escopo) antes de ler chamados do Qualitor.";

/** Situação do Qualitor → status do site, pelo mapa configurado. */
export function statusDoSite(situacao: string, mapa: Obj): string | null {
  const s = semAcento(situacao);
  if (!s) return null;
  for (const status of ["resolvido", "andamento", "aberto"]) {
    for (const trecho of (mapa?.[status] || [])) if (trecho && s.includes(semAcento(trecho))) return status;
  }
  return "aberto";
}

function prioridadeDoQualitor(item: Obj, mapaPrioridade: Obj): string {
  const cd = String(item.cdseveridade ?? "").trim();
  for (const [p, v] of Object.entries(mapaPrioridade || {})) if (cd && String(v) === cd) return p;
  const t = semAcento(primeiro(item, CAMPOS.severidade));
  if (/alta|crit|urgen|1\b/.test(t)) return "alta";
  if (/baixa|3\b|4\b/.test(t)) return "baixa";
  return "media";
}

// ---------------------------------------------------------------- SOAP
async function lerTexto(resp: Response): Promise<string> {
  const buf = new Uint8Array(await resp.arrayBuffer());
  const inicio = new TextDecoder("latin1").decode(buf.slice(0, 200));
  const iso = /encoding=["']iso-8859-1["']/i.test(inicio) || /charset=iso-8859-1/i.test(resp.headers.get("content-type") || "");
  return new TextDecoder(iso ? "latin1" : "utf-8").decode(buf);
}

export function criarCliente(urlWs: string, fetchImpl: Fetch = fetch) {
  async function chamar(metodo: string, params: Record<string, string>): Promise<string> {
    const corpo = Object.entries(params).map(([k, v]) => `<${k} xsi:type="xsd:string">${escXml(v)}</${k}>`).join("");
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:main" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><ns1:${metodo}>${corpo}</ns1:${metodo}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    let resp: Response;
    try {
      resp = await fetchImpl(urlWs, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"urn:main#Request"' },
        body: envelope,
        signal: AbortSignal.timeout(25000)
      });
    } catch (e) {
      const nome = e instanceof Error ? e.name : "";
      throw new Error(`Sem resposta do Qualitor (${nome === "TimeoutError" ? "demorou demais" : msgErro(e)}). Confira a URL do webservice.`);
    }
    const texto = await lerTexto(resp);
    const falha = tag(texto, "faultstring");
    if (falha) {
      const f = desescXml(falha).trim();
      if (/permission|permiss/i.test(f)) {
        throw new Error(`Qualitor (${metodo}): ${f} — o servidor chegou ao Qualitor, mas esse usuário não tem permissão de usar o WebService` +
          (metodo === "login" ? " (ou o código da empresa/IP de origem não é aceito). Peça à Vantix para liberar o acesso ao WebService para o usuário dos Secrets." : ` para "${metodo}". Peça à Vantix para liberar esse método.`));
      }
      throw new Error(`Qualitor (${metodo}): ${f}`);
    }
    if (!resp.ok) throw new Error(`Qualitor respondeu HTTP ${resp.status}.`);
    const ret = tag(texto, "return");
    if (ret === null) throw new Error("Resposta inesperada do Qualitor (sem <return>).");
    return desescXml(ret);
  }
  let token: string | null = null;
  return {
    chamar,
    async login(login: string, senha: string, empresa: string) {
      const r = (await chamar("login", { login, passwd: senha, company: empresa })).trim();
      // Login inválido costuma voltar vazio, "0" ou um XML com status de erro.
      if (!r || r === "0" || r === "-1" || /<status>\s*0\s*<\/status>|erro|invalid|inv[aá]lid/i.test(r)) {
        const lido = lerRespostaQualitor(r);
        throw new Error("Login no Qualitor recusado" + (lido.msg ? ": " + lido.msg : ". Confira usuário, senha e empresa nos Secrets da função."));
      }
      token = r;
      return token;
    },
    async metodo(nome: string, xml: string) {
      if (!token) throw new Error("Sem login no Qualitor.");
      const bruto = await chamar(nome, { auth: token, xmlValue: xml });
      return { bruto, ...lerRespostaQualitor(bruto) };
    }
  };
}

// ---------------------------------------------------------------- banco (REST)
export function criarBanco(url: string, chave: string, fetchImpl: Fetch = fetch) {
  const base = url.replace(/\/$/, "") + "/rest/v1/";
  const cab = { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  async function req(metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<any> {
    const r = await fetchImpl(base + caminho, { method: metodo, headers: { ...cab, ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await r.text();
    if (!r.ok) throw new Error(`Banco: ${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  }
  return {
    get: (c: string): Promise<any[]> => req("GET", c),
    patch: (c: string, d: Obj): Promise<any[]> => req("PATCH", c, d, { Prefer: "return=representation" }),
    post: (c: string, d: Obj): Promise<any[]> => req("POST", c, d, { Prefer: "return=representation" }),
    rpc: (f: string, d?: Obj) => req("POST", "rpc/" + f, d ?? {}),
    async usuarioDoToken(token: string): Promise<Obj | null> {
      const r = await fetchImpl(url.replace(/\/$/, "") + "/auth/v1/user", { headers: { apikey: chave, Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      return await r.json();
    }
  };
}

// ---------------------------------------------------------------- regras
function textoChamado(c: Obj): string {
  const linhas = [String(c.atividade || "").trim()];
  if (c.origem === "portal") linhas.push(`\nSolicitante: ${c.solicitante_nome || "—"} (${c.solicitante_setor || "—"})${c.solicitante_contato ? " · " + c.solicitante_contato : ""}`);
  linhas.push(`\nAberto pelo Help Desk Matriz — chamado ${c.numero}${c.criado_por_nome ? " por " + c.criado_por_nome : ""}.`);
  return linhas.join("\n");
}
function tituloChamado(c: Obj): string {
  const primeiraLinha = String(c.atividade || "").split("\n")[0].replace(/^\[[^\]]+\]\s*/, "").trim();
  return `${c.area ? c.area + " - " : ""}${primeiraLinha}`.slice(0, 100) || `Chamado ${c.numero}`;
}

export async function processarFila(db: Banco, q: Cliente, cfg: Obj, agora = () => new Date().toISOString(), rodada = 0): Promise<Obj> {
  const resumo = { enviados: 0, erros: 0, aguardando: 0, validacao: false };
  let abriu = false;
  if (cfg.modo_validacao !== false) {
    // Modo validação: só leitura. Os itens ficam na fila para depois.
    resumo.validacao = true;
    resumo.aguardando = (await db.get("qualitor_fila?status=eq.pendente&select=id")).length;
    return resumo;
  }
  // Itens presos em "processando" há mais de 10 min voltam para a fila.
  const dezMin = new Date(Date.now() - 10 * 60000).toISOString();
  await db.patch(`qualitor_fila?status=eq.processando&processado_em=lt.${encodeURIComponent(dezMin)}`, { status: "pendente" });
  // Na ordem em que aconteceram; "abrir" sempre antes do resto.
  const itens = (await db.get(`qualitor_fila?status=eq.pendente&order=id.asc&limit=${LOTE_FILA}`))
    .filter((i: Obj) => rodada === 0 || i.tipo !== "abrir") // 2ª rodada: só as ações que esperavam o número
    .sort((a: Obj, b: Obj) => Number(b.tipo === "abrir") - Number(a.tipo === "abrir"));
  let mapaUsuarios: Obj | null = null;
  for (const item of itens) {
    // "Reserva" o item: se outra execução pegou antes, pula.
    const reservado = await db.patch(`qualitor_fila?id=eq.${item.id}&status=eq.pendente`, { status: "processando", processado_em: agora() });
    if (!reservado.length) continue;
    const [c] = await db.get(`chamados?id=eq.${encodeURIComponent(item.chamado_id)}&select=*`);
    try {
      if (!c) throw new Error("Chamado não existe mais.");
      if (item.tipo === "abrir") {
        if (c.qualitor_numero) { await db.patch(`qualitor_fila?id=eq.${item.id}`, { status: "ok", erro: null }); continue; }
        const vars = {
          ...(cfg.codigos || {}),
          titulo: tituloChamado(c), descricao: textoChamado(c), numero_site: c.numero, area: c.area,
          prioridade: c.prioridade, severidade: (cfg.mapa_prioridade || {})[c.prioridade] ?? "",
          solicitante: c.solicitante_nome || c.criado_por_nome || "", contato: c.solicitante_contato || "",
          autor: item.autor_nome || ""
        };
        const r = await q.metodo("addTicketByData", preencher(cfg.xml_abertura, vars));
        const numero = r.itens.map((i: Obj) => i.cdchamado).find(Boolean) || (tag(r.bruto, "cdchamado") || "").trim();
        if (!r.ok || !numero) throw new Error(r.msg || "O Qualitor não devolveu o número do chamado.");
        await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, { qualitor_numero: numero, qualitor_sync: "ok", qualitor_erro: null, qualitor_atualizado_em: agora() });
        await db.post("chamado_eventos", { chamado_id: c.id, tipo: "edicao", texto: `Aberto no Qualitor: chamado nº ${numero}`, autor_nome: "Qualitor" });
        abriu = true;
        // Já tinha responsável/andamento no site: leva isso para lá também.
        if (cfg.enviar_acoes !== false) {
          const pend = await db.get(`qualitor_fila?chamado_id=eq.${encodeURIComponent(c.id)}&status=eq.pendente&select=tipo`);
          const tem = (t: string) => pend.some((x: Obj) => x.tipo === t);
          if (c.responsavel_uid && !tem("atribuir")) await db.post("qualitor_fila", { tipo: "atribuir", chamado_id: c.id, texto: c.responsavel_uid, autor_nome: item.autor_nome });
          if (c.status === "andamento" && !tem("iniciar")) await db.post("qualitor_fila", { tipo: "iniciar", chamado_id: c.id, autor_nome: item.autor_nome });
        }
      } else {
        if (!c.qualitor_numero) {
          // Ainda não existe no Qualitor: espera o "abrir" (ou desiste se ele falhou).
          if (c.qualitor_sync === "erro") throw new Error("O chamado não foi aberto no Qualitor.");
          await db.patch(`qualitor_fila?id=eq.${item.id}`, { status: "pendente" });
          resumo.aguardando++;
          continue;
        }
        const acao = ACOES[item.tipo];
        if (!acao) throw new Error(`Ação desconhecida: ${item.tipo}`);
        const vars: Obj = { ...(cfg.codigos || {}), cdchamado: c.qualitor_numero, autor: item.autor_nome || "",
          texto: `${item.texto}${item.autor_nome ? "\n— " + item.autor_nome + " (Help Desk Matriz)" : ""}` };
        if (item.tipo === "atribuir") {
          if (!mapaUsuarios) {
            mapaUsuarios = {};
            for (const m of await db.get("qualitor_usuarios?select=usuario_id,cdusuario")) mapaUsuarios[m.usuario_id] = m.cdusuario;
          }
          const cd = mapaUsuarios[item.texto];
          if (!cd) throw new Error("Técnico sem código do Qualitor: cadastre em Integrações > Técnicos no Qualitor e clique em Reenviar.");
          vars.cdresponsavel = cd;
        }
        if (item.tipo === "prioridade") vars.severidade = (cfg.mapa_prioridade || {})[item.texto] ?? "";
        const r = await q.metodo(acao[0], preencher(cfg[acao[1]] || "", vars));
        if (!r.ok) throw new Error(r.msg || `O Qualitor recusou (${item.tipo}).`);
        if (item.tipo === "encerrar") await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, { qualitor_atualizado_em: agora() });
      }
      await db.patch(`qualitor_fila?id=eq.${item.id}`, { status: "ok", erro: null, processado_em: agora() });
      resumo.enviados++;
    } catch (e) {
      const tentativas = (item.tentativas || 0) + 1;
      const m = msgErro(e);
      const desistiu = tentativas >= MAX_TENTATIVAS || /não existe mais|não foi aberto|sem código do Qualitor|desconhecida/.test(m);
      await db.patch(`qualitor_fila?id=eq.${item.id}`, { status: desistiu ? "erro" : "pendente", tentativas, erro: m.slice(0, 500), processado_em: agora() });
      if (c && item.tipo === "abrir") {
        await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, { qualitor_sync: desistiu ? "erro" : "pendente", qualitor_erro: m.slice(0, 500) });
      }
      resumo.erros++;
      if (/Login no Qualitor|Sem resposta do Qualitor/.test(m)) throw e; // não adianta continuar
    }
  }
  // Chamados recém-abertos liberam as ações que esperavam o número: mais uma rodada.
  if (abriu && rodada === 0) {
    const mais = await processarFila(db, q, cfg, agora, 1);
    resumo.enviados += mais.enviados; resumo.erros += mais.erros; resumo.aguardando = mais.aguardando;
  }
  return resumo;
}

/** cdusuario do Qualitor → id do técnico no site. */
async function mapaPorCodigo(db: Banco): Promise<Obj> {
  const m: Obj = {};
  try { for (const x of await db.get("qualitor_usuarios?select=usuario_id,cdusuario")) m[String(x.cdusuario)] = x.usuario_id; } catch { /* tabela opcional */ }
  return m;
}
/** Responsável do Qualitor → técnico do site: pelo código cadastrado; senão, pelo nome. */
function acharUsuario(usuarios: Obj[], porCodigo: Obj, item: Obj, nome: string): Obj | undefined {
  const cd = primeiro(item, CAMPOS.cdResponsavel);
  if (cd && porCodigo[cd]) { const u = usuarios.find((x) => x.id === porCodigo[cd]); if (u) return u; }
  return usuarios.find((u: Obj) => nome && nomeParecido(u.nome, nome));
}

function nomeParecido(a: string, b: string): boolean {
  const x = semAcento(a).trim().split(/\s+/), y = semAcento(b).trim().split(/\s+/);
  if (!x[0] || !y[0]) return false;
  return x.join(" ") === y.join(" ") || (x[0] === y[0] && x[x.length - 1] === y[y.length - 1]);
}

export async function atualizarLigados(db: Banco, q: Cliente, cfg: Obj, agora = () => new Date().toISOString()) {
  const resumo = { consultados: 0, atualizados: 0, foraDoEscopo: 0 };
  const esc = escopoDe(cfg);
  if (!esc.equipes.length) return resumo;
  const usuarios = await db.get("usuarios?select=id,nome,papel&papel=neq.painel");
  const porCodigo = await mapaPorCodigo(db);
  const ligados = await db.get(`chamados?qualitor_numero=not.is.null&status=neq.resolvido&select=*&order=qualitor_atualizado_em.asc.nullsfirst&limit=${LOTE_CONSULTA}`);
  for (const c of ligados) {
    const r = await q.metodo("getTicketData", preencher(cfg.xml_consulta, { ...(cfg.codigos || {}), cdchamado: c.qualitor_numero }));
    resumo.consultados++;
    const item = r.itens[0];
    if (!r.ok || !mesmoChamado(item, c.qualitor_numero)) { await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, { qualitor_atualizado_em: agora() }); continue; }
    if (temEquipe(item) && !dentroDoEscopo(item, esc)) {
      // Foi transferido para outra equipe no Qualitor: não copia mais nada dele.
      const aviso = "Transferido para outra equipe no Qualitor";
      if (c.qualitor_situacao !== aviso) {
        await db.post("chamado_eventos", { chamado_id: c.id, tipo: "status", texto: "Qualitor: chamado transferido para outra equipe. O site para de acompanhar os detalhes dele.", autor_nome: "Qualitor" });
      }
      await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, { qualitor_situacao: aviso, qualitor_responsavel: null, qualitor_atualizado_em: agora() });
      resumo.foraDoEscopo++;
      continue;
    }
    const situacao = primeiro(item, CAMPOS.situacao);
    const resp = primeiro(item, CAMPOS.responsavel);
    const novoStatus = statusDoSite(situacao, cfg.mapa_situacao) || c.status;
    const mudancas: Obj = { qualitor_situacao: situacao || c.qualitor_situacao, qualitor_responsavel: resp || c.qualitor_responsavel, qualitor_atualizado_em: agora() };
    const eu = acharUsuario(usuarios, porCodigo, item, resp);
    if (eu && eu.id !== c.responsavel_uid) { mudancas.responsavel_uid = eu.id; mudancas.responsavel_nome = eu.nome; }
    if (novoStatus !== c.status) {
      mudancas.status = novoStatus;
      mudancas.resolvido_em = novoStatus === "resolvido" ? agora() : null;
      mudancas.atualizado_em = agora();
    }
    await db.patch(`chamados?id=eq.${encodeURIComponent(c.id)}`, mudancas);
    if (mudancas.status || mudancas.responsavel_uid) {
      resumo.atualizados++;
      const partes = [];
      if (mudancas.status) partes.push(`situação "${situacao}"`);
      if (mudancas.responsavel_uid) partes.push(`responsável ${mudancas.responsavel_nome}`);
      await db.post("chamado_eventos", { chamado_id: c.id, tipo: mudancas.status ? "status" : "atribuicao", texto: `Atualizado pelo Qualitor: ${partes.join(", ")}`, autor_nome: "Qualitor" });
    }
  }
  return resumo;
}

/**
 * Os chamados da Comm chegam por "scripts de atendimento": o título vem como
 * "Script de atendimento: COM-CONFIGURAR" e a descrição repete o formulário
 * ("* Por favor, preencha... NOME / IDENTIFICAÇÃO DA MÁQUINA : - X * Descreva
 * a sua solicitação - Y"). Aqui vira "[COM-CONFIGURAR] Y" + "Máquina: X".
 */
export function resumoAtividade(titulo: string, descricao: string): string {
  const t = String(titulo || "").trim(), d = String(descricao || "").trim();
  const script = (t.match(/^Script de atendimento:\s*(.+)$/i) || [])[1]?.trim() || "";
  const pedido = (d.match(/Descreva a sua solicita[çc][ãa]o\s*-\s*([\s\S]+)$/i) || d.match(/Favor descrever a sua solicita[çc][ãa]o\.?\s*-\s*([\s\S]+)$/i) || d.match(/DESCREVER A SOLICITA[ÇC][ÃA]O\s*-\s*([\s\S]+)$/i) || [])[1]?.trim() || "";
  const maquina = (d.match(/IDENTIFICA[ÇC][ÃA]O DA M[ÁA]QUINA\s*:\s*-?\s*([^*]*?)\s*(?:\*|$)/i) || [])[1]?.trim().replace(/^-\s*/, "") || "";
  if (script || pedido) {
    const cabeca = `${script ? `[${script}] ` : t && !script ? `[${t}] ` : ""}${pedido || d || t}`;
    return [cabeca, maquina && maquina !== "-" ? `Máquina: ${maquina}` : "", `\nTexto original: ${d}`].filter(Boolean).join("\n").slice(0, 5000);
  }
  return [t, d && d !== t ? d : ""].filter(Boolean).join("\n").slice(0, 5000);
}

export async function importarNovos(db: Banco, q: Cliente, cfg: Obj, agora = () => new Date().toISOString()) {
  const resumo = { encontrados: 0, importados: 0, foraDoEscopo: 0 };
  if (!cfg.importar) return resumo;
  const esc = escopoDe(cfg);
  if (!esc.equipes.length) throw new Error(SEM_ESCOPO);
  const r = await q.metodo("getTicketsData", preencher(cfg.xml_busca, cfg.codigos || {}));
  if (!r.ok) throw new Error("Busca no Qualitor recusada: " + (r.msg || "sem mensagem"));
  const todos = r.itens.filter((i: Obj) => i.cdchamado);
  const itens = todos.filter((i: Obj) => dentroDoEscopo(i, esc));
  resumo.foraDoEscopo = todos.length - itens.length;
  resumo.encontrados = itens.length;
  if (!itens.length) return resumo;
  const usuarios = await db.get("usuarios?select=id,nome,papel&papel=neq.painel");
  const porCodigo = await mapaPorCodigo(db);
  const numeros = itens.map((i: Obj) => String(i.cdchamado).replace(/[^0-9A-Za-z_-]/g, ""));
  const ja = new Set((await db.get(`chamados?select=qualitor_numero&qualitor_numero=in.(${numeros.map((n: string) => `"${n}"`).join(",")})`)).map((x: Obj) => x.qualitor_numero));
  for (const item of itens) {
    const numero = String(item.cdchamado).replace(/[^0-9A-Za-z_-]/g, "");
    if (!numero || ja.has(numero)) continue;
    const situacao = primeiro(item, CAMPOS.situacao);
    const status = statusDoSite(situacao, cfg.mapa_situacao) || "aberto";
    if (status === "resolvido") continue; // só traz o que está em aberto
    const resp = primeiro(item, CAMPOS.responsavel);
    const eu = acharUsuario(usuarios, porCodigo, item, resp);
    const titulo = primeiro(item, CAMPOS.titulo);
    const descricao = primeiro(item, CAMPOS.descricao);
    const atividade = resumoAtividade(titulo, descricao) || `Chamado ${numero} do Qualitor`;
    const [novo] = await db.post("chamados", {
      numero, area: (primeiro(item, CAMPOS.setor) || "Qualitor").slice(0, 200), atividade,
      prioridade: prioridadeDoQualitor(item, cfg.mapa_prioridade), status: eu || status === "aberto" ? status : "aberto",
      responsavel_uid: eu ? eu.id : null, responsavel_nome: eu ? eu.nome : null,
      criado_por_nome: "Qualitor" + (primeiro(item, CAMPOS.solicitante) ? ": " + primeiro(item, CAMPOS.solicitante) : ""),
      origem: "qualitor", solicitante_nome: primeiro(item, CAMPOS.solicitante) || null,
      qualitor_numero: numero, qualitor_situacao: situacao || null, qualitor_responsavel: resp || null,
      qualitor_sync: "ok", qualitor_atualizado_em: agora()
    });
    await db.post("chamado_eventos", { chamado_id: novo.id, tipo: "criacao", texto: `Importado do Qualitor (chamado nº ${numero})${situacao ? " — situação: " + situacao : ""}`, autor_nome: "Qualitor" });
    await db.rpc("qualitor_notificar_novo", { p_chamado: novo.id });
    ja.add(numero);
    resumo.importados++;
  }
  return resumo;
}

// ---------------------------------------------------------------- servidor
/** "Explorar campos": leitura, sempre dentro do escopo. */
export async function consultar(db: Banco, q: Cliente, cfg: Obj, corpo: Obj) {
  const metodo = String(corpo.metodo || "");
  if (!METODOS_LEITURA.includes(metodo)) return { erro: "Só métodos de leitura: " + METODOS_LEITURA.join(", ") };
  if (METODOS_CADASTRO.includes(metodo)) {
    const r = await q.metodo(metodo, "<wsqualitor/>");
    return { ok: r.ok, msg: r.msg, itens: r.itens.slice(0, 50), bruto: r.bruto.slice(0, 20000) };
  }
  const esc = escopoDe(cfg);
  if (!esc.equipes.length) return { erro: SEM_ESCOPO };
  if (metodo === "getTicketsData") {
    const r = await q.metodo(metodo, preencher(cfg.xml_busca, cfg.codigos || {}));
    const dentro = r.itens.filter((i: Obj) => dentroDoEscopo(i, esc));
    return { ok: r.ok, msg: r.msg, itens: dentro.slice(0, 50), ocultos: r.itens.length - dentro.length, bruto: "(resposta completa oculta: a lista pode ter chamados de outras equipes)" };
  }
  // getTicketData / getTicketHistoryData: um chamado, que precisa ser da equipe
  // ou ter sido aberto/importado pelo site.
  const cdchamado = String(corpo.cdchamado || "").replace(/[^0-9A-Za-z_-]/g, "");
  if (!cdchamado) return { erro: "Informe o número do chamado do Qualitor." };
  const xml = preencher(cfg.xml_consulta, { ...(cfg.codigos || {}), cdchamado });
  const dados = await q.metodo("getTicketData", xml);
  const item = dados.itens[0];
  if (!dados.ok || !item) return { ok: false, msg: dados.msg || "Chamado não encontrado.", itens: [], bruto: "" };
  if (!mesmoChamado(item, cdchamado)) return { erro: "O Qualitor devolveu outro chamado, diferente do pedido. Confira o modelo de consulta (precisa usar {{cdchamado}})." };
  const ligado = (await db.get(`chamados?select=id&qualitor_numero=eq.${encodeURIComponent(cdchamado)}&limit=1`)).length > 0;
  if (!ligado && !dentroDoEscopo(item, esc)) {
    return { erro: `O chamado ${cdchamado} não é da equipe permitida (${esc.equipes.join(", ")}). A aplicação só enxerga chamados dessa equipe.` };
  }
  const r = metodo === "getTicketData" ? dados : await q.metodo(metodo, xml);
  return { ok: r.ok, msg: r.msg, itens: r.itens.slice(0, 50), bruto: r.bruto.slice(0, 20000) };
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function tratar(req: Request, env: Record<string, string | undefined>, fetchImpl: Fetch = fetch) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "Use POST." }, 405);
  let corpo: Obj;
  try { corpo = await req.json(); } catch { return resposta({ erro: "Corpo inválido." }, 400); }
  const db = criarBanco(env.SUPABASE_URL || "", env.SUPABASE_SERVICE_ROLE_KEY || "", fetchImpl);
  const [cfg] = await db.get("qualitor_config?id=eq.1&select=*");
  if (!cfg) return resposta({ erro: "Configuração do Qualitor não encontrada. Rode o supabase/schema.sql." }, 500);

  // Quem chama: o banco (segredo) ou um admin logado.
  const [seg] = await db.get("qualitor_segredo?id=eq.1&select=valor");
  let autorizado = typeof corpo.segredo === "string" && iguais(corpo.segredo, seg?.valor || "");
  if (!autorizado) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const quem = token ? await db.usuarioDoToken(token) : null;
    if (quem?.id) {
      const [perfil] = await db.get(`usuarios?id=eq.${quem.id}&select=papel`);
      autorizado = perfil?.papel === "admin";
    }
  }
  if (!autorizado) return resposta({ erro: "Não autorizado." }, 401);

  const acao = String(corpo.acao || "");
  const manual = !corpo.segredo;
  if (!cfg.ativo && !manual) return resposta({ ok: true, ignorado: "integração desligada" });
  if (!env.QUALITOR_LOGIN || !env.QUALITOR_SENHA) {
    return resposta({ erro: "Faltam os Secrets QUALITOR_LOGIN e QUALITOR_SENHA na função (Edge Functions > qualitor > Secrets)." }, 200);
  }
  // O endereço vem SEMPRE da configuração salva (nunca do pedido), para a
  // senha do Qualitor não poder ser enviada a outro servidor.
  const bloqueio = servidorPermitido(cfg.url_ws, env.QUALITOR_HOSTS);
  if (bloqueio) {
    await db.patch("qualitor_config?id=eq.1", { ultimo_erro: bloqueio, ultima_sinc: new Date().toISOString() }).catch(() => {});
    return resposta({ ok: false, erro: bloqueio });
  }
  const q = criarCliente(cfg.url_ws, fetchImpl);
  try {
    await q.login(env.QUALITOR_LOGIN, env.QUALITOR_SENHA, env.QUALITOR_EMPRESA || "1");
    if (acao === "testar") {
      let versao = "";
      try { versao = desescXml(await q.chamar("getVersion", { xmlValue: "<wsqualitor/>" })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); } catch { /* opcional */ }
      return resposta({ ok: true, mensagem: "Login no Qualitor funcionou.", versao: versao.slice(0, 200) });
    }
    if (acao === "consultar") return resposta(await consultar(db, q, cfg, corpo));
    if (acao === "processar") {
      const fila = await processarFila(db, q, cfg);
      return resposta({ ok: true, fila });
    }
    if (acao === "sincronizar") {
      const fila = await processarFila(db, q, cfg);
      const ligados = await atualizarLigados(db, q, cfg);
      const importacao = await importarNovos(db, q, cfg);
      await db.patch("qualitor_config?id=eq.1", { ultima_sinc: new Date().toISOString(), ultimo_erro: null });
      return resposta({ ok: true, fila, ligados, importacao });
    }
    return resposta({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    await db.patch("qualitor_config?id=eq.1", { ultimo_erro: msgErro(e).slice(0, 500), ultima_sinc: new Date().toISOString() }).catch(() => {});
    return resposta({ ok: false, erro: msgErro(e) });
  }
}

if (import.meta.main) {
  Deno.serve((req) => tratar(req, Deno.env.toObject()));
}
