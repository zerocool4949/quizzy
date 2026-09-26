import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  startGame,
  getRoom,
  updateRoomSettings,
  getCurrentRound,
  submitAnswer,
  allPlayersAnswered,
  canEndRound,
  getRoundResults
} from '../gameManager.js';

vi.mock('../quiz.js', () => ({
  getQuizTracks: vi.fn()
}));

vi.mock('../soundtrackQuiz.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSoundtrackQuizTracks: vi.fn()
}));

vi.mock('../audioCache.js', () => ({
  getMovieClipSeconds: vi.fn(() => 20),
  ensureMovieClip: vi.fn(),
  getClipUrl: vi.fn()
}));

import { getQuizTracks } from '../quiz.js';
import { getSoundtrackQuizTracks } from '../soundtrackQuiz.js';

describe('gameManager', () => {
  beforeEach(() => {
    getQuizTracks.mockReset();
    getSoundtrackQuizTracks.mockReset();
  });

  it('hands off host when the host leaves', () => {
    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');

    const updated = leaveRoom(room.code, 'host-1');

    expect(updated).not.toBeNull();
    expect(updated.hostId).toBe('player-2');
    expect(updated.players[0].id).toBe('player-2');
    expect(updated.players[0].isHost).toBe(true);
  });

  it('starts a game and resets scores', async () => {
    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');

    const existingRoom = getRoom(room.code);
    existingRoom.players[0].score = 42;
    existingRoom.players[1].score = 7;

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song',
        correctArtist: 'Artist',
        options: []
      }
    ]);

    const result = await startGame(room.code);

    expect(result).toHaveProperty('room');
    expect(result.room.state).toBe('playing');
    expect(result.room.rounds).toHaveLength(1);
    expect(result.room.players.every(p => p.score === 0)).toBe(true);
  });

  it('scores typed mode correctly for artist and title', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');
    updateRoomSettings(room.code, { answerMode: 'typed' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Hotline Bling',
        correctArtist: 'Drake',
        options: []
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    // Answer artist in 3s -> 10 + 3 bonus
    vi.setSystemTime(new Date(startTime.getTime() + 3000));
    const artistResult = submitAnswer(room.code, 'player-2', { text: 'Drake' });
    expect(artistResult.points).toBe(15);
    expect(artistResult.artistCorrect).toBe(true);
    expect(artistResult.titleCorrect).toBe(false);

    // Answer title in 6s -> 15 + 2 bonus
    vi.setSystemTime(new Date(startTime.getTime() + 6000));
    const titleResult = submitAnswer(room.code, 'player-2', { text: 'Hotline Bling' });
    expect(titleResult.points).toBe(38);
    expect(titleResult.fullCorrect).toBe(true);

    vi.useRealTimers();
  });

  it('only ends a round once and respects typed completion', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');
    updateRoomSettings(room.code, { answerMode: 'typed' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Blinding Lights',
        correctArtist: 'The Weeknd',
        options: []
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    expect(allPlayersAnswered(room.code)).toBe(false);

    vi.setSystemTime(new Date(startTime.getTime() + 4000));
    submitAnswer(room.code, 'player-2', { text: 'The Weeknd' });
    submitAnswer(room.code, 'host-1', { text: 'The Weeknd' });
    expect(allPlayersAnswered(room.code)).toBe(false);

    vi.setSystemTime(new Date(startTime.getTime() + 7000));
    submitAnswer(room.code, 'player-2', { text: 'Blinding Lights' });
    submitAnswer(room.code, 'host-1', { text: 'Blinding Lights' });
    expect(allPlayersAnswered(room.code)).toBe(true);

    expect(canEndRound(room.code)).toBe(true);
    expect(canEndRound(room.code)).toBe(false);

    vi.useRealTimers();
  });

  it('scores MCQ mode correctly with speed bonus', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');
    updateRoomSettings(room.code, { answerMode: 'mcq' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song',
        correctArtist: 'Artist',
        options: [
          { id: 'track-1', name: 'Song', artist: 'Artist' },
          { id: 'track-2', name: 'Wrong', artist: 'Other' }
        ]
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    // Answer correctly in 2s -> 10 + 3 speed bonus
    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    const result = submitAnswer(room.code, 'player-2', { answerId: 'track-1' });

    expect(result.mode).toBe('mcq');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(13); // 10 base + 3 speed bonus
    expect(result.speedBonus).toBe(3);

    vi.useRealTimers();
  });

  it('scores MCQ mode zero for wrong answer', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'mcq' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song',
        correctArtist: 'Artist',
        options: [
          { id: 'track-1', name: 'Song', artist: 'Artist' },
          { id: 'track-2', name: 'Wrong', artist: 'Other' }
        ]
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    const result = submitAnswer(room.code, 'host-1', { answerId: 'track-2' });

    expect(result.mode).toBe('mcq');
    expect(result.isCorrect).toBe(false);
    expect(result.points).toBe(0);

    vi.useRealTimers();
  });

  it('handles movie mode scoring correctly', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'movie' });

    getSoundtrackQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/audio/movie.mp3',
        albumArt: '',
        correctId: 'movie-1',
        correctMovie: 'The Lion King',
        correctTrack: 'Circle of Life'
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    // Wrong guess - lose a life
    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    const wrongResult = submitAnswer(room.code, 'host-1', { text: 'Frozen' });

    expect(wrongResult.mode).toBe('movie');
    expect(wrongResult.isCorrect).toBe(false);
    expect(wrongResult.livesLeft).toBe(2);

    // Correct guess - score points
    vi.setSystemTime(new Date(startTime.getTime() + 4000));
    const correctResult = submitAnswer(room.code, 'host-1', { text: 'The Lion King' });

    expect(correctResult.mode).toBe('movie');
    expect(correctResult.isCorrect).toBe(true);
    expect(correctResult.movieCorrect).toBe(true);
    expect(correctResult.points).toBe(20); // 15 base + 5 speed bonus (<5s)

    vi.useRealTimers();
  });

  it('loses all lives in movie mode', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'movie' });

    getSoundtrackQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/audio/movie.mp3',
        albumArt: '',
        correctId: 'movie-1',
        correctMovie: 'Inception',
        correctTrack: 'Time'
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    // Three wrong guesses
    submitAnswer(room.code, 'host-1', { text: 'Interstellar' });
    submitAnswer(room.code, 'host-1', { text: 'Tenet' });
    const finalResult = submitAnswer(room.code, 'host-1', { text: 'Dunkirk' });

    expect(finalResult.livesLeft).toBe(0);
    expect(finalResult.movieCorrect).toBe(false);

    // Cannot submit more answers after losing all lives
    const afterResult = submitAnswer(room.code, 'host-1', { text: 'Inception' });
    expect(afterResult).toBeNull();

    vi.useRealTimers();
  });

  it('handles typed mode with multi-artist tracks', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'typed' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Under Pressure',
        correctArtist: 'Queen & David Bowie',
        correctArtists: ['Queen', 'David Bowie']
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    // Should match any of the artists
    vi.setSystemTime(new Date(startTime.getTime() + 3000));
    const result1 = submitAnswer(room.code, 'host-1', { text: 'David Bowie' });
    expect(result1.artistCorrect).toBe(true);

    vi.useRealTimers();
  });

  it('tracks streak across correct answers', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'mcq' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song 1',
        correctArtist: 'Artist',
        options: [{ id: 'track-1', name: 'Song 1', artist: 'Artist' }]
      },
      {
        roundNumber: 2,
        previewUrl: 'https://example.test/preview2.mp3',
        albumArt: '',
        correctId: 'track-2',
        correctName: 'Song 2',
        correctArtist: 'Artist',
        options: [{ id: 'track-2', name: 'Song 2', artist: 'Artist' }]
      }
    ]);

    await startGame(room.code);

    // Round 1
    getCurrentRound(room.code);
    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    const result1 = submitAnswer(room.code, 'host-1', { answerId: 'track-1' });
    expect(result1.streak).toBe(1);

    // Simulate round end and next round
    canEndRound(room.code);
    const existingRoom = getRoom(room.code);
    existingRoom.currentRound++;
    existingRoom.roundEnded = false;

    // Round 2
    getCurrentRound(room.code);
    vi.setSystemTime(new Date(startTime.getTime() + 4000));
    const result2 = submitAnswer(room.code, 'host-1', { answerId: 'track-2' });
    expect(result2.streak).toBe(2);

    vi.useRealTimers();
  });

  it('resets streak on wrong answer', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    updateRoomSettings(room.code, { answerMode: 'mcq' });

    // Set initial streak
    const existingRoom = getRoom(room.code);
    existingRoom.players[0].streak = 5;

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song',
        correctArtist: 'Artist',
        options: [
          { id: 'track-1', name: 'Song', artist: 'Artist' },
          { id: 'track-2', name: 'Wrong', artist: 'Other' }
        ]
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    const result = submitAnswer(room.code, 'host-1', { answerId: 'track-2' }); // Wrong

    expect(result.streak).toBe(0);

    vi.useRealTimers();
  });

  it('returns correct round results structure', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', 'Player');
    updateRoomSettings(room.code, { answerMode: 'mcq' });

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: 'https://example.test/album.jpg',
        correctId: 'track-1',
        correctName: 'Test Song',
        correctArtist: 'Test Artist',
        correctYear: '2020',
        options: [{ id: 'track-1', name: 'Test Song', artist: 'Test Artist' }]
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    vi.setSystemTime(new Date(startTime.getTime() + 2000));
    submitAnswer(room.code, 'host-1', { answerId: 'track-1' });
    submitAnswer(room.code, 'player-2', { answerId: 'track-1' });

    const results = getRoundResults(room.code);

    expect(results.correctId).toBe('track-1');
    expect(results.correctName).toBe('Test Song');
    expect(results.correctArtist).toBe('Test Artist');
    expect(results.albumArt).toBe('https://example.test/album.jpg');
    expect(results.playerResults).toHaveLength(2);
    expect(results.playerResults[0].isCorrect).toBe(true);

    vi.useRealTimers();
  });

  it('sanitizes player names on room creation', () => {
    const room = createRoom('host-1', '<script>alert("xss")</script>');
    // HTML tags and dangerous chars are removed
    expect(room.players[0].name).toBe('alert(xss)');
    expect(room.players[0].name).not.toContain('<');
    expect(room.players[0].name).not.toContain('>');
  });

  it('sanitizes player names on join', () => {
    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'player-2', '<img src=x onerror=alert(1)>');

    const player = room.players.find(p => p.id === 'player-2');
    // Empty after sanitization falls back to 'Player'
    expect(player.name).not.toContain('<');
    expect(player.name).not.toContain('>');
  });

  it('spectators cannot submit answers', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2025-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const room = createRoom('host-1', 'Host');
    joinRoom(room.code, 'spectator-1', 'Spectator', true);

    getQuizTracks.mockResolvedValue([
      {
        roundNumber: 1,
        previewUrl: 'https://example.test/preview.mp3',
        albumArt: '',
        correctId: 'track-1',
        correctName: 'Song',
        correctArtist: 'Artist',
        options: [{ id: 'track-1', name: 'Song', artist: 'Artist' }]
      }
    ]);

    await startGame(room.code);
    getCurrentRound(room.code);

    const result = submitAnswer(room.code, 'spectator-1', { answerId: 'track-1' });
    expect(result).toBeNull();

    vi.useRealTimers();
  });
});
