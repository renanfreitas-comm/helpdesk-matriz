// ==========================================================================
// MIGRAÇÃO: FIREBASE (Firestore + Authentication) -> SUPABASE
// ==========================================================================
// Copia usuários, chamados, relatórios, máquinas (com histórico), estoque
// e visitas do Firebase para o Supabase. Veja o passo a passo no README.md
// (seção "Migrar os dados do Firebase").
//
// Uso (dentro da pasta "migracao"):
//   npm install
//   node migrar.mjs            -> mostra o que SERIA copiado (simulação)
//   node migrar.mjs --gravar   -> copia de verdade
//
// Pode rodar mais de uma vez: registros já copiados são atualizados (não
// duplicam), e contas que já existem no Supabase mantêm a senha atual.
//
// SENHAS: o Firebase não exporta senhas. Cada usuário novo recebe uma
// senha temporária, salva em "senhas-temporarias.csv" nesta pasta.
// Repasse cada uma por um canal seguro e APAGUE o arquivo depois.
// ==========================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createClient } from "@supabase/supabase-js";
import {
  converterUsuario, converterChamado, converterRelatorio, converterMaquina,
  converterHistorico, converterItemEstoque, converterVisita,
} from "./converter.mjs";

const GRAVAR = process.argv.includes("--gravar");

// ------------------------------------------------------------ configuração
// Todos os caminhos são relativos à pasta "migracao" (onde este arquivo
// está), não importa de onde o comando foi rodado.
const PASTA = dirname(fileURLToPath(import.meta.url));
const naPasta = (nome) => join(PASTA, nome);

const arquivoConfig = naPasta("config.json");
if (!existsSync(arquivoConfig)) {
  const parecidos = readdirSync(PASTA).filter((f) => /^config.*\.json/i.test(f) && f !== "config.exemplo.json");
  console.error("Faltou o arquivo config.json na pasta migracao.");
  if (parecidos.length) console.error(`Achei: ${parecidos.join(", ")} — renomeie para exatamente "config.json".`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(readFileSync(arquivoConfig, "utf8").replace(/^\uFEFF/, ""));
} catch (e) {
  console.error("O config.json tem um erro de digitação (aspa ou vírgula faltando):", e.message);
  process.exit(1);
}
for (const campo of ["supabaseUrl", "supabaseServiceRoleKey"]) {
  if (!config[campo] || String(config[campo]).startsWith("COLE_AQUI")) {
    console.error(`Preencha "${campo}" no config.json.`);
    process.exit(1);
  }
}
config.supabaseUrl = String(config.supabaseUrl).trim().replace(/\/+$/, "");

// Procura a chave do Firebase: caminho informado, mesmo nome dentro da
// pasta migracao, "chave-firebase.json", ou o arquivo baixado com o nome
// original do Firebase (...firebase-adminsdk-....json).
function acharChaveFirebase() {
  const candidatos = [];
  const informado = config.arquivoChaveFirebase ? String(config.arquivoChaveFirebase) : "";
  if (informado) {
    candidatos.push(isAbsolute(informado) ? informado : join(PASTA, informado));
    candidatos.push(naPasta(basename(informado)));
  }
  candidatos.push(naPasta("chave-firebase.json"), naPasta("chave-firebase.json.json"));
  readdirSync(PASTA).filter((f) => /firebase-adminsdk.*\.json$/i.test(f)).forEach((f) => candidatos.push(naPasta(f)));
  return candidatos.find((c) => existsSync(c));
}
const arquivoChave = acharChaveFirebase();
if (!arquivoChave) {
  console.error("Não encontrei a chave do Firebase na pasta migracao.");
  console.error('Baixe em: Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada,');
  console.error('e salve o arquivo dentro da pasta migracao com o nome "chave-firebase.json".');
  console.error("Arquivos .json que estão na pasta agora: " + (readdirSync(PASTA).filter((f) => f.endsWith(".json")).join(", ") || "nenhum"));
  process.exit(1);
}
console.log("Chave do Firebase: " + basename(arquivoChave));

initializeApp({ credential: cert(JSON.parse(readFileSync(arquivoChave, "utf8"))) });
const fs = getFirestore();
const sb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(GRAVAR
  ? "== MIGRAÇÃO (gravando no Supabase) =="
  : "== SIMULAÇÃO (nada será gravado; use --gravar para copiar de verdade) ==");

// ------------------------------------------------------------ utilitários
function senhaTemporaria() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += letras[randomInt(letras.length)];
  return s;
}

async function lerColecao(nome) {
  const snap = await fs.collection(nome).get();
  return snap.docs.map((d) => ({ id: d.id, dados: d.data(), ref: d.ref }));
}

async function gravarLote(tabela, linhas) {
  if (!GRAVAR || linhas.length === 0) return;
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    const { error } = await sb.from(tabela).upsert(lote, { onConflict: "id" });
    if (error) throw new Error(`Erro gravando em ${tabela}: ${error.message}`);
  }
}

async function contasExistentesPorEmail() {
  const mapa = new Map();
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await sb.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) throw new Error("Erro listando usuários do Supabase: " + error.message);
    data.users.forEach((u) => u.email && mapa.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) break;
  }
  return mapa;
}

// ------------------------------------------------------------ 1) usuários
const mapaUid = new Map(); // uid Firebase -> id Supabase
const senhasCsv = [["nome", "email", "senha temporaria"]];

const usuariosFb = await lerColecao("usuarios");
const existentes = await contasExistentesPorEmail();
const linhasUsuarios = [];

for (const { id: uidFb, dados } of usuariosFb) {
  const email = String(dados.email || "").trim().toLowerCase();
  if (!email) {
    console.warn(`  ! usuário ${uidFb} sem e-mail — ignorado`);
    continue;
  }

  let idNovo = existentes.get(email);
  if (!idNovo) {
    const senha = senhaTemporaria();
    if (GRAVAR) {
      const { data, error } = await sb.auth.admin.createUser({
        email, password: senha, email_confirm: true, user_metadata: { nome: dados.nome || "" },
      });
      if (error) throw new Error(`Erro criando login de ${email}: ${error.message}`);
      idNovo = data.user.id;
    } else {
      idNovo = `simulado-${uidFb}`;
    }
    senhasCsv.push([dados.nome || "", email, senha]);
  } else {
    senhasCsv.push([dados.nome || "", email, "(já existia no Supabase — senha mantida)"]);
  }

  mapaUid.set(uidFb, idNovo);
  linhasUsuarios.push(converterUsuario(idNovo, dados));
}
await gravarLote("usuarios", linhasUsuarios);
console.log(`usuarios ............ ${linhasUsuarios.length}`);

// ------------------------------------------------------------ 2) demais dados
async function migrar(colecao, tabela, converter) {
  const docs = await lerColecao(colecao);
  const linhas = docs.map(({ id, dados }) => converter(id, dados, mapaUid));
  await gravarLote(tabela, linhas);
  console.log(`${tabela.padEnd(20, ".")} ${linhas.length}`);
  return docs;
}

await migrar("chamados", "chamados", converterChamado);
await migrar("relatorios", "relatorios", converterRelatorio);
const maquinas = await migrar("maquinas", "maquinas", (id, d) => converterMaquina(id, d));

let totalHistorico = 0;
const linhasHistorico = [];
for (const m of maquinas) {
  const snap = await m.ref.collection("historico").get();
  snap.docs.forEach((h) => linhasHistorico.push(converterHistorico(h.id, m.id, h.data(), mapaUid)));
  totalHistorico += snap.size;
}
await gravarLote("maquina_historico", linhasHistorico);
console.log(`${"maquina_historico".padEnd(20, ".")} ${totalHistorico}`);

await migrar("itensEstoque", "itens_estoque", converterItemEstoque);
await migrar("visitas", "visitas", converterVisita);

// ------------------------------------------------------------ 3) senhas
if (GRAVAR) {
  const csv = senhasCsv.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  writeFileSync(naPasta("senhas-temporarias.csv"), "﻿" + csv, "utf8");
  console.log("\nSenhas temporárias salvas em migracao/senhas-temporarias.csv");
  console.log("Repasse cada uma por um canal seguro e APAGUE esse arquivo depois.");
  console.log("Laudos antigos continuam como links do Google Drive (não foram copiados).");
} else {
  console.log("\nSimulação concluída. Se os números estiverem certos, rode: node migrar.mjs --gravar");
}
process.exit(0);
