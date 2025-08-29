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
      __version: 3,
      exportedAt: new Date().toISOString(),
      dark: localStorage.getItem('dark') || '0',
      usedSets: get('usedSets', {"D":[],"Ä":[],"G":[]}),
      logEntries: get('logEntries', []),
      tasksByNumber: get('tasksByNumber', {}),
      tasksRev: get('tasksRev', {}),     // harmless if absent in your build
      playerPoints: get('playerPoints', {"D":500,"Ä":500,"G":500}),
      pointsLog: get('pointsLog', []),
      mapState: get('mapState', {}),
      activePlayer: localStorage.getItem('activePlayer') || 'D',
      lastPlayer: localStorage.getItem('lastPlayer') || 'D',
      tasksLocked: get('tasksLocked', false),
      stateEpoch: Number(localStorage.getItem('stateEpoch') || '0')
    };
  }

  function applySnapshot(s) {
    if (s.dark != null) localStorage.setItem('dark', String(s.dark).endsWith('1') ? '1' : '0');
    if (s.usedSets) set('usedSets', s.usedSets);
    if (s.logEntries) set('logEntries', s.logEntries);
    if (s.tasksByNumber) set('tasksByNumber', s.tasksByNumber);
    if (s.tasksRev) set('tasksRev', s.tasksRev);
    if (s.playerPoints) set('playerPoints', s.playerPoints);
    if (s.pointsLog) set('pointsLog', s.pointsLog);
    if (s.mapState) set('mapState', s.mapState);
    if (s.activePlayer) localStorage.setItem('activePlayer', s.activePlayer);
    if (s.lastPlayer) localStorage.setItem('lastPlayer', s.lastPlayer);
    if (typeof s.tasksLocked !== 'undefined') set('tasksLocked', !!s.tasksLocked);
    if (typeof s.stateEpoch === 'number') localStorage.setItem('stateEpoch', String(s.stateEpoch));
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

  importInput?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (typeof window.daegSyncRestore === 'function') {
          await window.daegSyncRestore(parsed);
        } else {
          applySnapshot(parsed);
        }
        location.reload();
      } catch (err) {
        console.error('Import failed:', err);
        alert('Import failed: invalid or unreadable file.');
      }
    };
    reader.readAsText(f);
  });

  resetAll?.addEventListener('click', async () => {
    if (!confirm('Reset ALL data (numbers, points, map, logs). Tasks are kept. Runner only.')) return;
    const btn = resetAll;
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Resetting…';
    try {
      if (typeof window.daegSyncReset === 'function') {
        await window.daegSyncReset();   // runner-only; also bumps epoch
      } else {
        // fallback local-only reset (keeps tasks)
        const t = get('tasksByNumber', {});
        localStorage.clear();
        set('tasksByNumber', t);
      }
      setTimeout(()=>location.reload(), 300);
    } catch (e) {
      console.error('Reset failed:', e);
      alert('Reset failed (Runner only). See console.');
      btn.disabled = false; btn.textContent = originalText;
    }
  });
})();
