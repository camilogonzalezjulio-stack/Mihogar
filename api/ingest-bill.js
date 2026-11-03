// Recibe una factura leída de un correo (scripts/gmail-a-mihogar.gs) y la registra en Servicios.
// POST JSON { provider: 'aire'|'gases'|'triplea'|'claro', amount, month: 'YYYY-MM', due?: 'YYYY-MM-DD', messageId? }
// Autorización, una de dos:
//  - `X-Google-Token: <token OAuth>` de una cuenta de Google permitida (así llama el Apps Script, sin claves).
//  - `Authorization: Bearer <INGEST_SECRET>` (si no existe esa variable, se usa CRON_SECRET).
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../lib/admin.mjs';
import { PROVIDERS, applyBill } from '../lib/bills.mjs';

// SHA-256 de los correos de Google que pueden registrar facturas (en hash para no publicar el correo en el repo).
// Se puede reemplazar con la variable INGEST_GOOGLE_EMAILS="correo1,correo2".
const ALLOWED_EMAIL_HASHES = ['884cad76e80a884bcd73663146fe94996e3836d6fbbc9cebfc59519b3e34d3f8'];
const sha = s => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

async function authorized(req) {
  const secret = process.env.INGEST_SECRET || process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true;
  const token = req.headers['x-google-token'];
  if (!token) { console.warn('ingest: sin X-Google-Token. Cabeceras:', Object.keys(req.headers).join(',')); return false; }
  const email = await googleEmail(token);
  if (!email) { console.warn('ingest: Google no devolvió un correo verificado para el token'); return false; }
  const allowed = process.env.INGEST_GOOGLE_EMAILS
    ? process.env.INGEST_GOOGLE_EMAILS.split(',').map(sha)
    : ALLOWED_EMAIL_HASHES;
  const ok = allowed.includes(sha(email));
  if (!ok) console.warn('ingest: cuenta no permitida (hash ' + sha(email).slice(0, 8) + ')');
  return ok;
}

// Correo dueño del token. El token del Apps Script no siempre trae el correo (solo si el permiso de correo
// está declarado), así que si falta se pregunta a Gmail, que el script sí tiene permitido.
async function googleEmail(token) {
  const info = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!info.ok) { console.warn('ingest: tokeninfo respondió', info.status); return null; }
  const i = await info.json();
  if (i.email && String(i.email_verified) === 'true') return i.email;
  const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
  if (!p.ok) return null;
  return (await p.json()).emailAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  if (!(await authorized(req))) return res.status(401).json({ error: 'No autorizado' });

  let p;
  try { p = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: 'JSON inválido' }); }
  const amount = Number(p.amount);
  if (!PROVIDERS[p.provider]) return res.status(400).json({ error: 'Empresa desconocida', validas: Object.keys(PROVIDERS) });
  if (!(amount > 0)) return res.status(400).json({ error: 'Valor inválido' });
  if (!/^\d{4}-\d{2}$/.test(p.month || '')) return res.status(400).json({ error: 'Mes inválido (YYYY-MM)' });
  if (p.due && !/^\d{4}-\d{2}-\d{2}$/.test(p.due)) return res.status(400).json({ error: 'Fecha de vencimiento inválida (YYYY-MM-DD)' });

  try {
    const fs = db(), col = fs.collection('homes/main/data');
    const r = await fs.runTransaction(async t => {
      const [s, b] = await Promise.all([t.get(col.doc('services')), t.get(col.doc('bills'))]);
      const home = { services: s.data()?.items || [], bills: b.data()?.items || [] };
      const out = applyBill(home, { ...p, amount }, randomBytes(6).toString('base64url'));
      if (out.changed) t.set(col.doc('bills'), { items: out.bills });
      return out;
    });
    res.status(r.action === 'sin-servicio' ? 422 : 200)
      .json({ accion: r.action, servicio: r.service?.name || null, valor: r.bill?.amount ?? null, mes: p.month });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
