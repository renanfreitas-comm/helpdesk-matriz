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

export const supabase = createClient(
  CONFIGURADO ? SUPABASE_URL : "https://nao-configurado.supabase.co",
  CONFIGURADO ? SUPABASE_ANON_KEY : "nao-configurado",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);
