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

export const SUPABASE_URL = "COLE_AQUI_A_PROJECT_URL";
export const SUPABASE_ANON_KEY = "COLE_AQUI_A_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
