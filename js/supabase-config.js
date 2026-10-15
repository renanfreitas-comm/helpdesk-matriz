// ==========================================================================
// CONFIGURAÇÃO DO SUPABASE
// ==========================================================================
// Troque os dois valores abaixo pelos do SEU projeto Supabase.
// Onde encontrar: Supabase > Project Settings > API (ou "Data API"):
//   - Project URL          -> SUPABASE_URL
//   - anon / public key    -> SUPABASE_ANON_KEY
//
// A chave "anon" pode ficar no site: quem protege os dados são as regras
// de acesso (RLS) de supabase/schema.sql. NUNCA coloque aqui a chave
// "service_role" — ela ignora todas as regras.
// ==========================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

export const SUPABASE_URL = "https://etcxtrtfnasdsgngnwxr.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0Y3h0cnRmbmFzZHNnbmdud3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzOTIyMDAsImV4cCI6MjEwNjk2ODIwMH0.UJquMGB-ZE1iiI0mx6WAxcNrZVVxdFDWx_dIR1UNWYg";

// Se os valores acima não foram preenchidos, mostra um aviso claro na tela
// em vez de o site simplesmente "não funcionar".
export const CONFIGURADO = /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 30;
if (!CONFIGURADO) {
  const avisar = () => {
    if (document.getElementById("aviso-config")) return;
    const aviso = document.createElement("div");
    aviso.id = "aviso-config";
    aviso.className = "aviso-config";
    aviso.textContent = "Site não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY em js/supabase-config.js (veja o Passo 5 do README).";
    document.body.prepend(aviso);
  };
  if (document.body) avisar(); else document.addEventListener("DOMContentLoaded", avisar);
}

// --------------------------------------------------------------------------
// LOGIN SEPARADO POR ABA
// O login fica no sessionStorage (que é de cada aba) com um nome único por
// aba. Assim duas pessoas podem usar abas diferentes do mesmo navegador sem
// uma "espelhar" a outra, e o "Sair" de uma aba não derruba as outras.
// Recarregar a página (F5) mantém o login; fechar a aba encerra.
// --------------------------------------------------------------------------
function idDaAba() {
  try {
    let id = sessionStorage.getItem("hd-aba");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessionStorage.setItem("hd-aba", id);
    }
    return id;
  } catch (e) {
    return "padrao"; // navegação muito restrita: cai no comportamento antigo
  }
}

// "Duplicar aba" copia o sessionStorage, e a cópia passaria a dividir o
// login com a original. Cada aba segura uma trava com o seu id; se a trava
// já estiver ocupada, esta aba é uma cópia: ganha id novo e pede login.
async function idDaAbaUnico() {
  const id = idDaAba();
  if (id === "padrao" || !navigator.locks) return id;
  const segurar = (nome) => new Promise((pronto) => {
    navigator.locks.request(nome, { ifAvailable: true }, (trava) => {
      pronto(Boolean(trava));
      return trava ? new Promise(() => {}) : undefined; // mantém enquanto a aba existir
    }).catch(() => pronto(true));
  });
  if (await segurar("hd-aba-" + id)) return id;
  try {
    sessionStorage.removeItem("hd-auth-" + id);
    sessionStorage.removeItem("hd-aba");
  } catch (e) { /* ignora */ }
  const novo = idDaAba();
  segurar("hd-aba-" + novo);
  return novo;
}

function armazenamentoDaAba() {
  try {
    sessionStorage.setItem("hd-teste", "1");
    sessionStorage.removeItem("hd-teste");
    return window.sessionStorage;
  } catch (e) {
    return undefined; // usa o padrão do Supabase
  }
}

// Remove o login antigo, que ficava compartilhado entre todas as abas.
try {
  Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k));
} catch (e) { /* ignora */ }

export const supabase = createClient(
  CONFIGURADO ? SUPABASE_URL : "https://nao-configurado.supabase.co",
  CONFIGURADO ? SUPABASE_ANON_KEY : "nao-configurado",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: armazenamentoDaAba(),
      storageKey: "hd-auth-" + (await idDaAbaUnico())
    }
  }
);
