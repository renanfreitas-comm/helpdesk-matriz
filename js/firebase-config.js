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
  apiKey: "AIzaSyCHH5J6doAU8TAUbCT1znOoOZM73ppvjis",
  authDomain: "helpdesk-matriz-58813.firebaseapp.com",
  projectId: "helpdesk-matriz-58813",
  storageBucket: "helpdesk-matriz-58813.firebasestorage.app",
  messagingSenderId: "678044841159",
  appId: "1:678044841159:web:c9872965d4a08ee2dfbae2"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Exportado para uso em auth.js: criar um usuário novo precisa de uma
// instância secundária do Firebase (veja criarUsuarioComoAdmin em auth.js),
// para não derrubar a sessão do admin que está cadastrando.
export { firebaseConfig };
