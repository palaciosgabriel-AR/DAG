/* Points page: unified log + Undo support */
const summary  = document.getElementById('summary');
const body     = document.getElementById('pointsBody');
const spendBtn = document.getElementById('spend');
const errEl    = document.getElementById('error');

const minutesEl = document.getElementById('minutes');
const noteEl    = document.getElementById('note');

let current = localStorage.getItem('lastPlayer') || 'D';
let points  = load('playerPoints', {"D":500,"Ä":500,"G":500});
let log     = load('pointsLog', []); // entries: {id,t,p,points,note,undoOf?,undone?} (legacy may have {minutes})

highlightPlayer(current);
renderSummary();
renderLog();

document.querySelectorAll('[data-player]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    current = btn.dataset.player;
    localStorage.setItem('lastPlayer', current);
    highlightPlayer(current);
  });
});

/* Spend -> negative points (= -minutes*10) */
spendBtn.addEventListener('click', ()=>{
  errEl.textContent='';
  const m = parseInt(minutesEl.value,10);
  const note = (noteEl.value||'').trim();

  if (!Number.isInteger(m) || m<1 || m>120){
    errEl.textContent = 'Enter minutes between 1 and 120.'; return;
  }
  const delta = -(m * 10); // minutes cost 10 points each
  if ((points[current]||0) + delta < 0){
    errEl.textContent = "You don't have enough points for that!";
    return;
  }

  applyDelta(current, delta);
  const entry = { id: uid(), t: nowHHMMSS(), p: current, points: delta, note };
  log.push(entry); save('pointsLog', log);

  prependRow(entry);
  minutesEl.value = ''; noteEl.value = '';
});

/* ---------- Rendering ---------- */
function renderSummary(){
  const d  = points['D']  || 0;
  const ae = points['Ä']  || 0;
  const g  = points['G']  || 0;
  summary.innerHTML = renderScoreboard([
    { label: 'D',  value: d,  cls: 'pill-d'  },
    { label: 'Ä',  value: ae, cls: 'pill-ae' },
    { label: 'G',  value: g,  cls: 'pill-g'  },
  ], 'Points left');
}

function renderLog(){
  body.innerHTML='';
  // ensure all entries have IDs (for undo linking)
  for (let i=0;i<log.length;i++) {
    if (!log[i].id) { log[i].id = uid(); }
  }
  save('pointsLog', log);
  for (let i=log.length-1;i>=0;i--) prependRow(log[i], false);
}

function prependRow(e, insertTop=true){
  const tr = document.createElement('tr');

  // compute canonical points value (legacy support)
  const pts = typeof e.points === 'number'
    ? e.points
    : (typeof e.minutes === 'number' ? -(e.minutes*10) : 0);

  tr.append(td(e.t), td(e.p), td(String(pts)), tdText(e.note||''));
  const actions = document.createElement('td');

  const isUndoEntry = !!e.undoOf;
  if (!isUndoEntry && e.undone !== true) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-small';
    btn.textContent = 'Undo';
    btn.addEventListener('click', ()=>{
      doUndo(e, btn);
    });
    actions.appendChild(btn);
  } else {
    actions.textContent = isUndoEntry ? '← undo' : '';
  }
  tr.appendChild(actions);

  if (insertTop && body.firstChild) body.insertBefore(tr, body.firstChild);
  else body.appendChild(tr);
}

/* ---------- Undo logic ---------- */
function doUndo(origEntry, buttonEl){
  // ensure ID present
  if (!origEntry.id) { origEntry.id = uid(); save('pointsLog', log); }

  // inverse delta (legacy-safe)
  const origPts = typeof origEntry.points === 'number'
    ? origEntry.points
    : (typeof origEntry.minutes === 'number' ? -(origEntry.minutes*10) : 0);

  const inverse = -origPts;

  // Apply inverse without "no negative" guard — this is a correction entry
  applyDelta(origEntry.p, inverse);

  // Append an undo entry linked to original
  const undo = {
    id: uid(),
    t: nowHHMMSS(),
    p: origEntry.p,
    points: inverse,
    note: 'UNDO: ' + (origEntry.note || ''),
    undoOf: origEntry.id
  };
  log.push(undo);

  // Mark original as undone and persist
  origEntry.undone = true;
  save('pointsLog', log);

  // UI: disable the clicked button and add the undo entry at the top
  if (buttonEl) { buttonEl.disabled = true; buttonEl.textContent = 'Undone'; }
  prependRow(undo, true);
  renderSummary();
}

/* ---------- Helpers ---------- */
function applyDelta(player, delta){
  points[player] = (points[player]||0) + delta;
  save('playerPoints', points);
  renderSummary();
}
function td(text){ const el=document.createElement('td'); el.textContent=text; return el; }
function tdText(text){ const el=document.createElement('td'); el.textContent = text; return el; }

function highlightPlayer(p){
  document.querySelectorAll('[data-player]').forEach(b=>b.classList.toggle('btn-letter', b.dataset.player===p));
}
function nowHHMMSS(){ const d=new Date(),p=x=>String(x).padStart(2,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function uid(){ if (crypto && crypto.getRandomValues){ const a=new Uint32Array(2); crypto.getRandomValues(a); return `${Date.now().toString(36)}-${a[0].toString(36)}-${a[1].toString(36)}`; } return `id-${Math.random().toString(36).slice(2)}`; }

/* shared scoreboard renderer */
function renderScoreboard(items, ariaLabel){
  const pills = items.map(it => (
    `<div class="pill ${it.cls}" role="group" aria-label="${it.label}">
       <span class="tag"></span><span class="label">${it.label}</span>
       <span class="value">${it.value}</span>
     </div>`
  )).join('');
  return `<div class="scoreboard" aria-label="${ariaLabel}">${pills}</div>`;
}
