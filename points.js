/* Points page: unified log (no runner gating) */
var summary  = document.getElementById('summary');
var body     = document.getElementById('pointsBody');
var spendBtn = document.getElementById('spend');
var errEl    = document.getElementById('error');

var minutesEl = document.getElementById('minutes');
var noteEl    = document.getElementById('note');

function myPlayer(){ return localStorage.getItem('myPlayer') || 'D'; }

var points  = load('playerPoints', {"D":500,"Ä":500,"G":500});
var logData = load('pointsLog', []); // {id,t,p,points,note,undoOf?,undone?,originNumbersId?}

renderSummary();
renderLog();

/* Reflect remote updates */
window.addEventListener("daeg-sync-apply", function(){
  points  = load('playerPoints', {"D":500,"Ä":500,"G":500});
  logData = load('pointsLog', []);
  renderSummary();
  body.innerHTML=''; renderLog();
});

/* Spend -> negative points (= -minutes*10) for myPlayer */
spendBtn.addEventListener('click', function(){
  errEl.textContent='';
  var m = parseInt(minutesEl.value,10);
  var note = (noteEl.value||'').trim();

  if (!Number.isInteger(m) || m<1 || m>120){
    errEl.textContent = 'Enter minutes between 1 and 120.'; return;
  }
  var current = myPlayer();
  var delta = -(m * 10);
  if ((points[current]||0) + delta < 0){
    errEl.textContent = "You don't have enough points for that!";
    return;
  }

  applyDelta(current, delta);
  var entry = { id: uid(), t: nowHHMMSS(), p: current, points: delta, note: note };
  logData.push(entry); save('pointsLog', logData);

  prependRow(entry);
  minutesEl.value = ''; noteEl.value = '';
  if (window.daegSyncTouch) window.daegSyncTouch();
});

/* ---------- Rendering ---------- */
function renderSummary(){
  var d  = points['D']  || 0;
  var ae = points['Ä']  || 0;
  var g  = points['G']  || 0;
  summary.innerHTML = renderScoreboard([
    { label: 'D',  value: d,  cls: 'pill-d'  },
    { label: 'Ä',  value: ae, cls: 'pill-ae' },
    { label: 'G',  value: g,  cls: 'pill-g'  },
  ], 'Points left');
}

function renderLog(){
  for (var i=0;i<logData.length;i++) { if (!logData[i].id) logData[i].id = uid(); }
  save('pointsLog', logData);
  for (var j=logData.length-1;j>=0;j--) prependRow(logData[j], false);
}

function prependRow(e, insertTop){
  if (insertTop === void 0) insertTop = true;
  var tr = document.createElement('tr');
  var pts = (typeof e.points === 'number') ? e.points : (typeof e.minutes === 'number' ? -(e.minutes*10) : 0);

  tr.appendChild(td(e.t)); tr.appendChild(td(e.p)); tr.appendChild(td(String(pts))); tr.appendChild(tdText(e.note||''));
  var actions = document.createElement('td');

  var isUndoEntry = !!e.undoOf;
  if (!isUndoEntry && e.undone !== true) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-small';
    btn.textContent = 'Undo';
    btn.addEventListener('click', function(){ doUndo(e, btn); });
    actions.appendChild(btn);
  } else {
    actions.textContent = isUndoEntry ? '← undo' : '';
  }
  tr.appendChild(actions);

  if (insertTop && body.firstChild) body.insertBefore(tr, body.firstChild);
  else body.appendChild(tr);
}

/* ---------- Undo ---------- */
function doUndo(origEntry, buttonEl){
  if (!origEntry.id) { origEntry.id = uid(); save('pointsLog', logData); }

  var origPts = (typeof origEntry.points === 'number') ? origEntry.points : (typeof origEntry.minutes === 'number' ? -(origEntry.minutes*10) : 0);
  var inverse = -origPts;

  applyDelta(origEntry.p, inverse);

  var undo = {
    id: uid(),
    t: nowHHMMSS(),
    p: origEntry.p,
    points: inverse,
    note: 'UNDO: ' + (origEntry.note || ''),
    undoOf: origEntry.id
  };
  logData.push(undo);

  origEntry.undone = true;
  save('pointsLog', logData);

  if (origPts > 0) unclaimNumbersTask(origEntry);

  if (buttonEl) { buttonEl.disabled = true; buttonEl.textContent = 'Undone'; }
  prependRow(undo, true);
  renderSummary();
  if (window.daegSyncTouch) window.daegSyncTouch();
}

function unclaimNumbersTask(pointsEntry){
  var logs = load('logEntries', []);
  var changed = false;

  if (pointsEntry.originNumbersId) {
    var idx = -1;
    for (var i=0;i<logs.length;i++){ if (logs[i] && logs[i].id === pointsEntry.originNumbersId){ idx=i; break; } }
    if (idx >= 0 && logs[idx].claimed) { logs[idx].claimed = false; changed = true; }
  } else {
    var note = (pointsEntry.note || '').replace(/^UNDO:\s*/,'').trim();
    for (var j = logs.length - 1; j >= 0; j--) {
      var row = logs[j];
      if (row && row.p === pointsEntry.p && String(row.task||'').trim() === note && row.claimed === true) {
        logs[j].claimed = false; changed = true; break;
      }
    }
  }
  if (changed) { save('logEntries', logs); if (window.daegSyncTouch) window.daegSyncTouch(); }
}

/* ---------- Helpers ---------- */
function applyDelta(player, delta){
  points[player] = (points[player]||0) + delta;
  save('playerPoints', points);
  renderSummary();
}
function td(text){ var el=document.createElement('td'); el.textContent=text; return el; }
function tdText(text){ var el=document.createElement('td'); el.textContent = text; return el; }
function nowHHMMSS(){ var d=new Date(); function p(x){return String(x).padStart(2,'0');} return p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds()); }
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch(e){return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function uid(){ try{ if (crypto && crypto.getRandomValues){ var a=new Uint32Array(2); crypto.getRandomValues(a); return Date.now().toString(36)+"-"+a[0].toString(36)+"-"+a[1].toString(36); } }catch(e){} return "id-"+Math.random().toString(36).slice(2); }

function renderScoreboard(items, ariaLabel){
  var pills = items.map(function(it){
    return '<div class="pill '+it.cls+'" role="group" aria-label="'+it.label+'">'+
           '<span class="tag"></span><span class="label">'+it.label+'</span>'+
           '<span class="value">'+it.value+'</span></div>';
  }).join('');
  return '<div class="scoreboard" aria-label="'+ariaLabel+'">'+pills+'</div>';
}
