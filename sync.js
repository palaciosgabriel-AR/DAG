// sync.js — Stable realtime sync for DÄG
// - Firebase v12.1.0 ESM (CDN)
// - Per-key revision map (prevents stale overwrites)
// - Import/Restore to cloud, Reset (keeps tasks), Tasks lock
// - Robust "apply" rules so new devices & blank caches adopt server state
// - Minimal logging (can be turned off by setting DEBUG=false)

/* ---------- Config ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
  authDomain: "daeg-d59cf.firebaseapp.com",
  projectId: "daeg-d59cf",
  storageBucket: "daeg-d59cf.firebasestorage.app",
  messagingSenderId: "862000912172",
  appId: "1:862000912172:web:27e96ecff42a6806897e89",
  measurementId: "G-Y0LLM4HYLP"
};
const GAME_ID = "DAEG"; // your live doc

// All keys we sync (including tasksLocked)
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer",
  "tasksLocked"
];

// Debug logging toggle
const DEBUG = true;
function log(...a){ if (DEBUG) console.log("[sync]", ...a); }
function warn(...a){ console.warn("[sync]", ...a); }

/* ---------- Firebase ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const gameRef = doc(db, "games", GAME_ID);
let uid = "anon";

/* ---------- Status badge ---------- */
const statusEl = (() => {
  const el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `
    margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;
    border:1px solid rgba(255,255,255,.5);
    background:rgba(255,255,255,.15); color:#fff; font-size:.8rem;
  `;
  (document.querySelector('.data-actions') || document.querySelector('.topbar'))?.appendChild(el);
  return el;
})();
function setStatus(text, tone='info'){
  if (!statusEl) return;
  statusEl.textContent = `Live: ${text}`;
  statusEl.style.background =
    tone==='ok'  ? 'rgba(46,204,113,.25)' :
    tone==='ro'  ? 'rgba(241,196,15,.25)' :
    tone==='err' ? 'rgba(231,76,60,.25)' :
                   'rgba(255,255,255,.15)';
}
setStatus('connecting…');

/* ---------- Helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS) x[k] = safeParse(localStorage.getItem(k)); return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return Math.random().toString(36); } }

function isEmptyTasks(obj){
  if (!obj || typeof obj !== 'object') return true;
  const ks = Object.keys(obj);
  if (ks.length === 0) return true;
  for (const k of ks){
    const v = obj[k];
    if (String(v||'').trim() !== '') return false;
  }
  return true;
}
function hasAnyTasks(obj){
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some(v => String(v||'').trim() !== '');
}

/* ---------- Per-key revision map ---------- */
let revMap = safeParse(localStorage.getItem('revMap')) || {}; // {key:int}
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return Number.isInteger(revMap[key]) ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Engine state ---------- */
let applyingRemote = false;
let writeable = false;
let pushTimer = null;
let lastSentFingerprint = '';
const changedKeys = new Set();

/* ---------- Apply remote (stable rules) ---------- */
function applyRemote(data){
  const incomingRev = data.revMap || {};

  // Merge remote counters first so comparisons are fair
  if (data.revMap && typeof data.revMap === 'object') {
    revMap = { ...revMap, ...data.revMap };
    saveRevMap();
  }

  applyingRemote = true;
  let anyChanged = false;

  try {
    for (const k of KEYS){
      if (!(k in data)) continue;

      const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
      const localStr = localStorage.getItem(k);
      const localHasValue = localStr != null;
      const locRev = getRev(k);

      let shouldApply = false;

      // 1) If local missing -> adopt remote
      if (!localHasValue) {
        shouldApply = true;
      }
      // 2) Otherwise, adopt only if remote rev is strictly newer
      else if (incRev > locRev) {
        shouldApply = true;
      }
      // 3) Healing for tasks: if local tasks are empty-ish but remote has content, adopt
      else if (k === 'tasksByNumber') {
        const localVal  = safeParse(localStr);
        const remoteVal = data[k];
        if (isEmptyTasks(localVal) && hasAnyTasks(remoteVal)) {
          shouldApply = true;
        }
      }

      if (shouldApply){
        localStorage.setItem(k, JSON.stringify(data[k]));
        revMap[k] = incRev; // adopt remote counter we just applied
        anyChanged = true;
        log("applied", k, "(incRev:", incRev, "locRev:", locRev, ")");
      }
    }
    if (anyChanged) saveRevMap();
  } finally {
    applyingRemote = false;
  }

  if (anyChanged) {
    window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  }
}

/* ---------- Push changes ---------- */
function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }

async function pushNow(){
  try{
    if (changedKeys.size === 0) return;

    const allLocal = packLocal();
    const payload = {};
    for (const k of changedKeys){ if (k in allLocal) payload[k] = allLocal[k]; }

    const sendBody = { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:7 }, ...payload };
    const fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;

    await setDoc(gameRef, sendBody, { merge:true });
    lastSentFingerprint = fp;
    changedKeys.clear();
    log("pushed keys:", Object.keys(payload));
  }catch(err){
    warn("push failed:", err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

/* Expose a nudge */
window.daegSyncTouch = function(){ schedulePush(); };

/* Intercept local writes: bump rev + mark changed */
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  const before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.includes(k) && before !== v) {
    bumpRev(k);
    changedKeys.add(k);
    schedulePush();
  }
};

/* ---------- Cloud-safe Import / Restore ---------- */
window.daegSyncRestore = async function(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot');
  for (const k of KEYS){
    if (Object.prototype.hasOwnProperty.call(snapshot, k)) {
      localStorage.setItem(k, JSON.stringify(snapshot[k]));
    }
  }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  await pushNow();
};

/* ---------- Remote RESET (keeps tasks) ---------- */
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
  if (!writeable) { alert('This device is read-only (not signed in). Try another device/network.'); return; }

  let preservedTasks = {};
  try { const snap = await getDoc(gameRef); if (snap.exists()) preservedTasks = snap.data()?.tasksByNumber || {}; } catch {}
  if (!preservedTasks || Object.keys(preservedTasks).length === 0) preservedTasks = packLocal().tasksByNumber || {};

  const fresh = initialSnapshot(preservedTasks);

  // bump revs for the keys we reset
  for (const k of ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"]) {
    bumpRev(k); changedKeys.add(k);
  }

  applyingRemote = true;
  try { for (const k of Object.keys(fresh)) localStorage.setItem(k, JSON.stringify(fresh[k])); }
  finally { applyingRemote = false; }

  await setDoc(gameRef, { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:7 }, ...fresh }, { merge:true });
  changedKeys.clear();
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}
window.daegSyncReset = doRemoteReset;

/* ---------- Write probe ---------- */
async function probeWrite(){
  try{
    await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true });
    writeable = true; setStatus('writeable', 'ok');
  }catch(err){
    writeable = false; setStatus('read-only', 'ro');
    warn("write probe failed:", err?.code || err?.message || err);
  }
}

/* ---------- Start ---------- */
async function start(){
  try {
    if (!auth.currentUser) {
      try { await signInAnonymously(auth); }
      catch (e) { warn("anon sign-in failed:", e); }
    }
    uid = auth.currentUser?.uid || "anon";

    // Initial remote read (if exists)
    try{
      const snap = await getDoc(gameRef);
      if (snap.exists()){
        const data = snap.data() || {};
        applyRemote(data);
      } else {
        log("no remote doc yet; will create on first change");
      }
    }catch(e){ warn("initial getDoc failed:", e); }

    // Live updates
    onSnapshot(gameRef,
      s => { if (s.exists()) applyRemote(s.data() || {}); },
      err => warn("onSnapshot error:", err)
    );

    await probeWrite();

    // Heartbeat: only pushes if there are pending changes
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);
  } catch (e) {
    warn("fatal start error:", e);
    setStatus('error', 'err');
  }
}
start();
