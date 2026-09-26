import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  updateRoomSettings,
  startGame,
  getCurrentRound,
  submitAnswer,
  allPlayersAnswered,
  canEndRound,
  getRoundResults,
  nextRound,
  getGameResults,
  resetRoom,
  switchRole
} from './gameManager.js';
import { getCategoryList } from './music.js';
import { importPlaylist, deleteImportedPlaylist } from './categories.js';
import { getPlaylist } from './spotify.js';
import { warmCache, refreshArtists } from './cache-warmer.js';
import * as artistCache from './artistCache.js';
import { warmMovieClips, getClipFilePath, hasClip, slugify } from './audioCache.js';
import { loadMovies, clearMoviesCache } from './movieQuiz.js';
import { loadVideogames, clearVideogamesCache } from './videogameQuiz.js';
import { writeFileSync, unlinkSync } from 'fs';

dotenv.config({ quiet: true });

// Warm cache on startup (non-blocking)
warmCache().catch(err => console.error('[Cache Warmer] Error:', err.message));
warmMovieClips(loadMovies())
  .then((stats) => {
    console.log(`[Movie Clips] Ready. total=${stats.total} cached=${stats.cached} downloaded=${stats.downloaded} failed=${stats.failed}`);
  })
  .catch(err => console.error('[Movie Clips] Error:', err.message));
warmMovieClips(loadVideogames())
  .then((stats) => {
    console.log(`[Videogame Clips] Ready. total=${stats.total} cached=${stats.cached} downloaded=${stats.downloaded} failed=${stats.failed}`);
  })
  .catch(err => console.error('[Videogame Clips] Error:', err.message));

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use('/audio', express.static(path.join(__dirname, 'data', 'audio')));

// Get available categories from categories.json
app.get('/api/categories', (_req, res) => {
  res.json(getCategoryList());
});

// Import a Spotify playlist as a new category
app.post('/api/playlists/import', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'Playlist URL is required' });
  }

  // Fetch playlist from Spotify
  const playlist = await getPlaylist(url);

  if (playlist.error) {
    return res.status(400).json({ error: playlist.error });
  }

  if (playlist.artists.length === 0) {
    return res.status(400).json({ error: 'Playlist has no tracks with artists' });
  }

  // Import the playlist
  const result = importPlaylist(playlist);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  console.log(`Imported playlist "${result.name}" with ${result.artistCount} artists`);

  // Cache tracks for new/stale artists (with timeout)
  const newArtists = playlist.artists.filter(artist => {
    const cached = artistCache.getArtistTracks(artist);
    return !cached || artistCache.isStale(artist, 90);
  });

  let cachedCount = 0;
  if (newArtists.length > 0) {
    console.log(`[Playlist Import] Caching tracks for ${newArtists.length} new/stale artists...`);
    try {
      await Promise.race([
        refreshArtists(newArtists).then(r => { cachedCount = r.success; }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
      ]);
      console.log(`[Playlist Import] Cached ${cachedCount} artists`);
    } catch (err) {
      console.warn(`[Playlist Import] Cache refresh incomplete (${err.message}), will continue in background`);
    }
  }

  res.json({ ...result, cachedArtists: cachedCount });
});

// Delete an imported playlist
app.delete('/api/playlists/:categoryId', (req, res) => {
  const { categoryId } = req.params;

  const result = deleteImportedPlaylist(categoryId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  console.log(`Deleted imported playlist "${result.name}"`);
  res.json(result);
});

// Admin middleware - checks ADMIN_KEY env var
function requireAdmin(req, res, next) {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Admin: get/save movies.json
app.get('/api/admin/movies', requireAdmin, (_req, res) => {
  res.json(loadMovies());
});

app.put('/api/admin/movies', requireAdmin, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  try {
    writeFileSync(path.join(__dirname, 'movies.json'), JSON.stringify(data, null, 2), 'utf-8');
    clearMoviesCache();
    console.log(`[Admin] movies.json updated (${Object.keys(data).length} entries)`);
    res.json({ success: true, count: Object.keys(data).length });
    warmMovieClips(data).then(r => console.log(`[Admin] Movie clips warm: ${r.downloaded} downloaded, ${r.failed} failed`));
  } catch (err) {
    console.error('[Admin] Failed to save movies.json:', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Admin: get/save videogames.json
app.get('/api/admin/videogames', requireAdmin, (_req, res) => {
  res.json(loadVideogames());
});

app.put('/api/admin/videogames', requireAdmin, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  try {
    writeFileSync(path.join(__dirname, 'videogames.json'), JSON.stringify(data, null, 2), 'utf-8');
    clearVideogamesCache();
    console.log(`[Admin] videogames.json updated (${Object.keys(data).length} entries)`);
    res.json({ success: true, count: Object.keys(data).length });
    warmMovieClips(data).then(r => console.log(`[Admin] Videogame clips warm: ${r.downloaded} downloaded, ${r.failed} failed`));
  } catch (err) {
    console.error('[Admin] Failed to save videogames.json:', err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Admin: re-download a clip (delete cached + re-warm)
app.post('/api/admin/redownload', requireAdmin, async (req, res) => {
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type or name' });
  const source = type === 'movies' ? loadMovies() : loadVideogames();
  const entry = source[name];
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const track = entry.tracks?.[0];
  if (!track) return res.status(400).json({ error: 'No track' });
  const trackName = typeof track === 'string' ? track : track.name;
  const trackKey = typeof track === 'string' ? slugify(track) : (track.key || slugify(trackName));
  // Delete existing clip
  const clipPath = getClipFilePath(name, trackKey);
  try { unlinkSync(clipPath); } catch {}
  // Re-download
  const result = await warmMovieClips({ [name]: entry });
  console.log(`[Admin] Re-download ${name}: ${result.downloaded} downloaded, ${result.failed} failed`);
  res.json({ success: result.downloaded > 0, downloaded: result.downloaded, failed: result.failed });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  let currentRoom = null;

  // Create a new room
  socket.on('create-room', ({ playerName }) => {
    const room = createRoom(socket.id, playerName);
    currentRoom = room.code;
    socket.join(room.code);

    socket.emit('room-created', {
      code: room.code,
      players: room.players,
      isHost: true
    });

    console.log(`Room ${room.code} created by ${playerName}`);
  });

  // Join existing room
  socket.on('join-room', ({ code, playerName, asSpectator = false }) => {
    const result = joinRoom(code, socket.id, playerName, asSpectator);

    if (result.error) {
      socket.emit('join-error', { message: result.error });
      return;
    }

    currentRoom = result.room.code;
    socket.join(result.room.code);

    const player = result.room.players.find(p => p.id === socket.id);

    socket.emit('room-joined', {
      code: result.room.code,
      players: result.room.players,
      isHost: false,
      isSpectator: player?.role === 'spectator',
      gameState: result.room.state
    });

    // Send current settings to the joining player
    socket.emit('settings-updated', {
      categoryIds: result.room.categoryIds,
      answerMode: result.room.answerMode,
      difficulty: result.room.difficulty,
      totalRounds: result.room.totalRounds
    });

    // Notify others
    socket.to(result.room.code).emit('player-joined', {
      players: result.room.players
    });

    // If game is in progress and joining as spectator, send current round info
    if (asSpectator && result.room.state === 'playing') {
      const round = result.room.rounds[result.room.currentRound];
      if (round) {
        socket.emit('new-round', {
          roundNumber: round.roundNumber,
          totalRounds: result.room.totalRounds,
          previewUrl: round.previewUrl,
          answerMode: result.room.answerMode,
          clipDuration: result.room.clipDuration,
          answerTime: (result.room.answerMode === 'typed' || result.room.answerMode === 'movie' || result.room.answerMode === 'videogame') ? 10 : 5,
          options: result.room.answerMode === 'mcq' ? round.options : undefined
        });
      }
    }

    console.log(`${playerName} joined room ${code}${asSpectator ? ' as spectator' : ''}`);
  });

  // Switch between player and spectator roles
  socket.on('switch-role', () => {
    if (!currentRoom) return;

    const result = switchRole(currentRoom, socket.id);

    if (result.error) {
      socket.emit('switch-role-error', { message: result.error });
      return;
    }

    socket.emit('role-switched', { role: result.newRole });

    // Notify all players of updated player list
    io.to(currentRoom).emit('player-joined', {
      players: result.room.players
    });

    console.log(`Player ${socket.id} switched to ${result.newRole} in room ${currentRoom}`);
  });

  // Update game settings (categories, answer mode, difficulty, rounds)
  socket.on('update-settings', ({ categoryIds, answerMode, difficulty, totalRounds }) => {
    if (!currentRoom) return;

    const room = getRoom(currentRoom);
    if (room && room.hostId === socket.id) {
      updateRoomSettings(currentRoom, { categoryIds, answerMode, difficulty, totalRounds });
      console.log(`Settings updated: categories: [${categoryIds?.join(', ')}], mode: "${answerMode}", difficulty: ${difficulty}, rounds: ${totalRounds}`);

      // Broadcast settings to all players in the room
      io.to(currentRoom).emit('settings-updated', {
        categoryIds: room.categoryIds,
        answerMode: room.answerMode,
        difficulty: room.difficulty,
        totalRounds: room.totalRounds
      });
    }
  });

  // Start the game
  socket.on('start-game', async () => {
    if (!currentRoom) return;

    const room = getRoom(currentRoom);
    if (!room || room.hostId !== socket.id) return;

    console.log(`Starting game in room ${currentRoom}`);

    // Show loading state while fetching tracks
    io.to(currentRoom).emit('game-loading', { phase: 'starting', message: 'Preparing quiz...' });

    try {
      // Progress callback to send updates to clients
      const onProgress = (progress) => {
        io.to(currentRoom).emit('game-loading', progress);
      };

      const result = await startGame(currentRoom, onProgress);

      if (result.error) {
        console.error(`Game start error: ${result.error}`);
        socket.emit('game-error', { message: result.error });
        return;
      }

      console.log(`Tracks loaded, starting countdown`);

      // NOW start the countdown (tracks are ready)
      io.to(currentRoom).emit('game-starting', { countdown: 3 });

      // Wait for countdown then send first round
      setTimeout(() => {
        sendNextRound(currentRoom);
      }, 3000);
    } catch (error) {
      console.error(`Game start exception: ${error.message}`);
      socket.emit('game-error', { message: error.message });
    }
  });

  // Player submits answer
  socket.on('submit-answer', (payload) => {
  if (!currentRoom) return;

  const result = submitAnswer(currentRoom, socket.id, payload);

  if (result) {
    socket.emit('answer-result', result);

    // End round when everyone is done (mcq once; typed after title or wrong artist)
    if (allPlayersAnswered(currentRoom)) {
      endRound(currentRoom);
    }
  }
});


  // Player explicitly leaves the room
  socket.on('leave-room', () => {
    if (!currentRoom) return;

    console.log(`Player ${socket.id} leaving room ${currentRoom}`);
    const roomCode = currentRoom;
    const room = leaveRoom(roomCode, socket.id);
    socket.leave(roomCode);

    if (room) {
      io.to(roomCode).emit('player-left', {
        players: room.players,
        newHostId: room.hostId
      });

      // Check if remaining players have all answered (end round early)
      if (room.state === 'playing' && allPlayersAnswered(roomCode)) {
        endRound(roomCode);
      }
    }

    currentRoom = null;
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    if (currentRoom) {
      const roomCode = currentRoom;
      const room = leaveRoom(roomCode, socket.id);

      if (room) {
        io.to(roomCode).emit('player-left', {
          players: room.players,
          newHostId: room.hostId
        });

        // Check if remaining players have all answered (end round early)
        if (room.state === 'playing' && allPlayersAnswered(roomCode)) {
          endRound(roomCode);
        }
      }
    }
  });

  // Play again
  socket.on('play-again', () => {
    if (!currentRoom) return;

    const room = getRoom(currentRoom);
    if (room && room.hostId === socket.id) {
      resetRoom(currentRoom);
      io.to(currentRoom).emit('room-reset', {
        players: room.players
      });
    }
  });
});

function sendNextRound(roomCode) {
  const room = getRoom(roomCode);
  const round = getCurrentRound(roomCode);
  console.log(`Sending round for ${roomCode}:`, round ? `Round ${round.roundNumber}` : 'No round');

  if (round && room) {
    // Include clip duration in round data
    io.to(roomCode).emit('new-round', {
      ...round,
      clipDuration: room.clipDuration || 15
    });

    // Auto-end round after clip duration + answer time (match client timer)
    const answerTime = (room.answerMode === 'typed' || room.answerMode === 'movie' || room.answerMode === 'videogame') ? 10 : 5;
    const timeout = ((room.clipDuration || 15) + answerTime) * 1000;
    const expectedRound = round.roundNumber - 1;

    setTimeout(() => {
      const currentRoom = getRoom(roomCode);
      if (currentRoom && currentRoom.state === 'playing' && currentRoom.currentRound === expectedRound) {
        endRound(roomCode);
      }
    }, timeout);
  }
}

function endRound(roomCode) {
  // Prevent double-ending a round
  if (!canEndRound(roomCode)) return;

  const results = getRoundResults(roomCode);

  if (results) {
    io.to(roomCode).emit('round-end', results);

    // Wait before next round
    setTimeout(() => {
      const status = nextRound(roomCode);

      if (status?.finished) {
        const gameResults = getGameResults(roomCode);
        io.to(roomCode).emit('game-over', gameResults);
      } else {
        sendNextRound(roomCode);
      }
    }, 5000);
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
