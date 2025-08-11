/* Points page */
const summary  = document.getElementById('summary');
const body     = document.getElementById('pointsBody');
const spendBtn = document.getElementById('spend');
const errEl    = document.getElementById('error');

const minutesEl = document.getElementById('minutes');
const noteEl    = document.getElementById('note');

let current = localStorage.getItem('lastPlayer') || 'D';
let points  = load('playerPoints', {"D":500,"Ä":500,"G":500});
let log     = load('pointsLog', []); // [{t,p,minutes,note}]

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

spendBtn.addEventListener('click', ()=>{
  errEl.textContent='';
  const m = parseInt(minutesEl.value,10);
  const note = (noteEl.value||'').trim();

  if (!Number.isInteger(m) || m<1 || m>120){
    errEl.textContent = 'Enter minutes between 1 and 120.'; return;
  }
  if ((points[current]||0) - m < 0){
    errEl.textContent = "You don't have enough points for that!";
    return;
  }
  points[current] = (points[current]||0) - m;
  save('playerPoints', points);
  renderSummary();

  const entry = { t: nowHHMMSS(), p: current, minutes: m, note };
  log.push(entry); save('pointsLog', log);
  prependRow(entry);

  minutesEl.value = ''; noteEl.value = '';
});

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
  body.innerHTML=''; for (let i=log.length-1;i>=0;i--) prependRow(log[i], false);
}
function prependRow(e, insertTop=true){
  const tr=document.createElement('tr');
  tr.innerHTML = `<td>${e.t}</td><td>${e.p}</td><td>${e.minutes}</td><td>${escapeHtml(e.note||'')}</td>`;
  if (insertTop && body.firstChild) body.insertBefore(tr, body.firstChild); else body.appendChild(tr);
}
function highlightPlayer(p){
  document.querySelectorAll('[data-player]').forEach(b=>b.classList.toggle('btn-letter', b.dataset.player===p));
}
function nowHHMMSS(){ const d=new Date(),p=x=>String(x).padStart(2,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function escapeHtml(s){ return s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m])); }

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
