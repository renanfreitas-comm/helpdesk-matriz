// ==========================================================================
// CABEÇALHO / NAVEGAÇÃO COMUM A TODAS AS PÁGINAS INTERNAS
// ==========================================================================
import { sair } from "./auth.js";

/**
 * Preenche o cabeçalho com nome/papel do usuário logado, mostra o link
 * "Usuários" apenas para admins e liga o botão de sair.
 */
export function montarNav(perfil) {
  const nomeEl = document.getElementById("nav-nome");
  const papelEl = document.getElementById("nav-papel");
  const linkUsuarios = document.getElementById("nav-link-usuarios");
  const linkSupervisao = document.getElementById("nav-link-supervisao");
  const btnSair = document.getElementById("nav-sair");

  if (nomeEl) nomeEl.textContent = perfil.nome || "Usuário";
  if (papelEl) {
    papelEl.textContent = perfil.papel === "admin" ? "Supervisor/Admin" : "Técnico";
    papelEl.className = "badge " + (perfil.papel === "admin" ? "badge-admin" : "badge-tecnico");
  }

  if (linkUsuarios) {
    linkUsuarios.style.display = perfil.papel === "admin" ? "" : "none";
  }

  if (linkSupervisao) {
    linkSupervisao.style.display = perfil.papel === "admin" ? "" : "none";
  }

  if (btnSair) {
    btnSair.addEventListener("click", async () => {
      await sair();
      window.location.href = "index.html";
    });
  }

  // Marca o item do menu correspondente à página atual como ativo.
  const paginaAtual = window.location.pathname.split("/").pop() || "dashboard.html";
  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.getAttribute("href") === paginaAtual) {
      link.classList.add("ativo");
    }
  });
}
