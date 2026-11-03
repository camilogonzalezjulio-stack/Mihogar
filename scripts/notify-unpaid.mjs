// Avisa por Telegram y Discord qué servicios no se han pagado.
// Lo ejecuta Vercel Cron (api/notify-unpaid.js, horarios en vercel.json) todos los días a las 9 am, 4 pm y 9 pm
// hora Colombia; también se puede correr a mano con `npm run notify`. Aquí se decide qué avisar:
//   - Desde el día 25: recibos del mes actual sin pagar (y servicios sin recibo registrado).
//   - Del 1 al 3: recibos del mes anterior sin pagar ("vencen el 3").
//   - Después del 3: cada recibo de un mes anterior sin pagar sale con sus días de mora, hasta que se pague.
//
// Variables de entorno:
//   FIREBASE_SERVICE_ACCOUNT  JSON de la cuenta de servicio (lee Firestore saltándose las reglas)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   opcionales: si faltan, no se envía a Telegram
//   DISCORD_WEBHOOK_URL                    opcional: si falta, no se envía a Discord
//   APP_URL                                opcional: enlace a la app al final del mensaje
//   NOTIFY_FROM_DAY (25), NOTIFY_GRACE_DAY (3), NOTIFY_TZ (America/Bogota)
//   NOTIFY_INCLUDE_UNREGISTERED (1)        avisar también de servicios sin recibo registrado en el mes
//   NOTIFY_FORCE=1      incluir el mes actual aunque no sea día 25+ (para probar)
//   NOTIFY_DRY_RUN=1    solo imprimir el mensaje, no enviarlo
//   NOTIFY_DATA_FILE    leer un respaldo JSON de la app en vez de Firestore (para probar)
//   NOTIFY_TODAY        fecha YYYY-MM-DD a usar como "hoy" (para probar)
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { send } from '../lib/notify.mjs';

const env = process.env;
const TZ = env.NOTIFY_TZ || 'America/Bogota';
const FROM_DAY = Number(env.NOTIFY_FROM_DAY || 25);
const GRACE_DAY = Number(env.NOTIFY_GRACE_DAY || 3);
const INCLUDE_UNREGISTERED = env.NOTIFY_INCLUDE_UNREGISTERED !== '0';

function today() {
  if (env.NOTIFY_TODAY) { const [y, m, d] = env.NOTIFY_TODAY.split('-').map(Number); return { y, m, d }; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

async function loadHome() {
  if (env.NOTIFY_DATA_FILE) return JSON.parse(await readFile(env.NOTIFY_DATA_FILE, 'utf8'));
  const { db } = await import('../lib/admin.mjs');
  const snap = await db().collection('homes/main/data').get();
  const home = {};
  snap.forEach(d => { home[d.id] = d.data().items; });
  return home;
}

const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const ymKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const dayNum = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000; // Date.UTC acepta mes 13 => enero siguiente
const monthName = (y, m, year = false) =>
  new Date(y, m - 1, 1).toLocaleDateString('es-CO', year ? { month: 'long', year: 'numeric' } : { month: 'long' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function buildMessage({ services = [], bills = [] }, now) {
  const cur = ymKey(now.y, now.m), todayN = dayNum(now.y, now.m, now.d);
  const byId = Object.fromEntries(services.map(s => [s.id, s]));
  const label = s => `${s.icon || '📌'} ${s.name}`;

  // Recibos sin pagar de meses anteriores, agrupados por servicio y mes.
  const past = new Map();
  for (const b of bills) {
    if (b.paid || b.month >= cur || !byId[b.serviceId]) continue;
    const k = b.serviceId + '|' + b.month;
    const g = past.get(k) || { s: byId[b.serviceId], month: b.month, total: 0 };
    g.total += Number(b.amount || 0);
    past.set(k, g);
  }
  const overdue = [], grace = [];
  for (const g of past.values()) {
    const [y, m] = g.month.split('-').map(Number);
    g.late = todayN - dayNum(y, m + 1, GRACE_DAY);
    g.monthLabel = monthName(y, m, y !== now.y);
    (g.late > 0 ? overdue : grace).push(g);
  }
  overdue.sort((a, b) => b.late - a.late);

  // Mes actual, desde el día 25.
  const current = [];
  if (now.d >= FROM_DAY || env.NOTIFY_FORCE === '1') {
    for (const s of services) {
      const mine = bills.filter(b => b.serviceId === s.id && b.month === cur);
      if (!mine.length) {
        // Valor fijo (p. ej. Administración): se avisa con su valor aunque nadie haya abierto la app este mes.
        if (s.fixed > 0) current.push(`• ${label(s)}: ${money(s.fixed)}`);
        else if (INCLUDE_UNREGISTERED) current.push(`• ${label(s)}: sin registrar el recibo`);
        continue;
      }
      const unpaid = mine.filter(b => !b.paid);
      if (!unpaid.length) continue;
      const due = unpaid.map(b => b.due).filter(Boolean).sort()[0];
      current.push(`• ${label(s)}: ${money(unpaid.reduce((t, b) => t + Number(b.amount || 0), 0))}${due ? ` (vence ${due})` : ''}`);
    }
  }

  const out = [];
  if (overdue.length) {
    out.push(`🚨 ${plural(overdue.length, 'servicio en mora', 'servicios en mora')}`);
    overdue.forEach(g => out.push(`• ${label(g.s)} (${g.monthLabel}): ${money(g.total)} — ${plural(g.late, 'día', 'días')} de mora`));
  }
  if (grace.length) {
    if (out.length) out.push('');
    out.push(`⏳ ${grace.length === 1 ? 'Vence' : 'Vencen'} el ${GRACE_DAY} de ${monthName(now.y, now.m)}:`);
    grace.forEach(g => out.push(`• ${label(g.s)} (${g.monthLabel}): ${money(g.total)}`));
  }
  if (current.length) {
    if (out.length) out.push('');
    out.push(current.length === 1
      ? `⚠️ 1 servicio de ${monthName(now.y, now.m, true)} no se ha pagado`
      : `⚠️ ${current.length} servicios de ${monthName(now.y, now.m, true)} no se han pagado`);
    out.push(...current);
    const left = new Date(now.y, now.m, 0).getDate() - now.d;
    out.push('', left === 0 ? '⏰ ¡Hoy es el último día del mes!' : `⏰ Quedan ${plural(left, 'día', 'días')} para terminar el mes.`);
  }
  if (!out.length) return null;
  if (env.APP_URL) out.push('', env.APP_URL);
  return out.join('\n');
}

// Arma el mensaje y lo envía. Devuelve { text, sent, errors }; lanza error si no hay canales configurados.
export async function run() {
  const text = buildMessage(await loadHome(), today());
  if (!text) { console.log('Nada que avisar hoy. 🎉'); return { text: null, sent: [], errors: [] }; }
  console.log(text);
  if (env.NOTIFY_DRY_RUN === '1') return { text, sent: [], errors: [] };
  return { text, ...(await send(text)) };
}

// Ejecutado desde la terminal (npm run notify), no importado por la función de Vercel.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(r => { if (r.errors.length) process.exit(1); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
