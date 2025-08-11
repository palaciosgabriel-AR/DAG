/* ===== Shared theme ===== */
const darkToggle = document.getElementById('darkToggle');
const savedDark = localStorage.getItem('dark') === '1';
document.body.classList.toggle('dark', savedDark);
darkToggle.checked = savedDark;
darkToggle.addEventListener('change', e=>{
  document.body.classList.toggle('dark', e.target.checked);
  localStorage.setItem('dark', e.target.checked ? '1' : '0');
});

/* ===== Numbers game with per-player pools, persistent ===== */
const TOTAL = 26;
const PLAYERS = ['D','Ä','G'];
const statusEl = document.getElementById('status');
const logBody  = document.getElementById('logBody');
const tasksBody= document.getElementById('tasksBody');
const resetBtn = document.getElementById('reset');
const btns = { 'D': document.getElementById('btn-d'),
               'Ä': document.getElementById('btn-ae'),
               'G': document.getElementById('btn-g') };

/* state */
let used = loadJson('usedSets', {"D":[],"Ä":[],"G":[]}); // arrays
Object.keys(used).forEach(k => used[k] = new Set(used[k]));
let logEntries = loadJson('logEntries', []);             // [{id,t,p,n,task,claimed}]
let tasks = loadJson('tasksByNumber', makeEmptyTasks()); // {"1":"...", ...}

/* render initial UI */
renderStatus();
PLAYERS.forEach(p => { if (used[p].size === TOTAL) btns[p].disabled = true; });
renderLogFromStorage();
renderTasksTable();

/* wire buttons */
Object.entries(btns).forEach(([p,el]) => el.addEventListener('click', ()=>handlePress(p)));
resetBtn.addEventListener('click', ()=>{
  if (!confirm('Reset numbers, log, and tasks?')) return;
  used = { 'D': new Set(), 'Ä': new Set(), 'G': new Set() };
  logEntries = [];
  tasks = makeEmptyTasks();
  persist('usedSets', { "D":[], "Ä":[], "G":[] });
  persist('logEntries', logEntries);
  persist('tasksByNumber', tasks);
  Object.values(btns).forEach(b=>b.disabled=false);
  while (logBody.firstChild) logBody.removeChild(logBody.firstChild);
  renderTasksTable();
  renderStatus();
});

/* helpers */
function makeEmptyTasks(){ const o={}; for(let i=1;i<=26;i++) o[String(i)]=''; return o; }
function loadJson(k, d){ try{ return JSON.parse(localStorage.getItem(k)||JSON.stringify(d)); }catch{return d;} }
function persist(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

function rand1toN(n){ return Math.floor(Math.random()*n)+1; }
function nextAvailableFrom(start,set){
  if (set.size>=TOTAL) return null;
  let c=start;
  for (let i=0;i<TOTAL;i++){ if(!set.has(c)) return c; c = (c%TOTAL)+1; }
  return null;
}
function fmt(d){ const p=x=>String(x).padStart(2,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function renderStatus(){
  const left = L => TOTAL - used[L].size;
  statusEl.textContent = `Numbers left — D: ${left('D')}, Ä: ${left('Ä')}, G: ${left('G')}`;
}

/* handle number press */
function handlePress(player){
  const set = used[player];
  const n = nextAvailableFrom(rand1toN(TOTAL), set);
  const ts = new Date();

  if (n===null){
    appendLogRow({t:fmt(ts), p:player, n:'—', task:'', claimed:true}, false);
    return;
  }
  set.add(n);
  persist('usedSets', { 'D':Array.from(used['D']), 'Ä':Array.from(used['Ä']), 'G':Array.from(used['G']) });

  const taskText = (tasks[String(n)]||'').trim();
  const entry = { id: cryptoRandomId(), t: fmt(ts), p: player, n, task: taskText, claimed: false };
  logEntries.push(entry); persist('logEntries', logEntries);
  appendLogRow(entry, true);
  renderStatus();
  if (set.size===TOTAL) btns[player].disabled = true;
}

/* log rendering */
function appendLogRow(e, newestOnTop){
  const tr = document.createElement('tr');
  const claimable = Number.isInteger(e.n);
  const taskText = (e.task||'').trim();

  tr.innerHTML = `
    <td>${e.t}</td>
    <td>${e.p}</td>
    <td>${e.n}</td>
    <td>${escapeHtml(taskText)}</td>
    <td>${claimable ? `<button class="btn claim" data-id="${e.id||''}" ${e.claimed?'disabled':''}>${e.claimed?'✓ Claimed':'+500'}</button>` : ''}</td>
  `;

  // attach
  if (newestOnTop && logBody.firstChild) logBody.insertBefore(tr, logBody.firstChild);
  else logBody.appendChild(tr);

  // wire claim
  if (claimable){
    const btn = tr.querySelector('button.claim');
    btn?.addEventListener('click', ()=>{
      // find entry, guard double claim
      const idx = logEntries.findIndex(x => x.id === e.id);
      if (idx >= 0 && !logEntries[idx].claimed){
        addPoints(logEntries[idx].p, 500);
        logEntries[idx].claimed = true;
        persist('logEntries', logEntries);
        btn.disabled = true; btn.textContent = '✓ Claimed';
      }
    });

    // backfill id if older entry missing it
    if (!e.id){
      const id = cryptoRandomId();
      const idx = logEntries.findIndex(x => x.t===e.t && x.p===e.p && x.n===e.n && x.task===e.task);
      if (idx>=0){ logEntries[idx].id = id; persist('logEntries', logEntries); btn?.setAttribute('data-id', id); }
    }
  }
}

function renderLogFromStorage(){
  // newest first
  for (let i=logEntries.length-1;i>=0;i--) appendLogRow(logEntries[i], false);
}

/* tasks table */
function renderTasksTable(){
  tasksBody.innerHTML = '';
  for(let i=1;i<=26;i++){
    const tr = document.createElement('tr');
    const val = tasks[String(i)] || '';
    tr.innerHTML = `<td>${i}</td><td><input type="text" data-num="${i}" value="${escapeAttr(val)}" placeholder="Enter task for ${i}"></td>`;
    tasksBody.appendChild(tr);
  }
  tasksBody.querySelectorAll('input[type="text"]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      tasks[String(inp.dataset.num)] = inp.value;
      persist('tasksByNumber', tasks);
    });
  });
}

/* cross-page points award */
function addPoints(player, amount){
  const key='playerPoints';
  const pts = loadJson(key, {"D":500,"Ä":500,"G":500});
  pts[player] = (pts[player]||0) + amount;
  persist(key, pts);
}

/* utils */
function cryptoRandomId(){
  if (window.crypto?.getRandomValues){
    const a = new Uint32Array(2); window.crypto.getRandomValues(a);
    return (Date.now().toString(36)+'-'+a[0].toString(36)+'-'+a[1].toString(36));
  }
  return 'id-'+Math.random().toString(36).slice(2);
}
function escapeHtml(s){ return s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }
