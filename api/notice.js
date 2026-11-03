// Avisos por Telegram y Discord que dispara la app. POST con `Authorization: Bearer <ID token de Firebase>`:
//   { type: 'paid', billId }    → "✅ Camilo ya pagó el servicio de 🌐 Internet (octubre de 2026): $ 44.950"
//   { type: 'missing', itemId } → "🛒 Sofia agregó que falta: Arroz ×2 (🍽️ Comida)"
//   { type: 'purchase', items: [{ name, qty }] } → "🛍️ Camilo hizo la compra (3 productos): …"
// El mensaje se arma con los datos de Firestore (no con lo que mande el navegador).
import { auth, db } from '../lib/admin.mjs';
import { send } from '../lib/notify.mjs';

const USER_DOMAIN = process.env.VITE_USER_DOMAIN || 'mihogar.test';
const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// La app guarda el cambio justo antes de llamar; si aún no llegó a Firestore, se reintenta un momento.
async function readUntil(docs, ok) {
  const col = db().collection('homes/main/data');
  let data;
  for (let i = 0; i < 4; i++) {
    const snaps = await Promise.all(docs.map(d => col.doc(d).get()));
    data = Object.fromEntries(docs.map((d, k) => [d, snaps[k].data()?.items || []]));
    if (ok(data)) return data;
    await wait(1500);
  }
  return data;
}

async function paidMessage(who, billId) {
  const d = await readUntil(['bills', 'services'], x => x.bills.find(b => b.id === billId)?.paid);
  const bill = d.bills.find(b => b.id === billId), service = bill && d.services.find(s => s.id === bill.serviceId);
  if (!bill || !service) return [404, 'Recibo no encontrado'];
  if (!bill.paid) return [409, 'El recibo no está marcado como pagado'];
  return [200, [`✅ ${who} ya pagó el servicio de ${service.icon || '📌'} ${service.name} (${monthName(bill.month)}): ${money(bill.amount)}`,
    'El comprobante quedó guardado en MiHogar.'].join('\n')];
}

async function missingMessage(who, itemId) {
  const d = await readUntil(['shopping', 'shopcats'], x => x.shopping.some(i => i.id === itemId && !i.done));
  const item = d.shopping.find(i => i.id === itemId);
  if (!item) return [404, 'Producto no encontrado'];
  if (item.done) return [409, 'El producto no está marcado como faltante'];
  const cat = d.shopcats.find(c => c.id === item.category);
  const pending = d.shopping.filter(i => !i.done).length;
  return [200, [`🛒 ${who} agregó que falta: ${item.name}${Number(item.qty) > 1 ? ` ×${item.qty}` : ''}${cat ? ` (${cat.icon || ''} ${cat.name})` : ''}`,
    `En total faltan ${pending} ${pending === 1 ? 'producto' : 'productos'} en la casa.`].join('\n')];
}

// Los productos comprados ya se borraron de Compras, así que la lista viene de la app (solo nombres y cantidades).
async function purchaseMessage(who, items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 80)
    .map(i => ({ name: String(i?.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60), qty: Math.max(1, Math.min(999, Number(i?.qty) || 1)) }))
    .filter(i => i.name);
  if (!list.length) return [400, 'Compra sin productos'];
  const d = await readUntil(['shopping'], () => true);
  const left = d.shopping.filter(i => !i.done).length;
  return [200, [`🛍️ ${who} hizo la compra (${list.length} ${list.length === 1 ? 'producto' : 'productos'}):`,
    ...list.map(i => `• ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`),
    left ? `Todavía faltan ${left} ${left === 1 ? 'producto' : 'productos'} en la casa.` : 'Ya no falta nada en la casa. 🎉'].join('\n')];
}

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

  try {
    const who = user.email.split('@')[0].replace(/^./, c => c.toUpperCase());
    const [code, text] = body.type === 'paid' && body.billId ? await paidMessage(who, body.billId)
      : body.type === 'missing' && body.itemId ? await missingMessage(who, body.itemId)
        : body.type === 'purchase' ? await purchaseMessage(who, body.items)
          : [400, 'Tipo de aviso inválido'];
    if (code !== 200) return res.status(code).json({ error: text });
    const r = await send(text);
    res.status(200).json({ avisado: r.sent.length > 0, enviado: r.sent, errores: r.errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
