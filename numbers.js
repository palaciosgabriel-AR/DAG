/* ===== Numbers page: persistent draws, tasks, and claim buttons ===== */
const TOTAL = 26;
const PLAYERS = ["D", "Ä", "G"];

const statusEl  = document.getElementById("status");
const logBody   = document.getElementById("logBody");
const tasksBody = document.getElementById("tasksBody");
const resetBtn  = document.getElementById("reset");
const btns = {
  D: document.getElementById("btn-d"),
  Ä: document.getElementById("btn-ae"),
  G: document.getElementById("btn-g"),
};

/* ---------- load state ---------- */
let used = loadJson("usedSets", { D: [], Ä: [], G: [] });
Object.keys(used).forEach(k => used[k] = new Set(used[k] || []));
let logEntries = loadJson("logEntries", []);            // [{id,t,p,n,task,claimed}]
let tasks      = loadJson("tasksByNumber", emptyTasks()); // {"1":"..."}

/* ---------- init UI ---------- */
renderStatus();
PLAYERS.forEach(p => { if (used[p].size === TOTAL) btns[p].disabled = true; });
renderLogFromStorage();
renderTasksTable();

/* ---------- events ---------- */
Object.keys(btns).forEach(p => btns[p].addEventListener("click", () => handlePress(p)));
resetBtn.addEventListener("click", () => {
  if (!confirm("Reset numbers, log, and tasks?")) return;
  used = { D: new Set(), Ä: new Set(), G: new Set() };
  logEntries = [];
  tasks = emptyTasks();
  persistUsed();
  saveJson("logEntries", logEntries);
  saveJson("tasksByNumber", tasks);
  Object.values(btns).forEach(b => (b.disabled = false));
  clearChildren(logBody);
  renderTasksTable();
  renderStatus();
});

/* ---------- core logic ---------- */
function handlePress(player){
  const set = used[player];
  const n = nextAvailableFrom(rand1toN(TOTAL), set);
  const ts = new Date();

  if (n === null) {
    const entry = { id: uid(), t: fmt(ts), p: player, n: "—", task: "", claimed: true };
    logEntries.push(entry); saveJson("logEntries", logEntries);
    appendLogRow(entry, true);
    return;
  }

  set.add(n); persistUsed();
  const taskText = String(tasks[String(n)] || "").trim();
  const entry = { id: uid(), t: fmt(ts), p: player, n, task: taskText, claimed: false };
  logEntries.push(entry); saveJson("logEntries", logEntries);
  appendLogRow(entry, true);

  if (set.size === TOTAL) btns[player].disabled = true;
  renderStatus();
}

function persistUsed(){
  saveJson("usedSets", {
    D: Array.from(used.D), Ä: Array.from(used.Ä), G: Array.from(used.G),
  });
}

/* ---------- log rendering (DOM nodes, no innerHTML) ---------- */
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
    btn.className = "btn claim";
    btn.textContent = e.claimed ? "✓ Claimed" : "+500";
    btn.disabled = !!e.claimed;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const idx = logEntries.findIndex(x => x.id === e.id);
      if (idx >= 0 && !logEntries[idx].claimed) {
        addPoints(logEntries[idx].p, 500);
        logEntries[idx].claimed = true;
        saveJson("logEntries", logEntries);
        btn.disabled = true;
        btn.textContent = "✓ Claimed";
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
    inp.type = "text"; inp.value = tasks[String(i)] || ""; inp.setAttribute("data-num", String(i));
    inp.placeholder = `Enter task for ${i}`;
    inp.addEventListener("input", () => {
      tasks[String(i)] = inp.value;
      saveJson("tasksByNumber", tasks);
    });
    tdInp.appendChild(inp);

    tr.append(tdNum, tdInp);
    tasksBody.appendChild(tr);
  }
}

/* ---------- cross-page points credit ---------- */
function addPoints(player, amount){
  const pts = loadJson("playerPoints", { D:500, Ä:500, G:500 });
  pts[player] = (pts[player] || 0) + amount;
  saveJson("playerPoints", pts);
}

/* ---------- utils ---------- */
function emptyTasks(){ const o={}; for (let i=1;i<=26;i++) o[String(i)]=""; return o; }
function loadJson(k,d){ try{ const s=localStorage.getItem(k); return s?JSON.parse(s):d; }catch{return d;} }
function saveJson(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function rand1toN(n){ return Math.floor(Math.random()*n)+1; }
function nextAvailableFrom(start,set){ if(set.size>=26) return null; let c=start; for(let i=0;i<26;i++){ if(!set.has(c)) return c; c=(c%26)+1; } return null; }
function fmt(d){ const p=x=>String(x).padStart(2,"0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function uid(){ if (crypto && crypto.getRandomValues){ const a=new Uint32Array(2); crypto.getRandomValues(a); return `${Date.now().toString(36)}-${a[0].toString(36)}-${a[1].toString(36)}`; } return `id-${Math.random().toString(36).slice(2)}`; }
function clearChildren(el){ while (el && el.firstChild) el.removeChild(el.firstChild); }
