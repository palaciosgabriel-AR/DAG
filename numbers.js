/* ===== Tasks page: single Draw for myPlayer; runner-gated in handlers (ES2018) ===== */
var TOTAL = 26;

var statusEl  = document.getElementById("status");
var logBody   = document.getElementById("logBody");
var tasksBody = document.getElementById("tasksBody");
var resetBtn  = document.getElementById("reset");
var drawBtn   = document.getElementById("btn-draw");

// Always quote non-ASCII keys
var used = loadJson("usedSets", { "D": [], "Ä": [], "G": [] });
Object.keys(used).forEach(function(k){ used[k] = new Set(used[k] || []); });
var logEntries = loadJson("logEntries", []);               // [{id,t,p,n,task,claimed}]
var tasks      = loadJson("tasksByNumber", emptyTasks());  // {"1":"..."}

function myPlayer(){ return localStorage.getItem('myPlayer') || 'D'; }
function canEdit(){ return (typeof window.canEdit === 'function') ? window.canEdit() : true; }

/* ---------- init ---------- */
renderStatus();
renderLogFromStorage();
renderTasksTable();

window.addEventListener("daeg-sync-apply", handleExternalUpdate);

/* ---------- events ---------- */
drawBtn.addEventListener("click", function(){
  if (!canEdit()) { alert('Runner only.'); return; }

  var p = myPlayer();
  var set = used[p] || new Set();
  var n = nextAvailableFrom(rand1toN(TOTAL), set);
  var ts = new Date();

  if (n === null) {
    var entryFull = { id: uid(), t: fmt(ts), p: p, n: "—", task: "", claimed: true };
    logEntries.push(entryFull); saveJson("logEntries", logEntries);
    appendLogRow(entryFull, true);
    if (window.daegSyncTouch) window.daegSyncTouch();
    return;
  }

  set.add(n); used[p] = set; persistUsed();
  var taskText = String(tasks[String(n)] || "").trim();
  var entry = { id: uid(), t: fmt(ts), p: p, n: n, task: taskText, claimed: false };
  logEntries.push(entry); saveJson("logEntries", logEntries);
  appendLogRow(entry, true);

  renderStatus();
  if (window.daegSyncTouch) window.daegSyncTouch();
});

resetBtn.addEventListener("click", function(){
  if (!canEdit()) { alert('Runner only.'); return; }
  if (!confirm("Reset numbers & log? (Tasks are kept)")) return;
  used = { "D": new Set(), "Ä": new Set(), "G": new Set() };
  logEntries = [];
  persistUsed();
  saveJson("logEntries", logEntries);
  clearChildren(logBody);
  renderStatus();
  if (window.daegSyncTouch) window.daegSyncTouch();
});

/* ---------- persist ---------- */
function persistUsed(){
  saveJson("usedSets", {
    "D": Array.from(used["D"] || []),
    "Ä": Array.from(used["Ä"] || []),
    "G": Array.from(used["G"] || [])
  });
}

/* ---------- log rendering ---------- */
function appendLogRow(e, newestOnTop){
  if (!logBody) return;
  var tr = document.createElement("tr");
  var tdTime  = document.createElement("td"); tdTime.textContent = e.t;
  var tdP     = document.createElement("td"); tdP.textContent = e.p;
  var tdNum   = document.createElement("td"); tdNum.textContent = e.n;
  var tdTask  = document.createElement("td"); tdTask.textContent = e.task || "";
  var tdClaim = document.createElement("td");

  if (typeof e.n === 'number' && isFinite(e.n)) {
    var btn = document.createElement("button");
    btn.className = "btn claim";
    btn.textContent = e.claimed ? "✓ Claimed" : "+500";
    btn.disabled = !!e.claimed;
    btn.addEventListener("click", function(){
      if (!canEdit()) { alert('Runner only.'); return; }
      if (btn.disabled) return;
      var idx = -1;
      for (var i=0;i<logEntries.length;i++){ if (logEntries[i].id === e.id){ idx=i; break; } }
      if (idx >= 0 && !logEntries[idx].claimed) {
        var player = logEntries[idx].p;
        var taskText = logEntries[idx].task || '';
        addPoints(player, 500);
        appendPointsLog(player, 500, taskText, e.id);
        logEntries[idx].claimed = true;
        saveJson("logEntries", logEntries);
        btn.disabled = true;
        btn.textContent = "✓ Claimed";
        if (window.daegSyncTouch) window.daegSyncTouch();
      }
    });
    tdClaim.appendChild(btn);
  }

  tr.appendChild(tdTime); tr.appendChild(tdP); tr.appendChild(tdNum); tr.appendChild(tdTask); tr.appendChild(tdClaim);
  if (newestOnTop && logBody.firstChild) logBody.insertBefore(tr, logBody.firstChild);
  else logBody.appendChild(tr);
}

function renderLogFromStorage(){
  if (!Array.isArray(logEntries)) logEntries = [];
  for (var i = logEntries.length - 1; i >= 0; i--) appendLogRow(logEntries[i], false);
}

/* ---------- tasks table ---------- */
function renderTasksTable(){
  clearChildren(tasksBody);
  for (var i = 1; i <= 26; i++) {
    var tr = document.createElement("tr");
    var tdNum = document.createElement("td"); tdNum.textContent = String(i);

    var tdInp = document.createElement("td");
    var inp = document.createElement("input");
    inp.type = "text";
    inp.value = tasks[String(i)] || "";
    inp.setAttribute("data-num", String(i));
    inp.placeholder = "Enter task for " + i;
    var saveIt = function(ev){
      if (!canEdit()) return;
      var k = String(i); // i from loop — we bind via attribute below
      // use ev.target to get current value/num
    };
    // bind with closure-safe handler
    (function(num, inputEl){
      function doSave(){
        if (!canEdit()) return;
        var k = String(num);
        var v = inputEl.value;
        if (tasks[k] !== v) { tasks[k] = v; saveJson("tasksByNumber", tasks); if (window.daegSyncTouch) window.daegSyncTouch(); }
      }
      inputEl.addEventListener("input", doSave);
      inputEl.addEventListener("change", doSave);
    })(i, inp);

    tdInp.appendChild(inp);
    tr.appendChild(tdNum); tr.appendChild(tdInp);
    tasksBody.appendChild(tr);
  }
}

/* ---------- external update ---------- */
function handleExternalUpdate(){
  var u = loadJson("usedSets", { "D":[], "Ä":[], "G":[] });
  Object.keys(u).forEach(function(k){ u[k] = new Set(u[k] || []); });
  used = u;
  logEntries = loadJson("logEntries", []);
  tasks = loadJson("tasksByNumber", tasks);
  clearChildren(logBody); renderLogFromStorage();
  renderStatus();

  var active = document.activeElement;
  var editing = active && tasksBody.contains(active) && active.tagName === 'INPUT';
  if (!editing) renderTasksTable();
  else {
    var activeNum = active.getAttribute('data-num');
    var inputs = tasksBody.querySelectorAll('input[data-num]');
    for (var i=0;i<inputs.length;i++){
      var inp = inputs[i];
      var num = inp.getAttribute('data-num');
      if (num !== activeNum) {
        var val = tasks[String(num)] || '';
        if (inp.value !== val) inp.value = val;
      }
    }
  }
}

/* ---------- cross-page points ---------- */
function addPoints(player, amount){
  var pts = loadJson("playerPoints", { "D":500, "Ä":500, "G":500 });
  pts[player] = (pts[player] || 0) + amount;
  saveJson("playerPoints", pts);
}
function appendPointsLog(player, delta, note, originNumbersId){
  var pLog = loadJson('pointsLog', []);
  pLog.push({ id: uid(), t: fmt(new Date()), p: player, points: delta, note: note || '', originNumbersId: originNumbersId || null });
  saveJson('pointsLog', pLog);
}

/* ---------- utils ---------- */
function emptyTasks(){ var o={}; for (var i=1;i<=26;i++) o[String(i)]=""; return o; }
function loadJson(k,d){ try{ var s=localStorage.getItem(k); return s?JSON.parse(s):d; }catch(e){ return d; } }
function saveJson(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function rand1toN(n){ return Math.floor(Math.random()*n)+1; }
function nextAvailableFrom(start,set){ if(set.size>=26) return null; var c=start; for(var i=0;i<26;i++){ if(!set.has(c)) return c; c=(c%26)+1; } return null; }
function fmt(d){ function p(x){return String(x).padStart(2,"0");} return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }
function uid(){ try{ if (crypto && crypto.getRandomValues){ var a=new Uint32Array(2); crypto.getRandomValues(a); return Date.now().toString(36)+"-"+a[0].toString(36)+"-"+a[1].toString(36); } }catch(e){} return "id-"+Math.random().toString(36).slice(2); }
function clearChildren(el){ while (el && el.firstChild) el.removeChild(el.firstChild); }

function renderStatus(){
  function left(L){ return 26 - (used[L] ? used[L].size : 0); }
  statusEl.textContent = "Numbers left — D: " + left("D") + ", Ä: " + left("Ä") + ", G: " + left("G");
}
