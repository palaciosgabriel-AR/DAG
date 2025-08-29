// sync.js — Firestore <-> localStorage realtime sync (Firebase v12.1.0)
// - Status badge ("writeable"/"read-only")
// - Server timestamp ordering (avoids clock-skew issues)
// - Heartbeat + explicit touch() for reliable pushes
// - Remote Reset now PRESERVES tasksByNumber

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
const GAME_ID = "DAEG"; // do not change (per your request)

/* ---------- Firebase (ESM from CDN) ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- State keys to sync ---------- */
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer"
];

/* ---------- Init ---------- */
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
let uid = "anon";
const gameRef = doc(db, "games", GAME_ID);

/* ---------- Live status badge ---------- */
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

/* ---------- Sync engine ---------- */
let applyingRemote = false;
let pushTimer = null;
let writeable = false;
let lastRemoteMillis = 0;          // gate on server time
let lastSentFingerprint = '';      // dedupe pushes

function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS) x[k] = safeParse(localStorage.getItem(k)); return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return Math.random().toString(36); } }

function applyLocal(data){
  applyingRemote = true;
  try { for (const k of KEYS) if (k in data) localStorage.setItem(k, JSON.stringify(data[k])); }
  finally { applyingRemote = false; }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }
async function pushNow(){
  try{
    const payload = packLocal();
    const fp = fingerprint(payload);
    if (fp === lastSentFingerprint) return; // nothing changed

    await setDoc(
      gameRef,
      { _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:1 }, ...payload },
      { merge:true }
    );
    lastSentFingerprint = fp;
  }catch(err){
    console.warn('[sync] push failed:', err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

// Export a nudge for important state changes
window.daegSyncTouch = function(){ schedulePush(); };

/* Hook localStorage so normal app changes also push */
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _set(k, v);
  if (KEYS.includes(k) && !applyingRemote) schedulePush();
};

/* ---------- Remote RESET (now preserves tasks) ---------- */
/** Build a fresh snapshot while keeping tasksByNumber intact. */
function initialSnapshot(preservedTasks){
  const currentDark = localStorage.getItem('dark') || '0';
  return {
    dark: currentDark,
    usedSets: { D:[], Ä:[], G:[] },
    logEntries: [],
    tasksByNumber: preservedTasks || {},     // <<< keep tasks
    playerPoints: { D:500, Ä:500, G:500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D'
  };
}

async function doRemoteReset(){
  if (!writeable) { alert('This device is read-only (not signed in). Try another device/network.'); return; }

  // Try to preserve tasks from server first; fall back to local if needed.
  let preservedTasks = {};
  try {
    const snap = await getDoc(gameRef);
    if (snap.exists()) preservedTasks = (snap.data()?.tasksByNumber) || {};
  } catch { /* ignore */ }
  if (!preservedTasks || Object.keys(preservedTasks).length === 0) {
    preservedTasks = packLocal().tasksByNumber || {};
  }

  const fresh = initialSnapshot(preservedTasks);
  await setDoc(
    gameRef,
    { _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:1 }, ...fresh },
    { merge:true }
  );
  applyLocal(fresh);
  lastSentFingerprint = fingerprint(fresh); // keep heartbeat quiet until next change
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

    // First load
    const snap = await getDoc(gameRef);
    if (snap.exists()){
      const data = snap.data()||{};
      const ts = data._meta && data._meta.updatedAt;
      lastRemoteMillis = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;
      applyLocal(data);
      lastSentFingerprint = fingerprint(packLocal());
    } else {
      try { await pushNow(); } catch {}
    }

    // Realtime updates (ordered by server time)
    onSnapshot(gameRef, s=>{
      if (!s.exists()) return;
      const data = s.data()||{};
      const ts = data._meta && data._meta.updatedAt;
      const ms = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;
      if (ms === 0 || ms > lastRemoteMillis){
        applyLocal(data);
        if (ms > 0) lastRemoteMillis = ms;
        lastSentFingerprint = fingerprint(packLocal());
      }
    }, err => console.error("Firestore onSnapshot error:", err));

    await probeWrite();

    // Heartbeat: push only when something actually changed
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);

  } catch (e) {
    console.error('[sync] fatal start error:', e);
    setStatus('error', 'err');
  }
}
start();
