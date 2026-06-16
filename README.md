# Cursewords Web

A browser-based party word game inspired by hidden forbidden-word clue games. This branch runs as a hosted web app with room codes instead of the Electron LAN desktop build.

## Requirements

- Node.js LTS with npm

## Development

```bash
npm install
npm run dev
```

This starts:

- the game server on `http://127.0.0.1:4949`
- the Vite client on `http://127.0.0.1:5173`

Open the Vite URL in your browser. Socket.IO traffic is proxied from the client dev server to the game server.

## Production Build

```bash
npm install
npm run build
npm start
```

The production server serves the built client from `dist/` and hosts Socket.IO on port `4949` by default.

Set `PORT` to change the listen port.

Set `CURSEWORDS_PLAY_PASSWORD` to require a shared password before anyone can create or join rooms:

```bash
CURSEWORDS_PLAY_PASSWORD="your-table-password" npm start
```

`PLAY_PASSWORD` is also supported as a shorter alias.

On Windows PowerShell, set the password before starting locally:

```powershell
$env:CURSEWORDS_PLAY_PASSWORD="your-table-password"
npm start
```

## Local Cloudflare Tunnel Deploy

Recommended public URL: `https://cursewords.danieldroder.dev`.

This deployment runs the game on a local machine and exposes it through Cloudflare Tunnel. This is preferred over raw router port forwarding because it does not expose your home IP directly and Cloudflare handles HTTPS and WebSockets.

1. Install `cloudflared` on the machine that will host the game.
2. Authenticate `cloudflared` with the Cloudflare account that owns `danieldroder.dev`:

```bash
cloudflared tunnel login
```

3. Create a named tunnel:

```bash
cloudflared tunnel create cursewords
```

4. Route the public hostname to the tunnel:

```bash
cloudflared tunnel route dns cursewords cursewords.danieldroder.dev
```

5. Copy `deploy/cloudflared.example.yml` to your local Cloudflare config directory and update the tunnel ID and credentials path shown by `cloudflared tunnel create`.

Windows PowerShell example:

```powershell
Copy-Item deploy/cloudflared.example.yml "$env:USERPROFILE\.cloudflared\config.yml"
```

6. Build and start the game server:

```bash
npm install
npm run build
CURSEWORDS_PLAY_PASSWORD="your-table-password" npm start
```

Windows PowerShell:

```powershell
npm install
npm run build
$env:CURSEWORDS_PLAY_PASSWORD="your-table-password"
npm start
```

7. In another terminal, start the tunnel:

```bash
cloudflared tunnel run cursewords
```

8. Verify these URLs:

```text
https://cursewords.danieldroder.dev/healthz
https://cursewords.danieldroder.dev/auth-config
```

The app uses same-origin Socket.IO, so no extra client endpoint configuration is needed. Cloudflare Tunnel forwards `https://cursewords.danieldroder.dev` to the local Node server at `http://localhost:4949`.

### Running Continuously

For real play sessions, keep both processes running:

- `npm start`
- `cloudflared tunnel run cursewords`

On Windows, `cloudflared service install` can run the tunnel as a background service. Use Task Scheduler, NSSM, PM2, or another process manager if you also want the Node server to restart automatically.

### Port Forwarding Alternative

Raw port forwarding can work, but Cloudflare Tunnel is safer and simpler. If you use port forwarding instead, use a static LAN IP for the host machine, keep `CURSEWORDS_PLAY_PASSWORD` set, forward only the required HTTP/HTTPS port, and consider restricting inbound traffic to Cloudflare IP ranges.

## Railway Deploy

This repo includes `railway.json` so Railway builds with `npm run build`, starts with `npm start`, and healthchecks `/healthz`.

Before sharing the public URL, set a password variable in Railway:

```bash
CURSEWORDS_PLAY_PASSWORD=your-table-password
```

Railway will provide the public ingress and the runtime `PORT`. The server already listens on `0.0.0.0` and reads `process.env.PORT`, falling back to `4949` only for local runs.

### Deploy From GitHub

1. Push this repo to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add the `CURSEWORDS_PLAY_PASSWORD` variable on the app service.
4. Open the service settings and generate a public Railway domain.
5. Share that domain and the password with players.

### Deploy From CLI

```bash
railway login
railway init
railway variable --set "CURSEWORDS_PLAY_PASSWORD=your-table-password"
railway up
railway domain
```

## Play Online

1. One player opens the site and clicks `Create Room`.
2. The lobby shows a 6-character room code.
3. Other players open the same site, enter that code, and click `Join`.
4. Players choose `Ember Guild` or `Frost Order`.
5. The host starts the dungeon when both teams have players and everyone is ready.

## Custom Words

The built-in decks include broad everyday words and fantasy dungeon words. Use `Mixed` for the largest default pool, `Everyday` for easier table play, or `Fantasy` for a more thematic game.

The host can configure custom words in the lobby before starting:

- `Built-in only` uses the included everyday/fantasy decks.
- `Built-in + custom` mixes pasted words with the selected built-in deck.
- `Custom only` uses only pasted words and requires at least 2 valid entries.

Paste one word or phrase per line. Custom words are saved in the host browser's local storage.

## Illustrated Dungeon Board

The game view includes a whimsical board-game style dungeon map with original illustrated room cards, animated team pawns, glowing path lines, cleared/locked room states, trap counts, and room curse text.

## Game Flow

- Both teams receive the other team's target word and secretly write traps.
- A team clue-giver sees only their own target word during their clue attempt.
- The guessing team cannot see the target or traps.
- The defending team sees the target and trap list, then calls traps if the clue-giver says one.
- Correct guesses advance a team through the dungeon rooms.
- Later rooms require more traps and add manual curse rules.
- Reaching the final room and solving it wins the delve.

## Project Layout

- `server/` Node/Socket.IO room server and multiplayer routing.
- `src/game/` authoritative game engine, word decks, rooms, tests.
- `src/shared/` cross-process TypeScript contracts.
- `src/assets/` original SVG assets.
- `src/components/DungeonBoard.tsx` illustrated progress board.
- `src/App.tsx` renderer UI and Socket.IO client.
- `src/styles.css` custom dungeon visual system and responsive layout.

## Verification

```bash
npm test
npm run build
npm start
```

With `npm start` still running, run the smoke test in another terminal:

```bash
npm run test:smoke
```
