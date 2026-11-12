// Envía por Telegram y Discord los recordatorios del calendario (1 día, 2 horas y 1 hora antes).
// La llama el script de Gmail cada 5 minutos (Vercel Cron gratis solo corre una vez al día).
// Misma autorización que el script: ver lib/script-auth.mjs. Marca en cada evento qué avisos ya se enviaron.
import { db } from '../lib/admin.mjs';
import { send } from '../lib/notify.mjs';
import { rejection } from '../lib/script-auth.mjs';
import { dueReminders, reminderMessage } from '../lib/reminders.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  const motivo = await rejection(req);
  if (motivo) return res.status(401).json({ error: 'No autorizado', motivo });

  try {
    const fs = db(), ref = fs.collection('homes/main/data').doc('events');
    const due = await fs.runTransaction(async t => {
      const r = dueReminders((await t.get(ref)).data()?.items || [], Date.now());
      if (r.due.length) t.set(ref, { items: r.events });
      return r.due;
    });
    const results = [];
    for (const d of due) results.push((await send(reminderMessage(d))).sent.length > 0);
    res.status(200).json({ enviados: due.map(d => `${d.event.title} (${d.offset.key})`), ok: results.every(Boolean) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
