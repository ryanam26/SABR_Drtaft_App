const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PICK_WINDOW_SECONDS = 60;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultTeams = Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`);

const createInitialState = () => ({
  commissionerKey: process.env.COMMISSIONER_KEY || 'commissioner',
  players: [],
  teams: defaultTeams,
  draft: {
    status: 'idle', // idle | running | paused | completed
    timerSecondsLeft: PICK_WINDOW_SECONDS,
    pausedReason: null,
    currentPickIndex: 0,
    maxPicks: 0,
    picks: [],
    rosters: {},
    startedAt: null,
    updatedAt: Date.now(),
    orderMode: 'snake'
  }
});

let state = loadState();
let timer = null;

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const initial = createInitialState();
    saveState(initial);
    return hydrate(initial);
  }
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return hydrate(raw);
}

function hydrate(raw) {
  const merged = { ...createInitialState(), ...raw, draft: { ...createInitialState().draft, ...raw.draft } };
  for (const team of merged.teams) {
    if (!merged.draft.rosters[team]) merged.draft.rosters[team] = [];
  }
  return merged;
}

function saveState(next = state) {
  next.draft.updatedAt = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getTeamForPick(index) {
  const teamCount = state.teams.length;
  const round = Math.floor(index / teamCount);
  const slot = index % teamCount;
  if (state.draft.orderMode === 'snake' && round % 2 === 1) {
    return state.teams[teamCount - 1 - slot];
  }
  return state.teams[slot];
}

function buildPublicState() {
  const draftedIds = new Set(state.draft.picks.map(p => p.playerId));
  const availablePlayers = state.players.filter(p => !draftedIds.has(p.id));
  const currentTeam = state.draft.status === 'running' ? getTeamForPick(state.draft.currentPickIndex) : null;
  const rounds = Math.floor(state.players.length / state.teams.length);
  return {
    ...state,
    draft: {
      ...state.draft,
      currentTeam,
      rounds,
      leftoverPlayers: state.players.length - (rounds * state.teams.length)
    },
    availablePlayers
  };
}

function validateCommissioner(key) {
  return key && key === state.commissionerKey;
}

function ensureTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (state.draft.status !== 'running') return;
    if (state.draft.currentPickIndex >= state.draft.maxPicks) {
      state.draft.status = 'completed';
      clearInterval(timer);
      timer = null;
      saveState();
      return;
    }
    state.draft.timerSecondsLeft -= 1;
    if (state.draft.timerSecondsLeft <= 0) {
      state.draft.status = 'paused';
      state.draft.timerSecondsLeft = 0;
      state.draft.pausedReason = 'Timer expired. Commissioner action required.';
    }
    saveState();
  }, 1000);
}

function resetDraft() {
  state.draft = createInitialState().draft;
  for (const team of state.teams) state.draft.rosters[team] = [];
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(reqPath).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json'
    }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.url === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, buildPublicState());
  }

  if (req.url === '/api/players' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { commissionerKey, players } = body;
      if (!validateCommissioner(commissionerKey)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!Array.isArray(players) || players.length === 0) return sendJson(res, 400, { error: 'Players required' });
      const seen = new Set();
      const normalized = players.map((p, i) => {
        const name = String(p.name || '').trim();
        const age = Number(p.age);
        const rating = Number(p.rating);
        const position = String(p.position || '').trim();
        if (!name || !position || !Number.isFinite(age) || !Number.isFinite(rating)) throw new Error(`Invalid row ${i + 1}`);
        if (rating < 1 || rating > 5) throw new Error(`Rating must be 1-5 at row ${i + 1}`);
        const key = name.toLowerCase();
        if (seen.has(key)) throw new Error(`Duplicate player name: ${name}`);
        seen.add(key);
        return { id: `p_${i + 1}_${Date.now()}`, name, age, rating, position };
      });
      state.players = normalized;
      resetDraft();
      saveState();
      return sendJson(res, 200, { ok: true, count: normalized.length });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.url === '/api/draft/start' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!validateCommissioner(body.commissionerKey)) return sendJson(res, 401, { error: 'Unauthorized' });
      if (Array.isArray(body.teams) && body.teams.length === 8) {
        state.teams = body.teams.map((t, i) => String(t || `Team ${i + 1}`).trim() || `Team ${i + 1}`);
      }
      if (!state.players.length) return sendJson(res, 400, { error: 'Upload players first' });
      resetDraft();
      const rounds = Math.floor(state.players.length / state.teams.length);
      state.draft.maxPicks = rounds * state.teams.length;
      state.draft.status = 'running';
      state.draft.startedAt = Date.now();
      state.draft.timerSecondsLeft = PICK_WINDOW_SECONDS;
      state.draft.pausedReason = null;
      ensureTimer();
      saveState();
      return sendJson(res, 200, { ok: true, maxPicks: state.draft.maxPicks, rounds });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.url === '/api/draft/pick' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const playerId = body.playerId;
      if (state.draft.status !== 'running') return sendJson(res, 400, { error: 'Draft not running' });
      const team = getTeamForPick(state.draft.currentPickIndex);
      if (body.team !== team) return sendJson(res, 403, { error: 'Not your turn' });
      const already = state.draft.picks.some(p => p.playerId === playerId);
      if (already) return sendJson(res, 400, { error: 'Player already drafted' });
      const player = state.players.find(p => p.id === playerId);
      if (!player) return sendJson(res, 404, { error: 'Player not found' });
      const pick = {
        pickNumber: state.draft.currentPickIndex + 1,
        round: Math.floor(state.draft.currentPickIndex / state.teams.length) + 1,
        team,
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        rating: player.rating,
        timestamp: Date.now()
      };
      state.draft.picks.push(pick);
      state.draft.rosters[team].push(player);
      state.draft.currentPickIndex += 1;
      state.draft.timerSecondsLeft = PICK_WINDOW_SECONDS;
      state.draft.pausedReason = null;
      if (state.draft.currentPickIndex >= state.draft.maxPicks) {
        state.draft.status = 'completed';
      }
      saveState();
      return sendJson(res, 200, { ok: true, pick });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.url === '/api/draft/commissioner' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!validateCommissioner(body.commissionerKey)) return sendJson(res, 401, { error: 'Unauthorized' });
      const action = body.action;
      if (action === 'pause') {
        state.draft.status = 'paused';
        state.draft.pausedReason = 'Paused by commissioner';
      } else if (action === 'resume') {
        if (state.draft.currentPickIndex >= state.draft.maxPicks) state.draft.status = 'completed';
        else {
          state.draft.status = 'running';
          state.draft.timerSecondsLeft = PICK_WINDOW_SECONDS;
          state.draft.pausedReason = null;
        }
      } else if (action === 'skip') {
        state.draft.currentPickIndex += 1;
        state.draft.timerSecondsLeft = PICK_WINDOW_SECONDS;
        state.draft.pausedReason = null;
        if (state.draft.currentPickIndex >= state.draft.maxPicks) state.draft.status = 'completed';
        else state.draft.status = 'running';
      } else if (action === 'undo') {
        const last = state.draft.picks.pop();
        if (!last) return sendJson(res, 400, { error: 'No picks to undo' });
        state.draft.currentPickIndex = Math.max(0, state.draft.currentPickIndex - 1);
        state.draft.rosters[last.team] = state.draft.rosters[last.team].filter(p => p.id !== last.playerId);
        state.draft.status = 'paused';
        state.draft.pausedReason = `Last pick undone by commissioner (${last.playerName})`;
      } else if (action === 'reset') {
        resetDraft();
      } else {
        return sendJson(res, 400, { error: 'Unknown action' });
      }
      saveState();
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.url === '/api/draft/export' && req.method === 'GET') {
    const headers = ['Pick #', 'Round', 'Team', 'Player', 'Position', 'Rating', 'Timestamp'];
    const rows = state.draft.picks.map(p => [p.pickNumber, p.round, p.team, p.playerName, p.position, p.rating, new Date(p.timestamp).toISOString()]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="draft-results.csv"'
    });
    return res.end(csv);
  }

  serveStatic(req, res);
});

ensureTimer();
server.listen(PORT, () => {
  console.log(`Draft app running on http://localhost:${PORT}`);
});
