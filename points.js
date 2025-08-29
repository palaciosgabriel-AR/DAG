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
      <button id="exportData" class="btn btn-small">Export</button>
      <label class="btn btn-small" for="importFile">Import</label>
      <input id="importFile" type="file" accept="application/json" hidden>
      <button id="resetAll" class="btn btn-small">Reset all</button>
    </div>
    <label class="toggle"><input type="checkbox" id="darkToggle"> Night mode</label>
  </header>

  <main class="container">
    <div id="summary"></div>

    <section class="form">
      <div class="form-row">
        <label for="minutes">Minutes (1–120)</label>
        <input id="minutes" type="number" min="1" max="120" inputmode="numeric" />
      </div>
      <div class="form-row">
        <label for="note">What for</label>
        <input id="note" type="text" placeholder="e.g. Tram ride to Bellevue" />
      </div>
      <div class="form-row">
        <label>&nbsp;</label>
        <button id="spend" class="btn">Spend</button>
      </div>
      <p id="error" style="color:#ffdede;font-weight:700;"></p>
    </section>

    <section class="log">
      <h2>Points log</h2>
      <table>
        <thead><tr><th>Time</th><th>Player</th><th>Points</th><th>Note</th><th>Action</th></tr></thead>
        <tbody id="pointsBody"></tbody>
      </table>
    </section>
  </main>

  <script src="./shared.js" defer></script>
  <script type="module" src="./sync.js?v=20"></script>
  <script src="./points.js" defer></script>
</body>
</html>
