(function () {
  // Theme
  const darkToggle = document.getElementById('darkToggle');
  const initialDark = localStorage.getItem('dark') === '1';
  document.body.classList.toggle('dark', initialDark);
  if (darkToggle) {
    darkToggle.checked = initialDark;
    darkToggle.addEventListener('change', e => {
      document.body.classList.toggle('dark', e.target.checked);
      localStorage.setItem('dark', e.target.checked ? '1' : '0');
      window.dispatchEvent(new Event('daeg-theme-change'));
    });
  }

  // Data helpers
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(d)); } catch { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function snapshotAll() {
    return {
      __version: 1,
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
  function applySnapshot(s) {
    if (s.dark != null) localStorage.setItem('dark', String(s.dark).endsWith('1') ? '1' : '0');
    if (s.usedSets) set('usedSets', s.usedSets);
    if (s.logEntries) set('logEntries', s.logEntries);
    if (s.tasksByNumber) set('tasksByNumber', s.tasksByNumber);
    if (s.playerPoints) set('playerPoints', s.playerPoints);
    if (s.pointsLog) set('pointsLog', s.pointsLog);
    if (s.mapState) set('mapState', s.mapState);
    if (s.activePlayer) localStorage.setItem('activePlayer', s.activePlayer);
    if (s.lastPlayer) localStorage.setItem('lastPlayer', s.lastPlayer);
  }

  // Export / Import / Reset all
  const exportBtn = document.getElementById('exportData');
  const importInput = document.getElementById('importFile');
  const resetAll = document.getElementById('resetAll');

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snapshotAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daeg-state-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  });

  importInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { applySnapshot(JSON.parse(reader.result)); location.reload(); }
      catch { alert('Import failed: invalid file.'); }
    };
    reader.readAsText(f);
  });

  // FIXED: Reset both local *and* Firestore
  resetAll?.addEventListener('click', async () => {
    if (!confirm('Reset ALL saved data (numbers, tasks, log, points, map) for everyone?')) return;
    try {
      if (typeof window.daegSyncReset === 'function') {
        await window.daegSyncReset();   // remote reset + local apply
      } else {
        // Fallback (no sync.js): just clear local
        localStorage.clear();
      }
      location.reload();
    } catch (err) {
      console.error('Reset failed:', err);
      alert('Reset failed. Check console for details.');
    }
  });
})();
