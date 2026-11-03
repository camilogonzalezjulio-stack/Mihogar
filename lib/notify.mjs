// Envío de mensajes a Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) y Discord (DISCORD_WEBHOOK_URL).
const env = process.env;

async function post(name, url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  console.log(`Enviado a ${name}`);
  return name;
}

// Devuelve { sent, errors }; lanza error si no hay ningún canal configurado.
export async function send(text) {
  const jobs = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
    jobs.push(post('Telegram', `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: env.TELEGRAM_CHAT_ID, text }));
  if (env.DISCORD_WEBHOOK_URL)
    jobs.push(post('Discord', env.DISCORD_WEBHOOK_URL, { content: text }));
  if (!jobs.length) throw new Error('No hay Telegram ni Discord configurados');

  const results = await Promise.allSettled(jobs);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  errors.forEach(e => console.error(e));
  return { sent: results.filter(r => r.status === 'fulfilled').map(r => r.value), errors };
}
