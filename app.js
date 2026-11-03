import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import './style.css';
import { firebaseConfig, USER_DOMAIN } from './firebase-config.js';

/* ---------- Estado y persistencia ---------- */
// Sin configurar Firebase, la app sigue funcionando solo con localStorage.
const cloud = Boolean(firebaseConfig.apiKey);
// Lo de la casa se comparte; las finanzas son privadas de cada usuario que inicia sesión.
const SHARED = ['services', 'bills', 'shopping'];
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
  shopping: [],  // {id, name, qty, price, category, done}
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
    if (group === 'shared' && ensureFixedBills()) { save(); return; }
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
  f.innerHTML = `<h2>${esc(title)}</h2>` + fields.map(x => {
    const v = x.value ?? '';
    const req = x.required === false ? '' : 'required';
    if (x.type === 'select')
      return `<label>${x.label}<select name="${x.name}">${x.options.map(o => `<option value="${esc(o.v)}" ${o.v == v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
    if (x.type === 'checkbox')
      return `<label class="row"><input type="checkbox" name="${x.name}" ${v ? 'checked' : ''}> ${x.label}</label>`;
    return `<label>${x.label}<input name="${x.name}" type="${x.type || 'text'}" value="${esc(v)}" ${req} ${x.type === 'number' ? 'min="0" step="any"' : ''} ${x.type === 'file' ? 'accept="image/*"' : ''}></label>`;
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
    <div class="card stat green"><div class="muted">🛒 Compras pendientes</div><div class="big">${toBuy.length} ítems</div>
      <div class="muted">Estimado ${money(est)}</div></div>
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
      <div class="row between"><h3>${esc(s.icon)} ${esc(s.name)}${s.fixed > 0 ? ` <span class="muted">· fijo ${money(s.fixed)}</span>` : ''}</h3>
        <span><button class="icon" data-act="bill-add" data-id="${s.id}" title="Registrar gasto">＋</button>
        <button class="icon" data-act="svc-edit" data-id="${s.id}" title="Editar servicio">✎</button></span></div>
      ${bills.map(b => `<div class="item">
        <input type="checkbox" data-act="bill-paid" data-id="${b.id}" ${b.paid ? 'checked' : ''} title="Pagado">
        <span class="grow"><b>${money(b.amount)}</b> <span class="badge ${b.paid ? 'paid' : 'pend'}">${b.paid ? 'Pagado' : 'Pendiente'}</span>
          <br><span class="muted">${b.due ? 'Vence ' + b.due : ''} ${esc(b.note)}</span></span>
        ${b.receipt ? `<button class="icon" data-act="bill-photo" data-id="${b.id}" title="Ver recibo">📎</button>` : ''}
        <button class="icon" data-act="bill-edit" data-id="${b.id}">✎</button></div>`).join('')
        || '<div class="muted" style="margin-top:8px">Sin registro este mes</div>'}
    </div>`;
  }).join('');
  return monthBar() + `<div class="head">
      <span class="muted">Total del mes: <b>${money(sum(S.bills.filter(b => b.month === ui.month)))}</b></span>
      <button class="btn" data-act="svc-add">+ Nuevo servicio / gasto</button></div>
    <div class="grid">${cards}</div>`;
}

const SHOP_CATS = [['Limpieza', '🧽'], ['Baños', '🚿'], ['Cocina', '🍳'], ['Nevera', '🧊']];
// Los ítems creados antes de las categorías (o con una que ya no existe) van a "Otros".
const catOf = i => SHOP_CATS.some(([c]) => c === i.category) ? i.category : 'Otros';
const estimate = items => items.reduce((t, i) => t + (i.price || 0) * (i.qty || 1), 0);

// En compras, `done` significa "hay en la casa"; sin marcar significa "falta".
function vCompras() {
  const pend = S.shopping.filter(i => !i.done);
  const line = i => `<div class="item">
    <button class="badge ${i.done ? 'paid' : 'pend'}" style="border:0;min-width:58px" data-act="buy-toggle" data-id="${i.id}"
      title="Cambiar a ${i.done ? 'Falta' : 'Hay'}">${i.done ? '✔ Hay' : '✖ Falta'}</button>
    <span class="grow"><span class="name">${esc(i.name)}</span>${i.done ? '' : ` <span class="muted">×${i.qty || 1}</span>`}</span>
    <b>${!i.done && i.price ? money(i.price * (i.qty || 1)) : ''}</b>
    <button class="icon" data-act="buy-edit" data-id="${i.id}">✎</button></div>`;
  const cats = [...SHOP_CATS];
  if (S.shopping.some(i => catOf(i) === 'Otros')) cats.push(['Otros', '📦']);
  const split = c => {
    const items = S.shopping.filter(i => catOf(i) === c);
    return [items.filter(i => !i.done), items.filter(i => i.done)];
  };

  // Pantalla de una categoría
  const open = cats.find(([c]) => c === ui.shopCat);
  if (open) {
    const [c, icon] = open, [p, d] = split(c);
    return `<button class="ghost sm" data-act="shop-back" style="margin-bottom:14px">← Compras</button>
      <div class="head">
        <span class="row"><span class="cat-icon">${icon}</span><span><h2 style="margin:0">${c}</h2>
          <span class="muted">${p.length} faltan · ${d.length} hay${p.length ? ' · Estimado ' + money(estimate(p)) : ''}</span></span></span>
        ${c === 'Otros' ? '' : `<button class="btn" data-act="buy-add" data-id="${c}">+ Agregar producto</button>`}</div>
      <div class="grid two-eq">
        <div class="card"><div class="section-label warn" style="margin-top:0">✖ Falta (${p.length})</div>
          ${p.map(line).join('') || '<div class="empty">No falta nada 🎉</div>'}</div>
        <div class="card"><div class="section-label ok" style="margin-top:0">✔ Hay en casa (${d.length})</div>
          ${d.map(line).join('') || '<div class="empty">Nada registrado</div>'}</div>
      </div>`;
  }

  // Vista general: una tarjeta por categoría
  const tiles = cats.map(([c, icon]) => {
    const [p, d] = split(c), total = p.length + d.length;
    return `<button class="card tile" data-act="shop-open" data-id="${c}">
      <span class="cat-icon">${icon}</span>
      <h3>${c}</h3>
      <span class="muted">${total ? `<span class="${p.length ? 'warn' : 'ok'}"><b>${p.length}</b> faltan</span> · <b>${d.length}</b> hay` : 'Sin productos'}</span>
      <span class="progress"><i style="width:${total ? d.length / total * 100 : 0}%"></i></span>
      <span class="muted">${p.length ? 'Estimado ' + money(estimate(p)) : '&nbsp;'}</span>
    </button>`;
  }).join('');
  return `<div class="head">
    <span><h2 style="margin:0">Compras e inventario</h2><span class="muted">${pend.length} faltan · ${S.shopping.length - pend.length} hay · Estimado ${money(estimate(pend))}</span></span>
    <button class="btn" data-act="buy-add">+ Agregar</button></div>
    <div class="grid tiles">${tiles}</div>`;
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
          <span class="grow">${esc(x.desc) || esc(x.category) || (x.type === 'in' ? 'Ingreso' : 'Egreso')}<br><span class="muted">${x.date}${x.category ? ' · ' + esc(x.category) : ''}</span></span>
          <b class="${x.type === 'in' ? 'ok' : 'bad'}">${x.type === 'in' ? '+' : '−'}${money(x.amount)}</b>
          <button class="icon" data-act="tx-edit" data-id="${x.id}">✎</button></div>`).join('')
          || '<div class="empty">Sin movimientos este mes</div>'}</div>
      <div class="card"><h3 style="margin-bottom:8px">Egresos por categoría</h3>
        ${cats.map(([c, v]) => `<div class="item"><span class="grow">${esc(c)}</span><b>${money(v)}</b></div>`).join('') || '<div class="muted">—</div>'}</div>
    </div>`;
}

const FIXED_LABEL = 'Valor fijo mensual (déjalo vacío si cambia cada mes)';

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
      { name: 'fixed', label: FIXED_LABEL, type: 'number', required: false },
    ], v => { S.services.push({ id: uid(), name: v.name, icon: v.icon || '📌', fixed: v.fixed || 0 }); ensureFixedBills(); save(); });
  },
  'svc-edit'(id) {
    const s = find(S.services, id);
    openForm('Editar servicio', [
      { name: 'name', label: 'Nombre', value: s.name },
      { name: 'icon', label: 'Emoji', value: s.icon, required: false },
      { name: 'fixed', label: FIXED_LABEL, type: 'number', value: s.fixed || '', required: false },
    ], v => { s.name = v.name; s.icon = v.icon || '📌'; s.fixed = v.fixed || 0; ensureFixedBills(); save(); },
    () => { S.bills.filter(b => b.serviceId === id && b.receipt).forEach(b => delReceipt(b.id)); S.services = S.services.filter(x => x.id !== id); S.bills = S.bills.filter(b => b.serviceId !== id); save(); });
  },
  'bill-add'(id) { billForm({ serviceId: id, month: ui.month, amount: '', due: '', note: '', paid: false }, true); },
  'bill-edit'(id) { billForm(find(S.bills, id), false); },
  'bill-photo'(id) { showReceipt(find(S.bills, id)); },
  'bill-paid'(id, el) { find(S.bills, id).paid = el.checked; save(); },

  'buy-add'(cat) { buyForm({ name: '', qty: 1, price: '', category: cat || SHOP_CATS[0][0] }, true); },
  'buy-edit'(id) { buyForm(find(S.shopping, id), false); },
  'buy-toggle'(id) { const i = find(S.shopping, id); i.done = !i.done; save(); },

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
    { name: 'paid', label: 'Ya está pagado', type: 'checkbox', value: b.paid },
    { name: 'photo', label: b.receipt ? 'Reemplazar foto del recibo' : 'Foto del recibo', type: 'file', required: false },
    ...(b.receipt ? [{ name: 'rmPhoto', label: 'Quitar la foto actual', type: 'checkbox', value: false }] : []),
  ], async v => {
    const { photo, rmPhoto, ...data } = v;
    const rec = isNew ? { id: uid(), ...b } : b;
    Object.assign(rec, data);
    try {
      if (photo) { await putReceipt(rec.id, await compress(photo)); rec.receipt = true; }
      else if (rmPhoto) { await delReceipt(rec.id); rec.receipt = false; }
    } catch (e) { alert('No se pudo guardar la foto: ' + e.message); }
    if (isNew) S.bills.push(rec);
    save();
  },
  isNew ? null : () => { delReceipt(b.id); S.bills = S.bills.filter(x => x.id !== b.id); save(); });
}

async function showReceipt(b) {
  const f = $('#dlg-form'), dlg = $('#dlg');
  f.innerHTML = `<h2>Recibo · ${esc(svc(b.serviceId)?.name)} · ${monthLabel(b.month)}</h2><div class="empty" id="r-img">Cargando…</div>
    <div class="actions"><button class="btn" value="ok">Cerrar</button></div>`;
  f.onsubmit = e => { e.preventDefault(); dlg.close(); };
  dlg.showModal();
  try {
    const data = await getReceipt(b.id);
    $('#r-img').outerHTML = data ? `<a href="${data}" target="_blank"><img src="${data}" alt="Recibo" style="width:100%;border-radius:8px"></a>` : '<div class="empty">No se encontró la foto</div>';
  } catch (e) { $('#r-img').textContent = 'Error: ' + e.message; }
}

function buyForm(i, isNew) {
  openForm(isNew ? 'Agregar producto' : 'Editar producto', [
    { name: 'name', label: 'Producto', value: i.name },
    { name: 'status', label: 'Estado', type: 'select', value: i.done ? 'hay' : 'falta',
      options: [{ v: 'falta', t: '✖ Falta (hay que comprar)' }, { v: 'hay', t: '✔ Hay en casa' }] },
    { name: 'qty', label: 'Cantidad a comprar', type: 'number', value: i.qty },
    { name: 'price', label: 'Precio unitario estimado', type: 'number', value: i.price, required: false },
    { name: 'category', label: 'Categoría', type: 'select', value: catOf(i) === 'Otros' ? SHOP_CATS[0][0] : i.category,
      options: SHOP_CATS.map(([c, icon]) => ({ v: c, t: `${icon} ${c}` })) },
  ], ({ status, ...v }) => {
    Object.assign(i, v, { done: status === 'hay' });
    if (isNew) S.shopping.push({ id: uid(), ...i });
    save();
  },
  isNew ? null : () => { S.shopping = S.shopping.filter(x => x.id !== i.id); save(); });
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
if (!cloud && ensureFixedBills()) cache();
render();
