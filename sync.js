// sync.js — simple realtime sync (no runner), ES2018-safe

/* ---------- Firebase config ---------- */
var firebaseConfig = {
  apiKey: "AIzaSyBukCK_qvHrHqkUYR90ch25vV_tsbe2RBo",
  authDomain: "daeg-d59cf.firebaseapp.com",
  projectId: "daeg-d59cf",
  storageBucket: "daeg-d59cf.firebasestorage.app",
  messagingSenderId: "862000912172",
  appId: "1:862000912172:web:27e96ecff42a6806897e89",
  measurementId: "G-Y0LLM4HYLP"
};
var GAME_ID = "DAEG";
var PROJECT = firebaseConfig.projectId;

/* Keys we sync */
var KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer","tasksLocked",
  "stateEpoch","revMap"
];

/* ---------- Firebase SDK ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

var app  = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db   = getFirestore(app);
var gameRef = doc(db, "games", GAME_ID);

/* ---------- Small helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch (e) { return null; } }
function get(k, d){ try { var s=localStorage.getItem(k); return s?JSON.parse(s):d; } catch(e){ return d; } }
function set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function getLocalEpoch(){ var raw = localStorage.getItem('stateEpoch'); var n = raw==null ? 0 : Number((raw+"").replace(/^"|"$/g,'')); return isFinite(n)?n:0; }
function setLocalEpoch(n){ localStorage.setItem('stateEpoch', String(n)); }
function nowIso(){ return new Date().toISOString(); }

/* revMap to detect newer values per-key */
var revMap = get('revMap', {});
function getRev(k){ return (revMap && typeof revMap[k]==='number') ? revMap[k] : 0; }
function bumpRev(k){ revMap[k] = getRev(k) + 1; set('revMap', revMap); }

/* badge */
(function(){
  var el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live','polite');
  el.style.cssText = "margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;border:1px solid rgba(255,255,255,.5);background:rgba(46,204,113,.25);color:#fff;font-size:.8rem;white-space:nowrap;";
  var slot = document.querySelector('.data-actions') || document.querySelector('.topbar');
  if (slot) slot.appendChild(el);
  el.textContent = "Live: syncing · " + PROJECT + "/" + GAME_ID + " · epoch " + getLocalEpoch();
})();

/* ---------- Apply remote ---------- */
function applyRemote(data){
  var incomingRev = data.revMap || {};
  var remoteEpoch = Number(data.stateEpoch || 0);
  var localEpoch  = getLocalEpoch();
  var epochOverride = remoteEpoch > localEpoch;

  if (epochOverride) {
    setLocalEpoch(remoteEpoch);
  }

  var changed = false;
  for (var i=0;i<KEYS.length;i++){
    var k = KEYS[i];
    if (k === 'revMap') continue;
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;

    var inc = (typeof incomingRev[k]==='number') ? incomingRev[k] : 0;
    var locRev = getRev(k);
    if (epochOverride || inc > locRev || localStorage.getItem(k) == null) {
      set(k, data[k]);
      revMap[k] = inc;
      changed = true;
    }
  }
  set('revMap', revMap);

  // Update badge
  var el = document.getElementById('liveStatus');
  if (el) el.textContent = "Live: syncing · " + PROJECT + "/" + GAME_ID + " · epoch " + (remoteEpoch || localEpoch);

  if (changed) {
    try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
  }
}

/* ---------- Push local changes ---------- */
var applyingRemote = false;
var changedKeys = new Set();
var pushTimer = null;

var _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  var before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.indexOf(k) !== -1 && before !== v) {
    bumpRev(k); changedKeys.add(k); schedulePush();
  }
};

function schedulePush(){ if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
function pushNow(){
  if (changedKeys.size === 0) return;
  var payload = {};
  changedKeys.forEach(function(k){ payload[k] = safeParse(localStorage.getItem(k)); });

  // Always send revMap and epoch
  payload.revMap = get('revMap', {});
  payload.stateEpoch = getLocalEpoch();
  payload._meta = { updatedAt: serverTimestamp(), updatedFrom: 'web', version: 20, localTime: nowIso() };

  setDoc(gameRef, payload, { merge:true }).then(function(){
    changedKeys.clear();
  }).catch(function(e){
    // keep trying in background; not fatal for UI
    setTimeout(schedulePush, 1000);
  });
}

/* ---------- Reset keeping tasks ---------- */
window.daegSyncReset = function(){
  var serverEpoch = 0;
  getDoc(gameRef).then(function(snap){ if (snap.exists()) serverEpoch = Number((snap.data()||{}).stateEpoch || 0); })
  .finally(function(){
    var nextEpoch = Math.max(serverEpoch, getLocalEpoch()) + 1;
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
      stateEpoch: nextEpoch
    };
    applyingRemote = true;
    try {
      Object.keys(fresh).forEach(function(k){ set(k, fresh[k]); bumpRev(k); });
    } finally { applyingRemote = false; }
    schedulePush();
    try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
  });
};

/* ---------- Restore from exported snapshot ---------- */
window.daegSyncRestore = function(snap){
  if (!snap || typeof snap !== 'object') return;
  applyingRemote = true;
  try {
    Object.keys(snap).forEach(function(k){
      if (KEYS.indexOf(k) !== -1) set(k, snap[k]);
    });
  } finally { applyingRemote = false; }
  // bump epoch to make this authoritative
  setLocalEpoch(getLocalEpoch() + 1);
  set('revMap', revMap);
  schedulePush();
  try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
};

/* ---------- Start ---------- */
function start(){
  onAuthStateChanged(auth, function(){
    // initial fetch
    getDoc(gameRef).then(function(snap){ if (snap.exists()) applyRemote(snap.data() || {}); });
    // live updates
    onSnapshot(gameRef, function(s){ if (s.exists()) { applyingRemote = true; try{ applyRemote(s.data() || {});} finally{ applyingRemote=false; } } });
  });
  signInAnonymously(auth).catch(function(){ /* ignore */ });

  // periodic push flush
  setInterval(function(){ pushNow(); }, 3000);
}
start();

// expose small bit (optional)
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID };
