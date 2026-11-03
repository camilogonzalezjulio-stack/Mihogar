// Función de Vercel que corre Vercel Cron (horarios en vercel.json).
// Vercel manda `Authorization: Bearer <CRON_SECRET>` en cada ejecución programada; sin ese secreto
// nadie de afuera puede disparar los avisos.
import { run } from '../scripts/notify-unpaid.mjs';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const r = await run();
    res.status(r.errors.length ? 502 : 200).json({ avisado: Boolean(r.text), enviado: r.sent, errores: r.errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
