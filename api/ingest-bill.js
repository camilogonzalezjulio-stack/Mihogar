// Recibe una factura leída de un correo (scripts/gmail-a-mihogar.gs) y la registra en Servicios.
// POST JSON { provider: 'aire'|'gases'|'triplea'|'claro', amount, month: 'YYYY-MM', due?: 'YYYY-MM-DD', messageId? }
// Requiere `Authorization: Bearer <INGEST_SECRET>` (si no existe esa variable, se usa CRON_SECRET).
import { randomBytes } from 'node:crypto';
import { db } from '../lib/admin.mjs';
import { PROVIDERS, applyBill } from '../lib/bills.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  const secret = process.env.INGEST_SECRET || process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'No autorizado' });

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
