/* Map assignment (persists) + labels + crowned leader — Runner writes only */
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
function myPlayer(){ return localStorage.getItem('myPlayer') || 'D'; }
function canEdit(){ return typeof window.canEdit === 'function' ? window.canEdit() : true; }

let mapState = load('mapState', {});   // {ZH:'D', ...}

const hostSvg = document.getElementById('ch-map');
const layer = document.getElementById('cantons-layer');

const normId = (raw)=>{ if(!raw) return null; let s=raw.toUpperCase().trim();
  s=s.replace(/^CH[\-_.\s]?/,''); s=s.replace(/[^A-Z]/g,''); if(s.length>2)s=s.slice(-2); return CODESET.has(s)?s:null; };

/* Load local ch.svg (already hosted with the site) */
(async function loadSvg(){
  try{
    const r = await fetch('./ch.svg', {mode:'cors'}); if(!r.ok) throw new Error('svg not found');
    const txt = await r.text(); const doc = new DOMParser().parseFromString(txt,'image/svg+xml'); const src = doc.documentElement;
    const vb = src.getAttribute('viewBox'); if(vb) hostSvg.setAttribute('viewBox', vb);
    layer.innerHTML = '';
    const ensure = (code)=>{ let g=layer.querySelector(`#${code}`); if(!g){ g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','canton'); g.setAttribute('id',code); layer.appendChild(g);} return g; };

    Array.from(src.querySelectorAll('g[id]')).forEach(G=>{
      const code = normId(G.getAttribute('id')); if(!code) return;
      const dest = ensure(code);
      Array.from(G.querySelectorAll('path,polygon,rect')).forEach(sh=>{ const c=sh.cloneNode(true); scrub(c); dest.appendChild(c); });
    });
    Array.from(src.querySelectorAll('path[id],polygon[id],rect[id]')).forEach(sh=>{
      const code = normId(sh.getAttribute('id')); if(!code) return;
      const dest = ensure(code); const c=sh.cloneNode(true); scrub(c); dest.appendChild(c);
    });
    if (layer.querySelectorAll('.canton').length < 20) throw new Error('not enough shapes');

    wireCantons(); applyMapColors(); updateCounts();
  }catch(e){
    document.getElementById('counts').textContent = 'Map failed to load.';
    console.error(e);
  }
})();

function scrub(el){ el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('fill'); el.removeAttribute('stroke'); el.removeAttribute('opacity'); }

function ensureLabel(g, id){
  let t = g.querySelector('text.label');
  if (!t) {
    t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('class','label');
    t.textContent = NAMES[id] || id;
    g.appendChild(t);
  }
  const bb = g.getBBox();
  t.setAttribute('x', (bb.x + bb.width / 2));
  t.setAttribute('y', (bb.y + bb.height / 2));
  return t;
}

function wireCantons(){
  Array.from(layer.querySelectorAll('.canton')).forEach(g=>{
    const id = normId(g.id); if(!id) return; g.id = id;

    g.addEventListener('click', ()=>{
      if (!canEdit()) return;              // Runner-only
      const owner = mapState[id];
      const me = myPlayer();
      if (!owner) mapState[id] = me;
      else if (owner === me) delete mapState[id];
      else mapState[id] = me;
      save('mapState', mapState);
      applyMapColors(); updateCounts();
      window.daegSyncTouch?.();
    });

    g.addEventListener('mouseenter', ()=>{
      const t = ensureLabel(g, id); t.style.display = 'block';
    });
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
    t.style.display = owner ? 'block' : 'none';
  });
}
window.addEventListener('daeg-theme-change', applyMapColors);

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

/* sync updates */
window.addEventListener('daeg-sync-apply', ()=>{
  mapState = load('mapState', {});
  applyMapColors(); updateCounts();
});

/* shared helpers */
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
