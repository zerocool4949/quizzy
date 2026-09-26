# Repository Guidelines

## Working instructions

## Project Structure & Module Organization
- `client/` hosts the React + Vite frontend; main UI lives in `client/src/components/`.
- `client/src/components/game/` contains split Game screen components (GameLoading, GameCountdown, GameFinished, RoundResults, LiveScoreboard, MCQAnswers, TypedAnswers, SoundtrackAnswers for movie/videogame modes).
- `client/src/components/Admin.jsx` is the admin page for editing `movies.json` and `videogames.json` (accessible at `/admin?key=ADMIN_KEY`).
- `client/src/components/ErrorBoundary.jsx` provides React error boundary for crash handling.
- `client/src/context/` holds shared game state and socket wiring.
- `client/src/locales/` contains translation JSON files; update `client/src/i18n.jsx` when adding a new language.
- `server/` is the Express + Socket.io backend. `server/index.js` only bootstraps (middleware, `/api/categories`, static files); socket events live in `server/sockets.js`, admin HTTP routes in `server/routes/admin.js`, and game flow/scoring in `server/gameManager.js`.
- `server/quiz.js` handles quiz generation, artist sampling, and track fetching via `music.js`.
- `server/soundtrackQuiz.js` handles movie and video game soundtrack quiz generation, driven by the per-mode `SOUNDTRACK_MODES` config (data file, iTunes artwork entity, payload keys like `correctMovie`/`correctGame`). Also loads and atomically saves the JSON files.
- `server/movies.json` contains the curated list of movies/series with their soundtrack tracks.
- `server/videogames.json` contains the curated list of video games with their soundtrack tracks.
- `server/playlistImport.js` imports a Spotify playlist as a category and caches its artists.
- `server/categories.js` loads artist lists from `server/categories.json` and imported Spotify playlists (`server/imported-playlists.json`).
- `server/music.js` re-exports the active provider (`cache-provider.js`).
- `server/cache-provider.js` is the main music provider (cache-first with Spotify fallback + Deezer previews).
- `server/artistCache.js` handles local cache persistence (`server/data/artists.json`) with in-memory caching.
- `server/lastfm.js` wraps the Last.fm API for all-time top tracks (30s timeout).
- `server/spotify.js` wraps the Spotify API (token management, playlist import, fallback, 30s timeout).
- `server/deezer.js` wraps the Deezer API for audio previews (30s timeout).
- `server/audioCache.js` downloads/serves cached movie/videogame soundtrack clips (yt-dlp + ffmpeg) and prewarms on startup.
- `server/answerMatcher.js` provides fuzzy matching for typed answers (Levenshtein distance, normalization).
- `server/titleUtils.js` provides shared title cleaning helpers.
- `server/validation.js` provides input sanitization for player names, room codes, and answers.
- `server/tests/` holds Vitest suites (`answerMatcher`, `gameManager`, `quiz`).
- Shared config and deployment files are at repo root: `compose.yml`, `Dockerfile`, `.env.example`; CI workflows are in `.github/workflows/`.

## Build, Test, and Development Commands
- Use Node.js 22.13+ and pnpm 11.24.0, pinned in `package.json`. `pnpm-workspace.yaml` declares client/server; commit `pnpm-lock.yaml`. Docker uses Node 22 and frozen pnpm installs, with only server production dependencies in the runtime stage.
- `pnpm install` installs root workspaces (`client`, `server`).
- `pnpm run dev` runs both apps concurrently (Vite on `:5173`, API on `:3001` by default).
- `pnpm run build` builds the client for production (`client/dist`).
- `pnpm start` runs the server in production mode.
- `pnpm test` runs server tests (Vitest). Use `pnpm run test:watch` for watch mode.
- `docker compose up -d` runs the full stack in production containers.

## Coding Style & Naming Conventions
- Follow existing formatting per package: client files use 2-space indents and no semicolons; server files use 2-space indents and semicolons.
- Prefer single quotes in JS/JSX to match current files.
- Keep filenames descriptive and aligned with existing patterns (e.g., `Game.jsx`, `roomManager.js`).
- No repo-wide formatter is configured; keep changes consistent with nearby code.
- Client stack: React 19, React Router 7, Vite 8, Tailwind CSS 4 via `@tailwindcss/vite` (theme and custom animations in `@theme` in `client/src/index.css`; no Tailwind/PostCSS config files). Server: Express 5 (wildcard routes use `/{*splat}`), dotenv loaded with `quiet: true`, Vitest 5.

## Testing Guidelines
- Backend tests use Vitest (`server` workspace).
- Name tests to mirror modules or behaviors (example: `server/tests/answerMatcher.test.js`).
- Add tests only when explicitly requested; for game logic, focus requested tests on scoring, round flow, and answer matching.

## Commit & Pull Request Guidelines
- Recent commits use short, imperative summaries (examples: "Add multilingual support", "Clarify difficulty tooltip").
- Keep commit subjects under ~60 characters and scoped to one change.
- PRs should include a concise summary, checks actually performed, and relevant limitations. Include screenshots for UI changes when available; do not start services solely to obtain them unless explicitly requested.
- Link related issues or feature requests when applicable.

## Configuration & Security Notes
- Copy `.env.example` to `server/.env` and set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `LASTFM_API_KEY`, and `ADMIN_KEY`.
- Get a free Last.fm API key at https://www.last.fm/api/account/create
- `ADMIN_KEY` is used for the admin page (`/admin?key=yourSecret`) to edit movies/videogames JSON files without restarting the server.
- Do not commit secrets; use `.env` and keep API credentials local.

## Key Implementation Details
- **Room codes**: 4-character alphanumeric codes (no ambiguous chars like 0/O/1/I). Generated in `server/roomManager.js`.
- **Room TTL cleanup**: Rooms auto-delete after 2 hours of inactivity. Cleanup runs every 5 minutes. See `roomManager.js`.
- **Input sanitization**: Player names, room codes, and typed answers are sanitized to prevent XSS. See `server/validation.js`.
- **API timeouts**: All external API calls (Spotify, Last.fm, Deezer) have 30-second timeouts via `fetchWithTimeout()`.
- **In-memory artist cache**: Artist track data is loaded once at startup and kept in memory. File reads only happen on cold start, significantly improving quiz generation performance. See `server/artistCache.js`.
- **Error boundary**: React errors are caught by `ErrorBoundary.jsx` and display a friendly error page instead of crashing.
- **Playlist sampling**: Artists are sampled equally from each playlist (not proportionally by size) to ensure smaller playlists get fair representation. Sample size scales with round count (`rounds * 3` buffer, minimum 60). See `getMultiCategoryTracks` in `server/quiz.js`.
- **Spotify token caching**: The Spotify access token is cached with a promise lock to prevent parallel fetches when concurrent requests arrive. See `getAccessToken` in `server/spotify.js`.
- **Title cleaning**: Track titles are cleaned by removing parenthetical content `(...)`, bracketed content `[...]`, and everything after ` - ` (which typically contains metadata like "Remastered", "Live", "Acoustic", etc.). Cache stores original titles; cleaning is applied at Deezer search (`server/cache-provider.js`) and output (`server/quiz.js`). See `cleanTitle` in `server/titleUtils.js`.
- **Typed answer matching**: Uses Levenshtein distance with ~15% typo tolerance and word-level matching for multi-word answers. Accents and punctuation are normalized. See `server/answerMatcher.js`.
- **Scoring**: MCQ correct answer is 10 + speed bonus +3 (<3s), +2 (<6s), +1 (<10s). Typed uses speed tiers +5 (<5s), +3 (<10s), +1 (<15s) with artist base 10, title base 15, combo +5; typed players get 3 lives (5 on hard difficulty). Movie/videogame correct guess is 15 + typed speed tiers. See `submitAnswer` in `server/gameManager.js`.
- **Round timing**: Round ends at `clipDuration + answerTime` (answerTime is 10s for typed/movie/videogame, 5s for MCQ). Single source: `getAnswerTime` in `server/gameManager.js`, used by `sendNextRound` in `server/sockets.js`.
- **Movie soundtrack mode**: Uses typed input (not MCQ) to guess the movie/series name. Tracks are loaded from `server/movies.json` and downloaded from YouTube via yt-dlp. Players get 3 lives. See `server/soundtrackQuiz.js` and the soundtrack branch in `server/gameManager.js`.
- **Admin page**: Accessible at `/admin?key=ADMIN_KEY`. Provides inline editing of `movies.json` and `videogames.json` entries directly in the table. Features: auto-save on every action (add/edit/delete), audio preview (Play button), re-download clips (Re-dl button), alphabetical sorting. Auth via `requireAdmin` middleware in `server/routes/admin.js`: a request passes if its IP is in `ADMIN_IPS` (comma-separated) or it carries `ADMIN_KEY` (`?key=` / `x-admin-key`). Behind a reverse proxy set `TRUST_PROXY` (hop count or subnet like `loopback`) so `req.ip` is the real client IP. Saves trigger `warmMovieClips` in the background to download new/missing clips. Re-download endpoint (`POST /api/admin/redownload`) deletes the cached clip and re-downloads it. Saves write to a temp file then rename, so a crash can't corrupt the JSON. See `client/src/components/Admin.jsx` and `server/routes/admin.js`.
- **Video game soundtrack mode**: Same code path as movie mode (`SOUNDTRACK_MODES.videogame`). Uses typed input to guess the video game name. Tracks are loaded from `server/videogames.json` and downloaded from YouTube via yt-dlp. Players get 3 lives. Adding another soundtrack mode means a new `SOUNDTRACK_MODES` entry, a JSON file, an `ADMIN_TYPES` entry in `server/routes/admin.js`, a `MODE_UI` entry in `SoundtrackAnswers.jsx`, and a `usedSoundtrackIds` set in `server/roomManager.js`.
- **Movie/videogame clip cache**: Both modes use local MP3 clips cached in `server/data/audio/`, served from `/audio`. Clips are prewarmed on server start via `audioCache.js`. Entries in `movies.json`/`videogames.json` use either a plain string (`"Track Name"`) or object with search override (`{ "name": "Track", "search": "Artist Track" }`). Clip selection uses 20s length and starts at ~30% of song duration but never before 20s. Quiz generation caps attempts, so failing downloads end with an error instead of looping forever. Requires `yt-dlp` and `ffmpeg` (installed in Dockerfile).
- **Game logging**: Each game logs rounds to `server/logs/games.jsonl` (JSON lines format) when the game starts. Includes timestamp, roomId, playerCount, categories, and track details (artist, title, year). File is ignored by git. See `server/gameLogger.js`.
- **Lobby settings persistence**: When returning to lobby after a game, settings (categories, difficulty, mode, rounds) are preserved via `roomSettings` from the game context. See `Lobby.jsx` state initialization.
- **Direct link join handling**: Join requests via direct links (`/join/:code`) are queued in `pendingJoinRef` if the socket isn't connected yet, then processed on the `connect` event. This prevents race conditions where users submit the join form before socket.io finishes connecting. See `GameContext.jsx`.
- **Spectator mode**: Players can join as spectators (watch but not play). Spectators have `role: 'spectator'` in player objects, don't count toward the 8-player limit, can join mid-game, and can switch to player role in lobby (host cannot become spectator). See `switchRole` in `server/roomManager.js` and `isSpectator` state in `GameContext.jsx`.
- **Playlist management**: Import/delete of Spotify playlists goes over socket events (`import-playlist`, `delete-playlist`) with acknowledgements, not HTTP. The server only accepts them from the room host and rate-limits them in memory (5 imports and 20 deletes per room per 10 min, 30 imports globally). See `server/sockets.js` and `importPlaylist`/`deletePlaylist` in `GameContext.jsx`.
- **CORS**: HTTP and Socket.io both allow only `CLIENT_URL` (default `http://localhost:5173`).
- **Answer normalization**: Leading articles ("the", "a", "an", "les", "la", "le", "l") are stripped from both user input and target text during matching, so "beatles" matches "The Beatles". See `normalize` in `server/answerMatcher.js`.

## Socket & Real-time Architecture
- `client/src/context/GameContext.jsx` is the central hub for all socket.io communication and game state management.
- Socket events flow: client action → `socketRef.current.emit()` → server handler in `server/sockets.js` → broadcast back to clients → reducer dispatch.
- **Timing-sensitive areas**: Any emit that happens early in component lifecycle (direct links, page refresh) may fire before socket connects. Use `pendingJoinRef` pattern if adding similar features.
- Room join flow: URL `/join/:code` → `Home.jsx` extracts code → user submits → `joinRoom()` → server `join-room` event → `room-joined` response → navigate to `/lobby/:code`.

## Local Track Cache Architecture

### Overview

Quizzy uses a local JSON cache for track discovery, populated by Last.fm (with Spotify fallback). This provides all-time top tracks ranked by cumulative scrobbles rather than current streaming popularity.

**Why Last.fm?** Last.fm returns all-time top tracks by total scrobbles, while Spotify's API returns current streaming popularity (skewed toward recent releases). For example, Orelsan's top tracks on Last.fm include "Basique" (2017), but Spotify only returns 2021+ songs.

### Data Flow

```
Quiz requests tracks for artist
    ↓
1. Check cache (server/data/artists.json)
   - If fresh (< 90 days): use cached tracks
   - If stale: try refresh, fallback to stale data if fails
   - If miss: fetch from Last.fm → Spotify fallback → save to cache
    ↓
2. For each track, find Deezer preview
   - Search Deezer by "artist trackname"
   - Match by normalized artist + title
    ↓
3. Return tracks with previewUrl
```

### Cache Modules

- `server/artistCache.js` - Cache persistence with in-memory layer (get/save/isStale/prune). Loads from disk once at startup, stays in memory for fast lookups.
- `server/lastfm.js` - Last.fm API wrapper for all-time top tracks (30s timeout)
- `server/cache-provider.js` - Integration layer (wraps cache + Spotify + Deezer)
- `server/cache-warmer.js` - Startup warming, auto-prune, and CLI tool

### Cache Data Format

`server/data/artists.json`:
```json
{
  "Stromae": {
    "lastUpdated": "2026-01-27",
    "source": "lastfm",
    "tracks": [
      { "name": "Papaoutai", "playcount": 6228941, "spotifyId": "34dx8DACTJsc3rsJdaEIQw" }
    ]
  }
}
```

### Cache Warming

- **On server startup**: Background refresh for missing/stale artists
- **On playlist import**: Foreground fetch for new artists (30s timeout)
- **Auto-prune**: Deleted artists removed from cache
- **Concurrency lock**: Duplicate fetches for the same artist are queued, not duplicated (see `inProgress` Set in `cache-warmer.js`)

### CLI Usage

```bash
# Music cache (Last.fm/Spotify)
node server/cache-warmer.js                    # Refresh missing/stale artists
node server/cache-warmer.js --artist "Stromae" # Single artist
node server/cache-warmer.js --refresh          # Force refresh all
node server/cache-warmer.js --stats            # Show statistics

# Movie audio cache (YouTube)
node server/audioCache.js --warm               # Download missing clips (default)
node server/audioCache.js --prune              # Remove clips not in movies.json
node server/audioCache.js --stats              # Show cache statistics
```

### Configuration

Required environment variables:
- `LASTFM_API_KEY` - Primary source for track rankings
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` - Fallback + playlist import

Behavior:
- If `LASTFM_API_KEY` missing → Use Spotify only
- If Spotify credentials missing → Cache only (no fallback)

## Docker Notes
- `compose.yml` mounts five volumes: `imported-playlists.json`, `movies.json` (read-write for admin page), `videogames.json` (read-write for admin page), `logs/` directory, and `data/` directory (artist cache + movie/videogame audio clips).
- `movies.json` and `videogames.json` are mounted separately so they can be updated without rebuilding the image (just `git pull && docker compose restart`).
- Dockerfile installs `yt-dlp[default]` via pip (includes EJS challenge solver scripts) and `ffmpeg` via Alpine packages. Node.js (from base image) is used as the JS runtime for yt-dlp's YouTube challenge solving (`--js-runtimes node` and `--remote-components ejs:github` in `audioCache.js`). yt-dlp picks its own YouTube player clients; don't force `player_client=web`, which often returns only images.
- To update yt-dlp when movie clips break: `docker compose build --no-cache && docker compose up -d`.
- Images are built by `.github/workflows/docker.yml` (on `ubuntu-latest`) on push to `main`, `v*` tags, or manual dispatch, and pushed to `ghcr.io/zerocool4949/quizzy` tagged `latest` + commit SHA (main) or the tag name. Provenance/SBOM attestations are disabled.
- `.github/workflows/ghcr-cleanup.yml` runs weekly (Sunday 03:00 UTC) or manually, keeping the latest tagged version and deleting untagged images.
