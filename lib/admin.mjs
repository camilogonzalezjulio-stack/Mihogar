// Acceso a Firestore con la cuenta de servicio (salta las reglas). Solo para código de servidor
// (funciones de Vercel y scripts), nunca para la página.
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export function db() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
  // En Vercel la misma instancia atiende varias ejecuciones: inicializar solo una vez.
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return getFirestore();
}
