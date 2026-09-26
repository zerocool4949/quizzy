// Socket.io event handlers - room flow, game rounds, playlist management

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
  switchRole,
  getAnswerTime
} from './gameManager.js';
import { deleteImportedPlaylist } from './categories.js';
import { importPlaylistFromUrl } from './playlistImport.js';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Fixed-window counter: returns false once `limit` hits are reached for a key within the window
function createRateLimiter(limit) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 1000) {
      for (const [k, entry] of hits) {
        if (now - entry.start >= RATE_LIMIT_WINDOW_MS) hits.delete(k);
      }
    }
    const entry = hits.get(key);
    if (!entry || now - entry.start >= RATE_LIMIT_WINDOW_MS) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  };
}

// Per-room limits, plus a global import cap to protect Spotify/Last.fm quotas
const importLimitPerRoom = createRateLimiter(5);
const importLimitGlobal = createRateLimiter(30);
const deleteLimitPerRoom = createRateLimiter(20);

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    let currentRoom = null;

    const isHost = () => {
      const room = currentRoom && getRoom(currentRoom);
      return !!room && room.hostId === socket.id;
    };

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
            answerTime: getAnswerTime(result.room.answerMode),
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
      if (!isHost()) return;

      const room = getRoom(currentRoom);
      updateRoomSettings(currentRoom, { categoryIds, answerMode, difficulty, totalRounds });
      console.log(`Settings updated: categories: [${categoryIds?.join(', ')}], mode: "${answerMode}", difficulty: ${difficulty}, rounds: ${totalRounds}`);

      // Broadcast settings to all players in the room
      io.to(currentRoom).emit('settings-updated', {
        categoryIds: room.categoryIds,
        answerMode: room.answerMode,
        difficulty: room.difficulty,
        totalRounds: room.totalRounds
      });
    });

    // Import a Spotify playlist as a new category (host only)
    socket.on('import-playlist', async ({ url } = {}, ack) => {
      if (typeof ack !== 'function') return;
      if (!isHost()) return ack({ error: 'Only the host can manage playlists' });
      if (!importLimitPerRoom(currentRoom) || !importLimitGlobal('all')) {
        return ack({ error: 'Too many requests, try again later' });
      }

      try {
        ack(await importPlaylistFromUrl(url));
      } catch (error) {
        console.error(`Playlist import error: ${error.message}`);
        ack({ error: 'Failed to fetch playlist' });
      }
    });

    // Delete an imported playlist (host only)
    socket.on('delete-playlist', ({ categoryId } = {}, ack) => {
      if (typeof ack !== 'function') return;
      if (!isHost()) return ack({ error: 'Only the host can manage playlists' });
      if (!deleteLimitPerRoom(currentRoom)) return ack({ error: 'Too many requests, try again later' });
      if (typeof categoryId !== 'string') return ack({ error: 'Playlist not found' });

      const result = deleteImportedPlaylist(categoryId);
      if (!result.error) console.log(`Deleted imported playlist "${result.name}"`);
      ack(result);
    });

    // Start the game
    socket.on('start-game', async () => {
      if (!isHost()) return;

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
          sendNextRound(io, currentRoom);
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
          endRound(io, currentRoom);
        }
      }
    });

    const leaveCurrentRoom = () => {
      const roomCode = currentRoom;
      const room = leaveRoom(roomCode, socket.id);

      if (room) {
        io.to(roomCode).emit('player-left', {
          players: room.players,
          newHostId: room.hostId
        });

        // Check if remaining players have all answered (end round early)
        if (room.state === 'playing' && allPlayersAnswered(roomCode)) {
          endRound(io, roomCode);
        }
      }
    };

    // Player explicitly leaves the room
    socket.on('leave-room', () => {
      if (!currentRoom) return;

      console.log(`Player ${socket.id} leaving room ${currentRoom}`);
      socket.leave(currentRoom);
      leaveCurrentRoom();
      currentRoom = null;
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      if (currentRoom) leaveCurrentRoom();
    });

    // Play again
    socket.on('play-again', () => {
      if (!isHost()) return;

      const room = getRoom(currentRoom);
      resetRoom(currentRoom);
      io.to(currentRoom).emit('room-reset', {
        players: room.players
      });
    });
  });
}

function sendNextRound(io, roomCode) {
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
    const timeout = ((room.clipDuration || 15) + getAnswerTime(room.answerMode)) * 1000;
    const expectedRound = round.roundNumber - 1;

    setTimeout(() => {
      const currentRoom = getRoom(roomCode);
      if (currentRoom && currentRoom.state === 'playing' && currentRoom.currentRound === expectedRound) {
        endRound(io, roomCode);
      }
    }, timeout);
  }
}

function endRound(io, roomCode) {
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
        sendNextRound(io, roomCode);
      }
    }, 5000);
  }
}
