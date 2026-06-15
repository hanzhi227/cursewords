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
```
