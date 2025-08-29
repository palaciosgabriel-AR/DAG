// sync.js — runner/seekers, stable heartbeat, epoch reset, single player choice

/* ---------- Firebase config ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
  authDomain: "daeg-d59cf.firebaseapp.com",
  projectId: "daeg-d59cf",
  storageBucket: "daeg-d59cf.firebasestorage.app",
  messagingSenderId: "862000912172",
  appId: "1:862000912172:web:27e96ecff42a6806897e89",
  measurementId: "G-Y0LLM4HYLP"
};
const GAME_ID = "DAEG";
const PROJECT = firebaseConfig.projectId;
const DOCPATH = `games/${GAME_ID}`;

/* Keys synced via revMap (runner field is separate) */
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer","tasksLocked",
  "stateEpoch"
];

const RUNNER_TTL_MS = 90_000;
const HEARTBEAT_MS  = 10_000;
const DEBUG = true;
const log  = (...a)=>{ if (DEBUG) console.log("[sync]", ...a); };
const warn = (...a)=>console.warn("[sync]", ...a);

/* ---------- Firebase SDK ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const gameRef = doc(db, "games", GAME_ID);
let uid = "anon";

/* ---------- Identity + player ---------- */
function ensureClientId(){
  let id = localStorage.getItem("clientId");
  if (!id) { id = `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`; localStorage.setItem("clientId", id); }
  return id;
}
const clientId = ensureClientId();

function getMyPlayer(){
  const p = localStorage.getItem("myPlayer") || "D";
  return (p==="D"||p==="Ä"||p==="G") ? p : "D";
}
function setMyPlayer(p){
  localStorage.setItem("myPlayer", p);
  if (isRunnerHere()) requestImmediateHeartbeat();
}

/* ---------- Badge ---------- */
const statusEl = (() => {
  const el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `
    margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;
    border:1px solid rgba(255,255,255,.5);
    background:rgba(255,255,255,.15); color:#fff; font-size:.8rem; white-space:nowrap;
  `;
  (document.querySelector('.data-actions') || document.querySelector('.topbar'))?.appendChild(el);
  return el;
})();
function setBadge(mode, epoch){
  const tone =
    mode==='writeable' ? 'rgba(46,204,113,.25)' :
    mode==='read-only' ? 'rgba(241,196,15,.25)' :
                          'rgba(255,255,255,.15)';
  statusEl.style.background = tone;
  statusEl.textContent = `Live: ${mode} · ${PROJECT}/${GAME_ID} · epoch ${epoch ?? (getLocalEpoch()||0)}`;
  statusEl.title = `Project: ${PROJECT}\nDoc: ${DOCPATH}\nClient: ${clientId}`;
}

/* ---------- Runner UI controls (player picker + runner buttons) ---------- */
const roleBox = (() => {
  const topbar = document.querySelector('.topbar');
  const container = document.createElement('div');
  container.className = 'rolebox';
  container.style.cssText = 'display:flex;gap:.5rem;align-items:center;justify-self:end;';
  const label = document.createElement('span');
  label.id = 'roleLabel';
  label.style.cssText = 'font-weight:700;padding:.2rem .5rem;border:1px solid rgba(255,255,255,.5);border-radius:.5rem;background:rgba(255,255,255,.15);';
  const selWrap = document.createElement('label');
  selWrap.style.cssText = 'display:inline-flex;gap:.35rem;align-items:center;';
  selWrap.innerHTML = '<span>I am:</span>';
  const sel = document.createElement('select');
  sel.id = 'playerSelect';
  ['D','Ä','G'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
  sel.value = getMyPlayer();
  sel.addEventListener('change', ()=> setMyPlayer(sel.value));
  selWrap.appendChild(sel);
  const takeBtn = document.createElement('button');
  takeBtn.id = 'becomeRunner';
  takeBtn.className = 'btn btn-small';
  takeBtn.textContent = 'Become runner';
  const giveBtn = document.createElement('button');
  giveBtn.id = 'relinquishRunner';
  giveBtn.className = 'btn btn-small';
  giveBtn.textContent = 'Relinquish';
  container.append(label, selWrap, takeBtn, giveBtn);
  topbar?.appendChild(container);
  return { label, sel, takeBtn, giveBtn };
})();

/* ---------- Helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS) x[k] = safeParse(localStorage.getItem(k)); return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return Math.random().toString(36); } }
function getLocalEpoch(){ const raw = localStorage.getItem('stateEpoch'); const n = raw==null ? 0 : Number(raw.replace(/^"|"$/g,'')); return Number.isFinite(n)?n:0; }
function setLocalEpoch(n){ localStorage.setItem('stateEpoch', String(n)); }
function nowMs(){ return Date.now(); }
function tsMillis(x){
  if (!x) return null;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (typeof x.seconds === 'number') return x.seconds*1000;
  const n = Number(x); return Number.isFinite(n) ? n : null;
}

/* ---------- revMap ---------- */
let revMap = safeParse(localStorage.getItem('revMap')) || {};
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return Number.isInteger(revMap[key]) ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Engine state ---------- */
let applyingRemote = false;
let writeable = false;
let pushTimer = null;
let lastSentFingerprint = '';
const changedKeys = new Set();

/* ---------- Runner state (stable) ---------- */
let currentRunner = null; // {id, player, lastSeen, since}
let lastSnapshotEpoch = 0;

function runnerExpired(r){
  if (!r) return true;
  if (r.id === clientId) return false;                 // <- I am runner: never consider expired (prevents flicker)
  const ms = tsMillis(r.lastSeen);
  if (ms == null) return false;                        // unknown => assume alive
  return (nowMs() - ms) > RUNNER_TTL_MS;
}
function isRunnerHere(){ return currentRunner && currentRunner.id === clientId; }
function canEdit(){ return isRunnerHere(); }
window.canEdit = canEdit;

/* Heartbeat (runner only) */
let hbTimer = null, hbPending = false;
function requestImmediateHeartbeat(){ if (isRunnerHere() && !hbPending) heartbeat(); }
async function heartbeat(){
  if (!isRunnerHere()) return;
  hbPending = true;
  try {
    await setDoc(gameRef, {
      runner: { id: clientId, player: getMyPlayer(), lastSeen: serverTimestamp(), since: currentRunner?.since || serverTimestamp() }
    }, { merge:true });
  } finally { hbPending = false; }
}
function startHeartbeat(){ stopHeartbeat(); requestImmediateHeartbeat(); hbTimer = setInterval(()=>heartbeat(), HEARTBEAT_MS); }
function stopHeartbeat(){ if (hbTimer) clearInterval(hbTimer); hbTimer = null; }

/* UI role update */
function updateRoleUI(){
  const role = isRunnerHere() ? `Runner (${getMyPlayer()})` : `Seeker (${getMyPlayer()})`;
  roleBox.label.textContent = role;
  roleBox.takeBtn.style.display = isRunnerHere() ? 'none' : 'inline-block';
  roleBox.giveBtn.style.display = isRunnerHere() ? 'inline-block' : 'none';
  document.body.setAttribute('data-edit', canEdit() ? '1' : '0');
  window.dispatchEvent(new CustomEvent('daeg-edit-state', { detail: { canEdit: canEdit() } }));
}

/* Become / Relinquish */
async function becomeRunner(){
  try{
    const snap = await getDoc(gameRef);
    const server = snap.exists() ? (snap.data() || {}) : {};
    const r = server.runner || null;
    if (r && !runnerExpired(r) && r.id !== clientId) {
      const ok = confirm(`Switch runner from ${r.player || 'unknown'} to you (${getMyPlayer()})?`);
      if (!ok) return;
    }
    await setDoc(gameRef, { runner: { id: clientId, player: getMyPlayer(), lastSeen: serverTimestamp(), since: serverTimestamp() } }, { merge:true });
    startHeartbeat();                                   // start immediately; no more flicker
  }catch(e){ warn('becomeRunner failed:', e); alert('Failed to become runner.'); }
}
async function relinquishRunner(){
  try{
    if (!isRunnerHere()) return;
    await setDoc(gameRef, { runner: deleteField() }, { merge:true });
  }catch(e){ warn('relinquish failed:', e); }
}
roleBox.takeBtn.addEventListener('click', becomeRunner);
roleBox.giveBtn.addEventListener('click', relinquishRunner);

/* ---------- Apply remote (epoch-aware) ---------- */
function isEmptyTasks(obj){ if (!obj || typeof obj!=='object') return true; const ks=Object.keys(obj); if(!ks.length) return true; return !Object.values(obj).some(v=>String(v??'').trim()!==''); }
function hasAnyTasks(obj){ if (!obj || typeof obj!=='object') return false; return Object.values(obj).some(v=>String(v??'').trim()!==''); }

function applyRemote(data){
  const incomingRev = data.revMap || {};
  const remoteEpoch = Number(data.stateEpoch || 0);
  const localEpoch  = getLocalEpoch();
  const epochOverride = remoteEpoch > localEpoch;

  if (data.revMap && typeof data.revMap === 'object') { revMap = { ...revMap, ...data.revMap }; saveRevMap(); }

  currentRunner = data.runner || null;
  lastSnapshotEpoch = remoteEpoch;

  applyingRemote = true;
  let anyChanged = false;
  try {
    if (epochOverride) {
      setLocalEpoch(remoteEpoch);
      for (const k of KEYS){
        if (!(k in data)) continue;
        localStorage.setItem(k, JSON.stringify(data[k]));
        if (k !== 'stateEpoch') { const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0; revMap[k] = incRev; }
      }
      saveRevMap();
      anyChanged = true;
      log("epoch override -> adopted server state (epoch", remoteEpoch, ")");
    } else {
      for (const k of KEYS){
        if (!(k in data)) continue;
        if (k === 'stateEpoch') continue;
        const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
        const localStr = localStorage.getItem(k);
        const locRev = getRev(k);
        let shouldApply = false;
        if (localStr == null) shouldApply = true;
        else if (incRev > locRev) shouldApply = true;
        else if (k === 'tasksByNumber') {
          const localVal  = safeParse(localStr);
          const remoteVal = data[k];
          if (isEmptyTasks(localVal) && hasAnyTasks(remoteVal)) shouldApply = true;
        }
        if (shouldApply){ localStorage.setItem(k, JSON.stringify(data[k])); revMap[k] = incRev; anyChanged = true; }
      }
      if (anyChanged) saveRevMap();
    }
  } finally { applyingRemote = false; }

  updateRoleUI();
  setBadge(writeable ? 'writeable' : 'read-only', remoteEpoch || localEpoch);
  if (isRunnerHere()) startHeartbeat(); else stopHeartbeat();
  if (anyChanged) window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

/* ---------- Push changes ---------- */
function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }
async function pushNow(){
  try{
    if (changedKeys.size === 0) return;
    const allLocal = packLocal();
    const payload = {};
    for (const k of changedKeys){ if (k in allLocal) payload[k] = allLocal[k]; }
    const sendBody = { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:12 }, ...payload };
    const fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;
    await setDoc(gameRef, sendBody, { merge:true });
    lastSentFingerprint = fp;
    changedKeys.clear();
  }catch(err){
    warn("push failed:", err?.code || err?.message || err);
    writeable = false; setBadge('read-only', lastSnapshotEpoch || getLocalEpoch());
    setTimeout(probeWrite, 1500);
  }
}
window.daegSyncTouch = function(){ schedulePush(); };

/* Intercept local writes: bump rev + mark changed */
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  const before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.includes(k) && before !== v) { bumpRev(k); changedKeys.add(k); schedulePush(); }
};

/* ---------- Restore / Reset ---------- */
window.daegSyncRestore = async function(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot');
  for (const k of KEYS){ if (Object.prototype.hasOwnProperty.call(snapshot, k)) localStorage.setItem(k, JSON.stringify(snapshot[k])); }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  await pushNow();
};

function initialSnapshot(preservedTasks){
  const currentDark = localStorage.getItem('dark') || '0';
  return {
    dark: currentDark,
    usedSets: { D:[], Ä:[], G:[] },
    logEntries: [],
    tasksByNumber: preservedTasks || {},
    playerPoints: { D:500, Ä:500, G:500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D'
  };
}

async function doRemoteReset(){
  if (!isRunnerHere()) { alert('Only the Runner can reset.'); throw new Error('not-runner'); }
  if (!writeable)      { alert('This device is read-only.'); throw new Error('read-only'); }

  let server = {};
  try { const snap = await getDoc(gameRef); if (snap.exists()) server = snap.data() || {}; } catch {}
  const nextEpoch = Math.max(Number(server.stateEpoch||0), getLocalEpoch()) + 1;
  const preservedTasks = (server.tasksByNumber && Object.keys(server.tasksByNumber).length)
    ? server.tasksByNumber : (packLocal().tasksByNumber || {});
  const fresh = initialSnapshot(preservedTasks);
  fresh.stateEpoch = nextEpoch;

  for (const k of ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"]) { bumpRev(k); changedKeys.add(k); }
  setLocalEpoch(nextEpoch); changedKeys.add("stateEpoch");

  applyingRemote = true; try { for (const k of Object.keys(fresh)) localStorage.setItem(k, JSON.stringify(fresh[k])); } finally { applyingRemote = false; }
  await setDoc(gameRef, { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:12 }, ...fresh }, { merge:true });
  changedKeys.clear();
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  return true;
}
window.daegSyncReset = doRemoteReset;

/* ---------- Write probe + start ---------- */
async function probeWrite(){
  try{ await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true }); writeable = true; setBadge('writeable', lastSnapshotEpoch || getLocalEpoch()); }
  catch(err){ writeable = false; setBadge('read-only', lastSnapshotEpoch || getLocalEpoch()); warn("write probe failed:", err?.code || err?.message || err); }
}

async function start(){
  try {
    if (!auth.currentUser) { try { await signInAnonymously(auth); } catch(e){ warn("anon sign-in failed:", e); } }
    uid = auth.currentUser?.uid || "anon";
    try{ const snap = await getDoc(gameRef); if (snap.exists()) applyRemote(snap.data() || {}); } catch(e){ warn("initial getDoc failed:", e); }
    onSnapshot(gameRef, s => { if (s.exists()) applyRemote(s.data() || {}); }, err => warn("onSnapshot error:", err));
    await probeWrite();
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);
  } catch (e) { warn("fatal start error:", e); setBadge('error', lastSnapshotEpoch || getLocalEpoch()); }
}
start();

// Expose
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID, clientId };
