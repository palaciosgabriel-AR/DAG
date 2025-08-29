// sync.js — Firestore <-> localStorage realtime sync (Firebase v12.1.0)
// Conflict-proof via per-key revision map (revMap):
//  - Each data key has a monotonically increasing local rev.
//  - We send revMap with writes and store it in Firestore.
//  - On incoming snapshots we apply a key only if incoming rev > local rev.
// This prevents older/stale clients from overwriting newer data.
// Includes: status badge, remote reset (preserves tasks), heartbeat, and explicit touch().

const firebaseConfig = {
  apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
  authDomain: "daeg-d59cf.firebaseapp.com",
  projectId: "daeg-d59cf",
  storageBucket: "daeg-d59cf.firebasestorage.app",
  messagingSenderId: "862000912172",
  appId: "1:862000912172:web:27e96ecff42a6806897e89",
  measurementId: "G-Y0LLM4HYLP"
};
const GAME_ID = "DAEG"; // keep your live doc

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// All keys we sync
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer"
];

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
let uid = "anon";
const gameRef = doc(db, "games", GAME_ID);

/* ---------- Small status badge ---------- */
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

/* ---------- Local helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){
  const x={};
  for (const k of KEYS) x[k] = safeParse(localStorage.getItem(k));
  return x;
}
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return Math.random().toString(36); } }

/* ---------- Conflict-proof revision map ---------- */
let revMap = safeParse(localStorage.getItem('revMap')) || {};       // {key: int}
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return Number.isInteger(revMap[key]) ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Sync engine state ---------- */
let applyingRemote = false;
let writeable = false;
let hasInitialSync = false;       // after first remote apply
let pushTimer = null;
let lastSentFingerprint = '';     // dedupe writes
const changedKeys = new Set();    // which keys changed locally since last push

/* ---------- Applying remote safely ---------- */
function applyRemote(data){
  // Incoming may contain: data for KEYS, a {revMap}, and a {_meta}
  const incomingRev = data.revMap || {};

  applyingRemote = true;
  try {
    for (const k of KEYS){
      if (!(k in data)) continue;

      const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
      const locRev = getRev(k);

      // On very first sync, accept everything; afterwards only accept strictly newer revs.
      const shouldApply = !hasInitialSync || incRev > locRev;

      if (shouldApply){
        // Write the value and adopt incoming rev for this key
        localStorage.setItem(k, JSON.stringify(data[k]));
        revMap[k] = incRev;
      }
    }
    saveRevMap();
  } finally {
    applyingRemote = false;
  }

  hasInitialSync = true;
  // Only notify pages if something actually changed vs current local snapshot
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

/* ---------- Pushing changes ---------- */
function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }

async function pushNow(){
  try{
    if (changedKeys.size === 0) return; // nothing changed since last successful push

    // Build a minimal payload containing only changed keys
    const allLocal = packLocal();
    const payload = {};
    for (const k of changedKeys){
      // Only send defined values
      if (k in allLocal) payload[k] = allLocal[k];
    }

    // Include full revMap so others can compare per key
    const sendBody = { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:2 }, ...payload };
    const fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;

    await setDoc(gameRef, sendBody, { merge:true });

    lastSentFingerprint = fp;
    changedKeys.clear(); // we've flushed them
  }catch(err){
    console.warn('[sync] push failed:', err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

/* ---------- Expose a gentle nudge after important changes ---------- */
window.daegSyncTouch = function(){ schedulePush(); };

/* ---------- Intercept local writes to mark keys changed & bump rev ---------- */
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  const before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.includes(k)) {
    if (before !== v) {
      bumpRev(k);
      changedKeys.add(k);
      schedulePush();
    }
  }
};

/* ---------- Remote RESET (preserves tasks) ---------- */
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

  // Preserve tasks from server if possible; else fall back to local.
  let preservedTasks = {};
  try { const snap = await getDoc(gameRef); if (snap.exists()) preservedTasks = snap.data()?.tasksByNumber || {}; } catch {}
  if (!preservedTasks || Object.keys(preservedTasks).length === 0) preservedTasks = packLocal().tasksByNumber || {};

  const fresh = initialSnapshot(preservedTasks);

  // Bump revs for all keys we're resetting so our write wins per key
  for (const k of ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"]) {
    bumpRev(k);
    changedKeys.add(k);
  }
  // (tasksByNumber is preserved; do not bump unless you actually edit it)

  // Apply fresh locally first (under applyingRemote guard) so UI updates immediately
  applyingRemote = true;
  try {
    for (const k of Object.keys(fresh)) localStorage.setItem(k, JSON.stringify(fresh[k]));
  } finally {
    applyingRemote = false;
  }

  // Push fresh snapshot + current revMap
  await setDoc(gameRef, { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:2 }, ...fresh }, { merge:true });
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
    console.warn('[sync] write probe failed:', err?.code || err?.message || err);
  }
}

/* ---------- Start ---------- */
async function start(){
  try {
    if (!auth.currentUser) { try { await signInAnonymously(auth); } catch (e) { console.warn('[sync] anon sign-in failed:', e); } }
    uid = auth.currentUser?.uid || "anon";

    // Load remote (if any)
    const snap = await getDoc(gameRef);
    if (snap.exists()){
      const data = snap.data() || {};
      // Adopt remote revMap if present (so everyone starts from same counters)
      if (data.revMap && typeof data.revMap === 'object') {
        revMap = { ...revMap, ...data.revMap };
        saveRevMap();
      }
      applyRemote(data);
    } else {
      // No remote doc yet: do nothing; first real change will create it.
    }

    // Live updates — apply per-key only if incoming rev is newer
    onSnapshot(gameRef, s=>{
      if (!s.exists()) return;
      const data = s.data() || {};
      if (data.revMap && typeof data.revMap === 'object') {
        // Don't overwrite our revMap here; applyRemote will compare per key
      }
      applyRemote(data);
    }, err => console.error("Firestore onSnapshot error:", err));

    await probeWrite();

    // Heartbeat: only pushes if there are pending changedKeys
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);

  } catch (e) {
    console.error('[sync] fatal start error:', e);
    setStatus('error', 'err');
  }
}
start();
