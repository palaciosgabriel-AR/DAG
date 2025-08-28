// sync.js — Realtime Firestore <-> localStorage (Firebase v12.1.0), config inlined

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

// 5) Local <-> Remote state
let applyingRemote = false;
let pushTimer = null;
let lastRemoteRev = 0;

function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){
  const x={}; for (const k of KEYS){ const v = localStorage.getItem(k); x[k] = safeParse(v); } return x;
}
function applyLocal(data){
  applyingRemote = true;
  try {
    for (const k of KEYS) if (k in data) localStorage.setItem(k, JSON.stringify(data[k]));
  } finally {
    applyingRemote = false;
  }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

function schedulePush(){ if (applyingRemote) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
async function pushNow(){
  const payload = packLocal();
  const rev = Date.now();
  lastRemoteRev = rev;
  await setDoc(
    gameRef,
    { _meta:{rev,updatedAt:serverTimestamp(),updatedBy:uid,version:1}, ...payload },
    { merge:true }
  );
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
  const snap = initialSnapshot();
  const rev  = Date.now();
  lastRemoteRev = rev;
  await setDoc(
    gameRef,
    { _meta:{rev,updatedAt:serverTimestamp(),updatedBy:uid,version:1}, ...snap },
    { merge:true }
  );
  applyLocal(snap); // immediately replace local state, too
}
// Expose a safe handle for shared.js
window.daegSyncReset = doRemoteReset;

// 7) Start: sign-in, seed/apply, realtime listener
async function start(){
  if (!auth.currentUser) {
    try { await signInAnonymously(auth); } catch {}
  }
  uid = auth.currentUser?.uid || "anon";

  const snap = await getDoc(gameRef);
  if (snap.exists()){
    const data = snap.data()||{};
    lastRemoteRev = (data._meta && data._meta.rev) || 0;
    applyLocal(data);
  } else {
    await pushNow(); // seed remote from current local
  }

  onSnapshot(gameRef, s=>{
    if (!s.exists()) return;
    const data = s.data()||{};
    const rev = (data._meta && data._meta.rev) || 0;
    if (rev > lastRemoteRev){
      applyLocal(data);
      lastRemoteRev = rev;
    }
  }, err => console.error("Firestore onSnapshot error:", err));
}

start();
