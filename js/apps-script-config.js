// ==========================================================================
// CONFIGURAÇÃO DO GOOGLE APPS SCRIPT
// ==========================================================================
// Este projeto usa um Google Apps Script gratuito (sem plano pago, sem
// cartão de crédito) como um "backend" simples para duas coisas do módulo
// de Visitas Técnicas:
//   1) Guardar o laudo (PDF/DOCX) de uma visita no Google Drive.
//   2) Enviar de verdade (automaticamente) os e-mails de aviso.
//
// Veja o passo a passo completo no Passo 4 do README.md — em resumo:
//   1. Publique o código de apps-script/Codigo.gs como um "App da Web" no
//      https://script.google.com (Executar como: Eu | Acesso: Qualquer pessoa).
//   2. Cole abaixo a URL do App da Web que o Google gerar.
//   3. Cole abaixo o MESMO texto que você colocou em TOKEN_SECRETO lá no
//      Codigo.gs (é uma senha só sua, para ninguém além do site conseguir
//      usar seu Apps Script).
// ==========================================================================

export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz0LQbigfHdhojJa9Jn8STKq36W2xJ2L3thO1PKHKXaJb_5abO3snFLqQNvywxuHgvcOA/exec";
export const APPS_SCRIPT_TOKEN = "CommcenterInfra2026";
