// Spotify API wrapper - fallback when Deezer fails
// Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

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

let accessToken = null;
let tokenExpiry = 0;
let tokenPromise = null; // Prevents parallel token fetches

// Get access token using client credentials flow
async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (accessToken && Date.now() < tokenExpiry - 60000) {
    return accessToken;
  }

  // If a fetch is already in progress, wait for it
  if (tokenPromise) {
    return tokenPromise;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('Spotify credentials not configured');
    return null;
  }

  // Start fetching and store the promise
  tokenPromise = (async () => {
    try {
      const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        },
        body: 'grant_type=client_credentials'
      });

      if (!response.ok) {
        console.error('Spotify auth failed:', response.status);
        return null;
      }

      const data = await response.json();
      accessToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in * 1000);

      console.log('Spotify token acquired, expires in', data.expires_in, 'seconds');
      return accessToken;
    } catch (error) {
      console.error('Spotify auth error:', error.message);
      return null;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

function isRemixTitle(title) {
  return /\bremix\b/i.test(String(title || ''));
}

// Map Spotify track to our internal format
function mapTrack(track) {
  const artistNames = (track.artists || []).map(a => a.name).filter(Boolean);
  return {
    id: `spotify-${track.id}`,
    name: track.name,
    artist: artistNames.join(' & ') || '',
    artists: artistNames,
    previewUrl: track.preview_url,
    albumArt: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? ''
  };
}

// Map Spotify track metadata (keep even without preview)
function mapTrackMeta(track) {
  const artistNames = (track.artists || []).map(a => a.name).filter(Boolean);
  return {
    id: `spotify-${track.id}`,
    name: track.name,
    artist: artistNames.join(' & ') || '',
    artists: artistNames,
    previewUrl: track.preview_url,
    albumArt: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? '',
    year: track.album?.release_date ? String(track.album.release_date).slice(0, 4) : null
  };
}

// Search for tracks
export async function searchTracks(query, limit = 50) {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) {
      console.log(`Spotify search error for "${query}": ${response.status}`);
      return [];
    }

    const data = await response.json();

    return (data.tracks?.items || [])
      .filter(track => track.preview_url) // Only tracks with previews
      .filter(track => !isRemixTitle(track.name))
      .map(mapTrack);
  } catch (error) {
    console.log(`Spotify search error for "${query}":`, error?.message ?? error);
    return [];
  }
}

// Search for tracks with metadata (does not require preview_url)
export async function searchTracksMeta(query, limit = 50) {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) {
      console.log(`Spotify search error for "${query}": ${response.status}`);
      return [];
    }

    const data = await response.json();

    return (data.tracks?.items || [])
      .filter(track => !isRemixTitle(track.name))
      .map(mapTrackMeta);
  } catch (error) {
    console.log(`Spotify search error for "${query}":`, error?.message ?? error);
    return [];
  }
}

// Search for artist ID
export async function searchArtistId(artistName) {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.artists?.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// Get top tracks for an artist
export async function getArtistTopTracks(artistId, limit = 10) {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    // Spotify requires a market parameter for top tracks
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!response.ok) return [];

    const data = await response.json();

    return (data.tracks || [])
      .filter(track => track.preview_url)
      .slice(0, limit)
      .map(mapTrack);
  } catch {
    return [];
  }
}

// Check if Spotify is configured and working
export async function isAvailable() {
  const token = await getAccessToken();
  return token !== null;
}

// Extract playlist ID from Spotify URL or ID
function extractPlaylistId(input) {
  if (!input) return null;

  // Already a plain ID
  if (/^[a-zA-Z0-9]{22}$/.test(input)) {
    return input;
  }

  // URL format: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
  const urlMatch = input.match(/playlist\/([a-zA-Z0-9]{22})/);
  if (urlMatch) return urlMatch[1];

  // Spotify URI: spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]{22})/);
  if (uriMatch) return uriMatch[1];

  return null;
}

// Fetch playlist details and tracks from Spotify
export async function getPlaylist(playlistIdOrUrl) {
  const token = await getAccessToken();
  if (!token) return { error: 'Spotify not configured' };

  const playlistId = extractPlaylistId(playlistIdOrUrl);
  if (!playlistId) {
    return { error: 'Invalid playlist URL or ID' };
  }

  try {
    // Get playlist metadata
    const playlistRes = await fetchWithTimeout(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!playlistRes.ok) {
      if (playlistRes.status === 404) return { error: 'Playlist not found' };
      return { error: `Spotify API error: ${playlistRes.status}` };
    }

    const playlist = await playlistRes.json();

    // Extract unique artists from playlist tracks
    const artistSet = new Set();
    for (const item of playlist.tracks?.items || []) {
      const track = item.track;
      if (track?.artists?.[0]?.name) {
        artistSet.add(track.artists[0].name);
      }
    }

    // If playlist has more tracks, fetch them (Spotify paginates at 100)
    let nextUrl = playlist.tracks?.next;
    while (nextUrl) {
      const nextRes = await fetchWithTimeout(nextUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!nextRes.ok) break;

      const nextData = await nextRes.json();
      for (const item of nextData.items || []) {
        const track = item.track;
        if (track?.artists?.[0]?.name) {
          artistSet.add(track.artists[0].name);
        }
      }
      nextUrl = nextData.next;
    }

    return {
      id: playlistId,
      name: playlist.name,
      description: playlist.description || '',
      imageUrl: playlist.images?.[0]?.url || '',
      owner: playlist.owner?.display_name || 'Unknown',
      trackCount: playlist.tracks?.total || 0,
      artists: Array.from(artistSet)
    };
  } catch (error) {
    console.error('Spotify playlist fetch error:', error.message);
    return { error: 'Failed to fetch playlist' };
  }
}

// Get Spotify track ID for an artist + track name
export async function getTrackId(artist, trackName) {
  const token = await getAccessToken();
  if (!token) return null;

  const query = `track:${trackName} artist:${artist}`;

  try {
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.tracks?.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// Get release year for a track using Spotify search
export async function getTrackYear(artist, trackName) {
  const token = await getAccessToken();
  if (!token) return null;

  const safeArtist = String(artist || '').trim();
  const safeTrack = String(trackName || '').trim();
  if (!safeArtist || !safeTrack) return null;

  const query = `track:${safeTrack} artist:${safeArtist}`;

  try {
    const response = await fetchWithTimeout(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const releaseDate = data.tracks?.items?.[0]?.album?.release_date;
    return releaseDate ? String(releaseDate).slice(0, 4) : null;
  } catch {
    return null;
  }
}
