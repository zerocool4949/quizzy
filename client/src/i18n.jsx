import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './locales/en.json';
import fr from './locales/fr.json';

const dictionaries = { en, fr };
const defaultLanguage = 'en';
const storageKey = 'quizzy-language';

const I18nContext = createContext(null);

function getNestedValue(source, key) {
  if (!source || !key) return null;
  return key.split('.').reduce((acc, part) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
      return acc[part];
    }
    return null;
  }, source);
}

function interpolate(value, vars) {
  if (!vars) return value;
  return Object.keys(vars).reduce((result, varKey) => {
    return result.replaceAll(`{${varKey}}`, String(vars[varKey]));
  }, value);
}

const serverErrorKeys = {
  'Room not found': 'errors.roomNotFound',
  'Game already in progress': 'errors.gameAlreadyInProgress',
  'Already in room': 'errors.alreadyInRoom',
  'Room is full (max 8 players)': 'errors.roomFull',
  'Cannot start game': 'errors.cannotStartGame',
  'Need at least 1 player': 'errors.needPlayer',
  'Playlist URL is required': 'errors.playlistUrlRequired',
  'Playlist has no tracks with artists': 'errors.playlistEmpty',
  'Playlist already imported': 'errors.playlistAlreadyImported',
  'Spotify not configured': 'errors.spotifyNotConfigured',
  'Invalid playlist URL or ID': 'errors.playlistUrlInvalid',
  'Playlist not found': 'errors.playlistNotFound',
  'Failed to fetch playlist': 'errors.playlistFetchFailed',
  'Failed to save playlist': 'errors.playlistSaveFailed',
  'Failed to delete playlist': 'errors.playlistDeleteFailed',
  'Can only delete imported playlists': 'errors.playlistDeleteDenied',
  'Only the host can manage playlists': 'errors.playlistHostOnly',
  'Too many requests, try again later': 'errors.tooManyRequests'
};

function normalizeLanguage(code) {
  if (!code) return defaultLanguage;
  const normalized = String(code).toLowerCase();
  if (dictionaries[normalized]) return normalized;
  const base = normalized.split('-')[0];
  return dictionaries[base] ? base : defaultLanguage;
}

function getInitialLanguage() {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(storageKey);
    if (stored) return normalizeLanguage(stored);
  }
  if (typeof navigator !== 'undefined') {
    return normalizeLanguage(navigator.language);
  }
  return defaultLanguage;
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => getInitialLanguage());

  const setLanguage = useCallback((next) => {
    setLanguageState(normalizeLanguage(next));
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, language);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);

  const t = useCallback((key, vars) => {
    const dictionary = dictionaries[language] || dictionaries[defaultLanguage];
    const value = getNestedValue(dictionary, key);
    if (typeof value === 'string') {
      return interpolate(value, vars);
    }
    return key;
  }, [language]);

  const tError = useCallback((message) => {
    if (!message) return '';
    const directKey = serverErrorKeys[message];
    if (directKey) return t(directKey);
    if (message.startsWith('Spotify API error:')) {
      const status = message.split(':').pop().trim();
      return t('errors.spotifyApi', { status });
    }
    return message;
  }, [t]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t,
    tError
  }), [language, setLanguage, t, tError]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
