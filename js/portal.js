// ==========================================================================
// PORTAL DO COLABORADOR — abrir chamado SEM login
// ==========================================================================
// portal.html?k=<código>            → formulário (código vem do link/QR da TI)
// portal.html?k=<código>&c=<acomp.>  → acompanhamento do chamado
// Quem abre não tem acesso a nada do sistema: o banco só aceita as funções
// abrir_chamado_portal() e consultar_chamado_portal() (supabase/schema.sql).
// ==========================================================================
import { supabase } from "./supabase-config.js";

const CATEGORIAS = [
  ["impressora", "🖨", "Impressora"], ["computador", "💻", "Computador"], ["rede", "📶", "Internet / Wi-Fi"],
  ["acesso", "🔐", "Acesso / senha"], ["telefonia", "📞", "Telefone"], ["sistemas", "✉️", "Sistemas / e-mail"],
  ["outro", "❓", "Outro"]
];
const STATUS = {
  aberto: ["Recebido", "Aguardando um técnico", "aberto"],
  andamento: ["Em atendimento", "Um técnico já está cuidando disso", "andamento"],
  resolvido: ["Resolvido", "A TI marcou como resolvido", "resolvido"]
};
const MENSAGENS = {
  link_invalido: "Este link não vale mais. Peça o link novo (ou o QR code) para a TI.",
  desativado: "O portal está temporariamente desligado. Fale com a TI pelo ramal ou contato de sempre.",
  limite: "Muitos chamados foram abertos agora. Tente de novo em alguns minutos ou ligue para a TI.",
  dados_invalidos: "Confira os campos: escolha o tipo do problema, descreva com pelo menos 5 letras e informe nome e setor.",
  invalido: "Não foi possível enviar."
};

const params = new URLSearchParams(window.location.search);
const chave = params.get("k") || ler("hd-portal-k") || "";
const codigo = params.get("c") || "";
const $ = (id) => document.getElementById(id);
let categoria = "";
let impacto = "medio";
let temporizador = null;

if (params.get("k")) gravar("hd-portal-k", params.get("k"));

if (codigo) mostrarAcompanhamento(codigo, params.get("novo") === "1");
else if (chave) mostrarFormulario();
else $("portal-sem-link").hidden = false;

// -------------------- Formulário --------------------
function mostrarFormulario() {
  $("portal-form-card").hidden = false;
  $("portal-categorias").innerHTML = CATEGORIAS.map(([v, e, r]) =>
    `<button type="button" class="portal-cat" data-valor="${v}"><span>${e}</span>${r}</button>`).join("");
  document.querySelectorAll(".portal-cat").forEach((b) => b.addEventListener("click", () => {
    categoria = b.dataset.valor;
    document.querySelectorAll(".portal-cat").forEach((x) => x.classList.toggle("on", x === b));
  }));
  document.querySelectorAll("#portal-impacto button").forEach((b) => b.addEventListener("click", () => {
    impacto = b.dataset.valor;
    document.querySelectorAll("#portal-impacto button").forEach((x) => x.classList.toggle("ativo", x === b));
  }));
  // Lembra nome/setor/contato neste aparelho para a próxima vez.
  const eu = lerJSON("hd-portal-eu") || {};
  $("portal-nome").value = eu.nome || "";
  $("portal-setor").value = eu.setor || "";
  $("portal-contato").value = eu.contato || "";
  desenharMeus();
  $("portal-form").addEventListener("submit", enviar);
}

async function enviar(e) {
  e.preventDefault();
  const erro = $("portal-erro");
  erro.textContent = "";
  const dados = {
    nome: $("portal-nome").value.trim(), setor: $("portal-setor").value.trim(),
    contato: $("portal-contato").value.trim(), descricao: $("portal-descricao").value.trim()
  };
  if (!categoria) { erro.textContent = "Escolha o que está acontecendo."; return; }
  if (dados.descricao.length < 5) { erro.textContent = "Descreva o problema em poucas palavras."; $("portal-descricao").focus(); return; }
  if (dados.nome.length < 2) { erro.textContent = "Informe seu nome."; $("portal-nome").focus(); return; }
  if (!dados.setor) { erro.textContent = "Informe seu setor."; $("portal-setor").focus(); return; }

  const botao = $("portal-enviar");
  botao.disabled = true; botao.textContent = "Enviando...";
  try {
    const { data, error } = await supabase.rpc("abrir_chamado_portal", {
      p_chave: chave, p_nome: dados.nome, p_setor: dados.setor, p_contato: dados.contato,
      p_categoria: categoria, p_descricao: dados.descricao, p_impacto: impacto, p_armadilha: $("portal-site").value
    });
    if (error) throw error;
    if (!data || !data.ok) { erro.textContent = MENSAGENS[data && data.motivo] || MENSAGENS.invalido; return; }
    gravar("hd-portal-eu", JSON.stringify({ nome: dados.nome, setor: dados.setor, contato: dados.contato }));
    const meus = (lerJSON("hd-portal-meus") || []).filter((m) => m.codigo !== data.codigo);
    meus.unshift({ numero: data.numero, codigo: data.codigo, resumo: dados.descricao.slice(0, 80), quando: new Date().toISOString() });
    gravar("hd-portal-meus", JSON.stringify(meus.slice(0, 10)));
    window.location.href = linkAcompanhamento(data.codigo) + "&novo=1";
  } catch (err) {
    erro.textContent = /fetch|network/i.test(err.message || "") ? "Sem conexão. Verifique a internet e tente de novo." : "Não foi possível enviar: " + (err.message || err);
  } finally {
    botao.disabled = false; botao.textContent = "Enviar chamado";
  }
}

function desenharMeus() {
  const meus = lerJSON("hd-portal-meus") || [];
  if (!meus.length) return;
  $("portal-meus").hidden = false;
  $("portal-meus-lista").innerHTML = meus.map((m) =>
    `<li><a href="${esc(linkAcompanhamento(m.codigo))}"><strong>${esc(m.numero)}</strong> · ${esc(m.resumo)}</a>
      <small>${new Date(m.quando).toLocaleDateString("pt-BR")}</small></li>`).join("");
}

// -------------------- Acompanhamento --------------------
async function mostrarAcompanhamento(cod, recemEnviado) {
  $("portal-acompanhar").hidden = false;
  $("portal-enviado").hidden = !recemEnviado;
  if (recemEnviado) history.replaceState(null, "", linkAcompanhamento(cod));
  if (chave) { $("acomp-novo").hidden = false; $("acomp-novo").href = `portal.html?k=${encodeURIComponent(chave)}`; }
  $("acomp-copiar").addEventListener("click", async () => {
    const url = new URL(linkAcompanhamento(cod), window.location.href).href;
    try { await navigator.clipboard.writeText(url); $("acomp-copiar").textContent = "Link copiado ✓"; }
    catch (e) { prompt("Copie o link:", url); }
  });
  await atualizarAcompanhamento(cod);
  temporizador = setInterval(() => atualizarAcompanhamento(cod), 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") atualizarAcompanhamento(cod); });
}

async function atualizarAcompanhamento(cod) {
  try {
    const { data, error } = await supabase.rpc("consultar_chamado_portal", { p_codigo: cod });
    if (error) throw error;
    if (!data || !data.ok) {
      $("acomp-titulo").textContent = "Chamado não encontrado";
      $("acomp-descricao").textContent = "Confira se o link está completo.";
      clearInterval(temporizador);
      return;
    }
    const [rotulo, frase, classe] = STATUS[data.status] || STATUS.aberto;
    $("acomp-titulo").textContent = `Chamado ${data.numero}`;
    $("acomp-descricao").textContent = data.descricao || "";
    $("acomp-status").innerHTML = `
      <span class="portal-status-selo ${classe}">${rotulo}</span>
      <span>${frase}${data.responsavel && data.status !== "resolvido" ? ` · com <strong>${esc(data.responsavel)}</strong>` : ""}</span>`;
    $("acomp-etapas").innerHTML = (data.etapas || []).map((e) =>
      `<li><span class="ponto"></span><div><strong>${esc(e.texto)}</strong><small>${quando(e.quando)}</small></div></li>`).join("")
      + (data.status !== "resolvido" ? `<li class="futuro"><span class="ponto"></span><div><strong>Resolvido</strong><small>em breve</small></div></li>` : "");
    if (data.status === "resolvido") clearInterval(temporizador);
  } catch (err) {
    $("acomp-descricao").textContent = "Sem conexão agora. Tentando de novo...";
  }
}

// -------------------- Utilitários --------------------
function linkAcompanhamento(cod) {
  return `portal.html?${chave ? "k=" + encodeURIComponent(chave) + "&" : ""}c=${encodeURIComponent(cod)}`;
}
function quando(v) {
  const d = new Date(v);
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lerJSON(k) { try { return JSON.parse(ler(k) || "null"); } catch (e) { return null; } }
function gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } }
function esc(t) { const d = document.createElement("div"); d.textContent = t ?? ""; return d.innerHTML; }
