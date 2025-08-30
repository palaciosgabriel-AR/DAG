// sync.js — optimized Firebase sync (always-merge + extra push triggers)

/* ---------- Firebase config ---------- */
var firebaseConfig = {
  apiKey: "AIzaSyDiyIXeHs78Eh9OFYNtSZqYWtQoIk5WZAU",
  authDomain: "dag2-94e6a.firebaseapp.com",
  projectId: "dag2-94e6a",
  storageBucket: "dag2-94e6a.firebasestorage.app",
  messagingSenderId: "958018507364",
  appId: "1:958018507364:web:7768f5b9606d1191d94571"
};
var GAME_ID = "DAEG";
var PROJECT = firebaseConfig.projectId;

/* Keys we sync */
var KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer"
];

/* ---------- Firebase SDK ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

var app  = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db   = getFirestore(app);
var gameRef = doc(db, "games", GAME_ID);

/* ---------- Helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch (e) { return null; } }
function get(k, d){ try { var s=localStorage.getItem(k); return s?JSON.parse(s):d; } catch(e){ return d; } }
function set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function nowIso(){ return new Date().toISOString(); }

/* Status badge */
var statusEl;
function updateStatus(text, color) {
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.id = 'liveStatus';
    statusEl.style.cssText = "margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;border:1px solid rgba(255,255,255,.5);color:#fff;font-size:.8rem;white-space:nowrap;";
    var slot = document.querySelector('.data-actions') || document.querySelector('.topbar');
    if (slot) slot.appendChild(statusEl);
  }
  statusEl.textContent = text;
  statusEl.style.background = color || 'rgba(46,204,113,.25)';
}

/* ---------- Apply remote data ---------- */
var applyingRemote = false;
function applyRemote(data){
  var changed = false;
  for (var i=0;i<KEYS.length;i++){
    var k = KEYS[i];
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;

    var current  = localStorage.getItem(k);
    var incoming = JSON.stringify(data[k]);
    if (current !== incoming) {
      applyingRemote = true;
      set(k, data[k]);       // write local without marking dirty
      applyingRemote = false;
      changed = true;
    }
  }
  if (changed) {
    try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
  }
}

/* ---------- Batched push ---------- */
var changedKeys   = new Set();
var pushTimer     = null;
var lastPushTime  = 0;
var MIN_PUSH_MS   = 2000;

/* override setItem to detect changes */
var _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  var before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.indexOf(k) !== -1 && before !== v) {
    changedKeys.add(k);
    schedulePush();
  }
};

function schedulePush(){
  if (pushTimer) clearTimeout(pushTimer);
  var now = Date.now();
  var delay = Math.max(1000, MIN_PUSH_MS - (now - lastPushTime));
  pushTimer = setTimeout(pushNow, delay);
}

function pushNow(){
  if (changedKeys.size === 0) return;

  var payload = {};
  changedKeys.forEach(function(k){ payload[k] = safeParse(localStorage.getItem(k)); });
  payload._meta = { updatedAt: serverTimestamp(), from: 'web', time: nowIso() };

  lastPushTime = Date.now();
  updateStatus("Syncing…", "rgba(255,193,7,.25)");

  // IMPORTANT: always merge to avoid overwriting fields from other devices
  setDoc(gameRef, payload, { merge: true })
    .then(function(){
      changedKeys.clear();
      updateStatus("Live: " + PROJECT, "rgba(46,204,113,.25)");
    })
    .catch(function(e){
      console.error('Sync failed:', e.code, e.message);
      updateStatus("Sync failed: " + e.code, "rgba(220,53,69,.25)");
      setTimeout(schedulePush, 3000);
    });
}

/* Extra push triggers (helps iOS Safari) */
window.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'hidden') pushNow();
});
window.addEventListener('pagehide', function(){ pushNow(); });

/* ---------- Reset (keeps tasks) ---------- */
window.daegSyncReset = function(){
  updateStatus("Resetting…", "rgba(255,193,7,.25)");
  var tasks = get('tasksByNumber', {});
  var fresh = {
    usedSets: { "D":[], "Ä":[], "G":[] },
    logEntries: [],
    playerPoints: { "D":500, "Ä":500, "G":500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D',
    tasksByNumber: tasks,
    _meta: { resetAt: nowIso(), from: 'reset' }
  };

  applyingRemote = true;
  try { Object.keys(fresh).forEach(function(k){ set(k, fresh[k]); }); }
  finally { applyingRemote = false; }

  setDoc(gameRef, fresh, { merge: true })
    .then(function(){
      updateStatus("Reset complete", "rgba(46,204,113,.25)");
      try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
    })
    .catch(function(e){
      console.warn('Reset failed:', e.message);
      updateStatus("Reset failed", "rgba(220,53,69,.25)");
    });
};

/* ---------- Restore from export ---------- */
window.daegSyncRestore = function(snap){
  if (!snap || typeof snap !== 'object') return;
  applyingRemote = true;
  try { Object.keys(snap).forEach(function(k){ if (KEYS.indexOf(k)!==-1) set(k, snap[k]); }); }
  finally { applyingRemote = false; }
  schedulePush();
  try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
};

/* ---------- Start sync ---------- */
function start(){
  updateStatus("Connecting…", "rgba(108,117,125,.25)");
  onAuthStateChanged(auth, function(user){
    if (user) {
      updateStatus("Loading…", "rgba(255,193,7,.25)");
      getDoc(gameRef)
        .then(function(snap){ if (snap.exists()) applyRemote(snap.data() || {}); })
        .finally(function(){ updateStatus("Live: " + PROJECT, "rgba(46,204,113,.25)"); });

      onSnapshot(gameRef, function(snap){
        if (snap.exists()) applyRemote(snap.data() || {});
      }, function(error){
        console.error('Live sync error:', error);
        updateStatus("Sync error: " + error.code, "rgba(220,53,69,.25)");
      });
    }
  });
  signInAnonymously(auth).catch(function(e){
    console.error('Auth failed:', e);
    updateStatus("Auth failed: " + e.code, "rgba(220,53,69,.25)");
  });
}
start();

/* Safety net: force push any pending changes every 5s */
setInterval(function(){ if (changedKeys.size > 0) pushNow(); }, 5000);

window.daegSyncTouch = function(){ schedulePush(); };
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID };
