// sync.js — runner/seekers model + realtime sync + reset epoch
// - Firebase v12 ESM (CDN)
// - One active runner (lease with heartbeat); others are seekers (read-only)
// - Global stateEpoch so resets propagate even if local revs are higher
// - Per-key revMap so stale states don’t clobber newer ones
// - Player picker (D/Ä/G) in header; map/points/tasks use this automatically
// - Badge shows: writeable/read-only · project/doc · epoch N

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
const GAME_ID = "DAEG";           // <- ensure this matches for all players
const PROJECT = firebaseConfig.projectId;
const DOCPATH = `games/${GAME_ID}`;

/* Local keys we sync via revMap (runner field is *not* one of these) */
const KEYS = [
  "usedSets","logEntries","tasksByNumber",
  "playerPoints","pointsLog","mapState",
  "dark","activePlayer","lastPlayer","tasksLocked",
  "stateEpoch"
];

const RUNNER_TTL_MS = 90_000;   // runner lease expires after 90s inactivity
const HEARTBEAT_MS  = 10_000;   // runner updates lastSeen every 10s
const DEBUG = true;
const log = (...a)=>{ if (DEBUG) console.log("[sync]", ...a); };
const warn = (...a)=>console.warn("[sync]", ...a);

/* ---------- Firebase SDK ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const gameRef = doc(db, "games", GAME_ID);
let uid = "anon";

/* ---------- Local identity + player ---------- */
function ensureClientId(){
  let id = localStorage.getItem("clientId");
  if (!id) {
    id = `c-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem("clientId", id);
  }
  return id;
}
const clientId = ensureClientId();

function getMyPlayer(){
  const p = localStorage.getItem("myPlayer") || "D";
  return (p==="D"||p==="Ä"||p==="G") ? p : "D";
}
function setMyPlayer(p){
  localStorage.setItem("myPlayer", p);
  // If I am current runner, update runner.player in doc on next heartbeat
  if (isRunnerHere()) requestImmediateHeartbeat();
}

/* ---------- Status badge ---------- */
const statusEl = (() => {
  const el = document.createElement('span');
  el.id = 'liveStatus';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `
    margin-left:.5rem;padding:.2rem .5rem;border-radius:.5rem;
    border:1px solid rgba(255,255,255,.5);
    background:rgba(255,255,255,.15); color:#fff; font-size:.8rem; white-space:nowrap;
  `;
  (document.querySelector('.data-actions') || document.querySelector('.topbar'))?.appendChild(el);
  return el;
})();
function setBadge(mode, epoch){
  if (!statusEl) return;
  const tone =
    mode==='writeable' ? 'rgba(46,204,113,.25)' :
    mode==='read-only' ? 'rgba(241,196,15,.25)' :
                          'rgba(255,255,255,.15)';
  statusEl.style.background = tone;
  statusEl.textContent = `Live: ${mode} · ${PROJECT}/${GAME_ID} · epoch ${epoch ?? (getLocalEpoch()||0)}`;
  statusEl.title = `Project: ${PROJECT}\nDoc: ${DOCPATH}\nClient: ${clientId}`;
}

/* ---------- UI: player picker + runner controls ---------- */
const roleBox = (() => {
  const topbar = document.querySelector('.topbar');
  const container = document.createElement('div');
  container.className = 'rolebox';
  container.style.cssText = 'display:flex;gap:.5rem;align-items:center;justify-self:end;';
  const label = document.createElement('span');
  label.id = 'roleLabel';
  label.style.cssText = 'font-weight:700;padding:.2rem .5rem;border:1px solid rgba(255,255,255,.5);border-radius:.5rem;background:rgba(255,255,255,.15);';
  const playerWrap = document.createElement('label');
  playerWrap.style.cssText = 'display:inline-flex;gap:.35rem;align-items:center;';
  playerWrap.innerHTML = '<span>I am:</span>';
  const sel = document.createElement('select');
  sel.id = 'playerSelect';
  ['D','Ä','G'].forEach(v=>{
    const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
  });
  sel.value = getMyPlayer();
  sel.addEventListener('change', ()=> setMyPlayer(sel.value));
  playerWrap.appendChild(sel);

  const takeBtn = document.createElement('button');
  takeBtn.id = 'becomeRunner';
  takeBtn.className = 'btn btn-small';
  takeBtn.textContent = 'Become runner';

  const giveBtn = document.createElement('button');
  giveBtn.id = 'relinquishRunner';
  giveBtn.className = 'btn btn-small';
  giveBtn.textContent = 'Relinquish';

  container.append(label, playerWrap, takeBtn, giveBtn);
  topbar?.appendChild(container);
  return { label, sel, takeBtn, giveBtn };
})();

/* ---------- Helpers ---------- */
function safeParse(v){ try { return v==null?null:JSON.parse(v); } catch { return null; } }
function packLocal(){ const x={}; for (const k of KEYS) x[k] = safeParse(localStorage.getItem(k)); return x; }
function fingerprint(obj){ try { return JSON.stringify(obj); } catch { return Math.random().toString(36); } }
function getLocalEpoch(){ const raw = localStorage.getItem('stateEpoch'); const n = raw==null ? 0 : Number(raw.replace(/^"|"$/g,'')); return Number.isFinite(n)?n:0; }
function setLocalEpoch(n){ localStorage.setItem('stateEpoch', String(n)); }
function nowMs(){ return Date.now(); }

/* ---------- revMap ---------- */
let revMap = safeParse(localStorage.getItem('revMap')) || {}; // {key:int}
function saveRevMap(){ localStorage.setItem('revMap', JSON.stringify(revMap)); }
function getRev(key){ return Number.isInteger(revMap[key]) ? revMap[key] : 0; }
function bumpRev(key){ revMap[key] = getRev(key) + 1; saveRevMap(); }

/* ---------- Engine state ---------- */
let applyingRemote = false;
let writeable = false;
let pushTimer = null;
let lastSentFingerprint = '';
const changedKeys = new Set();

/* ---------- Runner state ---------- */
let currentRunner = null; // {id, player, since, lastSeen (as Timestamp)}
let lastSnapshotEpoch = 0;

function runnerExpired(r){
  if (!r || !r.lastSeen) return true;
  const ts = (r.lastSeen.toMillis ? r.lastSeen.toMillis() : Number(r.lastSeen) || 0);
  return (nowMs() - ts) > RUNNER_TTL_MS;
}
function isRunnerHere(){
  return currentRunner && currentRunner.id === clientId && !runnerExpired(currentRunner);
}
function canEdit(){ return isRunnerHere(); }
window.canEdit = canEdit;

/* Heartbeat (runner only) */
let hbTimer = null, hbPending = false;
function requestImmediateHeartbeat(){
  if (!isRunnerHere()) return;
  if (hbPending) return;
  heartbeat().catch(()=>{});
}
async function heartbeat(){
  if (!isRunnerHere()) return;
  hbPending = true;
  try{
    await setDoc(gameRef, {
      runner: {
        id: clientId,
        player: getMyPlayer(),
        lastSeen: serverTimestamp(),
        since: currentRunner?.since || serverTimestamp()
      }
    }, { merge:true });
  } finally { hbPending = false; }
}
function startHeartbeat(){
  stopHeartbeat();
  requestImmediateHeartbeat();
  hbTimer = setInterval(()=>heartbeat(), HEARTBEAT_MS);
}
function stopHeartbeat(){ if (hbTimer) clearInterval(hbTimer); hbTimer=null; }

/* UI update for role */
function updateRoleUI(){
  const role = isRunnerHere() ? `Runner (${getMyPlayer()})` : `Seeker (${getMyPlayer()})`;
  roleBox.label.textContent = role;
  roleBox.takeBtn.style.display = isRunnerHere() ? 'none' : 'inline-block';
  roleBox.giveBtn.style.display = isRunnerHere() ? 'inline-block' : 'none';

  // Broadcast editability to page scripts
  document.body.setAttribute('data-edit', canEdit() ? '1' : '0');
  window.dispatchEvent(new CustomEvent('daeg-edit-state', { detail: { canEdit: canEdit() } }));
}

/* Become / Relinquish runner */
async function becomeRunner(){
  try{
    const snap = await getDoc(gameRef);
    const server = snap.exists() ? (snap.data() || {}) : {};
    const r = server.runner || null;
    if (r && !runnerExpired(r) && r.id !== clientId) {
      const ok = confirm(`Switch runner from ${r.player || 'unknown'} to you (${getMyPlayer()})?`);
      if (!ok) return;
    }
    await setDoc(gameRef, { runner: { id: clientId, player: getMyPlayer(), lastSeen: serverTimestamp(), since: serverTimestamp() } }, { merge:true });
    startHeartbeat();
  }catch(e){ warn('becomeRunner failed:', e); alert('Failed to become runner. See console.'); }
}
async function relinquishRunner(){
  try{
    if (!isRunnerHere()) return;
    await setDoc(gameRef, { runner: deleteField() }, { merge:true });
  }catch(e){ warn('relinquish failed:', e); }
}

roleBox.takeBtn.addEventListener('click', becomeRunner);
roleBox.giveBtn.addEventListener('click', relinquishRunner);

/* ---------- Apply remote (epoch-aware) ---------- */
function isEmptyTasks(obj){
  if (!obj || typeof obj !== 'object') return true;
  const ks = Object.keys(obj); if (ks.length === 0) return true;
  for (const k of ks){ if (String(obj[k] ?? '').trim() !== '') return false; }
  return true;
}
function hasAnyTasks(obj){
  if (!obj || typeof obj !== 'object') return false;
  return Object.values(obj).some(v => String(v ?? '').trim() !== '');
}

function applyRemote(data){
  const incomingRev = data.revMap || {};
  const remoteEpoch = Number(data.stateEpoch || 0);
  const localEpoch  = getLocalEpoch();
  const epochOverride = remoteEpoch > localEpoch;

  // Merge rev counters first so comparisons are fair
  if (data.revMap && typeof data.revMap === 'object') {
    revMap = { ...revMap, ...data.revMap };
    saveRevMap();
  }

  // Runner info
  currentRunner = data.runner || null;
  lastSnapshotEpoch = remoteEpoch;

  applyingRemote = true;
  let anyChanged = false;
  try {
    if (epochOverride) {
      setLocalEpoch(remoteEpoch);
      for (const k of KEYS){
        if (!(k in data)) continue;
        localStorage.setItem(k, JSON.stringify(data[k]));
        if (k !== 'stateEpoch') {
          const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
          revMap[k] = incRev;
        }
      }
      saveRevMap();
      anyChanged = true;
      log("epoch override -> adopted server state (epoch", remoteEpoch, ")");
    } else {
      for (const k of KEYS){
        if (!(k in data)) continue;
        if (k === 'stateEpoch') continue;
        const incRev = Number.isInteger(incomingRev[k]) ? incomingRev[k] : 0;
        const localStr = localStorage.getItem(k);
        const localHasValue = localStr != null;
        const locRev = getRev(k);

        let shouldApply = false;
        if (!localHasValue) shouldApply = true;
        else if (incRev > locRev) shouldApply = true;
        else if (k === 'tasksByNumber') { // heal empty -> non-empty
          const localVal  = safeParse(localStr);
          const remoteVal = data[k];
          if (isEmptyTasks(localVal) && hasAnyTasks(remoteVal)) shouldApply = true;
        }
        if (shouldApply){
          localStorage.setItem(k, JSON.stringify(data[k]));
          revMap[k] = incRev;
          anyChanged = true;
          log("applied", k, "(incRev:", incRev, "locRev:", locRev, ")");
        }
      }
      if (anyChanged) saveRevMap();
    }
  } finally { applyingRemote = false; }

  updateRoleUI();
  setBadge(writeable ? 'writeable' : 'read-only', remoteEpoch || localEpoch);
  if (anyChanged) window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
}

/* ---------- Push changes ---------- */
function schedulePush(){ if (applyingRemote || !writeable) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 200); }
async function pushNow(){
  try{
    if (changedKeys.size === 0) return;
    const allLocal = packLocal();
    const payload = {};
    for (const k of changedKeys){ if (k in allLocal) payload[k] = allLocal[k]; }
    const sendBody = { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:11 }, ...payload };
    const fp = fingerprint(sendBody);
    if (fp === lastSentFingerprint) return;
    await setDoc(gameRef, sendBody, { merge:true });
    lastSentFingerprint = fp;
    changedKeys.clear();
    log("pushed keys:", Object.keys(payload));
  }catch(err){
    warn("push failed:", err?.code || err?.message || err);
    writeable = false; setBadge('read-only', lastSnapshotEpoch || getLocalEpoch());
    setTimeout(probeWrite, 1500);
    throw err;
  }
}
window.daegSyncTouch = function(){ schedulePush(); };

/* Intercept local writes: bump rev + mark changed */
const _set = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v){
  const before = localStorage.getItem(k);
  _set(k, v);
  if (!applyingRemote && KEYS.includes(k) && before !== v) {
    bumpRev(k);
    changedKeys.add(k);
    schedulePush();
  }
};

/* ---------- Cloud-safe Import / Restore ---------- */
window.daegSyncRestore = async function(snapshot){
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid snapshot');
  for (const k of KEYS){
    if (Object.prototype.hasOwnProperty.call(snapshot, k)) {
      localStorage.setItem(k, JSON.stringify(snapshot[k]));
    }
  }
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  await pushNow();
};

/* ---------- Reset (keeps tasks) + epoch bump ---------- */
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

/** Runner-only reset that preserves tasks and bumps a global epoch */
async function doRemoteReset(){
  if (!canEdit()) { alert('Only the Runner can reset.'); throw new Error('not-runner'); }
  if (!writeable) { alert('This device is read-only. Try another device/network.'); throw new Error('read-only'); }

  let server = {};
  try { const snap = await getDoc(gameRef); if (snap.exists()) server = snap.data() || {}; } catch {}
  const currentServerEpoch = Number(server.stateEpoch || 0);
  const nextEpoch = Math.max(currentServerEpoch, getLocalEpoch()) + 1;

  const preservedTasks = (server.tasksByNumber && Object.keys(server.tasksByNumber).length)
    ? server.tasksByNumber
    : (packLocal().tasksByNumber || {});
  const fresh = initialSnapshot(preservedTasks);
  fresh.stateEpoch = nextEpoch;

  for (const k of ["usedSets","logEntries","playerPoints","pointsLog","mapState","activePlayer","lastPlayer"]) {
    bumpRev(k); changedKeys.add(k);
  }
  setLocalEpoch(nextEpoch);
  changedKeys.add("stateEpoch");

  applyingRemote = true;
  try { for (const k of Object.keys(fresh)) localStorage.setItem(k, JSON.stringify(fresh[k])); }
  finally { applyingRemote = false; }

  await setDoc(gameRef, { revMap, _meta:{ updatedAt:serverTimestamp(), updatedBy:uid, version:11 }, ...fresh }, { merge:true });
  changedKeys.clear();
  window.dispatchEvent(new CustomEvent("daeg-sync-apply"));
  return true;
}
window.daegSyncReset = doRemoteReset;

/* ---------- Write probe ---------- */
async function probeWrite(){
  try{
    await setDoc(gameRef, { _probe:{ t: serverTimestamp() } }, { merge:true });
    writeable = true;
    setBadge('writeable', lastSnapshotEpoch || getLocalEpoch());
  }catch(err){
    writeable = false;
    setBadge('read-only', lastSnapshotEpoch || getLocalEpoch());
    warn("write probe failed:", err?.code || err?.message || err);
  }
}

/* ---------- Start ---------- */
async function start(){
  try {
    if (!auth.currentUser) { try { await signInAnonymously(auth); } catch (e) { warn("anon sign-in failed:", e); } }
    uid = auth.currentUser?.uid || "anon";

    // Initial apply
    try{
      const snap = await getDoc(gameRef);
      if (snap.exists()) applyRemote(snap.data() || {});
      else log("no remote doc yet; will create on first change");
    }catch(e){ warn("initial getDoc failed:", e); }

    // Live updates
    onSnapshot(gameRef,
      s => { if (s.exists()) applyRemote(s.data() || {}); },
      err => warn("onSnapshot error:", err)
    );

    await probeWrite();

    // Heartbeat driver
    setInterval(()=>{
      if (isRunnerHere()) startHeartbeat(); else stopHeartbeat();
    }, 2500);

    // 5s gentle push loop
    setInterval(()=>{ if (writeable && !applyingRemote) pushNow(); }, 5000);
  } catch (e) {
    warn("fatal start error:", e);
    setBadge('error', lastSnapshotEpoch || getLocalEpoch());
  }
}
start();

// Expose basic info
window.__DAEG_INFO__ = { project: PROJECT, gameId: GAME_ID, clientId };
