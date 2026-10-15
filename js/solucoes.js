// ==========================================================================
// TELA BASE DE SOLUÇÕES
// ==========================================================================
// - Todos leem e criam; o autor (ou o admin) edita e exclui.
// - O contador "resolveu N chamados" sobe quando alguém clica em
//   "Resolveu ✓" na sugestão dentro do chamado (1 vez por chamado).
// - O admin pode marcar "Precisa revisar": a solução deixa de ser sugerida.
// Atalho: solucoes.html#s=<id> abre a solução; #nova abre o formulário.
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, inserir, atualizar, excluir, paraDate } from "./db.js";
import { CATEGORIAS, normalizar, esc } from "./solucoes-util.js";

let usuarioAtual = null;
let perfilAtual = null;
let solucoes = [];
let categoria = "";
let jaAbriu = false;

const ehAdmin = () => perfilAtual && perfilAtual.papel === "admin";
const listaEl = document.getElementById("lista-solucoes");
const modal = document.getElementById("modal-solucao");
const form = document.getElementById("form-solucao");

protegerPagina((user, perfil) => {
  usuarioAtual = user;
  perfilAtual = perfil;
  montarNav(perfil, user);
  if (ehAdmin()) document.querySelectorAll(".apenas-admin").forEach((el) => el.style.display = "");

  observar("solucoes", (q) => q.order("usos", { ascending: false }).order("criado_em", { ascending: false }), (linhas) => {
    solucoes = linhas;
    renderizar();
    if (!jaAbriu) { jaAbriu = true; abrirPeloEndereco(); }
  }, (erro) => {
    listaEl.innerHTML = `<p class="vazio">Não foi possível carregar: ${esc(erro.message)}<br><small>Se acabou de atualizar o site, rode o supabase/schema.sql de novo no Supabase.</small></p>`;
  });
});

window.addEventListener("hashchange", () => {
  const m = window.location.hash.match(/^#s=(.+)$/);
  if (m && !modal.classList.contains("aberto")) abrirModal(decodeURIComponent(m[1]));
});

function abrirPeloEndereco() {
  const h = window.location.hash;
  if (h === "#nova") abrirModal();
  const m = h.match(/^#s=(.+)$/);
  if (m) abrirModal(decodeURIComponent(m[1]));
}

// -------------------- Lista --------------------
document.getElementById("busca-solucoes").addEventListener("input", renderizar);

function renderizar() {
  const busca = normalizar(document.getElementById("busca-solucoes").value.trim());
  const termos = busca.split(/\s+/).filter((t) => t.length > 1);

  // Chips de categoria com contagem
  const contagem = {};
  solucoes.forEach((s) => { contagem[s.categoria] = (contagem[s.categoria] || 0) + 1; });
  document.getElementById("categorias-solucoes").innerHTML =
    `<button type="button" class="chip ${categoria ? "" : "on"}" data-cat="">Todas (${solucoes.length})</button>` +
    Object.entries(CATEGORIAS).filter(([v]) => contagem[v]).map(([v, c]) =>
      `<button type="button" class="chip ${categoria === v ? "on" : ""}" data-cat="${v}">${c.emoji} ${c.rotulo} (${contagem[v]})</button>`).join("");
  document.querySelectorAll("#categorias-solucoes .chip").forEach((b) => b.addEventListener("click", () => { categoria = b.dataset.cat; renderizar(); }));

  // Busca: todas as palavras precisam aparecer (título, problema ou passos).
  const filtradas = solucoes.filter((s) => {
    if (categoria && s.categoria !== categoria) return false;
    if (!termos.length) return true;
    const alvo = normalizar(`${s.titulo} ${s.problema} ${s.passos} ${s.criadoPorNome}`);
    return termos.every((t) => alvo.includes(t));
  });

  if (!solucoes.length) {
    listaEl.innerHTML = `<div class="vazio"><p><strong>Nenhuma solução salva ainda.</strong></p>
      <p class="texto-suave">Ao resolver um chamado, marque "Salvar na Base de soluções". Ou clique em "+ Nova solução".</p></div>`;
  } else if (!filtradas.length) {
    listaEl.innerHTML = `<p class="vazio">Nada encontrado para essa busca.</p>`;
  } else {
    listaEl.innerHTML = filtradas.map((s) => {
      const c = CATEGORIAS[s.categoria] || CATEGORIAS.outro;
      const primeiro = String(s.passos).split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" · ");
      const quando = paraDate(s.criadoEm);
      return `
        <article class="item-sol" data-id="${esc(s.id)}" tabindex="0">
          <span class="modulo-icone cor-${c.cor} ic-sol" aria-hidden="true">${c.emoji}</span>
          <div class="item-sol-corpo">
            <h3>${esc(s.titulo)}</h3>
            <p>${esc(primeiro.length > 180 ? primeiro.slice(0, 180) + "…" : primeiro)}</p>
            <div class="item-sol-tags">
              ${s.usos ? `<span class="badge badge-prazo-cumprido">Resolveu ${s.usos} chamado${s.usos === 1 ? "" : "s"}</span>` : `<span class="badge badge-prazo-ok">Nova</span>`}
              <span class="badge badge-neutro">${esc((s.criadoPorNome || "—").split(" ")[0])}${quando ? " · " + quando.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : ""}</span>
              ${s.revisar ? `<span class="badge badge-prazo-atrasado">Precisa revisar</span>` : ""}
            </div>
          </div>
        </article>`;
    }).join("");
    listaEl.querySelectorAll(".item-sol").forEach((el) => {
      el.addEventListener("click", () => abrirModal(el.dataset.id));
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") abrirModal(el.dataset.id); });
    });
  }

  // Lateral: mais usadas e quem mais contribuiu
  const usadas = solucoes.filter((s) => s.usos).sort((a, b) => b.usos - a.usos).slice(0, 5);
  document.getElementById("ranking-usadas").innerHTML = usadas.length
    ? usadas.map((s) => `<li><a href="#s=${encodeURIComponent(s.id)}" data-id="${esc(s.id)}">${esc(s.titulo)}</a><b>${s.usos}×</b></li>`).join("")
    : `<li class="texto-suave">Ainda sem uso registrado.</li>`;
  document.querySelectorAll("#ranking-usadas a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); abrirModal(a.dataset.id); }));
  const autores = {};
  solucoes.forEach((s) => { const n = s.criadoPorNome || "—"; autores[n] = (autores[n] || 0) + 1; });
  document.getElementById("ranking-autores").innerHTML = Object.entries(autores).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, q]) => `<li><span class="pessoa-ranking"><span class="avatar mini">${esc(n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase())}</span>${esc(n)}</span><b>${q}</b></li>`).join("")
    || `<li class="texto-suave">—</li>`;
}

// -------------------- Modal --------------------
document.getElementById("btn-nova-solucao").addEventListener("click", () => abrirModal());
document.getElementById("btn-cancelar-solucao").addEventListener("click", fecharModal);
modal.addEventListener("click", (e) => { if (e.target === modal) fecharModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("aberto")) fecharModal(); });

const catEl = document.getElementById("solucao-categorias");
catEl.innerHTML = Object.entries(CATEGORIAS).map(([v, c]) => `<button type="button" class="chip" data-valor="${v}">${c.emoji} ${c.rotulo}</button>`).join("");
catEl.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => marcarCategoria(b.dataset.valor)));
function marcarCategoria(v) { catEl.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.valor === v)); }

function abrirModal(id = null) {
  const s = id ? solucoes.find((x) => x.id === id) : null;
  if (id && !s) return;
  const podeEditar = !s || ehAdmin() || s.criadoPorUid === usuarioAtual.uid;
  form.reset();
  document.getElementById("solucao-erro").textContent = "";
  document.getElementById("solucao-id").value = s ? s.id : "";
  document.getElementById("solucao-modal-titulo").textContent = !s ? "Nova solução" : podeEditar ? "Editar solução" : "Solução";
  document.getElementById("solucao-titulo").value = s ? s.titulo : "";
  document.getElementById("solucao-problema").value = s ? s.problema : "";
  document.getElementById("solucao-passos").value = s ? s.passos : "";
  document.getElementById("solucao-revisar").checked = Boolean(s && s.revisar);
  marcarCategoria(s ? s.categoria : "outro");
  form.querySelectorAll("input, textarea").forEach((el) => { if (el.type !== "hidden") el.disabled = !podeEditar; });
  catEl.querySelectorAll(".chip").forEach((b) => b.disabled = !podeEditar);
  document.getElementById("btn-salvar-solucao").hidden = !podeEditar;
  document.getElementById("btn-excluir-solucao").hidden = !(s && podeEditar);
  document.getElementById("btn-cancelar-solucao").textContent = podeEditar ? "Cancelar" : "Fechar";
  if (s) history.replaceState(null, "", `#s=${encodeURIComponent(s.id)}`);
  modal.classList.add("aberto");
  if (podeEditar) setTimeout(() => document.getElementById("solucao-titulo").focus(), 30);
}

function fecharModal() {
  modal.classList.remove("aberto");
  history.replaceState(null, "", window.location.pathname);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("solucao-id").value;
  const dados = {
    titulo: document.getElementById("solucao-titulo").value.trim(),
    categoria: catEl.querySelector(".chip.on")?.dataset.valor || "outro",
    problema: document.getElementById("solucao-problema").value.trim(),
    passos: document.getElementById("solucao-passos").value.trim()
  };
  if (ehAdmin()) dados.revisar = document.getElementById("solucao-revisar").checked;
  const botao = document.getElementById("btn-salvar-solucao");
  botao.disabled = true; botao.textContent = "Salvando...";
  try {
    if (id) await atualizar("solucoes", id, dados);
    else await inserir("solucoes", dados);
    fecharModal();
  } catch (err) {
    document.getElementById("solucao-erro").textContent = "Erro ao salvar: " + err.message;
  } finally {
    botao.disabled = false; botao.textContent = "Salvar";
  }
});

document.getElementById("btn-excluir-solucao").addEventListener("click", async () => {
  const id = document.getElementById("solucao-id").value;
  if (!id || !confirm("Excluir esta solução? Essa ação não pode ser desfeita.")) return;
  try { await excluir("solucoes", id); fecharModal(); } catch (err) { alert("Erro ao excluir: " + err.message); }
});
