// ==========================================================================
// AUTENTICAÇÃO E PERFIL DO USUÁRIO
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/**
 * Cria uma nova conta de usuário no Firebase Auth e o respectivo
 * documento de perfil na coleção "usuarios".
 * O PRIMEIRO usuário a se cadastrar no sistema vira automaticamente "admin".
 * Os demais entram como "tecnico" (um admin pode promovê-los depois).
 */
export async function cadastrarUsuario(nome, email, senha) {
  const credencial = await createUserWithEmailAndPassword(auth, email, senha);
  const uid = credencial.user.uid;

  // Verifica se já existe algum usuário cadastrado no sistema.
  const usuariosSnapshot = await getDocs(collection(db, "usuarios"));
  const papel = usuariosSnapshot.empty ? "admin" : "tecnico";

  await setDoc(doc(db, "usuarios", uid), {
    nome: nome.trim(),
    email: email.trim().toLowerCase(),
    papel,
    criadoEm: serverTimestamp()
  });

  return { uid, papel };
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
