// sync.js — Firestore <-> localStorage realtime sync (Firebase v12.1.0)
// - Status badge ("writeable"/"read-only")
// - Per-key revision map (conflict-proof)
// - Heartbeat + explicit touch()
// - Remote Reset (preserves tasks)
// - Tasks lock flag syncing
// - NEW: daegSyncRestore(snapshot) => cloud-safe import/restore

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

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Include tasksLocked so the lock syncs everywhere
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer",
  "tasksLocked"
];

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
let uid = "anon";
const gameRef = doc(db, "games", GAME_ID);

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

/* ---------- Per-key revision map (conflict prevention) ---------- */
let revMap = safeParse(localStorage.getItem('revMap')) || {};
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return Number.isInteger(revMap[key]) ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Sync engine ---------- */
let applyingRemote = false;
let writeable = false;
let hasInitialSync = false;
let pushTimer = null;
let lastSentFingerprint = '';
const changedKeys = new Set();

function applyRemote(data){
  const incomingRev = data.revMap || {};
  applyingRemote = true;
  try {
    for (const k of KEYS){
      if (!(k in data)) continue;
      const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
      const locRev = getRev(k);
      const shouldApply = !hasInitialSync || incRev > locRev;
      if (shouldApply){
        localStorage.setItem(k, JSON.stringify(data[k]));
        revMap[k] = incRev;
      }
    }
    saveRevMap();
  } finally { applyingRemote = false; }

  hasInitialSync = true;
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }

async function pushNow(){
  try{
    if (changedKeys.size === 0) return;
    const allLocal = packLocal();
    const payload = {};
    for (const k of changedKeys){ if (k in allLocal) payload[k] = allLocal[k]; }
    const sendBody = { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:3 }, ...payload };
    const fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;
    await setDoc(gameRef, sendBody, { merge:true });
    lastSentFingerprint = fp;
    changedKeys.clear();
  }catch(err){
    console.warn('[sync] push failed:', err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

// Expose a gentle nudge
window.daegSyncTouch = function(){ schedulePush(); };

// Intercept local writes to mark keys changed & bump rev
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

/* ---------- Cloud-safe IMPORT / RESTORE (new) ---------- */
/**
 * Apply a snapshot (from file) locally and push it to Firestore with higher revs,
 * so it becomes the new shared state across all devices.
 */
window.daegSyncRestore = async function(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot');

  // Apply provided keys locally (this bumps revs and marks changedKeys via our setItem interceptor)
  for (const k of KEYS){
    if (Object.prototype.hasOwnProperty.call(snapshot, k)) {
      localStorage.setItem(k, JSON.stringify(snapshot[k]));
    }
  }

  // Trigger UI update immediately
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));

  // Push to Firestore so everyone adopts the imported state
  await pushNow();
};

/* ---------- Remote RESET (preserves tasks) ---------- */
function initialSnapshot(preservedTasks){
  const currentDark = localStorage.getItem('dark') || '0';
  // tasksLocked is preserved automatically (we don't touch it here)
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

  // Preserve tasks from server if possible; else fall back to local.
  let preservedTasks = {};
  try { const snap = await getDoc(gameRef); if (snap.exists()) preservedTasks = snap.data()?.tasksByNumber || {}; } catch {}
  if (!preservedTasks || Object.keys(preservedTasks).length === 0) preservedTasks = packLocal().tasksByNumber || {};

  const fresh = initialSnapshot(preservedTasks);
  for (const k of ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"]) {
    bumpRev(k);
    changedKeys.add(k);
  }

  // Apply locally then push
  applyingRemote = true;
  try { for (const k of Object.keys(fresh)) localStorage.setItem(k, JSON.stringify(fresh[k])); }
  finally { applyingRemote = false; }
  await setDoc(gameRef, { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:3 }, ...fresh }, { merge:true });
  changedKeys.clear();
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}
window.daegSyncReset = doRemoteReset;

/* ---------- Write probe ---------- */
async function probeWrite(){
  try{ await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true }); writeable = true; setStatus('writeable', 'ok'); }
  catch(err){ writeable = false; setStatus('read-only', 'ro'); console.warn('[sync] write probe failed:', err?.code || err?.message || err); }
}

/* ---------- Start ---------- */
async function start(){
  try {
    if (!auth.currentUser) { try { await signInAnonymously(auth); } catch (e) { console.warn('[sync] anon sign-in failed:', e); } }
    uid = auth.currentUser?.uid || "anon";

    const snap = await getDoc(gameRef);
    if (snap.exists()){
      const data = snap.data() || {};
      if (data.revMap && typeof data.revMap === 'object') { revMap = { ...revMap, ...data.revMap }; saveRevMap(); }
      applyRemote(data);
    }

    onSnapshot(gameRef, s=>{
      if (!s.exists()) return;
      const data = s.data() || {};
      applyRemote(data);
    }, err => console.error("Firestore onSnapshot error:", err));

    await probeWrite();
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);
  } catch (e) {
    console.error('[sync] fatal start error:', e);
    setStatus('error', 'err');
  }
}
start();
