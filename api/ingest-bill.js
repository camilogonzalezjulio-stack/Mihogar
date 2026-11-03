// Recibe una factura leída de un correo (scripts/gmail-a-mihogar.gs) y la registra en Servicios.
// POST JSON { provider: 'aire'|'gases'|'triplea'|'claro', amount, month: 'YYYY-MM', due?: 'YYYY-MM-DD', messageId? }
// Autorización: ver lib/script-auth.mjs (token de Google del Apps Script, sin claves).
import { randomBytes } from 'node:crypto';
import { db } from '../lib/admin.mjs';
import { PROVIDERS, applyBill } from '../lib/bills.mjs';
import { send } from '../lib/notify.mjs';
import { rejection } from '../lib/script-auth.mjs';

const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };

export function arrivalMessage({ action, service, bill }, p) {
  return [
    `📩 ${action === 'actualizado' ? 'Se actualizó la factura' : 'Llegó la factura'} de ${PROVIDERS[p.provider].label}`,
    `${service.icon || '📌'} ${service.name} (${monthName(bill.month)}): ${money(bill.amount)}`,
    bill.due ? `📅 Fecha límite: ${bill.due}` : '',
    'Quedó como pendiente en MiHogar. Para marcarla como pagada sube el comprobante.',
    process.env.APP_URL || '',
  ].filter(Boolean).join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  const motivo = await rejection(req);
  if (motivo) return res.status(401).json({ error: 'No autorizado', motivo });

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
    // Aviso inmediato solo cuando la factura es nueva o cambió el valor (no en duplicados ni recibos ya pagados).
    let avisado = false;
    if (r.changed) {
      try { avisado = (await send(arrivalMessage(r, p))).sent.length > 0; }
      catch (e) { console.error('Aviso de factura:', e.message); }
    }
    res.status(r.action === 'sin-servicio' ? 422 : 200)
      .json({ accion: r.action, servicio: r.service?.name || null, valor: r.bill?.amount ?? null, mes: p.month, avisado });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
