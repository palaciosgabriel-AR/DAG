/* ===== Tasks page: single Draw for myPlayer; runner-only edits ===== */
const TOTAL = 26;

const statusEl  = document.getElementById("status");
const logBody   = document.getElementById("logBody");
const tasksBody = document.getElementById("tasksBody");
const resetBtn  = document.getElementById("reset");
const drawBtn   = document.getElementById("btn-draw");

let used = loadJson("usedSets", { D: [], Ä: [], G: [] });
Object.keys(used).forEach(k => used[k] = new Set(used[k] || []));
let logEntries = loadJson("logEntries", []);               // [{id,t,p,n,task,claimed}]
let tasks      = loadJson("tasksByNumber", emptyTasks());  // {"1":"..."}

/* ---------- helpers ---------- */
function myPlayer(){ return localStorage.getItem('myPlayer') || 'D'; }
function canEdit(){ return typeof window.canEdit === 'function' ? window.canEdit() : true; }

/* ---------- init ---------- */
renderStatus();
renderLogFromStorage();
renderTasksTable();
updateEditability();

/* live refresh from sync + runner state changes */
window.addEventListener("daeg-sync-apply", handleExternalUpdate);
window.addEventListener("daeg-edit-state", updateEditability);

/* ---------- events ---------- */
drawBtn.addEventListener("click", () => {
  if (!canEdit()) return alert('Runner only.');
  const p = myPlayer();
  const set = used[p] || new Set();
  const n = nextAvailableFrom(rand1toN(TOTAL), set);
  const ts = new Date();

  if (n === null) {
    const entry = { id: uid(), t: fmt(ts), p, n: "—", task: "", claimed: true };
    logEntries.push(entry); saveJson("logEntries", logEntries);
    appendLogRow(entry, true);
    return;
  }

  set.add(n); used[p] = set; persistUsed();
  const taskText = String(tasks[String(n)] || "").trim();
  const entry = { id: uid(), t: fmt(ts), p, n, task: taskText, claimed: false };
  logEntries.push(entry); saveJson("logEntries", logEntries);
  appendLogRow(entry, true);

  renderStatus();
  window.daegSyncTouch?.();
});

resetBtn.addEventListener("click", () => {
  if (!canEdit()) return alert('Runner only.');
  if (!confirm("Reset numbers & log? (Tasks are kept)")) return;
  used = { D: new Set(), Ä: new Set(), G: new Set() };
  logEntries = [];
  persistUsed();
  saveJson("logEntries", logEntries);
  clearChildren(logBody);
  renderStatus();
  window.daegSyncTouch?.();
});

/* ---------- persist ---------- */
function persistUsed(){
  saveJson("usedSets", {
    D: Array.from(used.D || []), Ä: Array.from(used.Ä || []), G: Array.from(used.G || []),
  });
}

/* ---------- log rendering ---------- */
function appendLogRow(e, newestOnTop){
  if (!logBody) return;

  const tr = document.createElement("tr");
  const tdTime  = document.createElement("td"); tdTime.textContent = e.t;
  const tdP     = document.createElement("td"); tdP.textContent = e.p;
  const tdNum   = document.createElement("td"); tdNum.textContent = e.n;
  const tdTask  = document.createElement("td"); tdTask.textContent = e.task || "";
  const tdClaim = document.createElement("td");

  if (Number.isInteger(e.n)) {
    const btn = document.createElement("button");
    btn.className = "btn claim runner-only";
    btn.textContent = e.claimed ? "✓ Claimed" : "+500";
    btn.disabled = !!e.claimed || !canEdit();
    btn.addEventListener("click", () => {
      if (!canEdit()) return alert('Runner only.');
      if (btn.disabled) return;
      const idx = logEntries.findIndex(x => x.id === e.id);
      if (idx >= 0 && !logEntries[idx].claimed) {
        const player = logEntries[idx].p;
        const taskText = logEntries[idx].task || '';
        addPoints(player, 500);
        appendPointsLog(player, 500, taskText, e.id);
        logEntries[idx].claimed = true;
        saveJson("logEntries", logEntries);
        btn.disabled = true;
        btn.textContent = "✓ Claimed";
        window.daegSyncTouch?.();
      }
    });
    tdClaim.appendChild(btn);
  }

  tr.append(tdTime, tdP, tdNum, tdTask, tdClaim);

  if (newestOnTop && logBody.firstChild) logBody.insertBefore(tr, logBody.firstChild);
  else logBody.appendChild(tr);
}

function renderLogFromStorage(){
  if (!Array.isArray(logEntries)) logEntries = [];
  for (let i = logEntries.length - 1; i >= 0; i--) appendLogRow(logEntries[i], false);
}

/* ---------- tasks table ---------- */
function renderTasksTable(){
  clearChildren(tasksBody);
  for (let i = 1; i <= 26; i++) {
    const tr = document.createElement("tr");
    const tdNum = document.createElement("td"); tdNum.textContent = String(i);

    const tdInp = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = tasks[String(i)] || "";
    inp.setAttribute("data-num", String(i));
    inp.placeholder = `Enter task for ${i}`;
    const saveIt = () => {
      if (!canEdit()) return; // runner-only edits
      const key = String(i);
      const val = inp.value;
      if (tasks[key] !== val) {
        tasks[key] = val;
        saveJson("tasksByNumber", tasks);
        window.daegSyncTouch?.();
      }
    };
    inp.addEventListener("input", saveIt);
    inp.addEventListener("change", saveIt);

    tdInp.appendChild(inp);
    tr.append(tdNum, tdInp);
    tasksBody.appendChild(tr);
  }
  setTasksInputsDisabled(!canEdit());
}

function setTasksInputsDisabled(disabled){
  const inputs = tasksBody.querySelectorAll('input[type="text"][data-num]');
  inputs.forEach(inp => { inp.disabled = !!disabled; });
}

/* ---------- external update handler ---------- */
function handleExternalUpdate(){
  let u = loadJson("usedSets", { D:[], Ä:[], G:[] });
  Object.keys(u).forEach(k => u[k] = new Set(u[k] || []));
  used = u;
  logEntries = loadJson("logEntries", []);
  tasks = loadJson("tasksByNumber", tasks);

  clearChildren(logBody); renderLogFromStorage();
  renderStatus();

  // refresh task inputs, preserving focus if editing and still runner
  const active = document.activeElement;
  const editing = active && tasksBody.contains(active) && active.tagName === 'INPUT' && canEdit();
  if (!editing) renderTasksTable();
  else {
    const activeNum = active.getAttribute('data-num');
    const inputs = tasksBody.querySelectorAll('input[data-num]');
    inputs.forEach(inp=>{
      const num = inp.getAttribute('data-num');
      if (num !== activeNum) {
        const val = tasks[String(num)] || '';
        if (inp.value !== val) inp.value = val;
      }
    });
  }
}

/* ----- editability toggles ----- */
function updateEditability(){
  const editable = canEdit();
  // Toggle all runner-only controls
  document.querySelectorAll('.runner-only').forEach(el => { el.disabled = !editable; });
  setTasksInputsDisabled(!editable);
}

/* ---------- cross-page points credit + logging ---------- */
function addPoints(player, amount){
  const pts = loadJson("playerPoints", { D:500, Ä:500, G:500 });
  pts[player] = (pts[player] || 0) + amount;
  saveJson("playerPoints", pts);
}
function appendPointsLog(player, delta, note, originNumbersId){
  const pLog = loadJson('pointsLog', []);
  pLog.push({ id: uid(), t: fmt(new Date()), p: player, points: delta, note: note || '', originNumbersId: originNumbersId || null });
  saveJson('pointsLog', pLog);
}

/* ---------- utils ---------- */
function emptyTasks(){ const o={}; for (let i=1;i<=26;i++) o[String(i)]=""; return o; }
function loadJson(k,d){ try{ const s=localStorage.getItem(k); return s?JSON.parse(s):d; }catch{ return d; } }
function saveJson(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function rand1toN(n){ return Math.floor(Math.random()*n)+1; }
function nextAvailableFrom(start,set){ if(set.size>=26) return null; let c=start; for(let i=0;i<26;i++){ if(!set.has(c)) return c; c=(c%26)+1; } return null; }
function fmt(d){ const p=x=>String(x).padStart(2,"0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function uid(){ if (crypto && crypto.getRandomValues){ const a=new Uint32Array(2); crypto.getRandomValues(a); return `${Date.now().toString(36)}-${a[0].toString(36)}-${a[1].toString(36)}`; } return `id-${Math.random().toString(36).slice(2)}`; }
function clearChildren(el){ while (el && el.firstChild) el.removeChild(el.firstChild); }

function renderStatus(){
  const left = L => 26 - (used[L] ? used[L].size : 0);
  statusEl.textContent = `Numbers left — D: ${left("D")}, Ä: ${left("Ä")}, G: ${left("G")}`;
}
