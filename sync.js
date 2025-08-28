// sync.js — Realtime Firestore <-> localStorage (Firebase v12.1.0),
// uses server timestamp for ordering (fixes clock-skew), plus status badge & remote reset.

// 1) INLINE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
  authDomain: "daeg-d59cf.firebaseapp.com",
  projectId: "daeg-d59cf",
  storageBucket: "daeg-d59cf.firebasestorage.app",
  messagingSenderId: "862000912172",
  appId: "1:862000912172:web:27e96ecff42a6806897e89",
  measurementId: "G-Y0LLM4HYLP"
};
const GAME_ID = "DAEG"; // Firestore document: games/DAEG

// 2) Firebase ESM imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// 3) Keys we sync
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer"
];

// 4) Init Firebase
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let uid = "anon";
const gameRef = doc(db, "games", GAME_ID);

// ===== Live status badge (helps debug) =====
const statusEl = (() => {
  const el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `
    margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;
    border:1px solid rgba(255,255,255,.5);
    background:rgba(255,255,255,.15); color:#fff; font-size:.8rem;
  `;
  const holder = document.querySelector('.data-actions') || document.querySelector('.topbar');
  if (holder) holder.appendChild(el);
  return el;
})();
function setStatus(text, tone='info'){
  statusEl.textContent = `Live: ${text}`;
  if (tone === 'ok')      statusEl.style.background = 'rgba(46,204,113,.25)';
  else if (tone === 'ro') statusEl.style.background = 'rgba(241,196,15,.25)';
  else if (tone === 'err')statusEl.style.background = 'rgba(231,76,60,.25)';
  else                    statusEl.style.background = 'rgba(255,255,255,.15)';
}
setStatus('connecting…');

// 5) Local <-> Remote state
let applyingRemote = false;
let pushTimer = null;
let writeable = false;
// Use server time from Firestore to order snapshots (fix clock skew)
let lastRemoteMillis = 0;

function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS){ x[k] = safeParse(localStorage.getItem(k)); } return x; }
function applyLocal(data){
  applyingRemote = true;
  try {
    for (const k of KEYS) if (k in data) localStorage.setItem(k, JSON.stringify(data[k]));
  } finally {
    applyingRemote = false;
  }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
async function pushNow(){
  try{
    const payload = packLocal();
    await setDoc(
      gameRef,
      { _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:1 }, ...payload },
      { merge:true }
    );
  }catch(err){
    console.warn('[sync] push failed:', err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

// Hook localStorage so any app change gets synced
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _set(k, v);
  if (KEYS.includes(k) && !applyingRemote) schedulePush();
};

// 6) Remote RESET (used by the Reset All button)
function initialSnapshot(){
  const currentDark = localStorage.getItem('dark') || '0';
  return {
    dark: currentDark,
    usedSets: { D:[], Ä:[], G:[] },
    logEntries: [],
    tasksByNumber: {},
    playerPoints: { D:500, Ä:500, G:500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D'
  };
}
async function doRemoteReset(){
  if (!writeable) { alert('This device is read-only (not signed in). Try another device/network.'); return; }
  const snap = initialSnapshot();
  await setDoc(
    gameRef,
    { _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:1 }, ...snap },
    { merge:true }
  );
  // Apply locally; next snapshot will also confirm and carry server time
  applyLocal(snap);
}
window.daegSyncReset = doRemoteReset;

// 7) Probe write permission (detects auth/network problems)
async function probeWrite(){
  try{
    await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true });
    writeable = true; setStatus('writeable', 'ok');
  }catch(err){
    writeable = false; setStatus('read-only', 'ro');
    console.warn('[sync] write probe failed:', err?.code || err?.message || err);
  }
}

// 8) Start: sign-in, seed/apply, realtime listener (ordered by server time)
async function start(){
  try {
    if (!auth.currentUser) { try { await signInAnonymously(auth); } catch (e) { console.warn('[sync] signInAnonymously failed:', e); } }
    uid = auth.currentUser?.uid || "anon";

    const snap = await getDoc(gameRef);
    if (snap.exists()){
      const data = snap.data()||{};
      const ts = data._meta && data._meta.updatedAt;
      lastRemoteMillis = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;
      applyLocal(data);
    } else {
      try { await pushNow(); } catch {}
    }

    onSnapshot(gameRef, s=>{
      if (!s.exists()) return;
      const data = s.data()||{};
      // Prefer server timestamp to gate duplicates; if missing, apply anyway
      const ts = data._meta && data._meta.updatedAt;
      const ms = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;

      if (ms === 0 || ms > lastRemoteMillis){
        applyLocal(data);
        if (ms > 0) lastRemoteMillis = ms;
      }
    }, err => console.error("Firestore onSnapshot error:", err));

    await probeWrite();
  } catch (e) {
    console.error('[sync] fatal start error:', e);
    setStatus('error', 'err');
  }
}
start();
