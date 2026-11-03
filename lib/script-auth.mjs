// Autorización de las llamadas del Apps Script de Gmail (api/ingest-bill.js, api/pdf-text.js).
// `Authorization: Bearer <X>`, donde X es INGEST_SECRET (o CRON_SECRET) o un token OAuth de una cuenta de Google
// permitida. (Un encabezado propio como X-Google-Token no llega: algo en el camino lo quita.)
import { createHash } from 'node:crypto';

// SHA-256 de los correos de Google que pueden registrar facturas (en hash para no publicar el correo en el repo).
// Se puede reemplazar con la variable INGEST_GOOGLE_EMAILS="correo1,correo2".
const ALLOWED_EMAIL_HASHES = ['884cad76e80a884bcd73663146fe94996e3836d6fbbc9cebfc59519b3e34d3f8'];
const sha = s => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

// Devuelve null si está autorizado, o el motivo del rechazo (sin datos sensibles).
export async function rejection(req) {
  const secret = process.env.INGEST_SECRET || process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (secret && auth === `Bearer ${secret}`) return null;
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return 'falta Authorization: Bearer';
  const r = await googleEmail(token);
  if (r.error) return r.error;
  const allowed = process.env.INGEST_GOOGLE_EMAILS
    ? process.env.INGEST_GOOGLE_EMAILS.split(',').map(sha)
    : ALLOWED_EMAIL_HASHES;
  return allowed.includes(sha(r.email)) ? null : 'cuenta de Google no permitida';
}

// Correo dueño del token. El token del Apps Script no siempre trae el correo (solo si el permiso de correo
// está declarado), así que si falta se pregunta a Gmail, que el script sí tiene permitido.
async function googleEmail(token) {
  const info = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!info.ok) return { error: `tokeninfo respondió ${info.status}` };
  const i = await info.json();
  if (i.email && String(i.email_verified) === 'true') return { email: i.email };
  const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
  if (!p.ok) return { error: `el token no trae correo y Gmail respondió ${p.status}` };
  const email = (await p.json()).emailAddress;
  return email ? { email } : { error: 'Gmail no devolvió el correo' };
}
