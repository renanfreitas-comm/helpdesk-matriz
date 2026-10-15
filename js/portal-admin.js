// ==========================================================================
// PORTAL DO COLABORADOR — configuração (tela Usuários, só admin)
// ==========================================================================
// Mostra o link com o código, o QR code (gerado aqui mesmo, sem serviço
// externo), liga/desliga o portal, ajusta o limite por hora e gera um código
// novo quando o link vazar.
// ==========================================================================
import { supabase, observar } from "./db.js";

let config = null;
const $ = (id) => document.getElementById(id);

export function iniciarPortalAdmin() {
  observar("portal_config", (q) => q.eq("id", 1), (linhas) => {
    config = linhas[0] || null;
    desenhar();
  }, (err) => {
    $("portal-admin").innerHTML = `<h2>Portal do colaborador</h2><p class="texto-suave">Para ligar o portal, rode o supabase/schema.sql atualizado no Supabase. (${esc(err.message)})</p>`;
  });

  $("portal-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link()); aviso("Link copiado."); }
    catch (e) { $("portal-link").select(); document.execCommand("copy"); aviso("Link copiado."); }
  });
  $("portal-abrir").addEventListener("click", () => window.open(link(), "_blank", "noopener"));
  $("portal-baixar-qr").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = qrDataURL(12);
    a.download = "qr-portal-chamados.png";
    a.click();
  });
  $("portal-imprimir").addEventListener("click", imprimirCartaz);
  $("portal-ativo").addEventListener("change", (e) => salvar({ ativo: e.target.checked }));
  $("portal-limite").addEventListener("change", (e) => {
    const n = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 30));
    salvar({ limite_por_hora: n });
  });
  $("portal-nova-chave").addEventListener("click", async () => {
    if (!confirm("Gerar um link novo?\n\nO link e o QR code atuais param de funcionar na hora. Use quando o link vazar para fora da empresa.")) return;
    const { error } = await supabase.rpc("portal_nova_chave");
    if (error) { alert("Não foi possível: " + error.message); return; }
    window.dispatchEvent(new CustomEvent("db-alterado", { detail: "portal_config" }));
    aviso("Link novo gerado. Troque os QR codes impressos.");
  });
}

function link() {
  if (!config) return "";
  return new URL(`portal.html?k=${encodeURIComponent(config.chave)}`, window.location.href).href;
}

function qrDataURL(tamanhoCelula) {
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, "M");
  qr.addData(link());
  qr.make();
  return qr.createDataURL(tamanhoCelula, tamanhoCelula * 2);
}

function desenhar() {
  if (!config) return;
  $("portal-link").value = link();
  $("portal-ativo").checked = config.ativo;
  $("portal-limite").value = config.limitePorHora;
  $("portal-admin").classList.toggle("desligado", !config.ativo);
  try {
    $("portal-qr").innerHTML = `<img src="${qrDataURL(5)}" alt="QR code do portal de chamados" width="180" height="180" />`;
  } catch (e) {
    $("portal-qr").innerHTML = `<p class="texto-suave">QR code indisponível.</p>`;
  }
}

async function salvar(campos) {
  const { data, error } = await supabase.from("portal_config").update(campos).eq("id", 1).select();
  if (error || !data || !data.length) { alert("Não foi possível salvar: " + (error ? error.message : "sem permissão")); desenhar(); return; }
  window.dispatchEvent(new CustomEvent("db-alterado", { detail: "portal_config" }));
  aviso(campos.ativo === false ? "Portal desligado: o link mostra um aviso e não aceita chamados." : "Salvo.");
}

function imprimirCartaz() {
  const janela = window.open("", "_blank");
  if (!janela) { alert("Permita pop-ups para imprimir o cartaz."); return; }
  janela.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Cartaz — Chamados TI</title>
    <style>body{font-family:"Segoe UI",Roboto,Arial,sans-serif;text-align:center;padding:40px;color:#111}
    h1{font-size:40px;margin:0 0 8px}p{font-size:20px;margin:0 0 28px;color:#444}
    img{width:340px;height:340px;border:12px solid #F8B408;border-radius:16px}
    .passos{font-size:18px;margin-top:28px;line-height:1.7}.logo{height:40px;margin-bottom:24px}</style></head>
    <body><img class="logo" src="${new URL("assets/logo-comm.png", window.location.href).href}" alt="Comm" style="border:0;width:auto;height:40px">
    <h1>Problema com o computador?</h1><p>Abra um chamado para a TI pelo celular. Não precisa de senha.</p>
    <img src="${qrDataURL(10)}" alt="QR code">
    <div class="passos">1. Aponte a câmera do celular para o código<br>2. Conte o que está acontecendo<br>3. Acompanhe pelo número que aparecer</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  janela.document.close();
}

function aviso(texto) { $("portal-msg").textContent = texto; setTimeout(() => { if ($("portal-msg").textContent === texto) $("portal-msg").textContent = ""; }, 6000); }
function esc(t) { const d = document.createElement("div"); d.textContent = t ?? ""; return d.innerHTML; }
