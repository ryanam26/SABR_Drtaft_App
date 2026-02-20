# SABR Draft App

Web-based fantasy-style draft board for 8 teams with commissioner controls.

## Features
- Upload CSV player roster (`name,age,rating,position`) with validation.
- Equal roster-size drafting across 8 teams in snake order.
- 60-second pick timer per selection.
- Timer expiration auto-pauses draft and requires commissioner action.
- Shared board with:
  - available player list,
  - all team rosters,
  - full draft history.
- Commissioner actions: start, pause, resume, skip, undo, reset.
- Export drafted results as CSV.
- Persistent storage in `data/state.json`.

## Local run (exact steps)
1. Open a terminal in the repo.
2. Start the app:
   ```bash
   npm run start
   ```
3. Open `http://localhost:3000` in your browser.
4. Use commissioner key `commissioner` (or set `COMMISSIONER_KEY`).

## Local testing checklist (exact steps)

### 1) Syntax checks
```bash
npm run check
```

### 2) UI smoke test
- Open `http://localhost:3000`.
- Confirm you can see:
  - on-the-clock banner,
  - 60-second timer,
  - commissioner controls,
  - available players table,
  - team rosters,
  - draft history.

### 3) API smoke test
Run these commands in another terminal while server is running:

```bash
# health/state
curl -s http://localhost:3000/api/state | python3 -m json.tool | head -40

# upload sample roster
cat > /tmp/players.json <<'JSON'
{
  "commissionerKey": "commissioner",
  "players": [
    {"name": "Player 1", "age": 22, "rating": 5, "position": "QB"},
    {"name": "Player 2", "age": 23, "rating": 4, "position": "RB"},
    {"name": "Player 3", "age": 24, "rating": 3, "position": "WR"},
    {"name": "Player 4", "age": 25, "rating": 2, "position": "TE"},
    {"name": "Player 5", "age": 22, "rating": 5, "position": "QB"},
    {"name": "Player 6", "age": 23, "rating": 4, "position": "RB"},
    {"name": "Player 7", "age": 24, "rating": 3, "position": "WR"},
    {"name": "Player 8", "age": 25, "rating": 2, "position": "TE"}
  ]
}
JSON

curl -s -X POST http://localhost:3000/api/players \
  -H 'Content-Type: application/json' \
  --data @/tmp/players.json

# start draft
curl -s -X POST http://localhost:3000/api/draft/start \
  -H 'Content-Type: application/json' \
  --data '{"commissionerKey":"commissioner"}'

# verify state changed
curl -s http://localhost:3000/api/state | python3 -m json.tool | head -60
```

## Deploy to internet (exact steps using Render + Docker)

### Prerequisites
- GitHub repo with this code.
- Render account.

### Steps
1. Push your current branch to GitHub.
2. In Render, click **New +** → **Web Service**.
3. Connect your GitHub repo.
4. Choose:
   - **Runtime**: Docker
   - **Branch**: your deploy branch
   - **Region**: nearest to your users
5. Add environment variable:
   - `COMMISSIONER_KEY` = a secure key you choose.
6. Click **Create Web Service**.
7. After deploy finishes, open the Render URL and test:
   - upload CSV,
   - start draft,
   - make one pick,
   - export CSV.

### Data persistence note
- The app persists to `data/state.json` on disk.
- On platforms with ephemeral filesystems, state may reset on redeploy/restart.
- For production-grade persistence, move state to a managed DB/object store next.

## Alternative deploy (single VM)
If you deploy to a VPS (Ubuntu):

```bash
git clone <your-repo-url>
cd SABR_Drtaft_App
npm run check
COMMISSIONER_KEY='<your-key>' PORT=3000 nohup npm run start > app.log 2>&1 &
```

Put Nginx in front of port 3000 for HTTPS + domain routing.
