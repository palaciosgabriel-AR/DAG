/* Map assignment (persists) */
const COLORS = { 'D': '#4B5320', 'Ä': '#7EC8E3', 'G': '#004080' };
const CODES = ['ZH','BE','LU','UR','SZ','OW','NW','GL','ZG','FR','SO','BS','BL','SH','AR','AI','SG','GR','AG','TG','VD','VS','NE','GE','TI','JU'];
const CODESET = new Set(CODES);

let mapState = load('mapState', {});   // {ZH:'D', ...}
let activePlayer = localStorage.getItem('activePlayer') || 'D';

const chips = Array.from(document.querySelectorAll('.chip'));
chips.forEach(ch => ch.addEventListener('click', ()=>{ activePlayer = ch.dataset.player; localStorage.setItem('activePlayer',activePlayer); updateChips(); }));
function updateChips(){ chips.forEach(ch=>ch.classList.toggle('active', ch.dataset.player===activePlayer)); }
updateChips();

const hostSvg = document.getElementById('ch-map');
const layer = document.getElementById('cantons-layer');

const normId = (raw)=>{ if(!raw) return null; let s=raw.toUpperCase().trim();
  s=s.replace(/^CH[\-_.\s]?/,''); s=s.replace(/[^A-Z]/g,''); if(s.length>2)s=s.slice(-2); return CODESET.has(s)?s:null; };

(async function loadSvg(){
  const sources = [
    'https://upload.wikimedia.org/wikipedia/commons/f/f8/Suisse_cantons.svg',
    'https://simplemaps.com/static/svg/country/ch/admin1/ch.svg'
  ];
  for(const url of sources){
    try{
      const r = await fetch(url, {mode:'cors'}); if(!r.ok) continue;
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

      wireCantons(); applyMapColors(); updateCounts(); return;
    }catch(e){ /* try next */ }
  }
  document.getElementById('counts').textContent = 'Map failed to load.';
})();

function scrub(el){ el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('fill'); el.removeAttribute('stroke'); el.removeAttribute('opacity'); }

function wireCantons(){
  Array.from(layer.querySelectorAll('.canton')).forEach(g=>{
    const id = normId(g.id); if(!id) return; g.id = id;
    g.addEventListener('click', ()=>{
      const cur = mapState[id];
      if(!cur) mapState[id]=activePlayer;
      else if (cur===activePlayer) delete mapState[id];
      else mapState[id]=activePlayer;
      save('mapState', mapState); applyMapColors(); updateCounts();
    });
  });
}

function applyMapColors(){
  const dark = document.body.classList.contains('dark');
  Array.from(layer.querySelectorAll('.canton')).forEach(g=>{
    const id = g.id, owner = mapState[id];
    Array.from(g.querySelectorAll('path,rect,polygon')).forEach(path=>{
      if(owner){ path.style.fill = COLORS[owner]; path.style.stroke = 'rgba(255,255,255,.85)'; }
      else { path.style.fill = dark ? '#1b1c21' : 'rgba(255,255,255,.9)'; path.style.stroke = dark ? '#2a2a2a' : 'rgba(0,0,0,.25)'; }
    });
  });
}
window.addEventListener('daeg-theme-change', applyMapColors);

function updateCounts(){
  const counts={'D':0,'Ä':0,'G':0}; Object.values(mapState).forEach(v=>{ if(counts[v]!=null) counts[v]++; });
  document.getElementById('counts').textContent = `Cantons — D: ${counts['D']} · Ä: ${counts['Ä']} · G: ${counts['G']}`;
}

function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
