// Avisa por Telegram y Discord que alguien pagó un servicio: "✅ Camilo ya pagó el servicio de …".
// La llama la app al marcar un recibo como pagado. POST { billId } con `Authorization: Bearer <ID token de Firebase>`.
// El mensaje se arma con los datos de Firestore (no con lo que mande el navegador).
import { auth, db } from '../lib/admin.mjs';
import { send } from '../lib/notify.mjs';

const USER_DOMAIN = process.env.VITE_USER_DOMAIN || 'mihogar.test';
const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
const wait = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  let user;
  try { user = await auth().verifyIdToken(token); }
  catch { return res.status(401).json({ error: 'No autorizado' }); }
  if (!String(user.email || '').endsWith('@' + USER_DOMAIN)) return res.status(403).json({ error: 'Cuenta no permitida' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: 'JSON inválido' }); }
  if (!body.billId) return res.status(400).json({ error: 'Falta billId' });

  try {
    const col = db().collection('homes/main/data');
    // La app guarda el "pagado" justo antes de llamar; si aún no llegó a Firestore, se reintenta un momento.
    let bill, service;
    for (let i = 0; i < 4; i++) {
      const [b, s] = await Promise.all([col.doc('bills').get(), col.doc('services').get()]);
      bill = (b.data()?.items || []).find(x => x.id === body.billId);
      service = bill && (s.data()?.items || []).find(x => x.id === bill.serviceId);
      if (bill?.paid) break;
      await wait(1500);
    }
    if (!bill || !service) return res.status(404).json({ error: 'Recibo no encontrado' });
    if (!bill.paid) return res.status(409).json({ error: 'El recibo no está marcado como pagado' });

    const who = user.email.split('@')[0].replace(/^./, c => c.toUpperCase());
    const text = [
      `✅ ${who} ya pagó el servicio de ${service.icon || '📌'} ${service.name} (${monthName(bill.month)}): ${money(bill.amount)}`,
      'El comprobante quedó guardado en MiHogar.',
    ].join('\n');
    const r = await send(text);
    res.status(200).json({ avisado: r.sent.length > 0, enviado: r.sent, errores: r.errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
