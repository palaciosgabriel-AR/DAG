// sync.js — optimized Firebase sync with quota protection

/* ---------- Firebase config (REPLACE WITH YOUR NEW PROJECT CONFIG) ---------- */
var firebaseConfig = {
  apiKey: "YOUR_NEW_API_KEY",
  authDomain: "your-new-project.firebaseapp.com", 
  projectId: "your-new-project",
  storageBucket: "your-new-project.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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
function applyRemote(data){
  var changed = false;
  for (var i=0;i<KEYS.length;i++){
    var k = KEYS[i];
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
    
    var current = localStorage.getItem(k);
    var incoming = JSON.stringify(data[k]);
    if (current !== incoming) {
      applyingRemote = true;
      set(k, data[k]);
      applyingRemote = false;
      changed = true;
    }
  }

  if (changed) {
    try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
  }
}

/* ---------- Optimized push with batching ---------- */
var applyingRemote = false;
var changedKeys = new Set();
var pushTimer = null;
var lastPushTime = 0;
var MIN_PUSH_INTERVAL = 2000; // Minimum 2 seconds between pushes

// Override localStorage to track changes
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
  var timeSinceLastPush = now - lastPushTime;
  var delay = Math.max(1000, MIN_PUSH_INTERVAL - timeSinceLastPush); // At least 1 second, respect minimum interval
  pushTimer = setTimeout(pushNow, delay); 
}

function pushNow(){
  if (changedKeys.size === 0) return;
  
  var now = Date.now();
  if (now - lastPushTime < MIN_PUSH_INTERVAL) {
    // Too soon, reschedule
    schedulePush();
    return;
  }
  
  var payload = {};
  changedKeys.forEach(function(k){ payload[k] = safeParse(localStorage.getItem(k)); });
  payload._meta = { updatedAt: serverTimestamp(), from: 'web', time: nowIso() };

  lastPushTime = now;
  updateStatus("Syncing...", "rgba(255,193,7,.25)");
  
  setDoc(gameRef, payload, { merge:true }).then(function(){
    changedKeys.clear();
    updateStatus("Live: " + PROJECT, "rgba(46,204,113,.25)");
  }).catch(function(e){
    console.warn('Sync failed:', e.message);
    updateStatus("Sync failed", "rgba(220,53,69,.25)");
    // Retry with exponential backoff
    setTimeout(schedulePush, Math.min(10000, 2000 * Math.pow(2, Math.random())));
  });
}

/* ---------- Reset function ---------- */
window.daegSyncReset = function(){
  var tasks = get('tasksByNumber', {});
  var fresh = {
    usedSets: { "D":[], "Ä":[], "G":[] },
    logEntries: [],
    playerPoints: { "D":500, "Ä":500, "G":500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D',
    tasksByNumber: tasks
  };
  applyingRemote = true;
  try {
    Object.keys(fresh).forEach(function(k){ set(k, fresh[k]); });
  } finally { applyingRemote = false; }
  schedulePush();
  try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
};

/* ---------- Restore from export ---------- */
window.daegSyncRestore = function(snap){
  if (!snap || typeof snap !== 'object') return;
  applyingRemote = true;
  try {
    Object.keys(snap).forEach(function(k){
      if (KEYS.indexOf(k) !== -1) set(k, snap[k]);
    });
  } finally { applyingRemote = false; }
  schedulePush();
  try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(_){}
};

/* ---------- Start sync ---------- */
function start(){
  updateStatus("Connecting...", "rgba(108,117,125,.25)");
  
  onAuthStateChanged(auth, function(user){
    if (user) {
      updateStatus("Loading...", "rgba(255,193,7,.25)");
      
      // Initial fetch
      getDoc(gameRef).then(function(snap){ 
        if (snap.exists()) applyRemote(snap.data() || {}); 
        updateStatus("Live: " + PROJECT, "rgba(46,204,113,.25)");
      }).catch(function(e){
        console.warn('Initial fetch failed:', e.message);
        updateStatus("Load failed", "rgba(220,53,69,.25)");
      });
      
      // Live updates
      onSnapshot(gameRef, function(snap){ 
        if (snap.exists()) { 
          applyingRemote = true; 
          try{ applyRemote(snap.data() || {}); } 
          finally{ applyingRemote = false; } 
        } 
      }, function(error){
        console.warn('Live sync error:', error.message);
        updateStatus("Sync error", "rgba(220,53,69,.25)");
      });
    }
  });
  
  signInAnonymously(auth).catch(function(e){
    console.warn('Auth failed:', e.message);
    updateStatus("Auth failed", "rgba(220,53,69,.25)");
  });
}

start();
window.daegSyncTouch = function(){ schedulePush(); };
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID };
