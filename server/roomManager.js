// Room management - creation, joining, leaving, settings

import { sanitizePlayerName, sanitizeRoomCode } from './validation.js';

const rooms = new Map();

// Room TTL cleanup - delete rooms inactive for 2 hours
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Cleanup stale rooms periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      console.log(`[Room Cleanup] Deleting stale room ${code} (inactive for ${Math.round((now - room.lastActivity) / 60000)} minutes)`);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

export function createRoom(hostId, hostName) {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const safeName = sanitizePlayerName(hostName) || 'Player';

  const room = {
    code,
    hostId,
    players: [
      {
        id: hostId,
        name: safeName,
        score: 0,
        streak: 0,
        isHost: true,
        role: 'player'
      }
    ],
    state: 'lobby', // lobby, playing, finished
    categoryIds: ['top-hits'],
    clipDuration: 15,
    answerMode: 'typed', // 'mcq' | 'typed' | 'movie' | 'videogame'
    difficulty: 1, // 1=easy, 2=medium, 3=hard
    musicProvider: 'spotify',
    rounds: [],
    currentRound: 0,
    totalRounds: 10,
    roundStartTime: null,
    answers: new Map(),
    usedTrackIds: new Set(),
    usedSoundtrackIds: { movie: new Set(), videogame: new Set() },
    lastActivity: Date.now()
  };

  rooms.set(code, room);
  return room;
}

export function joinRoom(code, playerId, playerName, asSpectator = false) {
  const safeCode = sanitizeRoomCode(code);
  const room = rooms.get(safeCode);

  if (!room) return { error: 'Room not found' };
  if (room.state !== 'lobby' && !asSpectator) return { error: 'Game already in progress' };
  if (room.players.find(p => p.id === playerId)) return { error: 'Already in room' };

  // Only count active players toward the 8-player limit
  const activePlayers = room.players.filter(p => p.role === 'player').length;
  if (!asSpectator && activePlayers >= 8) return { error: 'Room is full (max 8 players)' };

  const safeName = sanitizePlayerName(playerName) || 'Player';

  room.players.push({
    id: playerId,
    name: safeName,
    score: 0,
    streak: 0,
    isHost: false,
    role: asSpectator ? 'spectator' : 'player'
  });

  room.lastActivity = Date.now();
  return { room };
}

export function leaveRoom(code, playerId) {
  const safeCode = sanitizeRoomCode(code || '');
  const room = rooms.get(safeCode);
  if (!room) return null;

  room.players = room.players.filter(p => p.id !== playerId);
  room.answers?.delete(playerId);

  // If host left, assign new host or delete room
  if (room.hostId === playerId) {
    if (room.players.length > 0) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    } else {
      rooms.delete(safeCode);
      return null;
    }
  }

  room.lastActivity = Date.now();
  return room;
}

export function getRoom(code) {
  const safeCode = sanitizeRoomCode(code || '');
  const room = rooms.get(safeCode);
  if (room) {
    room.lastActivity = Date.now();
  }
  return room;
}

export function updateRoomSettings(code, { categoryIds, answerMode, difficulty, totalRounds }) {
  const safeCode = sanitizeRoomCode(code || '');
  const room = rooms.get(safeCode);
  if (room && room.state === 'lobby') {
    if (categoryIds && categoryIds.length > 0) room.categoryIds = categoryIds;
    if (answerMode) room.answerMode = answerMode;
    if (difficulty) room.difficulty = difficulty;
    if (totalRounds) room.totalRounds = totalRounds;
    room.lastActivity = Date.now();
    return true;
  }
  return false;
}

export function resetRoom(code) {
  const safeCode = sanitizeRoomCode(code || '');
  const room = rooms.get(safeCode);
  if (!room) return null;

  room.state = 'lobby';
  room.rounds = [];
  room.currentRound = 0;
  room.roundEnded = false;
  room.roundStartTime = null;
  room.answers.clear();
  room.players.forEach(p => {
    p.score = 0;
    p.streak = 0;
  });
  room.lastActivity = Date.now();

  return room;
}

export function switchRole(code, playerId) {
  const safeCode = sanitizeRoomCode(code || '');
  const room = rooms.get(safeCode);
  if (!room || room.state !== 'lobby') return { error: 'Cannot switch role during game' };

  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not found' };

  // Cannot switch host to spectator
  if (player.isHost && player.role === 'player') {
    return { error: 'Host cannot become spectator' };
  }

  // Check player limit when switching to player
  if (player.role === 'spectator') {
    const activePlayers = room.players.filter(p => p.role === 'player').length;
    if (activePlayers >= 8) return { error: 'Room is full (max 8 players)' };
  }

  player.role = player.role === 'player' ? 'spectator' : 'player';
  room.lastActivity = Date.now();
  return { room, newRole: player.role };
}

export function deleteRoom(code) {
  const safeCode = sanitizeRoomCode(code || '');
  rooms.delete(safeCode);
}
