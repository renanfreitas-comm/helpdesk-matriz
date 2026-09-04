// ==========================================================================
// CONFIGURAÇÃO DO FIREBASE
// ==========================================================================
// Troque os valores abaixo pelas credenciais do SEU projeto Firebase.
// Onde encontrar: Console do Firebase > Configurações do projeto >
// "Seus aplicativos" > ícone Web (</>) > "Config".
//
// Veja o passo a passo completo no README.md deste projeto.
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "COLE_AQUI_SEU_PROJETO.firebaseapp.com",
  projectId: "COLE_AQUI_SEU_PROJECT_ID",
  storageBucket: "COLE_AQUI_SEU_PROJETO.appspot.com",
  messagingSenderId: "COLE_AQUI_SEU_SENDER_ID",
  appId: "COLE_AQUI_SEU_APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Exportado para uso em auth.js: criar um usuário novo precisa de uma
// instância secundária do Firebase (veja criarUsuarioComoAdmin em auth.js),
// para não derrubar a sessão do admin que está cadastrando.
export { firebaseConfig };
