// Recordatorios del calendario compartido: 1 día, 2 horas y 1 hora antes de cada evento.
// Las horas de los eventos son de Colombia (UTC-5, sin horario de verano). Sin hora = 8:00 a. m.
export const OFFSETS = [
  { key: '1d', min: 24 * 60, label: 'mañana' },
  { key: '2h', min: 120, label: 'en 2 horas' },
  { key: '1h', min: 60, label: 'en 1 hora' },
];

export function startMs({ date, time }) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '08:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, h + 5, mi);
}

// Qué avisar ahora. Si varios avisos ya tocan (p. ej. el evento se creó 90 min antes), se manda solo el más
// cercano y los anteriores se dan por enviados, para no mandar tres mensajes juntos.
// Devuelve { events (con `sent` actualizado), due: [{ event, offset }] } sin modificar la entrada.
export function dueReminders(events, now) {
  const due = [];
  const out = events.map(e => {
    if (!e.date) return e;
    const left = (startMs(e) - now) / 60000;
    if (left <= 0) return e;
    const sent = e.sent || [];
    const pending = OFFSETS.filter(o => left <= o.min && !sent.includes(o.key));
    if (!pending.length) return e;
    due.push({ event: e, offset: pending[pending.length - 1] });
    return { ...e, sent: [...sent, ...pending.map(o => o.key)] };
  });
  return { events: out, due };
}

const fmtTime = t => {
  if (!t) return 'todo el día';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

export function reminderMessage({ event: e, offset }) {
  const [y, m, d] = e.date.split('-').map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  return [`⏰ ${offset.key === '1d' ? 'Mañana' : offset.label === 'en 2 horas' ? 'En 2 horas' : 'En 1 hora'}: ${e.icon || '📌'} ${e.title}`,
    `📅 ${day} · ${fmtTime(e.time)}`, e.notes ? `📝 ${e.notes}` : ''].filter(Boolean).join('\n');
}
