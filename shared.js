(function () {
  // ---------------- Theme ----------------
  var darkToggle = document.getElementById('darkToggle');
  var initialDark = localStorage.getItem('dark') === '1';
  document.body.classList.toggle('dark', initialDark);
  if (darkToggle) {
    darkToggle.checked = initialDark;
    darkToggle.addEventListener('change', function(e){
      document.body.classList.toggle('dark', e.target.checked);
      localStorage.setItem('dark', e.target.checked ? '1' : '0');
      try{ window.dispatchEvent(new Event('daeg-theme-change')); }catch(_){}
    });
  }

  // ---------------- Small helpers ----------------
  function get(k, d){ try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch(e){ return d; } }
  function set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }

  // ---------------- Export / Import / Reset all ----------------
  function snapshotAll() {
    return {
      __version: 2,
      exportedAt: new Date().toISOString(),
      dark: localStorage.getItem('dark') || '0',
      usedSets: get('usedSets', {"D":[],"Ä":[],"G":[]}),
      logEntries: get('logEntries', []),
      tasksByNumber: get('tasksByNumber', {}),
      playerPoints: get('playerPoints', {"D":500,"Ä":500,"G":500}),
      pointsLog: get('pointsLog', []),
      mapState: get('mapState', {}),
      activePlayer: localStorage.getItem('activePlayer') || 'D',
      lastPlayer: localStorage.getItem('lastPlayer') || 'D'
    };
  }

  var exportBtn = document.getElementById('exportData');
  var importInput = document.getElementById('importFile');
  var resetAll = document.getElementById('resetAll');

  if (exportBtn) exportBtn.addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(snapshotAll(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'daeg-state-' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });

  if (importInput) importInput.addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var snap = JSON.parse(reader.result);
        if (window.daegSyncRestore) window.daegSyncRestore(snap);
        else {
          Object.keys(snap).forEach(function(k){ set(k, snap[k]); });
          location.reload();
        }
      } catch(_){ alert('Import failed: invalid file.'); }
    };
    reader.readAsText(f);
  });

  if (resetAll) resetAll.addEventListener('click', function(){
    if (!confirm('Reset ALL (keep tasks)?')) return;
    if (window.daegSyncReset) window.daegSyncReset();
    else {
      var tasks = get('tasksByNumber', {});
      localStorage.clear();
      set('tasksByNumber', tasks);
      location.reload();
    }
  });

  // ---------------- Who am I? picker in the header ----------------
  function getMyPlayer(){ 
    var p = localStorage.getItem('myPlayer') || 'D';
    return (p==='D'||p==='Ä'||p==='G') ? p : 'D';
  }
  function setMyPlayer(p){
    localStorage.setItem('myPlayer', p);
    localStorage.setItem('lastPlayer', p);
    // Let pages react immediately if they want
    try { window.dispatchEvent(new CustomEvent('daeg-player-change', { detail:{ player:p } })); } catch(_){}
  }

  var topbar = document.querySelector('.topbar');
  if (topbar) {
    var wrap = document.createElement('div');
    wrap.className = 'whoami';
    wrap.style.cssText = 'display:flex;gap:.45rem;align-items:center;justify-self:end;';
    var lbl = document.createElement('span');
    lbl.textContent = 'I am:';
    var sel = document.createElement('select');
    ['D','Ä','G'].forEach(function(v){ var o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
    sel.value = getMyPlayer();
    sel.addEventListener('change', function(){ setMyPlayer(sel.value); });
    wrap.appendChild(lbl); wrap.appendChild(sel);

    // insert just before Night mode toggle if present, else at end of header
    var anchor = document.querySelector('.toggle');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);
    else topbar.appendChild(wrap);
  }

  // If not set yet, default to D
  if (!localStorage.getItem('myPlayer')) setMyPlayer('D');
})();
