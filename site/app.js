// PayLab frontend: plain JavaScript, no framework, no build step.
// All API calls go to API_BASE + "/api/...". API_BASE comes from config.js
// (generated at container start); "" means "same origin as this page".

const API_BASE = (window.PAYLAB_API_BASE || '').replace(/\/+$/, '');
const POLL_MS = 4000;
const STORAGE_KEY = 'paylab.handle';

// Money: the API stores kobo (integers). We show naira.
const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
const fmt = (kobo) => naira.format(Number(kobo) / 100);
const toKobo = (value) => Math.round(Number(value) * 100);
const cleanHandle = (h) => String(h || '').trim().toLowerCase().replace(/^@/, '');

const $ = (id) => document.getElementById(id);
let me = null;        // the open wallet
let pollTimer = null;

// localStorage can be unavailable (private mode, blocked storage): never let that break the page.
const store = {
  get() { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch (e) { /* ignore */ } },
  clear() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } },
};

// --- API helper ------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function showMessage(el, kind, title, detail) {
  el.className = `result ${kind}` + (el.classList.contains('wide') ? ' wide' : '');
  el.innerHTML = '<div class="title"></div><div class="detail"></div>';
  el.querySelector('.title').textContent = title;
  el.querySelector('.detail').textContent = detail || '';
}

// --- Views -----------------------------------------------------------------
function showOnboarding() {
  me = null;
  clearInterval(pollTimer);
  $('app').classList.add('hidden');
  $('switch-wallet').classList.add('hidden');
  $('onboarding').classList.remove('hidden');
  loadDirectory();
}

async function openWallet(handle, quiet = false) {
  const { ok, status, data } = await api('GET', `/api/wallets/by-handle/${encodeURIComponent(cleanHandle(handle))}`);
  if (!ok) {
    if (!quiet) showMessage($('onboarding-msg'), 'error', `Could not open @${cleanHandle(handle)}`, data.error || `HTTP ${status}`);
    return false;
  }
  me = data;
  store.set(me.handle);
  $('onboarding').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('switch-wallet').classList.remove('hidden');
  $('result').className = 'result hidden';
  renderMe();
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, POLL_MS); // the payee sees money arrive "live"
  return true;
}

function renderMe() {
  $('balance').textContent = fmt(me.balance_kobo);
  $('who').textContent = `${me.owner} · @${me.handle}`;
}

// --- Polling: balance, history, directory ----------------------------------
async function refresh() {
  if (!me) return;
  try {
    const [wallet, payments] = await Promise.all([
      api('GET', `/api/wallets/${me.id}`),
      api('GET', `/api/payments?walletId=${me.id}`),
    ]);
    if (wallet.ok) { me = wallet.data; renderMe(); }
    if (payments.ok) renderHistory(payments.data);
    loadDirectory();
  } catch (err) {
    /* network blip: try again on the next tick */
  }
}

async function loadDirectory() {
  try {
    const { ok, data } = await api('GET', '/api/wallets');
    if (!ok) return;
    const list = $('directory');
    list.innerHTML = '';
    for (const w of data) {
      if (me && w.id === me.id) continue;
      const opt = document.createElement('option');
      opt.value = w.handle;
      opt.label = w.owner;
      list.append(opt);
    }
  } catch (err) { /* ignore */ }
}

function renderHistory(payments) {
  const list = $('history');
  list.innerHTML = '';
  if (payments.length === 0) {
    list.innerHTML = '<li class="muted">No payments yet.</li>';
    return;
  }
  for (const p of payments) {
    const sent = p.direction === 'sent';
    const li = document.createElement('li');
    li.className = `item ${p.status}`;

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'who';
    title.textContent = sent ? `To @${p.payee_handle || p.payee_wallet_id}` : `From @${p.payer_handle || p.payer_wallet_id}`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    const parts = [new Date(p.created_at).toLocaleString()];
    if (p.note) parts.push(p.note);
    if (p.status === 'failed' && p.reason) parts.push(p.reason);
    sub.textContent = parts.join(' · ');
    left.append(title, sub);

    const right = document.createElement('div');
    right.className = 'right';
    const amount = document.createElement('div');
    amount.className = `amount ${p.status === 'success' ? (sent ? 'out' : 'in') : 'void'}`;
    amount.textContent = `${sent ? '−' : '+'}${fmt(p.amount_kobo)}`;
    const pill = document.createElement('span');
    pill.className = `pill ${p.status}`;
    pill.textContent = p.status;
    right.append(amount, pill);

    li.append(left, right);
    list.append(li);
  }
}

// --- Forms -----------------------------------------------------------------
$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok, status, data } = await api('POST', '/api/wallets', {
    owner: $('create-owner').value.trim(),
    handle: cleanHandle($('create-handle').value),
  });
  if (!ok) return showMessage($('onboarding-msg'), 'error', 'Could not create wallet', data.error || `HTTP ${status}`);
  await openWallet(data.handle);
  showMessage($('result'), 'success', `Welcome, @${data.handle}!`, `Your wallet starts with ${fmt(data.balance_kobo)}.`);
});

$('open-form').addEventListener('submit', (e) => {
  e.preventDefault();
  openWallet($('open-handle').value);
});

function newReference() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PL-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me) return;
  const toHandle = cleanHandle($('to-handle').value);
  const amountKobo = toKobo($('amount').value);
  const reference = newReference(); // unique per payment; a retry of the same request reuses it
  $('send-btn').disabled = true;
  try {
    const { status, data } = await api('POST', '/api/payments', {
      fromWalletId: me.id,
      toHandle,
      amountKobo,
      reference,
      note: $('note').value.trim() || undefined,
    });
    if (data.status === 'success') {
      showMessage($('result'), 'success', `✓ Sent ${fmt(amountKobo)} to @${toHandle}`, reference);
      $('amount').value = '';
      $('note').value = '';
    } else if (data.status === 'failed') {
      showMessage($('result'), 'failed', `✗ Payment failed: ${data.reason || 'unknown reason'}`, reference);
    } else {
      showMessage($('result'), 'error', 'Payment not sent', data.reason || data.error || `HTTP ${status}`);
    }
    refresh();
  } catch (err) {
    showMessage($('result'), 'error', 'Could not reach the API', `${err.message} (API: ${API_BASE || 'same origin'})`);
  } finally {
    $('send-btn').disabled = false;
  }
});

$('switch-wallet').addEventListener('click', () => {
  store.clear();
  $('onboarding-msg').className = 'result hidden wide';
  showOnboarding();
});

// --- Start -----------------------------------------------------------------
$('api-info').textContent = `API: ${API_BASE || 'same origin'}`;
(async () => {
  const saved = store.get();
  if (!(saved && (await openWallet(saved, true).catch(() => false)))) showOnboarding();
})();
