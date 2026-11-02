// La configuración se lee del archivo .env (ver .env.example). Vite solo expone las variables VITE_*.
// Ojo: estos valores terminan en el JS publicado; no son secretos. La seguridad la dan
// Firebase Auth y las reglas de firestore.rules.
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// Dominio con el que se arman los correos de inicio de sesión (camilo -> camilo@mihogar.test).
export const USER_DOMAIN = env.VITE_USER_DOMAIN || 'mihogar.test';
