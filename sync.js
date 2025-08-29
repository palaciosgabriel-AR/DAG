// sync.js — runner/seekers, heartbeat, epoch reset, single player choice (ES2018-safe)

/* ---------- Firebase config ---------- */
const firebaseConfig = {
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
var DOCPATH = "games/" + GAME_ID;

/* Keys synced via revMap (runner field is separate) */
var KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer","tasksLocked",
  "stateEpoch"
];

var RUNNER_TTL_MS = 90000;
var HEARTBEAT_MS  = 10000;
var DEBUG = false;
function log(){ if(DEBUG){ try{console.log.apply(console, ["[sync]"].concat([].slice.call(arguments)));}catch(e){} } }
function warn(){ try{console.warn.apply(console, ["[sync]"].concat([].slice.call(arguments)));}catch(e){} }

/* ---------- Firebase SDK ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

var app  = initializeApp(firebaseConfig);
var auth = getAuth(app);
var db   = getFirestore(app);
var gameRef = doc(db, "games", GAME_ID);
var uid = "anon";

/* ---------- Identity + player ---------- */
function ensureClientId(){
  var id = localStorage.getItem("clientId");
  if (!id) { id = "c-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36); localStorage.setItem("clientId", id); }
  return id;
}
var clientId = ensureClientId();

function getMyPlayer(){
  var p = localStorage.getItem("myPlayer") || "D";
  return (p==="D"||p==="Ä"||p==="G") ? p : "D";
}
function setMyPlayer(p){
  localStorage.setItem("myPlayer", p);
  if (isRunnerHere()) requestImmediateHeartbeat();
}

/* ---------- Badge ---------- */
var statusEl = (function () {
  var el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = "margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.15);color:#fff;font-size:.8rem;white-space:nowrap;";
  var slot = document.querySelector('.data-actions') || document.querySelector('.topbar');
  if (slot) slot.appendChild(el);
  return el;
})();
function setBadge(mode, epoch){
  var tone = mode==='writeable' ? 'rgba(46,204,113,.25)' :
            (mode==='read-only' ? 'rgba(241,196,15,.25)' : 'rgba(255,255,255,.15)');
  statusEl.style.background = tone;
  statusEl.textContent = "Live: " + mode + " · " + PROJECT + "/" + GAME_ID + " · epoch " + (epoch!=null?epoch:getLocalEpoch());
  statusEl.title = "Project: " + PROJECT + "\nDoc: " + DOCPATH + "\nClient: " + clientId;
}

/* ---------- Runner UI controls (player picker + runner buttons) ---------- */
var roleBox = (function(){
  var topbar = document.querySelector('.topbar');
  var container = document.createElement('div');
  container.className = 'rolebox';
  container.style.cssText = 'display:flex;gap:.5rem;align-items:center;justify-self:end;';
  var label = document.createElement('span');
  label.id = 'roleLabel';
  label.style.cssText = 'font-weight:700;padding:.2rem .5rem;border:1px solid rgba(255,255,255,.5);border-radius:.5rem;background:rgba(255,255,255,.15);';
  var selWrap = document.createElement('label');
  selWrap.style.cssText = 'display:inline-flex;gap:.35rem;align-items:center;';
  selWrap.appendChild(document.createTextNode('I am:'));
  var sel = document.createElement('select');
  sel.id = 'playerSelect';
  ['D','Ä','G'].forEach(function(v){ var o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
  sel.value = getMyPlayer();
  sel.addEventListener('change', function(){ setMyPlayer(sel.value); });
  selWrap.appendChild(sel);
  var takeBtn = document.createElement('button');
  takeBtn.id = 'becomeRunner'; takeBtn.className = 'btn btn-small'; takeBtn.textContent='Become runner';
  var giveBtn = document.createElement('button');
  giveBtn.id = 'relinquishRunner'; giveBtn.className = 'btn btn-small'; giveBtn.textContent='Relinquish';
  container.appendChild(label); container.appendChild(selWrap); container.appendChild(takeBtn); container.appendChild(giveBtn);
  if (topbar) topbar.appendChild(container);
  return { label:label, sel:sel, takeBtn:takeBtn, giveBtn:giveBtn };
})();

/* ---------- Helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch (e) { return null; } }
function packLocal(){ var x={}; for (var i=0;i<KEYS.length;i++){ var k=KEYS[i]; x[k]=safeParse(localStorage.getItem(k)); } return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch (e) { return Math.random().toString(36); } }
function getLocalEpoch(){ var raw = localStorage.getItem('stateEpoch'); var n = raw==null ? 0 : Number((raw+"").replace(/^"|"$/g,'')); return isFinite(n)?n:0; }
function setLocalEpoch(n){ localStorage.setItem('stateEpoch', String(n)); }
function nowMs(){ return Date.now(); }
function tsMillis(x){
  if (!x) return null;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (typeof x.seconds === 'number') return x.seconds*1000;
  var n = Number(x); return isFinite(n) ? n : null;
}

/* ---------- revMap ---------- */
var revMap = safeParse(localStorage.getItem('revMap')) || {};
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return (revMap && typeof revMap[key] === 'number') ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Engine state ---------- */
var applyingRemote = false;
var writeable = false;
var pushTimer = null;
var lastSentFingerprint = '';
var changedKeys = new Set();

/* ---------- Runner state (stable) ---------- */
var currentRunner = null; // {id, player, lastSeen, since}
var lastSnapshotEpoch = 0;

function runnerExpired(r){
  if (!r) return true;
  if (r.id === clientId) return false;
  var ms = tsMillis(r.lastSeen);
  if (ms == null) return false;
  return (nowMs() - ms) > RUNNER_TTL_MS;
}
function isRunnerHere(){ return currentRunner && currentRunner.id === clientId; }
function canEdit(){ return isRunnerHere(); }
window.canEdit = canEdit;

/* Heartbeat (runner only) */
var hbTimer = null, hbPending = false;
function requestImmediateHeartbeat(){ if (isRunnerHere() && !hbPending) heartbeat(); }
function heartbeat(){
  if (!isRunnerHere()) return;
  hbPending = true;
  setDoc(gameRef, {
    runner: { id: clientId, player: getMyPlayer(), lastSeen: serverTimestamp(), since: (currentRunner && currentRunner.since) ? currentRunner.since : serverTimestamp() }
  }, { merge:true }).then(function(){ hbPending=false; }).catch(function(){ hbPending=false; });
}
function startHeartbeat(){ stopHeartbeat(); requestImmediateHeartbeat(); hbTimer = setInterval(function(){ heartbeat(); }, HEARTBEAT_MS); }
function stopHeartbeat(){ if (hbTimer) clearInterval(hbTimer); hbTimer = null; }

/* UI role update */
function updateRoleUI(){
  var role = isRunnerHere() ? ("Runner ("+getMyPlayer()+")") : ("Seeker ("+getMyPlayer()+")");
  roleBox.label.textContent = role;
  roleBox.takeBtn.style.display = isRunnerHere() ? 'none' : 'inline-block';
  roleBox.giveBtn.style.display = isRunnerHere() ? 'inline-block' : 'none';
  document.body.setAttribute('data-edit', canEdit() ? '1' : '0');
  try { window.dispatchEvent(new CustomEvent('daeg-edit-state', { detail: { canEdit: canEdit() } })); } catch(e){}
}

/* Become / Relinquish */
function becomeRunner(){
  getDoc(gameRef).then(function(snap){
    var server = snap.exists() ? (snap.data() || {}) : {};
    var r = server.runner || null;
    if (r && !runnerExpired(r) && r.id !== clientId) {
      var ok = confirm("Switch runner from " + (r.player || 'unknown') + " to you (" + getMyPlayer() + ")?");
      if (!ok) return;
    }
    setDoc(gameRef, { runner: { id: clientId, player: getMyPlayer(), lastSeen: serverTimestamp(), since: serverTimestamp() } }, { merge:true })
      .then(function(){ startHeartbeat(); })
      .catch(function(e){ warn('becomeRunner failed:', e); alert('Failed to become runner.'); });
  }).catch(function(e){ warn('becomeRunner read failed:', e); alert('Failed to become runner.'); });
}
function relinquishRunner(){
  if (!isRunnerHere()) return;
  setDoc(gameRef, { runner: deleteField() }, { merge:true }).catch(function(e){ warn('relinquish failed:', e); });
}
roleBox.takeBtn.addEventListener('click', becomeRunner);
roleBox.giveBtn.addEventListener('click', relinquishRunner);

/* ---------- Apply remote (epoch-aware) ---------- */
function isEmptyTasks(obj){ if (!obj || typeof obj!=='object') return true; var ks=Object.keys(obj); if(!ks.length) return true; for (var i=0;i<ks.length;i++){ var v=obj[ks[i]]; if (String((v==null?'':v)).trim()!=='') return false; } return true; }
function hasAnyTasks(obj){ if (!obj || typeof obj!=='object') return false; var ks=Object.keys(obj); for (var i=0;i<ks.length;i++){ var v=obj[ks[i]]; if (String((v==null?'':v)).trim()!=='') return true; } return false; }

function applyRemote(data){
  var incomingRev = data.revMap || {};
  var remoteEpoch = Number(data.stateEpoch || 0);
  var localEpoch  = getLocalEpoch();
  var epochOverride = remoteEpoch > localEpoch;

  if (data.revMap && typeof data.revMap === 'object') { revMap = Object.assign({}, revMap, data.revMap); saveRevMap(); }

  currentRunner = data.runner || null;
  lastSnapshotEpoch = remoteEpoch;

  applyingRemote = true;
  var anyChanged = false;
  try {
    if (epochOverride) {
      setLocalEpoch(remoteEpoch);
      for (var i=0;i<KEYS.length;i++){
        var k = KEYS[i];
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        localStorage.setItem(k, JSON.stringify(data[k]));
        if (k !== 'stateEpoch') { var incRev = (typeof incomingRev[k]==='number') ? incomingRev[k] : 0; revMap[k] = incRev; }
      }
      saveRevMap();
      anyChanged = true;
      log("epoch override -> adopted server state (epoch", remoteEpoch, ")");
    } else {
      for (var j=0;j<KEYS.length;j++){
        var kk = KEYS[j];
        if (!Object.prototype.hasOwnProperty.call(data, kk)) continue;
        if (kk === 'stateEpoch') continue;
        var inc = (typeof incomingRev[kk]==='number') ? incomingRev[kk] : 0;
        var localStr = localStorage.getItem(kk);
        var locRev = getRev(kk);
        var shouldApply = false;
        if (localStr == null) shouldApply = true;
        else if (inc > locRev) shouldApply = true;
        else if (kk === 'tasksByNumber') {
          var localVal  = safeParse(localStr);
          var remoteVal = data[kk];
          if (isEmptyTasks(localVal) && hasAnyTasks(remoteVal)) shouldApply = true;
        }
        if (shouldApply){ localStorage.setItem(kk, JSON.stringify(data[kk])); revMap[kk] = inc; anyChanged = true; }
      }
      if (anyChanged) saveRevMap();
    }
  } finally { applyingRemote = false; }

  updateRoleUI();
  setBadge(writeable ? 'writeable' : 'read-only', remoteEpoch || localEpoch);
  if (isRunnerHere()) startHeartbeat(); else stopHeartbeat();
  if (anyChanged) { try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(e){} }
}

/* ---------- Push changes ---------- */
function schedulePush(){ if (applyingRemote || !writeable) return; if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }
function pushNow(){
  try{
    if (changedKeys.size === 0) return;
    var allLocal = packLocal();
    var payload = {};
    changedKeys.forEach(function(k){ if (Object.prototype.hasOwnProperty.call(allLocal, k)) payload[k] = allLocal[k]; });
    var sendBody = { revMap:revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:13 } };
    for (var k in payload){ if (Object.prototype.hasOwnProperty.call(payload,k)) sendBody[k]=payload[k]; }
    var fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;
    setDoc(gameRef, sendBody, { merge:true }).then(function(){
      lastSentFingerprint = fp;
      changedKeys.clear();
    }).catch(function(err){
      warn("push failed:", err && (err.code || err.message) || err);
      writeable = false; setBadge('read-only', lastSnapshotEpoch || getLocalEpoch());
      setTimeout(probeWrite, 1500);
    });
  }catch(err){
    warn("pushNow threw:", err);
  }
}
window.daegSyncTouch = function(){ schedulePush(); };

/* Intercept local writes: bump rev + mark changed */
var _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  var before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.indexOf(k) !== -1 && before !== v) { bumpRev(k); changedKeys.add(k); schedulePush(); }
};

/* ---------- Restore / Reset ---------- */
window.daegSyncRestore = function(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot');
  for (var i=0;i<KEYS.length;i++){ var k=KEYS[i]; if (Object.prototype.hasOwnProperty.call(snapshot, k)) localStorage.setItem(k, JSON.stringify(snapshot[k])); }
  try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(e){}
  pushNow();
};

function initialSnapshot(preservedTasks){
  var currentDark = localStorage.getItem('dark') || '0';
  return {
    dark: currentDark,
    usedSets: { "D":[], "Ä":[], "G":[] },
    logEntries: [],
    tasksByNumber: preservedTasks || {},
    playerPoints: { "D":500, "Ä":500, "G":500 },
    pointsLog: [],
    mapState: {},
    activePlayer: 'D',
    lastPlayer: 'D'
  };
}

window.daegSyncReset = function(){
  if (!isRunnerHere()) { alert('Only the Runner can reset.'); throw new Error('not-runner'); }
  if (!writeable)      { alert('This device is read-only.'); throw new Error('read-only'); }

  var server = {};
  getDoc(gameRef).then(function(snap){
    if (snap.exists()) server = snap.data() || {};
  }).finally(function(){
    var nextEpoch = Math.max(Number(server.stateEpoch||0), getLocalEpoch()) + 1;
    var preservedTasks = (server.tasksByNumber && Object.keys(server.tasksByNumber).length)
      ? server.tasksByNumber : (packLocal().tasksByNumber || {});
    var fresh = initialSnapshot(preservedTasks);
    fresh.stateEpoch = nextEpoch;

    var resetKeys = ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"];
    for (var i=0;i<resetKeys.length;i++){ bumpRev(resetKeys[i]); changedKeys.add(resetKeys[i]); }
    setLocalEpoch(nextEpoch); changedKeys.add("stateEpoch");

    applyingRemote = true;
    try { for (var k in fresh){ if (Object.prototype.hasOwnProperty.call(fresh,k)) localStorage.setItem(k, JSON.stringify(fresh[k])); } }
    finally { applyingRemote = false; }

    setDoc(gameRef, (function(){
      var o = { revMap:revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:13 } };
      for (var k in fresh){ if (Object.prototype.hasOwnProperty.call(fresh,k)) o[k]=fresh[k]; }
      return o;
    })(), { merge:true }).then(function(){
      changedKeys.clear();
      try { window.dispatchEvent(new CustomEvent("daeg-sync-apply")); } catch(e){}
    });
  });
};

/* ---------- Write probe + start ---------- */
function probeWrite(){
  setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true })
    .then(function(){ writeable = true; setBadge('writeable', lastSnapshotEpoch || getLocalEpoch()); })
    .catch(function(err){ writeable = false; setBadge('read-only', lastSnapshotEpoch || getLocalEpoch()); warn("write probe failed:", err && (err.code || err.message) || err); });
}

function start(){
  var sign = function(){
    if (!auth.currentUser) {
      signInAnonymously(auth).catch(function(e){ warn("anon sign-in failed:", e); });
    }
  };
  try { sign(); } catch(e){}
  uid = (auth.currentUser && auth.currentUser.uid) ? auth.currentUser.uid : "anon";

  getDoc(gameRef).then(function(snap){ if (snap.exists()) applyRemote(snap.data() || {}); })
    .catch(function(e){ warn("initial getDoc failed:", e); });

  onSnapshot(gameRef, function(s){ if (s.exists()) applyRemote(s.data() || {}); }, function(err){ warn("onSnapshot error:", err); });

  probeWrite();
  setInterval(function(){ if (writeable && !applyingRemote) pushNow(); }, 5000);
}
start();

// Expose info
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID, clientId: clientId };
