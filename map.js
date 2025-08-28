/* Map assignment (persists) + labels + crowned leader + local SVG loader + explicit sync touch */
const COLORS = { 'D': '#4B5320', 'Ä': '#7EC8E3', 'G': '#004080' };
const CODES = ['ZH','BE','LU','UR','SZ','OW','NW','GL','ZG','FR','SO','BS','BL','SH','AR','AI','SG','GR','AG','TG','VD','VS','NE','GE','TI','JU'];
const CODESET = new Set(CODES);
const NAMES = {
  ZH:'Zürich', BE:'Bern', LU:'Luzern', UR:'Uri', SZ:'Schwyz', OW:'Obwalden', NW:'Nidwalden',
  GL:'Glarus', ZG:'Zug', FR:'Fribourg', SO:'Solothurn', BS:'Basel-Stadt', BL:'Basel-Landschaft',
  SH:'Schaffhausen', AR:'Appenzell Ausserrhoden', AI:'Appenzell Innerrhoden', SG:'St. Gallen',
  GR:'Graubünden', AG:'Aargau', TG:'Thurgau', VD:'Vaud', VS:'Valais', NE:'Neuchâtel',
  GE:'Genève', TI:'Ticino', JU:'Jura'
};

let mapState = load('mapState', {});   // {ZH:'D', ...}
let activePlayer = localStorage.getItem('activePlayer') || 'D';

const chips = Array.from(document.querySelectorAll('.chip'));
chips.forEach(ch => ch.addEventListener('click', ()=>{ activePlayer = ch.dataset.player; localStorage.setItem('activePlayer',activePlayer); updateChips(); window.daegSyncTouch?.('activePlayer'); }));
function updateChips(){ chips.forEach(ch=>ch.classList.toggle('active', ch.dataset.player===activePlayer)); }
updateChips();

const hostSvg = document.getElementById('ch-map');
const layer = document.getElementById('cantons-layer');

function normId(raw){
  if(!raw) return null; let s=raw.toUpperCase().trim();
  s=s.replace(/^CH[\-_.\s]?/,''); s=s.replace(/[^A-Z]/g,''); if(s.length>2)s=s.slice(-2);
  return CODESET.has(s)?s:null;
}

(async function loadSvg(){
  const sources = [
    './ch.svg?v=2',
    'https://upload.wikimedia.org/wikipedia/commons/f/f8/Suisse_cantons.svg',
    'https://simplemaps.com/static/svg/country/ch/admin1/ch.svg'
  ];
  for (const url of sources){
    try{
      const r = await fetch(url, { cache: 'no-store' });
      if(!r.ok) throw new Error('HTTP '+r.status);
      const txt = await r.text();
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const src = doc.documentElement;
      const vb = src.getAttribute('viewBox'); if(vb) hostSvg.setAttribute('viewBox', vb);
      layer.innerHTML = '';
      const ensure = (code)=>{ let g=layer.querySelector(`#${code}`); if(!g){ g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','canton'); g.setAttribute('id',code); layer.appendChild(g);} return g; };
      const scrub = (el)=>{ el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('fill'); el.removeAttribute('stroke'); el.removeAttribute('opacity'); };

      Array.from(src.querySelectorAll('g[id]')).forEach(G=>{
        const code = normId(G.getAttribute('id')); if(!code) return;
        const dest = ensure(code);
        Array.from(G.querySelectorAll('path,polygon,rect')).forEach(sh=>{ const c=sh.cloneNode(true); scrub(c); dest.appendChild(c); });
      });
      Array.from(src.querySelectorAll('path[id],polygon[id],rect[id]')).forEach(sh=>{
        const code = normId(sh.getAttribute('id')); if(!code) return;
        const dest = ensure(code); const c=sh.cloneNode(true); scrub(c); dest.appendChild(c);
      });
      if (layer.querySelectorAll('.canton').length < 20) throw new Error('not-enough-shapes');

      wireCantons(); applyMapColors(); updateCounts(); return;
    }catch(e){ /* try next */ }
  }
  document.getElementById('counts').textContent = 'Map failed to load.';
})();

function ensureLabel(g, id){
  let t = g.querySelector('text.label');
  if (!t) {
    t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('class','label');
    t.textContent = NAMES[id] || id;
    g.appendChild(t);
  }
  try {
    const bb = g.getBBox();
    t.setAttribute('x', (bb.x + bb.width / 2));
    t.setAttribute('y', (bb.y + bb.height / 2));
  } catch {}
  return t;
}

function wireCantons(){
  Array.from(layer.querySelectorAll('.canton')).forEach(g=>{
    const id = normId(g.id); if(!id) return; g.id = id;

    g.addEventListener('click', ()=>{
      const cur = mapState[id];
      if(!cur) mapState[id]=activePlayer;
      else if (cur===activePlayer) delete mapState[id];
      else mapState[id]=activePlayer;

      save('mapState', mapState);
      // NEW: explicitly nudge the sync layer to push now
      window.daegSyncTouch?.('mapState');

      applyMapColors(); updateCounts();
    });

    g.addEventListener('mouseenter', ()=>{ const t = ensureLabel(g, id); t.style.display = 'block'; });
    g.addEventListener('mouseleave', ()=>{
      const owner = mapState[id];
      const t = g.querySelector('text.label');
      if (t && !owner) t.style.display = 'none';
    });
  });
}

function applyMapColors(){
  const dark = document.body.classList.contains('dark');
  Array.from(layer.querySelectorAll('.canton')).forEach(g=>{
    const id = g.id, owner = mapState[id];
    const shapes = Array.from(g.querySelectorAll('path,rect,polygon'));
    shapes.forEach(path=>{
      if(owner){ path.style.fill = COLORS[owner]; path.style.stroke = 'rgba(255,255,255,.85)'; }
      else { path.style.fill = dark ? '#1b1c21' : 'rgba(255,255,255,.9)'; path.style.stroke = dark ? '#2a2a2a' : 'rgba(0,0,0,.25)'; }
    });

    const t = ensureLabel(g, id);
    t.style.display = mapState[id] ? 'block' : 'none';
  });
}
window.addEventListener('daeg-sync-apply', ()=>{
  mapState = load('mapState', {});
  applyMapColors(); updateCounts(); updateChips();
});
window.addEventListener('daeg-theme-change', applyMapColors);

/* ---- Scoreboard with crowns ---- */
function updateCounts(){
  const counts={'D':0,'Ä':0,'G':0}; Object.values(mapState).forEach(v=>{ if(counts[v]!=null) counts[v]++; });
  const max = Math.max(counts['D'], counts['Ä'], counts['G']);
  const items = [
    { label:'D',  value: counts['D'],  cls:'pill-d',  crown: counts['D']===max && max>0 },
    { label:'Ä',  value: counts['Ä'],  cls:'pill-ae', crown: counts['Ä']===max && max>0 },
    { label:'G',  value: counts['G'],  cls:'pill-g',  crown: counts['G']===max && max>0 },
  ];
  document.getElementById('counts').innerHTML = renderScoreboard(items, 'Cantons owned');
}

/* shared helpers */
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

function renderScoreboard(items, ariaLabel){
  const pills = items.map(it => (
    `<div class="pill ${it.cls}" role="group" aria-label="${it.label}">
       <span class="tag"></span>
       ${it.crown ? '<span class="crown" aria-hidden="true">👑</span>' : ''}
       <span class="label">${it.label}</span>
       <span class="value">${it.value}</span>
     </div>`
  )).join('');
  return `<div class="scoreboard" aria-label="${ariaLabel}">${pills}</div>`;
}
