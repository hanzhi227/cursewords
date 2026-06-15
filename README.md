# Cursewords

A LAN desktop party game inspired by hidden forbidden-word clue games. This project uses original branding, original word decks, and original dungeon visuals.

## Requirements

- Windows 10 or newer, or macOS on Intel/Apple Silicon
- Node.js LTS with npm on PATH

## Development

```powershell
npm install
npm run dev
```

## Build A Windows App

```powershell
npm install
npm run dist
```

The packaged output is written to `release/`:

- `Cursewords-Portable-0.4.4-x64.exe`
- `Cursewords-Setup-0.4.4-x64.exe`
- `win-unpacked/`

## Build A macOS App

Build macOS packages on a Mac:

```sh
npm install
npm run dist:mac
```

The packaged output is written to `release/`:

- `Cursewords-0.4.4-x64.dmg`
- `Cursewords-0.4.4-arm64.dmg`
- `Cursewords-0.4.4-x64.zip`
- `Cursewords-0.4.4-arm64.zip`
- `latest-mac.yml`

This simple macOS port is unsigned. macOS may show a Gatekeeper warning the first time the app is opened. A polished public release should use Apple Developer ID signing and notarization.

## Publish Updates

Installed Windows builds use GitHub Releases for over-the-air updates through `electron-updater`. Portable builds are still useful for manual download, but the installed NSIS build is the reliable Windows auto-update path. For the simple unsigned macOS port, distribute the `.dmg` manually until signing and notarization are configured.

1. Set a GitHub token that can create releases for `ddroder/cursewords`.
2. Run the publish script:

```powershell
$env:GH_TOKEN="github_pat_or_token"
npm run release
```

The Windows release upload includes the installer, portable app, blockmaps, and update metadata such as `latest.yml`. Packaged apps check for updates on launch/home/lobby screens and prompt users to download and restart when a new version is available.

## LAN Play

1. One player launches the app and clicks `Host LAN Delve`.
2. The host screen shows one or more LAN addresses like `192.168.1.20:4949`.
3. Other players launch the app, enter that address, and click `Join`.
4. Players choose `Ember Guild` or `Frost Order`.
5. The host starts the dungeon when both teams have players.

Windows Firewall or macOS Local Network/Firewall may ask for permission the first time the host starts a LAN server. Allow local/private-network access.

## Custom Words

The host can configure custom words in the lobby before starting:

- `Built-in only` uses the included everyday/fantasy decks.
- `Built-in + custom` mixes pasted words with the selected built-in deck.
- `Custom only` uses only pasted words and requires at least 2 valid entries.

Paste one word or phrase per line. Custom words are saved locally in the host app's storage and are only used by the host server when a new game starts.

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

- `electron/` desktop shell, LAN host server, IPC bridge.
- `src/game/` authoritative game engine, word decks, rooms, tests.
- `src/shared/` cross-process TypeScript contracts.
- `src/assets/` original SVG assets.
- `src/components/DungeonBoard.tsx` illustrated progress board.
- `src/App.tsx` renderer UI and Socket.IO client.
- `src/styles.css` custom dungeon visual system and responsive layout.

## Verification

Run these after Node.js is installed:

```powershell
npm test
npm run build
npm run dist
```

On macOS, also run:

```sh
npm run dist:mac
```

Verified in this workspace with a portable Node.js 20.15.1 toolchain:

- `npm test`
- `npm run build`
- `npm run dist`
