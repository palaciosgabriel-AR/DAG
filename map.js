/* Map assignment (persists) + labels + crowned leader — ES2018 safe */
var COLORS = { 'D': '#4B5320', 'Ä': '#7EC8E3', 'G': '#004080' };
var CODES = ['ZH','BE','LU','UR','SZ','OW','NW','GL','ZG','FR','SO','BS','BL','SH','AR','AI','SG','GR','AG','TG','VD','VS','NE','GE','TI','JU'];
var CODESET = new Set(CODES);
var NAMES = {
  ZH:'Zürich', BE:'Bern', LU:'Luzern', UR:'Uri', SZ:'Schwyz', OW:'Obwalden', NW:'Nidwalden',
  GL:'Glarus', ZG:'Zug', FR:'Fribourg', SO:'Solothurn', BS:'Basel-Stadt', BL:'Basel-Landschaft',
  SH:'Schaffhausen', AR:'Appenzell Ausserrhoden', AI:'Appenzell Innerrhoden', SG:'St. Gallen',
  GR:'Graubünden', AG:'Aargau', TG:'Thurgau', VD:'Vaud', VS:'Valais', NE:'Neuchâtel',
  GE:'Genève', TI:'Ticino', JU:'Jura'
};
function myPlayer(){ return localStorage.getItem('myPlayer') || 'D'; }

var mapState = load('mapState', {});   // {ZH:'D', ...}

var hostSvg = document.getElementById('ch-map');
var layer = document.getElementById('cantons-layer');

function normId(raw){
  if(!raw) return null;
  var s = String(raw).toUpperCase().trim();
  s = s.replace(/^CH[\-_.\s]?/,'');
  s = s.replace(/[^A-Z]/g,'');
  if(s.length>2) s = s.slice(-2);
  return CODESET.has(s)?s:null;
}

/* Load local ch.svg (must exist beside this file) */
(function loadSvg(){
  fetch('./ch.svg', {mode:'cors'}).then(function(r){
    if(!r.ok) throw new Error('svg not found');
    return r.text();
  }).then(function(txt){
    var doc = new DOMParser().parseFromString(txt,'image/svg+xml'); var src = doc.documentElement;
    var vb = src.getAttribute('viewBox'); if(vb) hostSvg.setAttribute('viewBox', vb);
    layer.innerHTML = '';
    function ensure(code){ var g=layer.querySelector('#'+code); if(!g){ g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','canton'); g.setAttribute('id',code); layer.appendChild(g);} return g; }

    Array.prototype.forEach.call(src.querySelectorAll('g[id]'), function(G){
      var code = normId(G.getAttribute('id')); if(!code) return;
      var dest = ensure(code);
      Array.prototype.forEach.call(G.querySelectorAll('path,polygon,rect'), function(sh){ var c=sh.cloneNode(true); scrub(c); dest.appendChild(c); });
    });
    Array.prototype.forEach.call(src.querySelectorAll('path[id],polygon[id],rect[id]'), function(sh){
      var code = normId(sh.getAttribute('id')); if(!code) return;
      var dest = ensure(code); var c=sh.cloneNode(true); scrub(c); dest.appendChild(c);
    });
    if (layer.querySelectorAll('.canton').length < 20) throw new Error('not enough shapes');

    wireCantons(); applyMapColors(); updateCounts();
  }).catch(function(e){
    var c = document.getElementById('counts'); if (c) c.textContent = 'Map failed to load.';
    console.error(e);
  });
})();

function scrub(el){ el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('fill'); el.removeAttribute('stroke'); el.removeAttribute('opacity'); }

function ensureLabel(g, id){
  var t = g.querySelector('text.label');
  if (!t) {
    t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('class','label');
    t.textContent = NAMES[id] || id;
    g.appendChild(t);
  }
  var bb = g.getBBox();
  t.setAttribute('x', (bb.x + bb.width / 2));
  t.setAttribute('y', (bb.y + bb.height / 2));
  return t;
}

function wireCantons(){
  Array.prototype.forEach.call(layer.querySelectorAll('.canton'), function(g){
    var id = normId(g.id); if(!id) return; g.id = id;

    g.addEventListener('click', function(){
      var owner = mapState[id];
      var me = myPlayer();
      if (!owner) mapState[id] = me;
      else if (owner === me) delete mapState[id];
      else mapState[id] = me;
      save('mapState', mapState);
      applyMapColors(); updateCounts();
      if (window.daegSyncTouch) window.daegSyncTouch();
    });

    g.addEventListener('mouseenter', function(){ var t = ensureLabel(g, id); t.style.display = 'block'; });
    g.addEventListener('mouseleave', function(){
      var owner = mapState[id];
      var t = g.querySelector('text.label');
      if (t && !owner) t.style.display = 'none';
    });
  });
}

function applyMapColors(){
  var dark = document.body.classList.contains('dark');
  Array.prototype.forEach.call(layer.querySelectorAll('.canton'), function(g){
    var id = g.id, owner = mapState[id];
    var shapes = g.querySelectorAll('path,rect,polygon');
    Array.prototype.forEach.call(shapes, function(path){
      if(owner){ path.style.fill = COLORS[owner]; path.style.stroke = 'rgba(255,255,255,.85)'; }
      else { path.style.fill = dark ? '#1b1c21' : 'rgba(255,255,255,.9)'; path.style.stroke = dark ? '#2a2a2a' : 'rgba(0,0,0,.25)'; }
    });
    var t = ensureLabel(g, id);
    t.style.display = owner ? 'block' : 'none';
  });
}
window.addEventListener('daeg-theme-change', applyMapColors);

function updateCounts(){
  var counts={'D':0,'Ä':0,'G':0};
  Object.keys(mapState).forEach(function(k){ var v=mapState[k]; if (counts.hasOwnProperty(v)) counts[v]++; });
  var max = Math.max(counts['D'], counts['Ä'], counts['G']);
  var items = [
    { label:'D',  value: counts['D'],  cls:'pill-d',  crown: counts['D']===max && max>0 },
    { label:'Ä',  value: counts['Ä'],  cls:'pill-ae', crown: counts['Ä']===max && max>0 },
    { label:'G',  value: counts['G'],  cls:'pill-g',  crown: counts['G']===max && max>0 }
  ];
  document.getElementById('counts').innerHTML = renderScoreboard(items, 'Cantons owned');
}

function renderScoreboard(items, ariaLabel){
  var pills = items.map(function(it){
    return '<div class="pill '+it.cls+'" role="group" aria-label="'+it.label+'">'+
           '<span class="tag"></span>' + (it.crown ? '<span class="crown" aria-hidden="true">👑</span>' : '') +
           '<span class="label">'+it.label+'</span>'+
           '<span class="value">'+it.value+'</span></div>';
  }).join('');
  return '<div class="scoreboard" aria-label="'+ariaLabel+'">'+pills+'</div>';
}

/* sync updates */
window.addEventListener('daeg-sync-apply', function(){
  mapState = load('mapState', {});
  applyMapColors(); updateCounts();
});

/* helpers */
function load(k,d){ try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch(e){return d;} }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
