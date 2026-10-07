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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
