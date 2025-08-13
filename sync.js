// sync.js  (load this on every page)
import { firebaseConfig, GAME_ID } from "./firebase-config.js";

// Firebase v10 ESM modules via CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Keys we sync (same as your app state) ----
const KEYS = [
  "usedSets", "logEntries", "tasksByNumber",
  "playerPoints", "pointsLog", "mapState",
  "dark", "activePlayer", "lastPlayer"
];

// ---- Firebase init + anonymous sign-in ----
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

await signIn(); // ensure we have a user before writing/listening
const uid = auth.currentUser?.uid || "anon";

// A single shared document for the whole game
const gameRef = doc(db, "games", GAME_ID);

// ---- Local <-> Remote sync state ----
let applyingRemote = false;
let pushTimer = null;
let lastRemoteRev = 0;

// Pack current local state into one object
function packLocal() {
  const snapshot = {};
  for (const k of KEYS) {
    const v = localStorage.getItem(k);
    snapshot[k] = safeParse(v);
  }
  return snapshot;
}
function applyLocal(data) {
  applyingRemote = true;
  try {
    for (const k of KEYS) {
      if (k in data) localStorage.setItem(k, JSON.stringify(data[k]));
    }
    // tell pages to re-render (they already listen to storage in our earlier patch)
    window.dispatchEvent(new Event("storage")); 
  } finally {
    applyingRemote = false;
  }
}
function safeParse(x){ try { return x==null ? null : JSON.parse(x); } catch { return null; } }

// Debounced push
function schedulePush() {
  if (applyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 350);
}
async function pushNow() {
  const payload = packLocal();
  const rev = Date.now(); // monotonic client-side rev is fine for this scale
  lastRemoteRev = rev;
  await setDoc(gameRef, {
    _meta: { rev, updatedAt: serverTimestamp(), updatedBy: uid, version: 1 },
    ...payload
  }, { merge: true });
}

// Monkey-patch localStorage.setItem to detect changes made by the app
const _setItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v) {
  _setItem(k, v);
  if (KEYS.includes(k) && !applyingRemote) schedulePush();
};

// Initial seed: if remote exists, apply it; otherwise push our local as the starting state
(async function start() {
  const snap = await getDoc(gameRef);
  if (snap.exists()) {
    const data = snap.data() || {};
    lastRemoteRev = (data._meta && data._meta.rev) || 0;
    applyLocal(data);
  } else {
    await pushNow();
  }

  // Realtime listener
  onSnapshot(gameRef, s => {
    if (!s.exists()) return;
    const data = s.data() || {};
    const rev = (data._meta && data._meta.rev) || 0;
    // Only apply if it's newer than what we pushed last
    if (rev > lastRemoteRev) {
      applyLocal(data);
      lastRemoteRev = rev;
    }
  }, err => {
    console.error("Firestore onSnapshot error:", err);
  });
})();

// Utility: sign in anonymously once
async function signIn() {
  // Already signed in?
  if (auth.currentUser) return;
  await new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, u => { stop(); resolve(u); }, reject);
  }).catch(()=>{});
  if (!auth.currentUser) await signInAnonymously(auth); // creates a temporary user ID
}
