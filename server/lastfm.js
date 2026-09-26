// Last.fm API wrapper - fetches all-time top tracks by scrobbles
// Requires LASTFM_API_KEY in .env (free at https://www.last.fm/api/account/create)

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const FETCH_TIMEOUT_MS = 30000; // 30 second timeout

// Fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Check if Last.fm is configured
export function isConfigured() {
  return Boolean(LASTFM_API_KEY);
}

// Get all-time top tracks for an artist (ranked by total scrobbles)
// Returns: [{ name, artist, playcount }]
export async function getArtistTopTracks(artistName, limit = 10) {
  if (!LASTFM_API_KEY) {
    console.warn('LASTFM_API_KEY not set in .env');
    return [];
  }

  const url = `${BASE_URL}?method=artist.gettoptracks` +
    `&artist=${encodeURIComponent(artistName)}` +
    `&api_key=${LASTFM_API_KEY}` +
    `&format=json` +
    `&limit=${limit}`;

  try {
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.error) {
      console.log(`Last.fm error for "${artistName}": ${data.message}`);
      return [];
    }

    const tracks = data.toptracks?.track || [];

    return tracks.map(t => ({
      name: t.name,
      artist: t.artist?.name || artistName,
      playcount: parseInt(t.playcount) || 0
    }));
  } catch (error) {
    console.error(`Last.fm fetch error for "${artistName}":`, error.message);
    return [];
  }
}

// Search for artist info (useful for validation)
export async function getArtistInfo(artistName) {
  if (!LASTFM_API_KEY) {
    return null;
  }

  const url = `${BASE_URL}?method=artist.getinfo` +
    `&artist=${encodeURIComponent(artistName)}` +
    `&api_key=${LASTFM_API_KEY}` +
    `&format=json`;

  try {
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.error) {
      return null;
    }

    const artist = data.artist;
    return {
      name: artist?.name || artistName,
      listeners: parseInt(artist?.stats?.listeners) || 0,
      playcount: parseInt(artist?.stats?.playcount) || 0
    };
  } catch {
    return null;
  }
}
