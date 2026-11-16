// ===== Konfigurasi =====
const KEY_TOKEN = 'fat.token';
const KEY_URL = 'fat.apiUrl';
const STATUS_RANK = { Tercapai: 3, Sebagian: 2, Belum: 1 };

const state = { pic: [], tugas: [], rows: [], editing: null };
let status = '';
let toastTimer = null;

// ===== Utilitas =====
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTgl(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

function badgeClass(s) {
  if (s === 'Tercapai') return 'b-ok';
  if (s === 'Sebagian') return 'b-part';
  if (s === 'Belum') return 'b-no';
  return 'b-empty';
}

function weekRange(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // Senin = 0
  const mon = new Date(d);
  mon.setDate(d.getDate() - day);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: isoDate(mon), to: isoDate(sun) };
}

function snapshot(r) {
  return { tanggal: r.tanggal, pic: r.pic, tugasId: r.tugasId, status: r.status, catatan: r.catatan || '' };
}

function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

async function busy(fn) {
  $('loading').classList.remove('hidden');
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
    return undefined;
  } finally {
    $('loading').classList.add('hidden');
  }
}

function confirmBox(text) {
  return new Promise((resolve) => {
    $('modal-text').textContent = text;
    $('modal').classList.remove('hidden');
    const done = (v) => {
      $('modal').classList.add('hidden');
      $('modal-yes').onclick = null;
      $('modal-no').onclick = null;
      resolve(v);
    };
    $('modal-yes').onclick = () => done(true);
    $('modal-no').onclick = () => done(false);
  });
}

// ===== Komunikasi dengan Apps Script =====
function getUrl() { return localStorage.getItem(KEY_URL) || ''; }
function getToken() { return localStorage.getItem(KEY_TOKEN) || ''; }

async function api(action, { method = 'GET', body = {}, params = {} } = {}) {
  const url = getUrl();
  if (!url) throw new Error('Alamat Apps Script belum diisi.');
  let res;
  if (method === 'GET') {
    const q = new URLSearchParams({ action, token: getToken(), ...params });
    res = await fetch(`${url}?${q.toString()}`);
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken(), ...body }),
    });
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Terjadi kesalahan.');
  return json;
}

// ===== Login & konfigurasi =====
function showLogin(msg = '') {
  $('view-login').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('url-wrap').classList.toggle('hidden', !!getUrl());
  $('login-error').textContent = msg;
}

function showApp() {
  $('view-login').classList.add('hidden');
  $('app').classList.remove('hidden');
  go('input');
}

async function loadConfig() {
  try {
    const cfg = await api('config');
    state.pic = cfg.pic;
    state.tugas = cfg.tugas;
    fillPicSelects();
    return '';
  } catch (e) {
    return e.message;
  }
}

function fillPicSelects() {
  const opts = state.pic.map((p) => `<option value="${esc(p.nama)}">${esc(p.nama)}</option>`).join('');
  $('f-pic').innerHTML = opts;
  $('h-pic').innerHTML = '<option value="">Semua PIC</option>' + opts;
  fillTugas();
}

function fillTugas() {
  const pic = $('f-pic').value;
  const list = state.tugas.filter((t) => t.pic === pic);
  $('f-tugas').innerHTML = list
    .map((t) => `<option value="${esc(t.id)}">[${esc(t.kategori)}] ${esc(t.nama)}</option>`)
    .join('');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const typedUrl = $('login-url').value.trim();
  if (typedUrl) localStorage.setItem(KEY_URL, typedUrl);
  if (!getUrl()) return showLogin('Isi alamat Apps Script dulu.');
  localStorage.setItem(KEY_TOKEN, $('login-token').value);
  $('login-error').textContent = '';
  $('loading').classList.remove('hidden');
  const err = await loadConfig();
  $('loading').classList.add('hidden');
  if (err) {
    localStorage.removeItem(KEY_TOKEN);
    return showLogin(err);
  }
  $('login-token').value = '';
  showApp();
});

$('btn-logout').addEventListener('click', () => {
  localStorage.removeItem(KEY_TOKEN);
  state.rows = [];
  resetForm();
  showLogin();
});

// ===== Navigasi =====
function go(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.bottom-nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (view === 'input' && !state.editing) resetForm();
  if (view === 'riwayat') loadRiwayat();
  if (view === 'rekap') loadRekap();
}

document.querySelectorAll('.bottom-nav button').forEach((b) => {
  b.addEventListener('click', () => go(b.dataset.view));
});

// ===== Form input / edit =====
function setStatus(s) {
  status = s;
  document.querySelectorAll('#f-status button').forEach((b) => {
    b.classList.toggle('on', b.dataset.status === s);
  });
}

document.querySelectorAll('#f-status button').forEach((b) => {
  b.addEventListener('click', () => setStatus(b.dataset.status));
});

$('f-pic').addEventListener('change', fillTugas);

function resetForm() {
  state.editing = null;
  $('form-title').textContent = 'Input aktivitas';
  $('f-tanggal').value = todayIso();
  $('f-catatan').value = '';
  $('form-error').textContent = '';
  setStatus('');
  $('btn-save').textContent = 'Simpan';
  $('btn-cancel-edit').classList.add('hidden');
  $('btn-delete').classList.add('hidden');
  fillTugas();
}

function startEdit(row) {
  state.editing = row;
  $('form-title').textContent = 'Ubah aktivitas';
  $('f-tanggal').value = row.tanggal;
  $('f-pic').value = row.pic;
  fillTugas();
  $('f-tugas').value = row.tugasId;
  $('f-catatan').value = row.catatan || '';
  setStatus(row.status);
  $('form-error').textContent = '';
  $('btn-save').textContent = 'Simpan perubahan';
  $('btn-cancel-edit').classList.remove('hidden');
  $('btn-delete').classList.remove('hidden');
  go('input');
}

$('btn-cancel-edit').addEventListener('click', resetForm);

function validateForm(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tanggal)) return 'Tanggal tidak valid.';
  if (!d.pic) return 'Pilih PIC.';
  if (!d.tugasId) return 'Pilih tugas.';
  if (!['Tercapai', 'Sebagian', 'Belum'].includes(d.status)) return 'Pilih status.';
  return '';
}

$('activity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    tanggal: $('f-tanggal').value,
    pic: $('f-pic').value,
    tugasId: $('f-tugas').value,
    status: status,
    catatan: $('f-catatan').value.trim(),
  };
  const err = validateForm(data);
  $('form-error').textContent = err;
  if (err) return;

  const ed = state.editing;
  const ok = await busy(() => (ed
    ? api('update', { method: 'POST', body: { row: ed.row, original: snapshot(ed), data } })
    : api('add', { method: 'POST', body: { data } })));
  if (ok === undefined) return;

  if (ed) {
    toast('Perubahan tersimpan.');
    resetForm();
    go('riwayat');
  } else {
    toast('Aktivitas tersimpan.');
    const pic = data.pic;
    const tgl = data.tanggal;
    resetForm();
    $('f-pic').value = pic;
    $('f-tanggal').value = tgl;
    fillTugas();
  }
});

$('btn-delete').addEventListener('click', async () => {
  const ed = state.editing;
  if (!ed) return;
  const yes = await confirmBox('Hapus aktivitas ini? Data tidak bisa dikembalikan.');
  if (!yes) return;
  const ok = await busy(() => api('delete', {
    method: 'POST',
    body: { row: ed.row, original: snapshot(ed) },
  }));
  if (ok === undefined) return;
  toast('Aktivitas dihapus.');
  resetForm();
  go('riwayat');
});

// ===== Riwayat =====
async function loadRiwayat() {
  const params = {};
  const tgl = $('h-tanggal').value;
  const pic = $('h-pic').value;
  if (tgl) { params.from = tgl; params.to = tgl; }
  if (pic) params.pic = pic;
  const res = await busy(() => api('list', { params }));
  if (!res) return;
  state.rows = res.rows;
  renderRiwayat();
}

function renderRiwayat() {
  const box = $('list');
  if (!state.rows.length) {
    box.innerHTML = '<p class="muted center">Belum ada aktivitas.</p>';
    return;
  }
  box.innerHTML = state.rows.map((r) => `
    <article class="item">
      <div class="meta">
        <span class="chip">${esc(r.pic)}</span>
        <span>${esc(fmtTgl(r.tanggal))}</span>
        <span>${esc(r.frekuensi)}</span>
      </div>
      <h3>${esc(r.nama)}</h3>
      <div class="row"><span class="badge ${badgeClass(r.status)}">${esc(r.status)}</span></div>
      ${r.catatan ? `<p class="muted">${esc(r.catatan)}</p>` : ''}
      <div class="row end">
        <button class="btn-ghost small" type="button" data-edit="${r.row}">Ubah</button>
        <button class="btn-danger small" type="button" data-del="${r.row}">Hapus</button>
      </div>
    </article>`).join('');
}

$('list').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const r = state.rows.find((x) => String(x.row) === editId);
    if (r) startEdit(r);
  }
  if (delId) {
    const r = state.rows.find((x) => String(x.row) === delId);
    if (!r) return;
    const yes = await confirmBox('Hapus aktivitas ini? Data tidak bisa dikembalikan.');
    if (!yes) return;
    const ok = await busy(() => api('delete', {
      method: 'POST',
      body: { row: r.row, original: snapshot(r) },
    }));
    if (ok === undefined) return;
    toast('Aktivitas dihapus.');
    loadRiwayat();
  }
});

$('h-pic').addEventListener('change', loadRiwayat);
$('h-tanggal').addEventListener('change', loadRiwayat);

// ===== Rekap mingguan =====
async function loadRekap() {
  if (!$('r-tanggal').value) $('r-tanggal').value = todayIso();
  const { from, to } = weekRange($('r-tanggal').value);
  $('r-range').textContent = `Minggu ${fmtTgl(from)} s/d ${fmtTgl(to)}`;
  const res = await busy(() => api('list', { params: { from, to } }));
  if (!res) return;
  renderRekap(res.rows);
}

function renderRekap(rows) {
  $('rekap').innerHTML = state.pic.map((p) => {
    const tasks = state.tugas.filter((t) => t.pic === p.nama);
    let done = 0;
    const lines = tasks.map((t) => {
      const entries = rows.filter((r) => r.tugasId === t.id);
      let best = '';
      entries.forEach((r) => {
        if ((STATUS_RANK[r.status] || 0) > (STATUS_RANK[best] || 0)) best = r.status;
      });
      if (best === 'Tercapai') done++;
      const label = best || 'Belum diisi';
      const cls = best ? badgeClass(best) : 'b-empty';
      const count = entries.length ? `${entries.length}x` : '';
      return `<li>
        <span class="badge ${cls}">${esc(label)}</span>
        <span>${esc(t.nama)}</span>
        <small class="muted">${count}</small>
      </li>`;
    }).join('');
    return `<article class="card">
      <h3>${esc(p.nama)} <small class="muted">${done}/${tasks.length} tercapai</small></h3>
      ${p.pelapor ? `<p class="muted">Lapor ke ${esc(p.pelapor)}</p>` : ''}
      <ul class="rekap">${lines}</ul>
    </article>`;
  }).join('');
}

$('r-tanggal').addEventListener('change', loadRekap);

// ===== Mulai =====
function init() {
  $('f-tanggal').value = todayIso();
  if (getToken() && getUrl()) {
    $('loading').classList.remove('hidden');
    loadConfig().then((err) => {
      $('loading').classList.add('hidden');
      if (err) {
        localStorage.removeItem(KEY_TOKEN);
        showLogin(err);
      } else {
        showApp();
      }
    });
  } else {
    showLogin();
  }
}

init();
