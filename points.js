<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DÄG — Points</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body data-page="points">
  <header class="topbar">
    <div class="brand">
      <span class="flag">🇨🇭</span><strong>DÄG across Switzerland</strong><span class="flag">🇨🇭</span>
    </div>
    <nav class="nav">
      <a href="./index.html">Tasks</a>
      <a href="./points.html" class="active">Points</a>
      <a href="./map.html">Map</a>
    </nav>
    <div class="data-actions">
      <button id="exportData" class="btn btn-small" title="Download saved data">Export</button>
      <label class="btn btn-small" for="importFile" title="Load saved data">Import</label>
      <input id="importFile" type="file" accept="application/json" hidden>
      <button id="resetAll" class="btn btn-small" title="Reset all saved data">Reset all</button>
    </div>
    <label class="toggle"><input type="checkbox" id="darkToggle"> Night mode</label>
  </header>

  <main class="container">
    <!-- Live summary (big pills) -->
    <section>
      <div id="summary"></div>
    </section>

    <!-- Spend section (Runner only) -->
    <section style="margin-top:1rem;">
      <h2>Spend / Trips</h2>
      <div class="form-row">
        <label for="minutes">Minutes (1–120)</label>
        <input id="minutes" type="number" min="1" max="120" placeholder="e.g., 7" />
      </div>
      <div class="form-row">
        <label for="note">Note</label>
        <input id="note" type="text" placeholder="Why (e.g., Tram to Bellevue)" />
      </div>
      <div style="margin-top:.8rem;">
        <button id="spend" class="btn runner-only" title="Runner only: subtract minutes × 10 points">Spend</button>
        <span id="error" style="margin-left:.8rem;"></span>
      </div>
    </section>

    <!-- Unified points log -->
    <section class="log" style="margin-top:1.6rem;">
      <h2>Points Log</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th><th>Player</th><th>Points</th><th>Note</th><th>Action</th>
          </tr>
        </thead>
        <tbody id="pointsBody"></tbody>
      </table>
    </section>
  </main>

  <!-- Scripts: sync (runner+player), shared (export/import/reset), then page logic -->
  <script type="module" src="./sync.js"></script>
  <script src="./shared.js" defer></script>
  <script src="./points.js" defer></script>
</body>
</html>
