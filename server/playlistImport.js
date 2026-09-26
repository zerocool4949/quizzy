// Import a Spotify playlist as a new category and cache its artists

import { importPlaylist } from './categories.js';
import { getPlaylist } from './spotify.js';
import { refreshArtists } from './cache-warmer.js';
import * as artistCache from './artistCache.js';

export async function importPlaylistFromUrl(url) {
  if (!url) {
    return { error: 'Playlist URL is required' };
  }

  // Fetch playlist from Spotify
  const playlist = await getPlaylist(url);

  if (playlist.error) {
    return { error: playlist.error };
  }

  if (playlist.artists.length === 0) {
    return { error: 'Playlist has no tracks with artists' };
  }

  const result = importPlaylist(playlist);

  if (result.error) {
    return { error: result.error };
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

  return { ...result, cachedArtists: cachedCount };
}
