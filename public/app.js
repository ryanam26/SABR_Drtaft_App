const stateUrl = '/api/state';
const $ = s => document.querySelector(s);
const statusEl = $('#status');
let appState = null;

function commissionerKey() { return $('#commissionerKey').value.trim(); }

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV needs header + rows');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const required = ['name', 'age', 'rating', 'position'];
  for (const r of required) if (!headers.includes(r)) throw new Error(`Missing ${r} column`);
  const idx = Object.fromEntries(required.map(k => [k, headers.indexOf(k)]));
  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map(c => c.trim());
    return {
      name: cols[idx.name],
      age: Number(cols[idx.age]),
      rating: Number(cols[idx.rating]),
      position: cols[idx.position]
    };
  });
}

async function post(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

async function loadState() {
  const res = await fetch(stateUrl);
  appState = await res.json();
  render();
}

function render() {
  const d = appState.draft;
  $('#timer').textContent = d.timerSecondsLeft;
  $('#onClock').textContent = d.currentTeam ? `${d.currentTeam} is on the clock` : `Draft status: ${d.status}`;
  if (d.pausedReason) $('#onClock').textContent += ` (${d.pausedReason})`;

  const playersBody = $('#playersTable tbody');
  playersBody.innerHTML = '';
  for (const p of appState.availablePlayers) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td>${p.age}</td><td>${p.rating}</td><td>${p.position}</td><td></td>`;
    const btn = document.createElement('button');
    btn.textContent = 'Draft';
    const canDraft = d.status === 'running' && d.currentTeam;
    btn.disabled = !canDraft;
    btn.onclick = async () => {
      try {
        await post('/api/draft/pick', { playerId: p.id, team: d.currentTeam });
        await loadState();
      } catch (e) { setStatus(e.message); }
    };
    tr.children[4].appendChild(btn);
    playersBody.appendChild(tr);
  }

  const historyBody = $('#historyTable tbody');
  historyBody.innerHTML = '';
  for (const h of appState.draft.picks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${h.pickNumber}</td><td>${h.round}</td><td>${h.team}</td><td>${h.playerName}</td><td>${h.position}</td><td>${h.rating}</td>`;
    historyBody.appendChild(tr);
  }

  const rosters = $('#rostersGrid');
  rosters.innerHTML = '';
  for (const team of appState.teams) {
    const div = document.createElement('div');
    div.className = 'team';
    const picks = appState.draft.rosters[team] || [];
    div.innerHTML = `<h3>${team} (${picks.length})</h3><ul>${picks.map(p => `<li>${p.name} - ${p.position} (${p.rating})</li>`).join('')}</ul>`;
    rosters.appendChild(div);
  }

  setStatus(`Players: ${appState.players.length}, Picks: ${d.picks.length}/${d.maxPicks}, Rounds: ${d.rounds}, Leftover players not drafted for equal rosters: ${d.leftoverPlayers}`);
}

function setStatus(msg) { statusEl.textContent = msg; }

$('#uploadBtn').onclick = async () => {
  try {
    const file = $('#csvFile').files[0];
    if (!file) throw new Error('Choose CSV file first');
    const text = await file.text();
    const players = parseCsv(text);
    await post('/api/players', { commissionerKey: commissionerKey(), players });
    await loadState();
    setStatus('Roster uploaded');
  } catch (e) { setStatus(e.message); }
};

$('#startBtn').onclick = async () => { try { await post('/api/draft/start', { commissionerKey: commissionerKey() }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#pauseBtn').onclick = async () => { try { await post('/api/draft/commissioner', { commissionerKey: commissionerKey(), action:'pause' }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#resumeBtn').onclick = async () => { try { await post('/api/draft/commissioner', { commissionerKey: commissionerKey(), action:'resume' }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#skipBtn').onclick = async () => { try { await post('/api/draft/commissioner', { commissionerKey: commissionerKey(), action:'skip' }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#undoBtn').onclick = async () => { try { await post('/api/draft/commissioner', { commissionerKey: commissionerKey(), action:'undo' }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#resetBtn').onclick = async () => { try { await post('/api/draft/commissioner', { commissionerKey: commissionerKey(), action:'reset' }); await loadState(); } catch(e){ setStatus(e.message);} };
$('#exportBtn').onclick = () => { window.location.href = '/api/draft/export'; };

setInterval(loadState, 1500);
loadState();
