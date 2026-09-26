# Quizzy

A real-time multiplayer music quiz game. Listen to song clips, guess the artist and title, compete with friends.

## Quick Start

Use Node.js 22.13+ and pnpm 11.24.0 (pinned in `package.json`). Install pnpm if needed with `npm install --global pnpm@11.24.0`. On Windows, use `pnpm.cmd` if PowerShell blocks `pnpm.ps1`.

```bash
pnpm install
pnpm run dev
```

Open http://localhost:5173

### Run Tests

```bash
pnpm test
```

## Features

- **Multiplayer** - 6-character room codes, up to 8 players, shareable invite links
- **Spectator mode** - Watch games without playing, join mid-game, switch roles in lobby
- **Four game modes** - Multiple choice, typed answers, movie soundtrack, or video game soundtrack
- **Typed mode** - Single input, guess artist/title in any order, type both at once for bonus
- **Fuzzy matching** - Typo tolerance, accent insensitive, partial matches
- **Configurable** - Rounds, difficulty, music categories, import Spotify playlists
- **Multi-artist support** - Songs with multiple artists display all names, accept any for typed mode
- **Last.fm track ranking** - All-time top tracks by scrobbles (not just current popularity)
- **Local cache** - Artist tracks cached locally with 90-day TTL, auto-refreshes on startup
- **Multilanguage UI** - English and French with a language switcher (defaults to browser language, remembers choice)
- **Admin page** - Edit movie and video game lists from the browser, inline editing, audio preview, re-download clips (`/admin?key=yourSecret`)

## Game Modes

### Multiple Choice
- 4 options per round
- 5 seconds to answer after clip ends
- 10 base points + speed bonus: +3 (<3s), +2 (<6s), +1 (<10s)

### Typed (Default)
- Single input field - guess artist or title in any order
- Type both together (e.g., "Drake Hotline Bling") for double credit
- 3 lives per round (5 on Hard) - wrong guesses cost a life
- 10 seconds to answer after clip ends
- Artist: 10 points + speed bonus
- Title: 15 points + speed bonus
- Combo: +5 bonus if both are found
- Speed bonus: +5 (<5s), +3 (<10s), +1 (<15s)

### Movie Soundtrack
- Guess which movie or TV show a soundtrack belongs to
- Type the movie/series name (fuzzy matching)
- 3 lives per round
- 15 base points + speed bonus
- Uses curated movie list from `server/movies.json`
- Audio clips downloaded from YouTube (requires `yt-dlp` and `ffmpeg`)
- No category or difficulty selection (uses built-in movie list)

### Video Game Soundtrack
- Guess which video game a soundtrack belongs to
- Type the game name (fuzzy matching)
- 3 lives per round
- 15 base points + speed bonus
- Uses curated game list from `server/videogames.json`
- Audio clips downloaded from YouTube (requires `yt-dlp` and `ffmpeg`)
- No category or difficulty selection (uses built-in game list)

## Host Settings

| Setting | Options |
|---------|---------|
| Rounds | 10, 15, or 20 |
| Difficulty | Easy (top hit), Medium (top 3), Hard (top 10) |
| Categories | Multi-select, mix genres |
| Import | Add any public Spotify playlist |

## Production Deployment

```bash
# Pull and run
docker compose up -d

# Update
docker compose pull && docker compose up -d
```

Access at `http://your-server:7111`

## Configuration

### Add Categories

Edit `server/categories.json`:

```json
{
  "my-category": {
    "name": "My Category",
    "artists": ["Artist 1", "Artist 2"]
  }
}
```

### API Keys (Required)

Add to `server/.env`:

```env
SPOTIFY_CLIENT_ID=your_id
SPOTIFY_CLIENT_SECRET=your_secret
LASTFM_API_KEY=your_key
ADMIN_KEY=your_secret_key
```

- **Spotify**: Get credentials from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) (used for playlist import and fallback)
- **Last.fm**: Get a free API key from [Last.fm API](https://www.last.fm/api/account/create) (used for all-time top tracks ranking)
- **Admin key**: Any secret string of your choice (used to access the admin page)

## Admin Page

Visit `/admin?key=yourSecret` (where `yourSecret` matches the `ADMIN_KEY` env var) to manage `movies.json` and `videogames.json` from the browser.

- **Inline editing** - Click Edit to modify entries directly in the table row
- **Auto-save** - All changes (add, edit, delete) are saved to the server immediately
- **Play** - Preview cached audio clips to verify the right track was downloaded
- **Re-download** - Force re-download a clip (useful after changing the YouTube search override)
- **Sorted** - Entries are displayed and saved alphabetically
- New/changed entries automatically trigger clip download in the background

## Localization

- Language files live in `client/src/locales/` (`en.json`, `fr.json`).
- Add a new language by creating a new JSON file and registering it in `client/src/i18n.jsx`.
- The UI defaults to the browser language unless a saved choice exists in localStorage.

## Tech Stack

- React + Vite + Tailwind CSS
- Node.js + Express + Socket.io
- Last.fm API (track ranking) + Spotify API (fallback, playlists) + Deezer API (audio previews)
- yt-dlp + ffmpeg (movie/video game soundtrack clips)
- Docker

## Project Structure

```
quizzy/
├── client/src/
│   ├── components/        # Game UI
│   │   ├── Game.jsx       # Game states, audio, timers
│   │   ├── Lobby.jsx      # Room settings
│   │   ├── Home.jsx       # Join/create
│   │   └── Admin.jsx      # Admin page (edit movies/videogames)
│   ├── locales/           # UI translations (en.json, fr.json)
│   └── context/           # GameContext (state + sockets)
├── server/
│   ├── index.js           # Express + Socket.io
│   ├── gameManager.js     # Game flow, scoring
│   ├── roomManager.js     # Room CRUD, settings
│   ├── answerMatcher.js   # Fuzzy matching for typed mode
│   ├── quiz.js            # Track selection, decoys
│   ├── movieQuiz.js       # Movie soundtrack quiz generator
│   ├── movies.json        # Movie soundtrack list
│   ├── videogameQuiz.js   # Video game soundtrack quiz generator
│   ├── videogames.json    # Video game soundtrack list
│   ├── audioCache.js      # Movie/videogame clip downloader (yt-dlp)
│   ├── cache-provider.js  # Cache-first music provider
│   ├── artistCache.js     # Local cache persistence
│   ├── lastfm.js          # Last.fm API (track ranking)
│   ├── spotify.js         # Spotify API (fallback)
│   ├── deezer.js          # Deezer API (audio previews)
│   ├── categories.json    # Music categories
│   └── data/artists.json  # Cached artist tracks
├── Dockerfile
└── compose.yml
```

## Cache Management

```bash
# Music cache (Last.fm/Spotify artists)
node server/cache-warmer.js --stats            # Show statistics
node server/cache-warmer.js                    # Refresh missing/stale artists
node server/cache-warmer.js --refresh          # Force refresh all

# Movie audio cache (YouTube clips)
node server/audioCache.js --stats              # Show statistics
node server/audioCache.js --warm               # Download missing clips
node server/audioCache.js --prune              # Remove unused clips
```

## Notes

- Clip duration: 15 seconds (music), 20 seconds (movies/video games)
- Each artist appears once per quiz
- Release year shown on round reveal (from Spotify metadata)
- Fuzzy matching: ~15% typo tolerance, must type 70%+ of answer, spaces optional
- Track titles cleaned (removes all parenthetical content like "Remastered", "Live", etc.)
- Loading screen shows track fetching progress
- Non-host players see live settings updates in lobby
- Rooms avoid repeating the same song across consecutive games when possible
- Movie and video game clips are cached in `server/data/audio/` and prewarmed on server start

---

*Created by Raph*






