// ==========================================================================
// AUTENTICAÇÃO E PERFIL DO USUÁRIO
// ==========================================================================
import { auth, db, firebaseConfig } from "./firebase-config.js";
import {
  initializeApp,
  deleteApp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  getAuth
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/**
 * Não existe mais cadastro público: só um admin logado pode criar novos
 * usuários (veja a tela Usuários). Para isso, esta função abre uma
 * instância SECUNDÁRIA e temporária do Firebase só para criar a conta no
 * Auth — assim a sessão do admin no navegador não é substituída pela do
 * usuário recém-criado (o Firebase, por padrão, loga automaticamente
 * quem acabou de ser criado na instância usada).
 */
export async function criarUsuarioComoAdmin(nome, email, senha, papel) {
  const appTemp = initializeApp(firebaseConfig, "app-temp-criacao-" + Date.now());
  const authTemp = getAuth(appTemp);

  try {
    const credencial = await createUserWithEmailAndPassword(authTemp, email, senha);
    const uid = credencial.user.uid;

    // Encerra a sessão na instância temporária (a sessão do admin, na
    // instância principal, nunca foi afetada).
    await signOut(authTemp);

    // Cria o perfil já autenticado como o admin (instância principal).
    await setDoc(doc(db, "usuarios", uid), {
      nome: nome.trim(),
      email: email.trim().toLowerCase(),
      papel,
      criadoEm: serverTimestamp()
    });

    return { uid };
  } finally {
    await deleteApp(appTemp);
  }
}

/** Envia um e-mail de redefinição de senha. */
export function redefinirSenha(email) {
  return sendPasswordResetEmail(auth, email);
}

/** Efetua login com e-mail e senha. */
export function entrar(email, senha) {
  return signInWithEmailAndPassword(auth, email, senha);
}

/** Encerra a sessão do usuário atual. */
export function sair() {
  return signOut(auth);
}

/** Busca o documento de perfil (nome/papel) de um usuário pelo UID. */
export async function obterPerfil(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Protege uma página: só libera o conteúdo se houver um usuário logado
 * E com perfil cadastrado no Firestore. Caso contrário, redireciona
 * para a tela de login (index.html).
 *
 * @param {(user: import("firebase/auth").User, perfil: object) => void} callback
 * @param {{ apenasAdmin?: boolean }} opcoes
 */
export function protegerPagina(callback, opcoes = {}) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    const perfil = await obterPerfil(user.uid);
    if (!perfil) {
      // Usuário existe no Auth mas não tem perfil no Firestore (caso raro).
      alert("Não foi possível carregar seu perfil. Faça login novamente.");
      await sair();
      window.location.href = "index.html";
      return;
    }

    if (opcoes.apenasAdmin && perfil.papel !== "admin") {
      alert("Apenas o supervisor/admin pode acessar esta página.");
      window.location.href = "dashboard.html";
      return;
    }

    callback(user, perfil);
  });
}
