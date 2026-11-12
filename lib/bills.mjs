// Registro de facturas que llegan por correo (ver api/ingest-bill.js y scripts/gmail-a-mihogar.gs).

// Empresa -> palabras con las que se reconoce su servicio en la app.
export const PROVIDERS = {
  aire: { label: 'Air-e', match: ['luz', 'energia', 'air-e', 'aire'] },
  gases: { label: 'Gases del Caribe', match: ['gas'] },
  triplea: { label: 'Triple A', match: ['agua', 'acueducto', 'triple a', 'aaa'] },
  claro: { label: 'Claro', match: ['internet', 'claro'] },
};

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function findService(services, provider) {
  const words = PROVIDERS[provider]?.match || [];
  // Primero una coincidencia exacta del nombre ("Luz"), luego que lo contenga ("Luz casa").
  return services.find(s => words.includes(norm(s.name)))
    || services.find(s => words.some(w => norm(s.name).includes(w)));
}

// Devuelve { changed, action, bills, bill, service } sin tocar `home`.
// - Si ese correo ya se registró (mismo messageId), no hace nada.
// - Si el servicio ya tiene recibo ese mes: lo actualiza si está pendiente (sin cambios si es el mismo valor,
//   p. ej. la empresa reenvió el correo); si ya está pagado no lo toca y avisa si el valor es otro (`conflict`).
// - Si no, crea el recibo como pendiente.
export function applyBill({ services = [], bills = [] }, { provider, amount, due, month, messageId }, newId) {
  const service = findService(services, provider);
  if (!service) return { changed: false, action: 'sin-servicio', bills };
  if (messageId && bills.some(b => b.source === messageId)) return { changed: false, action: 'duplicado', bills, service };

  const existing = bills.find(b => b.serviceId === service.id && b.month === month);
  if (existing?.paid) {
    return { changed: false, action: 'ya-pagado', conflict: Number(existing.amount) !== Number(amount), bills, bill: existing, service };
  }
  if (existing && Number(existing.amount) === Number(amount) && (!due || due === existing.due)) {
    return { changed: false, action: 'sin-cambios', bills, bill: existing, service };
  }

  const note = `Automático desde correo de ${PROVIDERS[provider].label}`;
  if (existing) {
    const bill = { ...existing, amount, due: due || existing.due || '', note, source: messageId || existing.source };
    return { changed: true, action: 'actualizado', bills: bills.map(b => (b === existing ? bill : b)), bill, service };
  }
  const bill = { id: newId, serviceId: service.id, month, amount, due: due || '', note, paid: false, source: messageId || '' };
  return { changed: true, action: 'creado', bills: [...bills, bill], bill, service };
}
