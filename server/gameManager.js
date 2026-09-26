// Game logic - rounds, scoring, answers

import { getQuizTracks } from './quiz.js';
import { normalize, looselyMatches } from './answerMatcher.js';
import { logGame } from './gameLogger.js';
import { sanitizeAnswerText } from './validation.js';
import { SOUNDTRACK_MODES, isSoundtrackMode, getSoundtrackQuizTracks } from './soundtrackQuiz.js';
import { getMovieClipSeconds } from './audioCache.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  updateRoomSettings,
  resetRoom,
  switchRole
} from './roomManager.js';

// Re-export room management functions
export { createRoom, joinRoom, leaveRoom, getRoom, updateRoomSettings, resetRoom, switchRole };

// Seconds to answer after the clip ends (client timer uses the same value)
export function getAnswerTime(answerMode) {
  return answerMode === 'mcq' ? 5 : 10;
}

// Typed mode on hard difficulty gets 5 lives; everything else gets 3
function getStartingLives(room) {
  return room.answerMode === 'typed' && room.difficulty === 3 ? 5 : 3;
}

// Speed bonus for typed and soundtrack answers
function getSpeedBonus(time) {
  if (time < 5) return 5;
  if (time < 10) return 3;
  if (time < 15) return 1;
  return 0;
}

// Speed bonus for MCQ answers
function getMcqSpeedBonus(time) {
  if (time < 3) return 3;
  if (time < 6) return 2;
  if (time < 10) return 1;
  return 0;
}

export async function startGame(code, onProgress = null) {
  const room = getRoom(code);
  if (!room || room.state !== 'lobby') return { error: 'Cannot start game' };
  const activePlayers = room.players.filter(p => p.role === 'player');
  if (activePlayers.length < 1) return { error: 'Need at least 1 player' };

  try {
    // Soundtrack modes (movie, videogame) use their own quiz generator
    if (isSoundtrackMode(room.answerMode)) {
      room.clipDuration = getMovieClipSeconds();
      const excludeIds = Array.from(room.usedSoundtrackIds[room.answerMode]);
      room.rounds = await getSoundtrackQuizTracks(room.answerMode, room.totalRounds, onProgress, excludeIds);
    } else {
      room.clipDuration = 15;
      const excludeTrackIds = room.usedTrackIds ? Array.from(room.usedTrackIds) : [];
      room.rounds = await getQuizTracks(
        room.categoryIds,
        room.totalRounds,
        room.difficulty,
        room.musicProvider,
        onProgress,
        excludeTrackIds
      );
    }
    room.state = 'playing';
    room.currentRound = 0;

    // Reset scores
    room.players.forEach(p => {
      p.score = 0;
      p.streak = 0;
    });

    // Track used songs/soundtracks to avoid repeats across games
    const usedIds = isSoundtrackMode(room.answerMode)
      ? room.usedSoundtrackIds[room.answerMode]
      : room.usedTrackIds;
    room.rounds.forEach(round => {
      if (round?.correctId) usedIds.add(round.correctId);
    });

    // Log game for debugging/review
    logGame(code, room.categoryIds, room.rounds, room.players.length);

    return { room };
  } catch (error) {
    return { error: error.message };
  }
}

export function getCurrentRound(code) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return null;

  const round = room.rounds[room.currentRound];
  if (!round) return null;

  room.roundStartTime = Date.now();
  room.roundEnded = false;
  room.answers.clear();

  return {
    roundNumber: round.roundNumber,
    totalRounds: room.totalRounds,
    previewUrl: round.previewUrl,
    answerMode: room.answerMode,
    clipDuration: room.clipDuration,
    answerTime: getAnswerTime(room.answerMode),
    startingLives: getStartingLives(room),
    options: room.answerMode === 'mcq' ? round.options : undefined
  };
}

export function submitAnswer(code, playerId, payload) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return null;

  const round = room.rounds[room.currentRound];
  const player = room.players.find(p => p.id === playerId);
  if (!round || !player) return null;

  // Spectators cannot submit answers
  if (player.role === 'spectator') return null;

  const timeTaken = (Date.now() - room.roundStartTime) / 1000;

  // MCQ MODE
  if (room.answerMode === 'mcq') {
    const answerId = payload?.answerId ?? payload;
    if (room.answers.has(playerId)) return null;

    const isCorrect = answerId === round.correctId;
    let points = 0;
    let speedBonus = 0;

    if (isCorrect) {
      speedBonus = getMcqSpeedBonus(timeTaken);
      points = 10 + speedBonus;
      player.streak++;
    } else {
      player.streak = 0;
    }

    player.score += points;

    room.answers.set(playerId, {
      mode: 'mcq',
      finished: true,
      answerId,
      isCorrect,
      points,
      speedBonus,
      timeTaken
    });

    return {
      mode: 'mcq',
      isCorrect,
      points,
      speedBonus,
      totalScore: player.score,
      streak: player.streak
    };
  }

  // SOUNDTRACK MODES (movie, videogame)
  if (isSoundtrackMode(room.answerMode)) {
    const mode = room.answerMode;
    const { answerKey, correctFlag } = SOUNDTRACK_MODES[mode];
    const text = sanitizeAnswerText(payload?.text);
    if (!text) return null;

    let existing = room.answers.get(playerId);

    if (!existing) {
      existing = {
        mode,
        finished: false,
        lives: getStartingLives(room),
        [correctFlag]: false,
        points: 0
      };
      room.answers.set(playerId, existing);
    }

    if (existing.finished) return null;

    // Wrong guess - lose a life
    if (!looselyMatches(text, round[answerKey])) {
      existing.lives--;
      if (existing.lives <= 0) {
        player.streak = 0;
        existing.finished = true;
      }

      return {
        mode,
        isCorrect: false,
        [correctFlag]: false,
        points: 0,
        totalScore: player.score,
        streak: player.streak,
        livesLeft: existing.lives
      };
    }

    // Correct!
    const speedBonus = getSpeedBonus(timeTaken);
    const pointsAwarded = 15 + speedBonus;
    player.score += pointsAwarded;
    player.streak++;
    existing[correctFlag] = true;
    existing.points = pointsAwarded;
    existing.finished = true;

    return {
      mode,
      isCorrect: true,
      [correctFlag]: true,
      points: pointsAwarded,
      speedBonus,
      totalScore: player.score,
      streak: player.streak,
      livesLeft: existing.lives
    };
  }

  // TYPED MODE
  const text = sanitizeAnswerText(payload?.text);
  if (!text) return null;

  let existing = room.answers.get(playerId);

  if (!existing) {
    existing = {
      mode: 'typed',
      finished: false,
      lives: getStartingLives(room),
      artistCorrect: false,
      titleCorrect: false,
      points: 0,
      comboApplied: false
    };
    room.answers.set(playerId, existing);
  }

  if (existing.finished) return null;

  const correctArtists = round.correctArtists || [round.correctArtist];
  const correctTitle = round.correctName;

  let matchesArtist = !existing.artistCorrect && correctArtists.some(artist => looselyMatches(text, artist));
  let matchesTitle = !existing.titleCorrect && looselyMatches(text, correctTitle);

  // Check if input contains both artist AND title
  if (text.length >= 6 && !existing.artistCorrect && !existing.titleCorrect) {
    const normalizedInput = normalize(text);
    const normalizedTitle = normalize(correctTitle);
    const matchesAnyArtist = correctArtists.some(artist => normalizedInput.includes(normalize(artist)));
    if (matchesAnyArtist && normalizedInput.includes(normalizedTitle)) {
      matchesArtist = true;
      matchesTitle = true;
    }
  }

  // Wrong guess - lose a life
  if (!matchesArtist && !matchesTitle) {
    existing.lives--;
    if (existing.lives <= 0) {
      player.streak = 0;
      existing.finished = true;
    }
    room.answers.set(playerId, existing);

    return {
      mode: 'typed',
      matched: null,
      isCorrect: false,
      fullCorrect: false,
      points: 0,
      pointsAwarded: 0,
      speedBonus: 0,
      totalScore: player.score,
      streak: player.streak,
      livesLeft: existing.lives,
      artistCorrect: existing.artistCorrect,
      titleCorrect: existing.titleCorrect
    };
  }

  // Process artist match
  if (matchesArtist) {
    const speedBonus = getSpeedBonus(timeTaken);
    const pointsAwarded = 10 + speedBonus;
    player.score += pointsAwarded;
    existing.artistText = text;
    existing.artistCorrect = true;
    existing.points = (existing.points || 0) + pointsAwarded;
    existing.artistSpeedBonus = speedBonus;
    existing.artistTime = timeTaken;
  }

  // Process title match
  if (matchesTitle) {
    const speedBonus = getSpeedBonus(timeTaken);
    const pointsAwarded = 15 + speedBonus;
    player.score += pointsAwarded;
    existing.titleText = text;
    existing.titleCorrect = true;
    existing.points = (existing.points || 0) + pointsAwarded;
    existing.titleSpeedBonus = speedBonus;
    existing.titleTime = timeTaken;
  }

  const fullCorrect = existing.artistCorrect && existing.titleCorrect;
  let comboBonus = 0;
  if (fullCorrect) {
    player.streak++;
    existing.finished = true;
    if (!existing.comboApplied) {
      comboBonus = 5;
      player.score += comboBonus;
      existing.points += comboBonus;
      existing.comboApplied = true;
    }
  }

  room.answers.set(playerId, existing);

  const matchedBoth = matchesArtist && matchesTitle;
  const matched = matchedBoth ? 'both' : (matchesArtist ? 'artist' : 'title');
  const pointsAwarded = (matchesArtist ? 10 + (existing.artistSpeedBonus || 0) : 0) +
                        (matchesTitle ? 15 + (existing.titleSpeedBonus || 0) : 0) +
                        comboBonus;

  return {
    mode: 'typed',
    matched,
    isCorrect: true,
    fullCorrect,
    points: existing.points,
    pointsAwarded,
    speedBonus: matchedBoth ? (existing.artistSpeedBonus || 0) + (existing.titleSpeedBonus || 0) :
                (matchesArtist ? existing.artistSpeedBonus : existing.titleSpeedBonus),
    totalScore: player.score,
    streak: player.streak,
    livesLeft: existing.lives,
    artistCorrect: existing.artistCorrect,
    titleCorrect: existing.titleCorrect
  };
}

export function allPlayersAnswered(code) {
  const room = getRoom(code);
  if (!room) return false;
  // Only check active players, not spectators
  const activePlayers = room.players.filter(p => p.role === 'player');
  return activePlayers.every(p => room.answers.get(p.id)?.finished);
}

export function canEndRound(code) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return false;
  if (room.roundEnded) return false;
  room.roundEnded = true;
  return true;
}

export function getRoundResults(code) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return null;

  const round = room.rounds[room.currentRound];

  // Only include active players in results
  const activePlayers = room.players.filter(p => p.role === 'player');

  // Base result with common fields
  const result = {
    correctId: round.correctId,
    albumArt: round.albumArt,
    playerResults: activePlayers
      .map(p => {
        const answer = room.answers.get(p.id);
        let isCorrect = false;
        if (answer?.mode === 'mcq') {
          isCorrect = answer?.isCorrect || false;
        } else if (isSoundtrackMode(answer?.mode)) {
          isCorrect = answer[SOUNDTRACK_MODES[answer.mode].correctFlag] || false;
        } else if (answer?.mode === 'typed') {
          isCorrect = !!(answer?.artistCorrect && answer?.titleCorrect);
        }

        return {
          id: p.id,
          name: p.name,
          score: p.score,
          roundPoints: answer?.points || 0,
          isCorrect,
          streak: p.streak
        };
      })
      .sort((a, b) => b.score - a.score)
  };

  // Add mode-specific fields
  if (isSoundtrackMode(room.answerMode)) {
    const { answerKey } = SOUNDTRACK_MODES[room.answerMode];
    result[answerKey] = round[answerKey];
    result.correctTrack = round.correctTrack;
    result.correctComposer = round.correctComposer;
    result.correctYear = round.correctYear;
  } else {
    result.correctName = round.correctName;
    result.correctArtist = round.correctArtist;
    result.correctYear = round.correctYear;
  }

  return result;
}

export function nextRound(code) {
  const room = getRoom(code);
  if (!room || room.state !== 'playing') return null;

  room.currentRound++;

  if (room.currentRound >= room.rounds.length) {
    room.state = 'finished';
    return { finished: true };
  }

  return { finished: false };
}

export function getGameResults(code) {
  const room = getRoom(code);
  if (!room) return null;

  // Only include active players in standings
  const activePlayers = room.players.filter(p => p.role === 'player');
  const sortedPlayers = [...activePlayers].sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0];

  return {
    winner: {
      id: winner.id,
      name: winner.name,
      score: winner.score
    },
    standings: sortedPlayers.map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: p.score
    })),
    rounds: room.rounds.map(r => {
      if (isSoundtrackMode(room.answerMode)) {
        const { answerKey, summaryKey } = SOUNDTRACK_MODES[room.answerMode];
        return {
          [summaryKey]: r[answerKey],
          track: r.correctTrack,
          composer: r.correctComposer
        };
      }
      return {
        artist: r.correctArtist,
        title: r.correctName
      };
    })
  };
}

