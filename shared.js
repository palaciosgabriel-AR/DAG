(function () {
  // Theme -------------------------------------------------------
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

  // Helpers -----------------------------------------------------
  function get(k, d){ try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch(e){ return d; } }
  function set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }

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

  // Export / Import / Reset all --------------------------------
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
          // Fallback local-only
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
      // Fallback local-only: keep tasks
      var tasks = get('tasksByNumber', {});
      localStorage.clear();
      set('tasksByNumber', tasks);
      location.reload();
    }
  });
})();
