import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const GameContext = createContext(null);

// In production, connect to same origin. In dev, use localhost:3001
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const initialState = {
  playerId: null,
  roomCode: null,
  players: [],
  isHost: false,
  isSpectator: false,
  playerName: '',
  gameState: 'idle', // idle, lobby, loading, countdown, playing, roundEnd, finished
  currentRound: null,
  roundResults: null,
  gameResults: null,
  myAnswer: null,
  answerResult: null,
  loadingProgress: null,
  error: null,
  roomSettings: null, // Settings shared by host
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'SET_PLAYER_ID':
      return { ...state, playerId: action.payload };
    case 'SET_PLAYER_NAME':
      return { ...state, playerName: action.payload };
    case 'ROOM_CREATED':
      return {
        ...state,
        roomCode: action.payload.code,
        players: action.payload.players,
        isHost: action.payload.isHost,
        isSpectator: false,
        gameState: 'lobby',
        error: null,
      };
    case 'ROOM_JOINED':
      return {
        ...state,
        roomCode: action.payload.code,
        players: action.payload.players,
        isHost: action.payload.isHost,
        isSpectator: action.payload.isSpectator || false,
        gameState: action.payload.gameState === 'playing' ? 'playing' : 'lobby',
        error: null,
      };
    case 'PLAYER_JOINED':
    case 'PLAYER_LEFT': {
      const currentPlayer = state.playerId ? action.payload.players.find(p => p.id === state.playerId) : null;
      return {
        ...state,
        players: action.payload.players,
        isHost: currentPlayer?.isHost ?? state.isHost,
        isSpectator: currentPlayer?.role === 'spectator' ?? state.isSpectator,
      };
    }
    case 'ROLE_SWITCHED':
      return {
        ...state,
        isSpectator: action.payload.role === 'spectator',
      };
    case 'GAME_LOADING':
      return { ...state, gameState: 'loading', loadingProgress: action.payload };
    case 'GAME_STARTING':
      return { ...state, gameState: 'countdown' };
    case 'NEW_ROUND':
      return {
        ...state,
        gameState: 'playing',
        currentRound: action.payload,
        myAnswer: null,
        answerResult: null,
      };
    case 'SUBMIT_ANSWER':
      return { ...state, myAnswer: action.payload };
    case 'ANSWER_RESULT':
      return { ...state, answerResult: action.payload };
    case 'ROUND_END':
      // Update players with their latest scores from round results
      const updatedPlayers = state.players.map(player => {
        const result = action.payload.playerResults?.find(r => r.id === player.id);
        return result ? { ...player, score: result.score, streak: result.streak } : player;
      });
      return {
        ...state,
        gameState: 'roundEnd',
        roundResults: action.payload,
        players: updatedPlayers,
      };
    case 'GAME_OVER':
      return {
        ...state,
        gameState: 'finished',
        gameResults: action.payload,
      };
    case 'ROOM_RESET':
      return {
        ...state,
        gameState: 'lobby',
        players: action.payload.players,
        currentRound: null,
        roundResults: null,
        gameResults: null,
        myAnswer: null,
        answerResult: null,
        roomSettings: null,
      };
    case 'SETTINGS_UPDATED':
      return { ...state, roomSettings: action.payload };
    case 'ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'RESET':
      return { ...initialState, playerName: state.playerName, isSpectator: false };
    default:
      return state;
  }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const socketRef = useRef(null);
  const pendingJoinRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      dispatch({ type: 'SET_PLAYER_ID', payload: socket.id });
      // Process any pending join request
      if (pendingJoinRef.current) {
        const { code, playerName, asSpectator } = pendingJoinRef.current;
        pendingJoinRef.current = null;
        socket.emit('join-room', { code: code.toUpperCase(), playerName, asSpectator });
      }
    });

    socket.on('room-created', (data) => {
      dispatch({ type: 'ROOM_CREATED', payload: data });
      navigate(`/lobby/${data.code}`);
    });

    socket.on('room-joined', (data) => {
      dispatch({ type: 'ROOM_JOINED', payload: data });
      navigate(`/lobby/${data.code}`);
    });

    socket.on('join-error', (data) => {
      dispatch({ type: 'ERROR', payload: data.message });
    });

    socket.on('player-joined', (data) => {
      dispatch({ type: 'PLAYER_JOINED', payload: data });
    });

    socket.on('player-left', (data) => {
      dispatch({ type: 'PLAYER_LEFT', payload: data });
    });

    socket.on('game-loading', (data) => {
      dispatch({ type: 'GAME_LOADING', payload: data });
    });

    socket.on('game-starting', () => {
      dispatch({ type: 'GAME_STARTING' });
    });

    socket.on('new-round', (data) => {
      console.log('Received new-round:', data);
      dispatch({ type: 'NEW_ROUND', payload: data });
    });

    socket.on('answer-result', (data) => {
      dispatch({ type: 'ANSWER_RESULT', payload: data });
    });

    socket.on('round-end', (data) => {
      dispatch({ type: 'ROUND_END', payload: data });
    });

    socket.on('game-over', (data) => {
      dispatch({ type: 'GAME_OVER', payload: data });
    });

    socket.on('room-reset', (data) => {
      dispatch({ type: 'ROOM_RESET', payload: data });
    });

    socket.on('game-error', (data) => {
      dispatch({ type: 'ERROR', payload: data.message });
    });

    socket.on('settings-updated', (data) => {
      dispatch({ type: 'SETTINGS_UPDATED', payload: data });
    });

    socket.on('role-switched', (data) => {
      dispatch({ type: 'ROLE_SWITCHED', payload: data });
    });

    socket.on('switch-role-error', (data) => {
      dispatch({ type: 'ERROR', payload: data.message });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Navigate on state changes
  useEffect(() => {
    if ((state.gameState === 'loading' || state.gameState === 'countdown' || state.gameState === 'playing') && state.roomCode) {
      navigate(`/game/${state.roomCode}`);
    } else if (state.gameState === 'lobby' && state.roomCode) {
      navigate(`/lobby/${state.roomCode}`);
    }
  }, [state.gameState, state.roomCode]);

  const createRoom = useCallback((playerName) => {
    dispatch({ type: 'SET_PLAYER_NAME', payload: playerName });
    socketRef.current?.emit('create-room', { playerName });
  }, []);

  const joinRoom = useCallback((code, playerName, asSpectator = false) => {
    dispatch({ type: 'SET_PLAYER_NAME', payload: playerName });
    if (socketRef.current?.connected) {
      socketRef.current.emit('join-room', { code: code.toUpperCase(), playerName, asSpectator });
    } else {
      // Queue the join request for when socket connects
      pendingJoinRef.current = { code, playerName, asSpectator };
    }
  }, []);

  const switchRole = useCallback(() => {
    socketRef.current?.emit('switch-role');
  }, []);

  const updateSettings = useCallback((settings) => {
    socketRef.current?.emit('update-settings', settings);
  }, []);

  // Emit with acknowledgement; resolves to the server's response
  const emitWithAck = useCallback((event, payload) => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve({ error: 'Not connected' });
    return socket.timeout(60000).emitWithAck(event, payload)
      .catch(() => ({ error: 'Request timed out' }));
  }, []);

  const importPlaylist = useCallback((url) => emitWithAck('import-playlist', { url }), [emitWithAck]);

  const deletePlaylist = useCallback((categoryId) => emitWithAck('delete-playlist', { categoryId }), [emitWithAck]);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start-game');
  }, []);

  const submitAnswer = useCallback((answerId) => {
    dispatch({ type: 'SUBMIT_ANSWER', payload: answerId });
    socketRef.current?.emit('submit-answer', { answerId });
  }, []);

  const submitTypedAnswer = useCallback((_, text) => {
    socketRef.current?.emit('submit-answer', { text });
  }, []);

  const playAgain = useCallback(() => {
    socketRef.current?.emit('play-again');
  }, []);

  const leaveGame = useCallback(() => {
    socketRef.current?.emit('leave-room');
    dispatch({ type: 'RESET' });
    navigate('/');
  }, [navigate]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  return (
    <GameContext.Provider
      value={{
        ...state,
        createRoom,
        joinRoom,
        switchRole,
        updateSettings,
        importPlaylist,
        deletePlaylist,
        startGame,
        submitAnswer,
        submitTypedAnswer,
        playAgain,
        leaveGame,
        clearError,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}
