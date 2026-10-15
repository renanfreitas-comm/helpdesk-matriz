// ==========================================================================
// TELA LINKS ÚTEIS
// ==========================================================================
// Todos veem; só o admin cria, edita e exclui (regras no banco).
// Endereços da rede interna (10.x, 192.168.x, 172.16–31.x) ganham o aviso
// "rede interna / VPN", porque só abrem dentro da empresa.
// ==========================================================================
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import { observar, inserir, atualizar, excluir } from "./db.js";

let perfilAtual = null;
let links = [];
const ehAdmin = () => perfilAtual && perfilAtual.papel === "admin";
const $ = (id) => document.getElementById(id);
const modal = $("modal-link");
const ICONE_GRUPO = { "Administrativo": "🧾", "Protheus": "🏭", "Infraestrutura e segurança": "🛡", "Qualitor": "🎫" };

protegerPagina((user, perfil) => {
  perfilAtual = perfil;
  montarNav(perfil, user);
  if (ehAdmin()) document.querySelectorAll(".apenas-admin").forEach((el) => (el.style.display = ""));
  observar("links_uteis", (q) => q.order("categoria").order("ordem").order("titulo"), (linhas) => {
    links = linhas;
    renderizar();
  }, (err) => {
    $("grupos-links").innerHTML = `<p class="vazio">Não foi possível carregar: ${esc(err.message)}<br><small>Se acabou de atualizar o site, rode o supabase/schema.sql de novo no Supabase.</small></p>`;
  });
});

$("busca-links").addEventListener("input", renderizar);
// Atalho: "/" foca a busca.
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $("busca-links").focus(); }
});

function interno(url) {
  try {
    const h = new URL(url).hostname;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$)/.test(h);
  } catch (e) { return false; }
}
function dominio(url) {
  try { const u = new URL(url); return u.host; } catch (e) { return url; }
}
const normalizar = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function renderizar() {
  const termos = normalizar($("busca-links").value).split(/\s+/).filter(Boolean);
  const filtrados = links.filter((l) => {
    const alvo = normalizar(`${l.titulo} ${l.descricao} ${l.categoria} ${dominio(l.url)}`);
    return termos.every((t) => alvo.includes(t));
  });
  if (!links.length) {
    $("grupos-links").innerHTML = `<p class="vazio">Nenhum link cadastrado ainda.${ehAdmin() ? " Use \"+ Novo link\"." : ""}</p>`;
    return;
  }
  if (!filtrados.length) { $("grupos-links").innerHTML = `<p class="vazio">Nada encontrado.</p>`; return; }

  const grupos = {};
  filtrados.forEach((l) => { (grupos[l.categoria] = grupos[l.categoria] || []).push(l); });
  $("grupos-links").innerHTML = Object.entries(grupos).map(([cat, itens]) => `
    <h2 class="grupo-titulo">${ICONE_GRUPO[cat] || "🔗"} ${esc(cat)}</h2>
    <div class="grade-links">
      ${itens.map((l) => `
        <div class="cartao-link">
          <a class="cartao-link-principal" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">
            <span class="cartao-link-icone" aria-hidden="true">${esc(iniciais(l.titulo))}</span>
            <span class="cartao-link-texto">
              <strong>${esc(l.titulo)}</strong>
              <small>${esc(l.descricao || dominio(l.url))}</small>
              ${interno(l.url) ? `<span class="selo-interno" title="Só abre dentro da empresa ou conectado na VPN">🔒 Rede interna / VPN</span>` : ""}
            </span>
            <span class="cartao-link-seta" aria-hidden="true">↗</span>
          </a>
          <div class="cartao-link-acoes">
            <button type="button" class="link-suave js-copiar" data-url="${esc(l.url)}">Copiar</button>
            ${ehAdmin() ? `<button type="button" class="link-suave js-editar" data-id="${esc(l.id)}">Editar</button>` : ""}
          </div>
        </div>`).join("")}
    </div>`).join("");

  document.querySelectorAll(".js-copiar").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = "Copiar"), 1500); }
    catch (e) { prompt("Copie o endereço:", b.dataset.url); }
  }));
  document.querySelectorAll(".js-editar").forEach((b) => b.addEventListener("click", () => abrirModal(b.dataset.id)));
}

function iniciais(t) {
  const p = String(t).replace(/[—-].*$/, "").trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
}

// -------------------- Modal (admin) --------------------
$("btn-novo-link").addEventListener("click", () => abrirModal());
$("btn-cancelar-link").addEventListener("click", () => modal.classList.remove("aberto"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("aberto"); });

function abrirModal(id = null) {
  const l = id ? links.find((x) => x.id === id) : null;
  $("form-link").reset();
  $("link-erro").textContent = "";
  $("link-id").value = l ? l.id : "";
  $("link-modal-titulo").textContent = l ? "Editar link" : "Novo link";
  $("link-titulo").value = l ? l.titulo : "";
  $("link-url").value = l ? l.url : "";
  $("link-descricao").value = l ? l.descricao : "";
  $("link-categoria").value = l ? l.categoria : "";
  $("link-ordem").value = l ? l.ordem : 0;
  $("btn-excluir-link").hidden = !l;
  $("lista-categorias-link").innerHTML = [...new Set(links.map((x) => x.categoria))].map((c) => `<option value="${esc(c)}">`).join("");
  modal.classList.add("aberto");
  setTimeout(() => $("link-titulo").focus(), 30);
}

$("form-link").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dados = {
    titulo: $("link-titulo").value.trim(),
    url: $("link-url").value.trim(),
    descricao: $("link-descricao").value.trim(),
    categoria: $("link-categoria").value.trim() || "Outros",
    ordem: parseInt($("link-ordem").value, 10) || 0
  };
  if (!/^https?:\/\//i.test(dados.url)) { $("link-erro").textContent = "O endereço precisa começar com http:// ou https://"; return; }
  try {
    const id = $("link-id").value;
    if (id) await atualizar("links_uteis", id, dados); else await inserir("links_uteis", dados);
    modal.classList.remove("aberto");
  } catch (err) { $("link-erro").textContent = "Erro ao salvar: " + err.message; }
});

$("btn-excluir-link").addEventListener("click", async () => {
  const id = $("link-id").value;
  if (!id || !confirm("Excluir este link?")) return;
  try { await excluir("links_uteis", id); modal.classList.remove("aberto"); } catch (err) { alert("Erro ao excluir: " + err.message); }
});

function esc(t) { const d = document.createElement("div"); d.textContent = t ?? ""; return d.innerHTML.replace(/"/g, "&quot;"); }
