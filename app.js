import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import './style.css';
import { firebaseConfig, USER_DOMAIN } from './firebase-config.js';

/* ---------- Estado y persistencia ---------- */
// Sin configurar Firebase, la app sigue funcionando solo con localStorage.
const cloud = Boolean(firebaseConfig.apiKey);
// Lo de la casa se comparte; las finanzas son privadas de cada usuario que inicia sesión.
const SHARED = ['services', 'bills', 'shopping', 'shopcats'];
const PRIVATE = ['people', 'tx'];
let db, auth, user = null, unsubs = [];
const synced = {};
const ready = { shared: false, private: false }; // no escribir un grupo antes de haberlo leído

const KEY = 'mihogar:v1';
const uid = () => Math.random().toString(36).slice(2, 10);

const defaults = () => ({
  services: [
    { id: uid(), name: 'Luz', icon: '💡' },
    { id: uid(), name: 'Gas', icon: '🔥' },
    { id: uid(), name: 'Agua', icon: '💧' },
    { id: uid(), name: 'Internet', icon: '🌐' },
    { id: uid(), name: 'Administración', icon: '🏢', fixed: 454000 },
  ],              // services: {id, name, icon, fixed?} — fixed: valor que se registra solo cada mes
  bills: [],     // {id, serviceId, month 'YYYY-MM', amount, due, paid, note}
  shopping: [],  // {id, name, qty, price, category (id de sección), done}
  shopcats: [],  // secciones de Compras {id, name, icon}; se llenan con DEFAULT_SHOPCATS
  people: [],    // {id, name}
  tx: [],        // {id, personId, type 'in'|'out', amount, category, date, desc}
});

let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || defaults(); } catch { S = defaults(); }
S = { ...defaults(), ...S };
const clearPrivate = () => { PRIVATE.forEach(k => { S[k] = []; delete synced[k]; }); };
// En modo nube las finanzas nunca se guardan en el navegador, para que otro usuario del mismo equipo no las vea.
if (cloud) clearPrivate();
const cache = () => localStorage.setItem(KEY, JSON.stringify(
  cloud ? Object.fromEntries(SHARED.map(k => [k, S[k]])) : S));

const homeCol = () => collection(db, 'homes', 'main', 'data');
const privCol = () => collection(db, 'homes', 'main', 'private', user.uid, 'data');
const save = () => {
  cache();
  if (db && user) [[SHARED, 'shared', homeCol], [PRIVATE, 'private', privCol]].forEach(([keys, group, col]) => {
    if (!ready[group]) return;
    keys.forEach(k => {
      const j = JSON.stringify(S[k]);
      if (j === synced[k]) return;
      synced[k] = j;
      setDoc(doc(col(), k), { items: S[k] }).catch(e => alert('No se pudo guardar en la nube: ' + e.message));
    });
  });
  render();
};

// Servicios con valor fijo (p. ej. Administración): crea solo el recibo pendiente del mes actual si no existe.
// Devuelve true si cambió algo.
function ensureFixedBills() {
  let changed = false;
  for (const s of S.services) {
    // Administración siempre vale 454.000; se pone una vez a quien no tenga valor fijo definido.
    if (s.fixed === undefined && /^administraci[oó]n$/i.test(s.name.trim())) { s.fixed = 454000; changed = true; }
  }
  const month = ym(new Date());
  for (const s of S.services) {
    if (!(s.fixed > 0) || S.bills.some(b => b.serviceId === s.id && b.month === month)) continue;
    S.bills.push({ id: uid(), serviceId: s.id, month, amount: s.fixed, due: '', note: 'Valor fijo mensual', paid: false });
    changed = true;
  }
  return changed;
}

function listen(col, keys, group, onEmpty) {
  let first = true;
  return onSnapshot(col, snap => {
    ready[group] = true;
    if (first && snap.empty) { first = false; onEmpty(); save(); return; }
    first = false;
    snap.docs.forEach(d => {
      if (!keys.includes(d.id)) return;
      S[d.id] = d.data().items; synced[d.id] = JSON.stringify(S[d.id]);
    });
    if (group === 'shared') { const a = ensureFixedBills(), b = ensureShopCats(); if (a || b) { save(); return; } }
    cache(); render();
  }, e => alert('Sin acceso a la base de datos: ' + e.message));
}

function startSync() {
  unsubs = [
    listen(homeCol(), SHARED, 'shared', () => {}), // primera vez: sube los datos locales de la casa
    // Primera vez de este usuario: arranca con una persona con su nombre.
    listen(privCol(), PRIVATE, 'private', () => { S.people = [{ id: uid(), name: userName() }]; S.tx = []; }),
  ];
}

function stopSync() {
  unsubs.forEach(u => u()); unsubs = [];
  ready.shared = ready.private = false;
  clearPrivate(); ui.personId = null;
}

const userName = () => { const n = user?.email.split('@')[0] || ''; return n.charAt(0).toUpperCase() + n.slice(1); };

if (cloud) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, u => {
    stopSync();
    user = u;
    if (u) startSync();
    render();
  });
}

const ui = { view: 'resumen', month: ym(new Date()), personId: null };

/* ---------- Utilidades ---------- */
function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function shiftMonth(m, n) { const [y, mo] = m.split('-').map(Number); return ym(new Date(y, mo - 1 + n, 1)); }
function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); }
const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = a => a.reduce((t, x) => t + Number(x.amount ?? 0), 0);
const today = () => new Date().toISOString().slice(0, 10);
const svc = id => S.services.find(s => s.id === id);
const $ = s => document.querySelector(s);

/* ---------- Fotos de recibos ----------
   Firebase Storage ya no es gratis en proyectos nuevos, así que la foto se comprime
   y se guarda como documento propio en Firestore (homes/main/receipts/{billId}). */
const rKey = id => 'mihogar:r:' + id;
const rDoc = id => doc(db, 'homes', 'main', 'receipts', id);
const inCloud = () => db && user;
async function putReceipt(id, data) {
  if (inCloud()) await setDoc(rDoc(id), { data }); else localStorage.setItem(rKey(id), data);
}
async function getReceipt(id) {
  if (inCloud()) { const s = await getDoc(rDoc(id)); return s.exists() ? s.data().data : null; }
  return localStorage.getItem(rKey(id));
}
async function delReceipt(id) {
  try { if (inCloud()) await deleteDoc(rDoc(id)); else localStorage.removeItem(rKey(id)); } catch { /* ya no existía */ }
}
// El comprobante de pago se guarda igual que la foto del recibo, con su propio id.
const proofKey = billId => 'pago-' + billId;

// Imagen → JPEG comprimido; PDF → tal cual si cabe en un documento de Firestore (< ~650 KB).
async function toStored(file) {
  if (file.type === 'application/pdf') {
    const data = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('No se pudo leer el PDF')); r.readAsDataURL(file);
    });
    if (data.length > 900000) throw new Error('El PDF pesa demasiado; sube una foto o captura del comprobante');
    return data;
  }
  return compress(file);
}

function compress(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      for (const [max, q] of [[1280, 0.7], [1024, 0.6], [800, 0.5]]) {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', q);
        if (out.length < 900000) return res(out); // límite de 1 MB por documento
      }
      rej(new Error('La imagen es demasiado grande'));
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

/* ---------- Formulario modal genérico ---------- */
function openForm(title, fields, onSubmit, onDelete) {
  const f = $('#dlg-form');
  f.oninput = f.onclick = null; // los pone reviewReceipt; no deben quedar en otros formularios
  f.innerHTML = `<h2>${esc(title)}</h2>` + fields.map(x => {
    const v = x.value ?? '';
    const req = x.required === false ? '' : 'required';
    if (x.type === 'select')
      return `<label>${x.label}<select name="${x.name}">${x.options.map(o => `<option value="${esc(o.v)}" ${o.v == v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
    if (x.type === 'checkbox')
      return `<label class="row"><input type="checkbox" name="${x.name}" ${v ? 'checked' : ''}> ${x.label}</label>`;
    return `<label>${x.label}<input name="${x.name}" type="${x.type || 'text'}" value="${esc(v)}" ${req} ${x.type === 'number' ? 'min="0" step="any"' : ''} ${x.type === 'file' ? `accept="${x.accept || 'image/*'}"` : ''}></label>`;
  }).join('') + `<div class="actions">
    ${onDelete ? '<button type="button" class="ghost danger" id="f-del">Eliminar</button><span class="grow"></span>' : ''}
    <button type="button" class="ghost" id="f-cancel">Cancelar</button>
    <button class="btn" value="ok">Guardar</button></div>`;
  const dlg = $('#dlg');
  f.onsubmit = e => {
    e.preventDefault();
    const out = {};
    fields.forEach(x => {
      const el = f.elements[x.name];
      out[x.name] = x.type === 'checkbox' ? el.checked : x.type === 'number' ? Number(el.value) : x.type === 'file' ? (el.files[0] || null) : el.value.trim();
    });
    dlg.close();
    onSubmit(out);
  };
  $('#f-cancel').onclick = () => dlg.close();
  if (onDelete) $('#f-del').onclick = () => { if (confirm('¿Eliminar?')) { dlg.close(); onDelete(); } };
  dlg.showModal();
}

/* ---------- Vistas ---------- */
function monthBar() {
  return `<div class="toolbar">
    <button class="ghost" data-act="prev">◀</button>
    <span class="month">${monthLabel(ui.month)}</span>
    <button class="ghost" data-act="next">▶</button>
  </div>`;
}

function vResumen() {
  const bills = S.bills.filter(b => b.month === ui.month);
  const paid = sum(bills.filter(b => b.paid)), pend = sum(bills.filter(b => !b.paid));
  const toBuy = S.shopping.filter(i => !i.done);
  const est = estimate(toBuy);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(ui.month, i - 5));
  const totals = months.map(m => sum(S.bills.filter(b => b.month === m)));
  const max = Math.max(...totals, 1);

  const people = S.people.map(p => {
    const t = S.tx.filter(x => x.personId === p.id && x.date.startsWith(ui.month));
    const inc = sum(t.filter(x => x.type === 'in')), out = sum(t.filter(x => x.type === 'out'));
    return `<div class="item"><span class="grow"><b>${esc(p.name)}</b><br><span class="muted">Ingresos ${money(inc)} · Egresos ${money(out)}</span></span>
      <b class="${inc - out >= 0 ? 'ok' : 'bad'}">${money(inc - out)}</b></div>`;
  }).join('') || '<div class="empty">Aún no hay personas. Agrégalas en Finanzas personales.</div>';

  return monthBar() + `<div class="grid">
    <div class="card stat"><div class="muted">⚡ Servicios del mes</div><div class="big">${money(paid + pend)}</div>
      <div class="muted"><span class="ok">Pagado ${money(paid)}</span> · <span class="warn">Pendiente ${money(pend)}</span></div></div>
    <div class="card stat green clickable" data-act="shop-list" title="Generar la lista de compras">
      <div class="muted">🛒 Compras pendientes</div><div class="big">${toBuy.length} ítems</div>
      <div class="muted">Estimado ${money(est)} · <b>Toca para generar la lista 🧾</b></div></div>
  </div>
  <div class="grid two" style="margin-top:16px">
    <div class="card"><h2>Gasto en servicios (6 meses)</h2><div class="bars">
      ${months.map((m, i) => `<div class="bar${m === ui.month ? " now" : ""}" title="${money(totals[i])}"><i style="height:${totals[i] / max * 85}%"></i>${monthLabel(m).split(' ')[0].slice(0, 3)}</div>`).join('')}
    </div></div>
    <div class="card"><h2>Personas</h2>${people}</div>
  </div>`;
}

function vServicios() {
  const cards = S.services.map(s => {
    const bills = S.bills.filter(b => b.serviceId === s.id && b.month === ui.month);
    return `<div class="card">
      <div class="row between"><h3>${esc(s.icon)} ${esc(s.name)}${s.fixed > 0 ? ` <span class="muted">· fijo ${money(s.fixed)}</span>` : ''}
        ${s.account ? `<br><span class="muted">N.º ${esc(s.account)}</span>` : ''}</h3>
        <span><button class="icon" data-act="bill-add" data-id="${s.id}" title="Registrar gasto">＋</button>
        <button class="icon" data-act="svc-edit" data-id="${s.id}" title="Editar servicio">✎</button></span></div>
      ${bills.map(b => `<div class="item">
        <input type="checkbox" data-act="bill-paid" data-id="${b.id}" ${b.paid ? 'checked' : ''} title="Pagado">
        <span class="grow"><b>${money(b.amount)}</b> <span class="badge ${b.paid ? 'paid' : 'pend'}">${b.paid ? 'Pagado' : 'Pendiente'}</span>
          <br><span class="muted">${b.due ? 'Vence ' + b.due : ''} ${esc(b.note)}</span></span>
        ${b.receipt ? `<button class="icon" data-act="bill-photo" data-id="${b.id}" title="Ver recibo">📎</button>` : ''}
        ${b.proof ? `<button class="icon" data-act="bill-proof" data-id="${b.id}" title="Ver comprobante de pago">🧾</button>` : ''}
        <button class="icon" data-act="bill-edit" data-id="${b.id}">✎</button></div>`).join('')
        || '<div class="muted" style="margin-top:8px">Sin registro este mes</div>'}
    </div>`;
  }).join('');
  return monthBar() + `<div class="head">
      <span class="muted">Total del mes: <b>${money(sum(S.bills.filter(b => b.month === ui.month)))}</b></span>
      <button class="btn" data-act="svc-add">+ Nuevo servicio / gasto</button></div>
    <div class="grid">${cards}</div>`;
}

/* ---------- Compras: secciones editables (nombre e ícono) ---------- */
const DEFAULT_SHOPCATS = [
  { id: 'comida', name: 'Comida', icon: '🍽️' },
  { id: 'banos', name: 'Baños', icon: '🚿' },
  { id: 'cuarto', name: 'Cuarto principal', icon: '🛏️' },
  { id: 'oficina', name: 'Oficina', icon: '💼' },
  { id: 'lavanderia', name: 'Lavandería', icon: '🧺' },
  { id: 'limpieza', name: 'Limpieza', icon: '🧽' },
  { id: 'muebles', name: 'Muebles y/o accesorios', icon: '🛋️' },
];
const OTROS = { id: 'otros', name: 'Otros', icon: '📦' };
const catById = id => S.shopcats.find(c => c.id === id);
// Los productos sin sección (o de una sección borrada) van a "Otros".
const catOf = i => catById(i.category) ? i.category : OTROS.id;
const shopCatsWithOtros = () => [...S.shopcats, ...(S.shopping.some(i => catOf(i) === OTROS.id) ? [OTROS] : [])];
const estimate = items => items.reduce((t, i) => t + (i.price || 0) * (i.qty || 1), 0);

// Crea las secciones por defecto y pasa los productos de las secciones viejas (Cocina, Nevera…) a las nuevas.
const OLD_CATS = { cocina: 'comida', nevera: 'comida', comida: 'comida', banos: 'banos', limpieza: 'limpieza' };
function ensureShopCats() {
  let changed = false;
  if (!S.shopcats?.length) { S.shopcats = DEFAULT_SHOPCATS.map(c => ({ ...c })); changed = true; }
  for (const i of S.shopping) {
    if (catById(i.category)) continue;
    const to = OLD_CATS[normName(i.category)];
    if (to && catById(to)) { i.category = to; changed = true; }
  }
  return changed;
}

// En compras, `done` significa "hay en la casa"; sin marcar significa "falta".
function vCompras() {
  const pend = S.shopping.filter(i => !i.done);
  const line = i => `<div class="item">
    <button class="badge ${i.done ? 'paid' : 'pend'}" style="border:0;min-width:58px" data-act="buy-toggle" data-id="${i.id}"
      title="Cambiar a ${i.done ? 'Falta' : 'Hay'}">${i.done ? '✔ Hay' : '✖ Falta'}</button>
    <span class="grow"><span class="name">${esc(i.name)}</span>${i.done ? '' : ` <span class="muted">×${i.qty || 1}</span>`}</span>
    <b>${!i.done && i.price ? money(i.price * (i.qty || 1)) : ''}</b>
    <button class="icon" data-act="buy-edit" data-id="${i.id}">✎</button></div>`;
  const cats = shopCatsWithOtros();
  const split = id => {
    const items = S.shopping.filter(i => catOf(i) === id);
    return [items.filter(i => !i.done), items.filter(i => i.done)];
  };

  // Pantalla de una sección
  const open = cats.find(c => c.id === ui.shopCat);
  if (open) {
    const [p, d] = split(open.id), otros = open.id === OTROS.id;
    return `<button class="ghost sm" data-act="shop-back" style="margin-bottom:14px">← Compras</button>
      <div class="head">
        <span class="row"><span class="cat-icon">${esc(open.icon)}</span><span><h2 style="margin:0">${esc(open.name)}</h2>
          <span class="muted">${p.length} faltan · ${d.length} hay${p.length ? ' · Estimado ' + money(estimate(p)) : ''}</span></span></span>
        ${otros ? '' : `<span class="row"><button class="ghost" data-act="cat-edit" data-id="${open.id}" title="Cambiar nombre o ícono">✎ Sección</button>
          <button class="btn" data-act="buy-add" data-id="${open.id}">+ Falta algo</button></span>`}</div>
      <div class="grid two-eq">
        <div class="card"><div class="section-label warn" style="margin-top:0">✖ Falta (${p.length})</div>
          ${p.map(line).join('') || '<div class="empty">No falta nada 🎉</div>'}</div>
        <div class="card"><div class="section-label ok" style="margin-top:0">✔ Hay en casa (${d.length})</div>
          ${d.map(line).join('') || '<div class="empty">Nada registrado</div>'}</div>
      </div>`;
  }

  // Vista general: una tarjeta por sección
  const tiles = cats.map(c => {
    const [p, d] = split(c.id), total = p.length + d.length;
    return `<button class="card tile" data-act="shop-open" data-id="${c.id}">
      <span class="cat-icon">${esc(c.icon)}</span>
      <h3>${esc(c.name)}</h3>
      <span class="muted">${total ? `<span class="${p.length ? 'warn' : 'ok'}"><b>${p.length}</b> faltan</span> · <b>${d.length}</b> hay` : 'Sin productos'}</span>
      <span class="progress"><i style="width:${total ? d.length / total * 100 : 0}%"></i></span>
      <span class="muted">${p.length ? 'Estimado ' + money(estimate(p)) : '&nbsp;'}</span>
    </button>`;
  }).join('');
  return `<div class="head">
    <span><h2 style="margin:0">Compras e inventario</h2><span class="muted">${pend.length} faltan · ${S.shopping.length - pend.length} hay · Estimado ${money(estimate(pend))}</span></span>
    <span class="row"><button class="btn" data-act="shop-list" title="Generar la lista de lo que falta">🧾 Lista de compras</button>
    <button class="btn" data-act="tx-scan" title="Leer una factura con la cámara">📷 Escanear factura</button>
    <button class="btn" data-act="buy-add">+ Falta algo</button></span></div>
    <div class="grid tiles">${tiles}
      <button class="card tile tile-add" data-act="cat-add"><span class="cat-icon">＋</span><h3>Nueva sección</h3>
        <span class="muted">Nombre e ícono a tu gusto</span></button></div>`;
}

function vFinanzas() {
  if (cloud && !ready.private) return '<div class="card empty">Cargando tus finanzas…</div>';
  if (!S.people.length)
    return `<div class="card empty">Agrega una persona para llevar sus ingresos y egresos.<br><br><button class="btn" data-act="person-add">+ Agregar persona</button></div>`;
  if (!S.people.some(p => p.id === ui.personId)) ui.personId = S.people[0].id;
  const p = S.people.find(x => x.id === ui.personId);
  const all = S.tx.filter(x => x.personId === p.id);
  const list = all.filter(x => x.date.startsWith(ui.month)).sort((a, b) => b.date.localeCompare(a.date));
  const inc = sum(list.filter(x => x.type === 'in')), out = sum(list.filter(x => x.type === 'out'));
  const total = sum(all.filter(x => x.type === 'in')) - sum(all.filter(x => x.type === 'out'));

  const byCat = {};
  list.filter(x => x.type === 'out').forEach(x => { const c = x.category || 'Sin categoría'; byCat[c] = (byCat[c] || 0) + x.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  return `<div class="card people">
      <div class="row between" style="margin-bottom:12px"><span><h3>Personas</h3>
        ${cloud ? '<span class="muted">🔒 Solo tú puedes ver estas finanzas</span>' : ''}</span>
        <button class="ghost sm" data-act="person-add">+ Agregar persona</button></div>
      <div class="tabs">${S.people.map(x => `<button data-act="person-sel" data-id="${x.id}" class="${x.id === p.id ? 'active' : ''}">
        <span class="avatar sm">${esc(x.name[0]?.toUpperCase())}</span>${esc(x.name)}</button>`).join('')}</div>
      <div class="row" style="margin-top:12px">
        <button class="ghost sm" data-act="person-edit" data-id="${p.id}">✎ Cambiar nombre</button>
        <button class="ghost sm danger" data-act="person-del" data-id="${p.id}">🗑 Eliminar a ${esc(p.name)}</button></div>
    </div>
    ${monthBar()}
    <div class="grid">
      <div class="card stat green"><div class="muted">Ingresos</div><div class="big ok">${money(inc)}</div></div>
      <div class="card stat red"><div class="muted">Egresos</div><div class="big bad">${money(out)}</div></div>
      <div class="card stat"><div class="muted">Balance del mes</div><div class="big ${inc - out >= 0 ? 'ok' : 'bad'}">${money(inc - out)}</div>
        <div class="muted">Acumulado total ${money(total)}</div></div>
    </div>
    <div class="grid two" style="margin-top:16px">
      <div class="card"><div class="row between"><h3>Movimientos</h3>
        <span><button class="btn sm" data-act="tx-add" data-type="in">+ Ingreso</button>
        <button class="btn sm red" data-act="tx-add" data-type="out">+ Egreso</button></span></div>
        ${list.map(x => `<div class="item"><span>${x.type === 'in' ? '🟢' : '🔴'}</span>
          <span class="grow">${esc(x.desc) || esc(x.category) || (x.type === 'in' ? 'Ingreso' : 'Egreso')}<br><span class="muted">${x.date}${x.category ? ' · ' + esc(x.category) : ''}${x.items?.length ? ` · ${x.items.length} productos` : ''}</span></span>
          <b class="${x.type === 'in' ? 'ok' : 'bad'}">${x.type === 'in' ? '+' : '−'}${money(x.amount)}</b>
          ${x.items ? `<button class="icon" data-act="tx-items" data-id="${x.id}" title="Ver y editar productos">🧾</button>` : ''}
          <button class="icon" data-act="tx-edit" data-id="${x.id}">✎</button></div>`).join('')
          || '<div class="empty">Sin movimientos este mes</div>'}</div>
      <div class="card"><h3 style="margin-bottom:8px">Egresos por categoría</h3>
        ${cats.map(([c, v]) => `<div class="item"><span class="grow">${esc(c)}</span><b>${money(v)}</b></div>`).join('') || '<div class="muted">—</div>'}</div>
    </div>`;
}

const FIXED_LABEL = 'Valor fijo mensual (déjalo vacío si cambia cada mes)';
const ACCOUNT_LABEL = 'Número de cuenta (NIC, póliza, contrato o ID)';

const views = { resumen: vResumen, servicios: vServicios, compras: vCompras, finanzas: vFinanzas };

function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  const name = user?.email.split('@')[0] || '';
  $('#who').innerHTML = cloud && user ? `<span class="avatar" title="${esc(name)}">${esc(name[0]?.toUpperCase())}</span>
    <button class="ghost sm" data-act="logout">Salir</button>` : '';
  const locked = cloud && !user;
  $('#nav').hidden = locked;
  if (locked) {
    $('#app').innerHTML = `<div class="card login">
      <img src="/logo.svg" alt="MiHogar">
      <h2>Bienvenido a MiHogar</h2>
      <div class="muted">Los gastos, compras y finanzas de la casa en un solo lugar</div>
      <form id="login">
        <label>Usuario<input name="u" autocomplete="username" autocapitalize="none" required></label>
        <label>Contraseña<input name="p" type="password" autocomplete="current-password" required></label>
        <div class="bad" id="login-err" style="font-size:13px;margin-top:10px"></div>
        <button class="btn">Entrar</button></form></div>`;
    $('#login').onsubmit = login;
    return;
  }
  $('#app').innerHTML = views[ui.view]();
}

/* ---------- Acciones ---------- */
const find = (arr, id) => arr.find(x => x.id === id);

const A = {
  logout() { signOut(auth); },
  prev() { ui.month = shiftMonth(ui.month, -1); render(); },
  next() { ui.month = shiftMonth(ui.month, 1); render(); },

  'svc-add'() {
    openForm('Nuevo servicio o gasto', [
      { name: 'name', label: 'Nombre (ej. Seguro, Aseo, Streaming)' },
      { name: 'icon', label: 'Emoji', value: '📌', required: false },
      { name: 'account', label: ACCOUNT_LABEL, required: false },
      { name: 'fixed', label: FIXED_LABEL, type: 'number', required: false },
    ], v => { S.services.push({ id: uid(), name: v.name, icon: v.icon || '📌', account: v.account, fixed: v.fixed || 0 }); ensureFixedBills(); save(); });
  },
  'svc-edit'(id) {
    const s = find(S.services, id);
    openForm('Editar servicio', [
      { name: 'name', label: 'Nombre', value: s.name },
      { name: 'icon', label: 'Emoji', value: s.icon, required: false },
      { name: 'account', label: ACCOUNT_LABEL, value: s.account || '', required: false },
      { name: 'fixed', label: FIXED_LABEL, type: 'number', value: s.fixed || '', required: false },
    ], v => { s.name = v.name; s.icon = v.icon || '📌'; s.account = v.account; s.fixed = v.fixed || 0; ensureFixedBills(); save(); },
    () => { S.bills.filter(b => b.serviceId === id && b.receipt).forEach(b => delReceipt(b.id)); S.services = S.services.filter(x => x.id !== id); S.bills = S.bills.filter(b => b.serviceId !== id); save(); });
  },
  'bill-add'(id) { billForm({ serviceId: id, month: ui.month, amount: '', due: '', note: '', paid: false }, true); },
  'bill-edit'(id) { billForm(find(S.bills, id), false); },
  'bill-photo'(id) { showReceipt(find(S.bills, id)); },
  'bill-proof'(id) { showReceipt(find(S.bills, id), true); },
  // Marcar como pagado siempre pide el comprobante; el estado cambia solo al subirlo.
  'bill-paid'(id, el) {
    const b = find(S.bills, id);
    if (el.checked) { el.checked = false; proofForm(b); return; }
    if (!el.checked && !confirm('¿Marcar este recibo como pendiente otra vez?')) { el.checked = true; return; }
    b.paid = el.checked; save();
  },

  'buy-add'(cat) { buyForm({ name: '', qty: 1, price: '', category: cat || S.shopcats[0]?.id }, true); },
  'buy-edit'(id) { buyForm(find(S.shopping, id), false); },
  'buy-toggle'(id) {
    const i = find(S.shopping, id); i.done = !i.done; save();
    if (!i.done) notify({ type: 'missing', itemId: i.id });
  },
  'cat-add'() { catForm(null); },
  'cat-edit'(id) { catForm(catById(id)); },
  'shop-list'() { shopListPicker(); },

  'person-add'() {
    openForm('Nueva persona', [{ name: 'name', label: 'Nombre' }], v => {
      const p = { id: uid(), name: v.name }; S.people.push(p); ui.personId = p.id; save();
    });
  },
  'person-sel'(id) { ui.personId = id; render(); },
  'person-edit'(id) {
    const p = find(S.people, id);
    openForm('Cambiar nombre', [{ name: 'name', label: 'Nombre', value: p.name }], v => { p.name = v.name; save(); });
  },
  'person-del'(id) {
    const p = find(S.people, id), n = S.tx.filter(t => t.personId === id).length;
    if (!confirm(`¿Eliminar a ${p.name}${n ? ` y sus ${n} movimientos` : ''}? Esto no se puede deshacer.`)) return;
    S.people = S.people.filter(x => x.id !== id); S.tx = S.tx.filter(t => t.personId !== id); save();
  },
  'shop-open'(c) { ui.shopCat = c; render(); window.scrollTo(0, 0); },
  'shop-back'() { ui.shopCat = null; render(); },
  'tx-add'(_, el) { txForm({ personId: ui.personId, type: el.dataset.type, amount: '', category: '', date: today(), desc: '' }, true); },
  'tx-edit'(id) { txForm(find(S.tx, id), false); },
  'tx-items'(id) { reviewReceipt(find(S.tx, id)); },
  'tx-scan'() {
    if (cloud && !ready.private) return alert('Espera un momento: se están cargando tus finanzas.');
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.onchange = () => input.files[0] && scanReceipt(input.files[0]);
    input.click();
  },
};

// Firebase Auth trabaja con correos: el usuario "camilo" se guarda como camilo@USER_DOMAIN.
async function login(e) {
  e.preventDefault();
  const f = e.target, err = $('#login-err'), btn = f.querySelector('button');
  const email = `${f.u.value.trim().toLowerCase()}@${USER_DOMAIN}`;
  btn.disabled = true; err.textContent = '';
  try { await signInWithEmailAndPassword(auth, email, f.p.value); }
  catch (x) {
    err.textContent = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(x.code)
      ? 'Usuario o contraseña incorrectos' : x.code === 'auth/too-many-requests' ? 'Demasiados intentos, espera un momento' : x.message;
    btn.disabled = false;
  }
}

function billForm(b, isNew) {
  openForm(`${isNew ? 'Registrar' : 'Editar'} · ${svc(b.serviceId)?.name} · ${monthLabel(b.month)}`, [
    { name: 'amount', label: 'Valor', type: 'number', value: b.amount },
    { name: 'due', label: 'Fecha de vencimiento', type: 'date', value: b.due, required: false },
    { name: 'note', label: 'Nota', value: b.note, required: false },
    { name: 'paid', label: 'Ya está pagado (requiere comprobante)', type: 'checkbox', value: b.paid },
    { name: 'proofFile', label: b.paid ? 'Reemplazar comprobante de pago' : 'Comprobante de pago (foto o PDF)', type: 'file', accept: PROOF_ACCEPT, required: false },
  ], async v => {
    const { proofFile, ...data } = v;
    const rec = isNew ? { id: uid(), ...b } : b;
    let subido = false;
    try {
      if (proofFile) { await putReceipt(proofKey(rec.id), await toStored(proofFile)); rec.proof = true; subido = true; }
    } catch (e) { alert('No se pudo guardar el comprobante: ' + e.message); }
    // Pasar de pendiente a pagado exige subir el comprobante en ese mismo momento.
    if (data.paid && !rec.paid && !subido) {
      alert('Para marcarlo como pagado tienes que adjuntar el comprobante de pago. Quedó como pendiente.');
      data.paid = false;
    }
    const recienPagado = data.paid && !rec.paid;
    if (recienPagado) data.paidAt = today();
    Object.assign(rec, data);
    if (isNew) S.bills.push(rec);
    save();
    if (recienPagado) notifyPaid(rec.id);
  },
  isNew ? null : () => { delReceipt(b.id); delReceipt(proofKey(b.id)); S.bills = S.bills.filter(x => x.id !== b.id); save(); });
}

const PROOF_ACCEPT = 'image/*,application/pdf';

// Pide el comprobante y, al subirlo, marca el recibo como pagado.
function proofForm(b) {
  openForm(`Comprobante de pago · ${svc(b.serviceId)?.name} · ${monthLabel(b.month)}`, [
    { name: 'proofFile', label: 'Sube la foto o PDF del comprobante para marcarlo como pagado', type: 'file', accept: PROOF_ACCEPT },
  ], async v => {
    if (!v.proofFile) return;
    try {
      await putReceipt(proofKey(b.id), await toStored(v.proofFile));
      Object.assign(b, { proof: true, paid: true, paidAt: today() });
      save();
      notifyPaid(b.id);
    } catch (e) { alert('No se pudo guardar el comprobante: ' + e.message); }
  });
}

// Pide a Vercel que avise por Telegram y Discord (api/notice.js): { type: 'paid', billId } → "X ya pagó el
// servicio…"; { type: 'missing', itemId } → "X agregó que falta…". Solo con sesión en la nube.
async function notify(body) {
  if (!inCloud()) return;
  try {
    const r = await fetch('/api/notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await user.getIdToken() },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.warn('Aviso:', r.status, await r.text());
  } catch (e) { console.warn('Aviso:', e.message); }
}
const notifyPaid = billId => notify({ type: 'paid', billId });

/* ---------- Lista de compras tipo recibo ---------- */
function shopListPicker(selected) {
  const f = $('#dlg-form'), dlg = $('#dlg');
  f.oninput = f.onclick = null;
  const cats = shopCatsWithOtros().map(c => ({ ...c, n: S.shopping.filter(i => !i.done && catOf(i) === c.id).length }));
  const sel = new Set(selected || cats.filter(c => c.n).map(c => c.id));
  f.innerHTML = `<h2>🧾 Lista de compras</h2><div class="muted">Marca las secciones que quieres en la lista.</div>
    <div class="row" style="margin-top:10px"><button type="button" class="ghost sm" id="sl-all">Todas</button>
      <button type="button" class="ghost sm" id="sl-none">Ninguna</button></div>
    <div class="pick-list">${cats.map(c => `<label class="pick ${c.n ? '' : 'empty-cat'}">
      <input type="checkbox" name="cat" value="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>
      <span class="pick-icon">${esc(c.icon)}</span><span class="grow">${esc(c.name)}</span>
      <span class="muted">${c.n ? `${c.n} faltan` : 'nada'}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="ghost" id="sl-cancel">Cancelar</button><button class="btn">Generar lista</button></div>`;
  const boxes = () => [...f.querySelectorAll('input[name=cat]')];
  f.onclick = e => {
    if (e.target.id === 'sl-all') boxes().forEach(b => { b.checked = true; });
    if (e.target.id === 'sl-none') boxes().forEach(b => { b.checked = false; });
    if (e.target.id === 'sl-cancel') dlg.close();
  };
  f.onsubmit = e => {
    e.preventDefault();
    const ids = boxes().filter(b => b.checked).map(b => b.value);
    if (!ids.length) return alert('Elige al menos una sección.');
    shopListReceipt(ids);
  };
  if (!dlg.open) dlg.showModal();
}

function shopListReceipt(ids) {
  const f = $('#dlg-form');
  f.oninput = f.onclick = null;
  const cats = shopCatsWithOtros().filter(c => ids.includes(c.id));
  const groups = cats.map(c => ({ c, items: S.shopping.filter(i => !i.done && catOf(i) === c.id) })).filter(g => g.items.length);
  const all = groups.flatMap(g => g.items);
  const total = estimate(all), qty = all.reduce((t, i) => t + (Number(i.qty) || 1), 0);
  const now = new Date();
  const who = (cloud ? userName() : find(S.people, ui.personId)?.name || '') || 'LA CASA';
  const date = now.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const order = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  const amt = i => i.price ? money(i.price * (i.qty || 1)).replace(/\s/g, '') : '—';
  // Código de barras decorativo, siempre igual para el mismo día.
  let seed = Number(order), bars = '';
  for (let x = 0; x < 236;) { seed = (seed * 9301 + 49297) % 233280; const w = 1 + (seed % 3); bars += `<rect x="${x}" width="${w}" height="44"/>`; x += w + 1 + (seed % 2); }

  const text = ['MIHOGAR · LISTA DE COMPRAS', date.toUpperCase(), '',
    ...groups.flatMap(g => [`— ${g.c.name.toUpperCase()} —`, ...g.items.map(i => `${String(i.qty || 1).padStart(2, '0')}  ${i.name}${i.price ? '  ' + amt(i) : ''}`), '']),
    `PRODUCTOS: ${qty}`, `TOTAL ESTIMADO: ${money(total)}`].join('\n');

  f.innerHTML = `<div class="receipt">
      <div class="r-title">MIHOGAR</div><div class="r-sub">LISTA DE COMPRAS</div>
      <div class="r-meta">PEDIDO #${order} PARA ${esc(who.toUpperCase())}<br>${esc(date.toUpperCase())}</div>
      <div class="r-line"></div>
      <div class="r-row r-head"><span>CANT</span><span>PRODUCTO</span><span>APROX</span></div>
      <div class="r-line"></div>
      ${groups.map(g => `<div class="r-cat">${esc(g.c.icon)} ${esc(g.c.name.toUpperCase())}</div>
        ${g.items.map(i => `<div class="r-row"><span>${String(i.qty || 1).padStart(2, '0')}</span><span>${esc(i.name.toUpperCase())}</span><span>${amt(i)}</span></div>`).join('')}`).join('')
        || '<div class="r-empty">NO FALTA NADA EN ESTAS SECCIONES 🎉</div>'}
      <div class="r-line"></div>
      <div class="r-row r-sum"><span></span><span>PRODUCTOS:</span><span>${qty}</span></div>
      <div class="r-row r-sum"><span></span><span>TOTAL ESTIMADO:</span><span>${money(total).replace(/\s/g, '')}</span></div>
      <div class="r-line"></div>
      <div class="r-meta">SECCIONES: ${esc(cats.map(c => c.name.toUpperCase()).join(', '))}</div>
      <div class="r-thanks">¡GRACIAS POR HACER EL MERCADO!</div>
      <svg class="r-barcode" viewBox="0 0 236 44" preserveAspectRatio="none">${bars}</svg>
      <div class="r-foot">mihogar-orcin.vercel.app</div>
    </div>
    <div class="actions" style="flex-wrap:wrap">
      <button type="button" class="ghost" id="sl-back">← Secciones</button>
      <button type="button" class="ghost" id="sl-copy">📋 Copiar</button>
      ${navigator.share ? '<button type="button" class="ghost" id="sl-share">📤 Compartir</button>' : ''}
      <button class="btn">Cerrar</button></div>`;
  f.onclick = async e => {
    if (e.target.id === 'sl-back') shopListPicker(ids);
    if (e.target.id === 'sl-copy') { try { await navigator.clipboard.writeText(text); e.target.textContent = '✓ Copiada'; } catch { alert(text); } }
    if (e.target.id === 'sl-share') navigator.share({ title: 'Lista de compras', text }).catch(() => {});
  };
  f.onsubmit = e => { e.preventDefault(); $('#dlg').close(); };
}

async function showReceipt(b, proof = false) {
  const f = $('#dlg-form'), dlg = $('#dlg');
  f.oninput = f.onclick = null;
  f.innerHTML = `<h2>${proof ? 'Comprobante de pago' : 'Recibo'} · ${esc(svc(b.serviceId)?.name)} · ${monthLabel(b.month)}</h2>
    ${proof && b.paidAt ? `<div class="muted">Pagado el ${b.paidAt}</div>` : ''}<div class="empty" id="r-img">Cargando…</div>
    <div class="actions"><button class="btn" value="ok">Cerrar</button></div>`;
  f.onsubmit = e => { e.preventDefault(); dlg.close(); };
  dlg.showModal();
  try {
    const data = await getReceipt(proof ? proofKey(b.id) : b.id);
    if (!data) { $('#r-img').outerHTML = '<div class="empty">No se encontró el archivo</div>'; return; }
    // Los navegadores bloquean abrir enlaces data: en otra pestaña; un blob: sí se puede abrir y descargar.
    const url = URL.createObjectURL(await (await fetch(data)).blob());
    const name = proof ? 'comprobante' : 'recibo';
    if (data.startsWith('data:application/pdf')) {
      $('#r-img').outerHTML = `<embed src="${url}" type="application/pdf" style="width:100%;height:60vh;border-radius:8px">
        <div class="row" style="margin-top:8px"><a class="ghost sm" href="${url}" target="_blank" rel="noopener">Abrir en pestaña nueva</a>
        <a class="ghost sm" href="${url}" download="${name}.pdf">⬇ Descargar PDF</a></div>`;
    } else {
      $('#r-img').outerHTML = `<img src="${url}" alt="${name}" title="Toca para ampliar"
        style="width:100%;border-radius:8px;cursor:zoom-in" data-view-img>
        <div class="muted" style="text-align:center;margin-top:6px">Toca la imagen para ampliarla</div>`;
      f.querySelector('[data-view-img]').onclick = () => openViewer(url, `${name}.jpg`);
    }
  } catch (e) { $('#r-img').textContent = 'Error: ' + e.message; }
}

/* ---------- Visor de imágenes (zoom y desplazamiento) ---------- */
const vw = { scale: 1, x: 0, y: 0, drag: null };
function vwApply() {
  $('#viewer-img').style.transform = `translate(${vw.x}px, ${vw.y}px) scale(${vw.scale})`;
}
function vwZoom(factor) {
  vw.scale = Math.min(8, Math.max(0.5, vw.scale * factor));
  if (vw.scale <= 1) { vw.x = 0; vw.y = 0; }
  vwApply();
}
function openViewer(src, filename) {
  Object.assign(vw, { scale: 1, x: 0, y: 0, drag: null });
  $('#viewer-img').src = src;
  Object.assign($('#viewer-dl'), { href: src, download: filename });
  vwApply();
  $('#viewer').showModal();
}
(() => {
  const v = $('#viewer'), img = $('#viewer-img'), stage = v.querySelector('.viewer-stage');
  v.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (b) ({ in: () => vwZoom(1.4), out: () => vwZoom(1 / 1.4), reset: () => { Object.assign(vw, { scale: 1, x: 0, y: 0 }); vwApply(); }, close: () => v.close() })[b.dataset.v]();
    else if (e.target === stage) v.close(); // tocar el fondo cierra
  });
  stage.addEventListener('wheel', e => { e.preventDefault(); vwZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
  img.addEventListener('dblclick', () => { vw.scale > 1 ? Object.assign(vw, { scale: 1, x: 0, y: 0 }) : (vw.scale = 2.5); vwApply(); });
  // Arrastrar con mouse o un dedo; pellizcar con dos dedos.
  const pts = new Map();
  let pinch = null;
  img.addEventListener('pointerdown', e => {
    img.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vw.scale }; }
    else vw.drag = { x: e.clientX - vw.x, y: e.clientY - vw.y };
  });
  img.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      vw.scale = Math.min(8, Math.max(0.5, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    } else if (vw.drag) { vw.x = e.clientX - vw.drag.x; vw.y = e.clientY - vw.drag.y; }
    vwApply();
  });
  const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) vw.drag = null; };
  img.addEventListener('pointerup', end);
  img.addEventListener('pointercancel', end);
})();

// Agregar a mano siempre es "falta"; lo que hay en casa llega al escanear una factura.
function buyForm(i, isNew) {
  const catOptions = S.shopcats.map(c => ({ v: c.id, t: `${c.icon} ${c.name}` }));
  openForm(isNew ? '¿Qué falta?' : 'Editar producto', [
    { name: 'name', label: 'Producto', value: i.name },
    ...(isNew ? [] : [{ name: 'status', label: 'Estado', type: 'select', value: i.done ? 'hay' : 'falta',
      options: [{ v: 'falta', t: '✖ Falta (hay que comprar)' }, { v: 'hay', t: '✔ Hay en casa' }] }]),
    { name: 'qty', label: 'Cantidad a comprar', type: 'number', value: i.qty },
    { name: 'price', label: 'Precio unitario estimado', type: 'number', value: i.price, required: false },
    { name: 'category', label: 'Sección', type: 'select', value: catById(i.category) ? i.category : S.shopcats[0]?.id, options: catOptions },
  ], ({ status, ...v }) => {
    const nowMissing = isNew || (status === 'falta' && i.done);
    Object.assign(i, v, { done: isNew ? false : status === 'hay' });
    const rec = isNew ? { id: uid(), ...i } : i;
    if (isNew) S.shopping.push(rec);
    save();
    if (nowMissing) notify({ type: 'missing', itemId: rec.id });
  },
  isNew ? null : () => { S.shopping = S.shopping.filter(x => x.id !== i.id); save(); });
}

function catForm(c) {
  const isNew = !c;
  openForm(isNew ? 'Nueva sección' : 'Editar sección', [
    { name: 'name', label: 'Nombre', value: c?.name || '' },
    { name: 'icon', label: 'Ícono (un emoji, ej. 🍽️ 🛏️ 🧺 💼)', value: c?.icon || '📦', required: false },
  ], v => {
    if (isNew) S.shopcats.push({ id: uid(), name: v.name, icon: v.icon || '📦' });
    else Object.assign(c, { name: v.name, icon: v.icon || '📦' });
    save();
  }, isNew ? null : () => {
    const n = S.shopping.filter(i => i.category === c.id).length;
    if (n && !confirm(`"${c.name}" tiene ${n} productos; pasarán a "Otros". ¿Eliminar la sección?`)) return;
    S.shopcats = S.shopcats.filter(x => x.id !== c.id);
    ui.shopCat = null;
    save();
  });
}

function txForm(t, isNew) {
  openForm(`${isNew ? 'Nuevo' : 'Editar'} ${t.type === 'in' ? 'ingreso' : 'egreso'}`, [
    { name: 'amount', label: 'Valor', type: 'number', value: t.amount },
    { name: 'date', label: 'Fecha', type: 'date', value: t.date },
    { name: 'category', label: t.type === 'in' ? 'Categoría (ej. Salario, Extra)' : 'Categoría (ej. Comida, Transporte)', value: t.category, required: false },
    { name: 'desc', label: 'Descripción', value: t.desc, required: false },
  ], v => { Object.assign(t, v); if (isNew) S.tx.push({ id: uid(), ...t }); save(); },
  isNew ? null : () => { S.tx = S.tx.filter(x => x.id !== t.id); save(); });
}

/* ---------- Productos comprados → Compras "Hay en casa" ---------- */
const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = s => normName(s).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
// Sección de Compras según palabras del producto (si existe); lo demás va a Comida o a la primera sección.
const CAT_WORDS = [
  ['lavanderia', /detergente|jabon (en )?polvo|suaviz|blanqu|quitamanch|ropa|fab\b|ariel|lavanderia/],
  ['limpieza', /lavaloza|lavalo|lavaplatos|cloro|varsol|limpia|desinfect|esponja|bolsa|basura|ambientador|escoba|trapero|guante|recogedor/],
  ['banos', /papel hig|pa hig|higien|shampoo|champu|crema dental|dental|cepillo|jabon|toalla|desodorante|afeitar|pantaj|panal|protector/],
  ['oficina', /cuaderno|lapiz|lapicero|boligrafo|esfero|resma|carpeta|grapa|marcador|tinta|cartucho/],
  ['cuarto', /sabana|almohada|cobija|edredon|colchon|cortina/],
  ['muebles', /silla|mesa|lampara|bombillo|foco|estante|repisa|cojin|alfombra|organizador/],
];
function guessShopCat(name) {
  const n = normName(name);
  const id = (CAT_WORDS.find(([, re]) => re.test(n)) || ['comida'])[0];
  return catById(id) ? id : (catById('comida') ? 'comida' : S.shopcats[0]?.id || OTROS.id);
}
const prettyName = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());

// Marca como "Hay" los que ya estaban en Compras (aunque el nombre sea más corto, p. ej. "Arroz") y crea los demás.
function addToStock(items) {
  let marked = 0, added = 0;
  for (const it of items.filter(i => i.name.trim())) {
    const w = words(it.name);
    const match = S.shopping.find(s => { const sw = words(s.name); return sw.length && sw.every(x => w.some(y => y.startsWith(x) || x.startsWith(y))); });
    if (match) { if (!match.done) { match.done = true; marked++; } continue; }
    S.shopping.push({ id: uid(), name: prettyName(it.name), qty: 1, price: Number(it.price) || 0, category: guessShopCat(it.name), done: true });
    added++;
  }
  return { marked, added };
}

// Persona de quien escanea: en la nube, la que tiene su nombre de usuario (o la primera de sus finanzas,
// que son privadas); sin nube, la seleccionada en Finanzas. Si no hay ninguna, se crea.
function ownPersonId() {
  const me = cloud ? normName(userName()) : '';
  const p = (me && S.people.find(x => normName(x.name) === me)) || find(S.people, ui.personId) || S.people[0];
  if (p) return p.id;
  const nuevo = { id: uid(), name: userName() || 'Yo' };
  S.people.push(nuevo);
  return nuevo.id;
}

/* ---------- Escanear factura (OCR) ---------- */
async function scanReceipt(file) {
  const f = $('#dlg-form'), dlg = $('#dlg');
  f.oninput = f.onclick = null;
  f.innerHTML = `<h2>📷 Leyendo factura…</h2><div class="muted" id="ocr-st">Preparando (la primera vez descarga el lector, ~2 MB)</div>
    <span class="progress" style="margin-top:12px"><i id="ocr-bar" style="width:0"></i></span>`;
  f.onsubmit = e => e.preventDefault();
  dlg.showModal();
  try {
    const { readImage, parseReceipt } = await import('./ocr.js');
    const text = await readImage(file, p => {
      $('#ocr-st').textContent = `Leyendo texto… ${Math.round(p * 100)}%`;
      $('#ocr-bar').style.width = `${p * 100}%`;
    });
    const r = parseReceipt(text);
    reviewReceipt({ personId: ownPersonId(), type: 'out', category: 'Mercado', desc: r.store, date: r.date || today(), amount: r.total, items: r.items }, true);
  } catch (e) {
    f.innerHTML = `<h2>No se pudo leer la factura</h2><div class="muted">${esc(e.message)}</div>
      <div class="actions"><button class="btn" value="ok">Cerrar</button></div>`;
    f.onsubmit = ev => { ev.preventDefault(); dlg.close(); };
  }
}

// Pantalla editable con lo que leyó el OCR (o un egreso ya guardado con productos).
function reviewReceipt(t, isNew = false) {
  const f = $('#dlg-form'), dlg = $('#dlg');
  let items = (t.items || []).map(i => ({ ...i }));
  let totalManual = !isNew; // en uno ya guardado se respeta el total; en uno nuevo se suma solo
  let toStock = true;
  const row = (i, n) => `<div class="row" style="gap:6px;margin-top:6px">
      <input data-i="${n}" data-k="name" value="${esc(i.name)}" placeholder="Producto" style="flex:1;margin:0">
      <input data-i="${n}" data-k="price" type="number" min="0" value="${i.price}" style="width:110px;margin:0">
      <button type="button" class="icon" data-rm="${n}" title="Quitar">✕</button></div>`;
  const draw = () => {
    f.innerHTML = `<h2>🧾 ${isNew ? 'Revisa la factura' : 'Productos de la compra'}</h2>
      ${isNew ? '<div class="muted">Corrige lo que el lector haya leído mal antes de guardar.</div>' : ''}
      <label>Tienda / descripción<input name="desc" value="${esc(t.desc)}"></label>
      <div class="row" style="gap:10px"><label style="flex:1">Fecha<input name="date" type="date" value="${t.date}"></label>
        <label style="flex:1">Categoría<input name="category" value="${esc(t.category)}"></label></div>
      <div class="muted" style="margin-top:12px">Egreso de <b>${esc(find(S.people, t.personId)?.name || '')}</b></div>
      <div class="section-label" style="margin-top:16px">Productos (${items.length})</div>
      <div id="rows">${items.map(row).join('') || '<div class="muted">No se detectaron productos; agrégalos o deja solo el total.</div>'}</div>
      <button type="button" class="ghost sm" id="add-row" style="margin-top:8px">+ Agregar producto</button>
      <label>Total<input name="amount" type="number" min="0" required value="${t.amount || ''}"></label>
      <div class="muted" id="sum"></div>
      ${isNew ? `<label class="row" style="margin-top:12px"><input type="checkbox" name="toStock" ${toStock ? 'checked' : ''}>
        Pasar los productos a "Hay en casa" en Compras</label>` : ''}
      <div class="actions"><button type="button" class="ghost" id="r-cancel">Cancelar</button><button class="btn">Guardar egreso</button></div>`;
    showSum();
  };
  const sum = () => items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const showSum = () => { $('#sum').textContent = items.length ? `Suma de productos: ${money(sum())}` : ''; };
  f.oninput = e => {
    const el = e.target;
    if (el.dataset.i !== undefined) {
      items[el.dataset.i][el.dataset.k] = el.dataset.k === 'price' ? Number(el.value) : el.value;
      if (!totalManual) f.elements.amount.value = sum();
      showSum();
    } else if (el.name === 'amount') totalManual = true;
    else if (el.name === 'toStock') toStock = el.checked;
    else if (el.name) t[el.name] = el.value;
  };
  f.onclick = e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { syncHeader(); items.splice(Number(rm.dataset.rm), 1); if (!totalManual) t.amount = sum(); draw(); }
    if (e.target.id === 'add-row') { syncHeader(); items.push({ name: '', price: 0 }); draw(); f.querySelector(`[data-i="${items.length - 1}"][data-k="name"]`).focus(); }
    if (e.target.id === 'r-cancel') dlg.close();
  };
  const syncHeader = () => ['desc', 'date', 'category', 'amount'].forEach(k => { t[k] = k === 'amount' ? Number(f.elements[k].value) : f.elements[k].value; });
  f.onsubmit = e => {
    e.preventDefault();
    syncHeader();
    const rec = isNew ? { id: uid(), type: 'out', ...t } : t;
    Object.assign(rec, { amount: Number(t.amount) || sum(), items: items.filter(i => i.name.trim() || i.price) });
    if (isNew) S.tx.push(rec);
    const stock = isNew && toStock ? addToStock(rec.items) : null;
    ui.personId = rec.personId;
    dlg.close();
    save();
    if (stock && (stock.marked || stock.added)) alert(`En Compras: ${stock.marked} ya estaban en la lista y pasaron a "Hay en casa"; ${stock.added} se agregaron como "Hay en casa".`);
  };
  draw();
  if (!dlg.open) dlg.showModal();
}

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('#nav button');
  if (nav) { ui.view = nav.dataset.view; ui.shopCat = null; render(); return; }
  if (e.target.closest('[data-brand]')) { e.preventDefault(); ui.view = 'resumen'; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.type === 'checkbox') return;
  A[el.dataset.act]?.(el.dataset.id, el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[type=checkbox][data-act]');
  if (el) A[el.dataset.act](el.dataset.id, el);
});

// En modo nube esto corre al llegar los datos compartidos (ver listen).
if (!cloud) { const a = ensureFixedBills(), b = ensureShopCats(); if (a || b) cache(); }
render();
