// Configuración de la app web de Firebase (proyecto mihogar-6e6c6).
// Estos valores NO son secretos: Firebase los diseña para ir en el JS publicado. Lo que protege los datos es
// el inicio de sesión y las reglas de firestore.rules. Si existe un .env con VITE_FIREBASE_*, tiene prioridad
// (útil para apuntar a otro proyecto); si no, se usan estos valores, así Vercel no necesita variables.
const env = import.meta.env;

const defaults = {
  apiKey: 'AIzaSyA83PfMwV44BaBD31qgHxtXL5Qqk1hioTo',
  authDomain: 'mihogar-6e6c6.firebaseapp.com',
  projectId: 'mihogar-6e6c6',
  storageBucket: 'mihogar-6e6c6.firebasestorage.app',
  messagingSenderId: '101748235237',
  appId: '1:101748235237:web:af48c4e3fa4c577de6ed0c',
};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || defaults.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || defaults.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || defaults.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || defaults.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaults.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || defaults.appId,
};

// Dominio con el que se arman los correos de inicio de sesión (camilo -> camilo@mihogar.test).
export const USER_DOMAIN = env.VITE_USER_DOMAIN || 'mihogar.test';
