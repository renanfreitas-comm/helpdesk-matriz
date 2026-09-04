// ==========================================================================
// LÓGICA DO DASHBOARD (indicadores)
// ==========================================================================
import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth.js";
import { montarNav } from "./nav.js";
import {
  collection,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const ROTULOS_PRIORIDADE = { baixa: "Baixa", media: "Média", alta: "Alta" };

protegerPagina(async (user, perfil) => {
  montarNav(perfil);

  const usuariosSnap = await getDocs(collection(db, "usuarios"));
  const usuarios = usuariosSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  onSnapshot(collection(db, "chamados"), (snap) => {
    const chamados = snap.docs.map((d) => d.data());
    atualizarCards(chamados);
    atualizarBarras("barras-prioridade", contarPor(chamados, "prioridade", ["alta", "media", "baixa"]), ROTULOS_PRIORIDADE);
    atualizarBarrasPorTecnico(chamados, usuarios);
  });
});

function atualizarCards(chamados) {
  document.getElementById("card-total").textContent = chamados.length;
  document.getElementById("card-aberto").textContent = chamados.filter((c) => c.status === "aberto").length;
  document.getElementById("card-andamento").textContent = chamados.filter((c) => c.status === "andamento").length;
  document.getElementById("card-resolvido").textContent = chamados.filter((c) => c.status === "resolvido").length;
}

function contarPor(chamados, campo, ordemChaves) {
  const contagem = {};
  ordemChaves.forEach((k) => contagem[k] = 0);
  chamados.forEach((c) => {
    const chave = c[campo];
    if (chave in contagem) contagem[chave]++;
  });
  return contagem;
}

function atualizarBarras(containerId, contagem, rotulos) {
  const total = Object.values(contagem).reduce((a, b) => a + b, 0) || 1;
  const container = document.getElementById(containerId);

  if (Object.values(contagem).every((v) => v === 0)) {
    container.innerHTML = '<p class="texto-suave">Nenhum chamado cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = Object.entries(contagem).map(([chave, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="barra-linha">
        <span>${rotulos[chave] || chave}</span>
        <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <span>${valor}</span>
      </div>`;
  }).join("");
}

function atualizarBarrasPorTecnico(chamados, usuarios) {
  const contagem = {};
  usuarios.forEach((u) => contagem[u.uid] = 0);
  let semResponsavel = 0;

  chamados.forEach((c) => {
    if (c.responsavelUid && c.responsavelUid in contagem) {
      contagem[c.responsavelUid]++;
    } else {
      semResponsavel++;
    }
  });

  const rotulos = {};
  usuarios.forEach((u) => rotulos[u.uid] = u.nome);

  const container = document.getElementById("barras-tecnico");
  const total = chamados.length || 1;
  const entradas = Object.entries(contagem).concat(semResponsavel > 0 ? [["_sem", semResponsavel]] : []);
  rotulos["_sem"] = "Não atribuído";

  if (chamados.length === 0) {
    container.innerHTML = '<p class="texto-suave">Nenhum chamado cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = entradas.map(([uid, valor]) => {
    const pct = Math.round((valor / total) * 100);
    return `
      <div class="barra-linha">
        <span>${rotulos[uid] || "—"}</span>
        <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%"></div></div>
        <span>${valor}</span>
      </div>`;
  }).join("");
}
