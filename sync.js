// sync.js — Firestore <-> localStorage (Firebase v12.1.0)
// - Uses server timestamp ordering (fixes clock skew)
// - Status badge ("writeable"/"read-only")
// - Remote reset support
// - NEW: explicit touch() for immediate pushes + safe heartbeat (only pushes when state changed)

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

// ===== Status badge =====
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

// ===== Sync state =====
let applyingRemote = false;
let pushTimer = null;
let writeable = false;
let lastRemoteMillis = 0;

// For heartbeat dedupe
let lastSentFingerprint = '';

function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS){ x[k] = safeParse(localStorage.getItem(k)); } return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return String(Math.random()); } }

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
    // If nothing has changed since our last successful push, skip (prevents chatter)
    if (fp === lastSentFingerprint) return;

    await setDoc(
      gameRef,
      { _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:1 }, ...payload },
      { merge:true }
    );
    lastSentFingerprint = fp;
    // console.info('[sync] pushed', new Date().toISOString());
  }catch(err){
    console.warn('[sync] push failed:', err?.code || err?.message || err);
    writeable = false; setStatus('read-only', 'ro');
    setTimeout(probeWrite, 1500);
  }
}

// Global touch helper — call this after important state changes
window.daegSyncTouch = function(/*key?*/){ schedulePush(); };

// Hook localStorage so any app change gets synced too
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  _set(k, v);
  if (KEYS.includes(k) && !applyingRemote) schedulePush();
};

// ===== Remote RESET (used by Reset All button) =====
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
  applyLocal(snap);
  // Ensure fresh fingerprint so the next user change pushes again
  lastSentFingerprint = fingerprint(snap);
}
window.daegSyncReset = doRemoteReset;

// ===== Write probe =====
async function probeWrite(){
  try{
    await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true });
    writeable = true; setStatus('writeable', 'ok');
  }catch(err){
    writeable = false; setStatus('read-only', 'ro');
    console.warn('[sync] write probe failed:', err?.code || err?.message || err);
  }
}

// ===== Start (ordered by server time) =====
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
      lastSentFingerprint = fingerprint(packLocal());
    } else {
      try { await pushNow(); } catch {}
    }

    onSnapshot(gameRef, s=>{
      if (!s.exists()) return;
      const data = s.data()||{};
      const ts = data._meta && data._meta.updatedAt;
      const ms = (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;

      if (ms === 0 || ms > lastRemoteMillis){
        applyLocal(data);
        if (ms > 0) lastRemoteMillis = ms;
        // receiving remote update means our local fingerprint may now match
        lastSentFingerprint = fingerprint(packLocal());
      }
    }, err => console.error("Firestore onSnapshot error:", err));

    await probeWrite();

    // Heartbeat: push only if local state changed since last push
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);

  } catch (e) {
    console.error('[sync] fatal start error:', e);
    setStatus('error', 'err');
  }
}
start();
