// ==========================================================================
// BASE DE SOLUÇÕES — FUNÇÕES COMPARTILHADAS
// ==========================================================================
// - sugerirSolucoes(): acha soluções parecidas com um chamado (por palavras);
// - abrirResolver(): janela "Resolver chamado" com "Como você resolveu?" e a
//   opção de salvar na Base de soluções (substitui o antigo prompt()).
// ==========================================================================
import { supabase, inserir, buscarTodos } from "./db.js";

export const CATEGORIAS = {
  impressora: { rotulo: "Impressora", emoji: "🖨", cor: "amarelo" },
  computador: { rotulo: "Computador", emoji: "💻", cor: "roxo" },
  rede: { rotulo: "Rede / Internet", emoji: "📶", cor: "verde" },
  acesso: { rotulo: "Acesso / senha", emoji: "🔐", cor: "azul" },
  telefonia: { rotulo: "Telefonia", emoji: "📞", cor: "laranja" },
  sistemas: { rotulo: "Sistemas", emoji: "🧩", cor: "cinza" },
  outro: { rotulo: "Outro", emoji: "❓", cor: "cinza" }
};

// Palavras que não ajudam a achar parecidos.
const VAZIAS = new Set(("a o e de da do das dos em no na nos nas um uma para por com sem que nao não ao aos " +
  "se ja já foi esta está estao estão ser ter tem mais muito pouco depois antes quando como onde qual " +
  "ele ela eles elas meu minha seu sua isso isto aqui ali la lá pc computador maquina máquina usuario usuário").split(" "));

export function normalizar(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function palavras(texto) {
  return normalizar(texto).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !VAZIAS.has(p))
    .map((p) => p.replace(/(oes|aes|ais|eis|s)$/, "")); // plural simples
}

/** Adivinha a categoria pelo texto do chamado. */
export function categoriaProvavel(texto) {
  const t = normalizar(texto);
  if (/impress|toner|scanner|spool|fila de impress/.test(t)) return "impressora";
  if (/vpn|internet|rede|wi-?fi|wifi|cabo|switch|link|ping|dns/.test(t)) return "rede";
  if (/senha|acesso|login|bloquead|permiss|pasta|credencia|usuario/.test(t)) return "acesso";
  if (/telefon|ramal|voip|celular/.test(t)) return "telefonia";
  if (/sistema|erp|outlook|e-?mail|office|excel|word|teams|programa|software/.test(t)) return "sistemas";
  if (/notebook|computador|pc |monitor|teclado|mouse|lento|liga|tela|windows|hd|ssd|memoria/.test(t)) return "computador";
  return "outro";
}

/**
 * Soluções parecidas com o chamado, da mais parecida para a menos.
 * Pontua pelas palavras em comum (título pesa mais) e pelos usos.
 */
export function sugerirSolucoes(chamado, solucoes, limite = 3) {
  const alvo = new Set(palavras(`${chamado.atividade} ${chamado.area}`));
  if (!alvo.size) return [];
  const cat = categoriaProvavel(chamado.atividade);
  return solucoes
    .filter((s) => !s.revisar)
    .map((s) => {
      const doTitulo = new Set(palavras(s.titulo));
      const doResto = new Set(palavras(`${s.problema} ${s.passos}`));
      const comuns = new Set();
      let pontos = 0;
      doTitulo.forEach((p) => { if (alvo.has(p)) { pontos += 3; comuns.add(p); } });
      doResto.forEach((p) => { if (alvo.has(p) && !comuns.has(p)) { pontos += 1; comuns.add(p); } });
      // Precisa de pelo menos 2 palavras em comum e texto parecido de verdade.
      if (comuns.size < 2 || pontos < 4) return { s, pontos: 0 };
      if (s.categoria === cat) pontos += 2;
      else if (cat !== "outro" && s.categoria !== "outro") pontos -= 3;
      // Usos só desempatam: nunca fazem uma solução aparecer sozinhos.
      return { s, pontos: pontos >= 4 ? pontos + Math.min(2, Math.log2(1 + (s.usos || 0)) / 2) : 0 };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((x) => x.s);
}

/** Conta que a solução resolveu este chamado (1 vez por chamado). */
export async function marcarSolucaoUsada(solucaoId, chamadoId) {
  const { data, error } = await supabase.rpc("usar_solucao", { p_solucao: solucaoId, p_chamado: chamadoId });
  if (error) throw error;
  return data;
}

let cacheSolucoes = null;
export async function carregarSolucoes() {
  try {
    cacheSolucoes = await buscarTodos("solucoes", (q) => q.order("usos", { ascending: false }));
  } catch (e) {
    cacheSolucoes = []; // tabela ainda não criada (schema antigo): o resto do site segue normal
  }
  return cacheSolucoes;
}

/** Bloco "Solução que já funcionou" para a janela de detalhes do chamado. */
export function htmlSugestao(chamado, sugestoes, indice = 0) {
  if (!sugestoes.length || chamado.status === "resolvido") return "";
  const s = sugestoes[indice % sugestoes.length];
  const passos = String(s.passos).split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  const lista = passos.length > 1
    ? `<ol>${passos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`
    : `<p style="margin:6px 0 10px">${esc(passos[0] || "")}</p>`;
  return `
    <div class="sugestao-sol" data-solucao="${esc(s.id)}">
      <div class="sugestao-topo"><b>💡 Solução que já funcionou em casos parecidos</b>
        ${s.usos ? `<span class="badge badge-prazo-cumprido">Resolveu ${s.usos} chamado${s.usos === 1 ? "" : "s"}</span>` : ""}</div>
      <b class="sugestao-titulo">${esc(s.titulo)}</b>
      ${lista}
      <div class="sugestao-rodape"><span class="texto-suave">Escrita por ${esc(s.criadoPorNome || "—")}</span>
        <span class="acoes-tabela">
          <button type="button" class="botao-primario botao-pequeno js-sol-resolveu">Resolveu ✓</button>
          ${sugestoes.length > 1 ? `<button type="button" class="botao-secundario botao-pequeno js-sol-outra">Ver outra (${indice % sugestoes.length + 1}/${sugestoes.length})</button>` : ""}
          <a class="botao-secundario botao-pequeno" href="solucoes.html#s=${encodeURIComponent(s.id)}">Abrir</a>
        </span></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Janela "Resolver chamado"
// ---------------------------------------------------------------------------
let modalResolver = null;
function criarModalResolver() {
  if (modalResolver) return modalResolver;
  const el = document.createElement("div");
  el.className = "modal-fundo";
  el.id = "modal-resolver";
  el.innerHTML = `
    <div class="modal" role="dialog" aria-labelledby="resolver-titulo">
      <h2 id="resolver-titulo">Resolver chamado</h2>
      <p class="texto-suave" id="resolver-sub" style="margin:-6px 0 14px;font-size:13px"></p>
      <form class="modal-form" id="form-resolver">
        <div class="campo">
          <label for="resolver-nota">Como você resolveu? <span class="texto-suave">(opcional, fica na linha do tempo)</span></label>
          <textarea id="resolver-nota" rows="4" maxlength="2000" placeholder="Ex.: fila travada; parei o Spooler, limpei a pasta PRINTERS e iniciei de novo."></textarea>
        </div>
        <label class="alternar"><input type="checkbox" id="resolver-salvar"> <strong>Salvar na Base de soluções para o time</strong></label>
        <div class="caixa-solucao" id="resolver-caixa" hidden>
          <div class="campo">
            <label for="resolver-sol-titulo">Título da solução</label>
            <input type="text" id="resolver-sol-titulo" maxlength="200" placeholder="Ex.: Impressora: fila travada após atualização do Windows" />
          </div>
          <div class="campo">
            <label>Categoria</label>
            <div class="seletor-chips" id="resolver-categorias">
              ${Object.entries(CATEGORIAS).map(([v, c]) => `<button type="button" class="chip" data-valor="${v}">${c.emoji} ${c.rotulo}</button>`).join("")}
            </div>
          </div>
          <p class="texto-suave" id="resolver-parecida" style="font-size:12.5px;margin:0"></p>
        </div>
        <p class="erro-msg" id="resolver-erro"></p>
        <div class="modal-acoes">
          <button type="button" class="botao-secundario" id="resolver-cancelar">Cancelar</button>
          <button type="submit" class="botao-primario" id="resolver-confirmar">Resolver chamado</button>
        </div>
      </form>
    </div>`;
  document.body.append(el);
  el.querySelectorAll("#resolver-categorias .chip").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll("#resolver-categorias .chip").forEach((x) => x.classList.toggle("on", x === b));
  }));
  el.querySelector("#resolver-salvar").addEventListener("change", (e) => {
    el.querySelector("#resolver-caixa").hidden = !e.target.checked;
    if (e.target.checked) el.querySelector("#resolver-sol-titulo").focus();
  });
  modalResolver = el;
  return el;
}

/**
 * Abre a janela e resolve o chamado ao confirmar.
 * @param {object} chamado
 * @param {(dados: {nota: string}) => Promise<void>} aoConfirmar  muda o status e grava a nota
 * @returns {Promise<boolean>} true se resolveu, false se cancelou
 */
export function abrirResolver(chamado, aoConfirmar) {
  const el = criarModalResolver();
  const $ = (s) => el.querySelector(s);
  $("#resolver-titulo").textContent = `Resolver chamado ${chamado.numero || ""}`.trim();
  $("#resolver-sub").textContent = [chamado.area, chamado.atividade].filter(Boolean).join(" · ").slice(0, 160);
  $("#resolver-nota").value = "";
  $("#resolver-salvar").checked = false;
  $("#resolver-caixa").hidden = true;
  $("#resolver-sol-titulo").value = "";
  $("#resolver-erro").textContent = "";
  const cat = categoriaProvavel(chamado.atividade);
  el.querySelectorAll("#resolver-categorias .chip").forEach((x) => x.classList.toggle("on", x.dataset.valor === cat));
  const parecidas = cacheSolucoes ? sugerirSolucoes(chamado, cacheSolucoes, 1) : [];
  $("#resolver-parecida").innerHTML = parecidas.length
    ? `Já existe uma parecida: <a class="link-suave" href="solucoes.html#s=${encodeURIComponent(parecidas[0].id)}" target="_blank">${esc(parecidas[0].titulo)}</a>. Se for a mesma coisa, não precisa salvar de novo.`
    : "";
  el.classList.add("aberto");
  setTimeout(() => $("#resolver-nota").focus(), 30);

  return new Promise((resolver) => {
    const fechar = (ok) => {
      el.classList.remove("aberto");
      form.removeEventListener("submit", enviar);
      $("#resolver-cancelar").removeEventListener("click", cancelar);
      el.removeEventListener("click", fora);
      document.removeEventListener("keydown", esc_);
      resolver(ok);
    };
    const cancelar = () => fechar(false);
    const fora = (e) => { if (e.target === el) fechar(false); };
    const esc_ = (e) => { if (e.key === "Escape") fechar(false); };
    const form = $("#form-resolver");
    const enviar = async (e) => {
      e.preventDefault();
      const nota = $("#resolver-nota").value.trim();
      const salvar = $("#resolver-salvar").checked;
      const titulo = $("#resolver-sol-titulo").value.trim();
      if (salvar && titulo.length < 3) { $("#resolver-erro").textContent = "Dê um título curto para a solução."; return; }
      if (salvar && nota.length < 3) { $("#resolver-erro").textContent = "Descreva como resolveu para salvar a solução."; return; }
      const botao = $("#resolver-confirmar");
      botao.disabled = true; botao.textContent = "Salvando...";
      try {
        await aoConfirmar({ nota });
        if (salvar) {
          const categoria = el.querySelector("#resolver-categorias .chip.on")?.dataset.valor || "outro";
          try {
            await inserir("solucoes", { titulo, categoria, problema: (chamado.atividade || "").slice(0, 2000), passos: nota, chamadoId: chamado.id });
          } catch (err) {
            alert("O chamado foi resolvido, mas a solução não foi salva: " + err.message);
          }
        }
        fechar(true);
      } catch (err) {
        $("#resolver-erro").textContent = "Não foi possível resolver: " + err.message;
      } finally {
        botao.disabled = false; botao.textContent = "Resolver chamado";
      }
    };
    form.addEventListener("submit", enviar);
    $("#resolver-cancelar").addEventListener("click", cancelar);
    el.addEventListener("click", fora);
    document.addEventListener("keydown", esc_);
  });
}

export function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// Atualiza o cache quando alguém salva/edita uma solução.
window.addEventListener("db-alterado", (e) => { if (e.detail === "solucoes" && cacheSolucoes) carregarSolucoes(); });
