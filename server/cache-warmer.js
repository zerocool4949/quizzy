#!/usr/bin/env node
// Cache Warmer - Background refresh for missing/stale artists on startup
// Reads artists from categories.json and imported-playlists.json
// Non-blocking: queues refresh in background, doesn't delay server startup
// Thread-safe: concurrent imports queue artists instead of duplicating work
//
// CLI Usage:
//   node cache-warmer.js                    # Refresh missing/stale artists
//   node cache-warmer.js --stats            # Show cache statistics
//   node cache-warmer.js --artist "Stromae" # Refresh single artist
//   node cache-warmer.js --refresh          # Force refresh all artists

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import * as artistCache from './artistCache.js';
import * as lastfm from './lastfm.js';
import * as spotify from './spotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CATEGORIES_PATH = join(__dirname, 'categories.json');
const IMPORTED_PATH = join(__dirname, 'imported-playlists.json');
const CACHE_STALENESS_DAYS = 90;

// Concurrency control
const inProgress = new Set();           // Artists currently being fetched
const waiting = new Map();              // artist -> [resolve callbacks] for waiters

// Load all artists from categories and imported playlists
function getAllArtists() {
  const artists = new Set();

  // Load from categories.json
  try {
    if (existsSync(CATEGORIES_PATH)) {
      const categories = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf-8'));
      for (const category of Object.values(categories)) {
        for (const artist of category.artists || []) {
          artists.add(artist);
        }
      }
    }
  } catch (err) {
    console.error('[Cache Warmer] Failed to load categories.json:', err.message);
  }

  // Load from imported-playlists.json
  try {
    if (existsSync(IMPORTED_PATH)) {
      const playlists = JSON.parse(readFileSync(IMPORTED_PATH, 'utf-8'));
      for (const playlist of Object.values(playlists)) {
        for (const artist of playlist.artists || []) {
          artists.add(artist);
        }
      }
    }
  } catch (err) {
    console.error('[Cache Warmer] Failed to load imported-playlists.json:', err.message);
  }

  return Array.from(artists);
}

// Get cache status
export function getCacheStatus() {
  const allArtists = getAllArtists();
  const cachedArtists = artistCache.getCachedArtists();
  const cachedSet = new Set(cachedArtists);

  const missing = allArtists.filter(a => !cachedSet.has(a));
  const stale = allArtists.filter(a =>
    cachedSet.has(a) && artistCache.isStale(a, CACHE_STALENESS_DAYS)
  );
  const fresh = allArtists.filter(a =>
    cachedSet.has(a) && !artistCache.isStale(a, CACHE_STALENESS_DAYS)
  );

  return {
    total: allArtists.length,
    cached: cachedArtists.length,
    fresh: fresh.length,
    missing: missing.length,
    stale: stale.length,
    missingArtists: missing,
    staleArtists: stale
  };
}

// Fetch and cache tracks for a single artist (internal, no lock)
async function doFetchArtistTracks(artistName, limit = 10) {
  // Try Last.fm first
  if (lastfm.isConfigured()) {
    const tracks = await lastfm.getArtistTopTracks(artistName, limit);
    if (tracks.length > 0) {
      const formatted = tracks.map(t => ({
        name: t.name,
        playcount: t.playcount || null,
        spotifyId: null
      }));
      artistCache.saveArtistTracks(artistName, formatted, 'lastfm');
      return { source: 'lastfm', count: formatted.length };
    }
  }

  // Fallback to Spotify
  const spotifyId = await spotify.searchArtistId(artistName);
  if (spotifyId) {
    const spotifyTracks = await spotify.getArtistTopTracks(spotifyId, limit);
    if (spotifyTracks.length > 0) {
      const formatted = spotifyTracks.map(t => ({
        name: spotify.cleanTitle(t.name),
        playcount: null,
        spotifyId: t.id?.replace('spotify-', '') || null
      }));
      artistCache.saveArtistTracks(artistName, formatted, 'spotify');
      return { source: 'spotify', count: formatted.length };
    }
  }

  return null;
}

// Fetch artist with lock - prevents duplicate concurrent fetches
async function fetchArtistTracks(artistName, limit = 10) {
  // If already in progress, wait for it to complete
  if (inProgress.has(artistName)) {
    console.log(`[Cache] Waiting for ${artistName} (already in progress)`);
    return new Promise(resolve => {
      const waiters = waiting.get(artistName) || [];
      waiters.push(resolve);
      waiting.set(artistName, waiters);
    });
  }

  // Mark as in progress
  inProgress.add(artistName);

  try {
    const result = await doFetchArtistTracks(artistName, limit);

    // Notify all waiters
    const waiters = waiting.get(artistName) || [];
    for (const resolve of waiters) {
      resolve(result);
    }
    waiting.delete(artistName);

    return result;
  } finally {
    inProgress.delete(artistName);
  }
}

// Refresh a list of artists (with rate limiting)
export async function refreshArtists(artistNames, options = {}) {
  const { onProgress, limit = 10 } = options;
  const results = { success: 0, failed: 0, artists: [] };

  for (let i = 0; i < artistNames.length; i++) {
    const artist = artistNames[i];

    try {
      const result = await fetchArtistTracks(artist, limit);

      if (result) {
        results.success++;
        results.artists.push({ name: artist, ...result });
      } else {
        results.failed++;
        results.artists.push({ name: artist, error: 'No tracks found' });
      }
    } catch (err) {
      results.failed++;
      results.artists.push({ name: artist, error: err.message });
    }

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: artistNames.length,
        artist,
        success: results.success,
        failed: results.failed
      });
    }

    // Rate limiting: 200ms between requests
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

// Warm cache on startup (non-blocking)
export async function warmCache() {
  console.log('[Cache Warmer] Starting cache check...');

  // Get all valid artists and prune deleted ones
  const allArtists = getAllArtists();
  const pruned = artistCache.pruneArtists(allArtists);

  if (pruned.length > 0) {
    console.log(`[Cache Warmer] Pruned ${pruned.length} deleted artists`);
  }

  // Check status
  const status = getCacheStatus();
  console.log(`[Cache Warmer] Status: ${status.fresh}/${status.total} fresh, ${status.missing} missing, ${status.stale} stale`);

  if (status.missing === 0 && status.stale === 0) {
    console.log('[Cache Warmer] All artists are fresh');
    return;
  }

  // Queue background refresh (non-blocking)
  const toRefresh = [...status.missingArtists, ...status.staleArtists];
  console.log(`[Cache Warmer] Queueing ${toRefresh.length} artists for background refresh`);

  // Run in background using setTimeout (non-blocking)
  setTimeout(async () => {
    console.log('[Cache Warmer] Starting background refresh...');

    const results = await refreshArtists(toRefresh, {
      onProgress: (p) => {
        if (p.current % 10 === 0 || p.current === p.total) {
          console.log(`[Cache Warmer] Progress: ${p.current}/${p.total} (${p.success} success, ${p.failed} failed)`);
        }
      }
    });

    console.log(`[Cache Warmer] Background refresh complete: ${results.success} success, ${results.failed} failed`);
  }, 1000); // Small delay to let server finish starting
}

// ============ CLI Support ============

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    artist: null,
    refresh: false,
    stats: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--artist':
        options.artist = args[++i];
        break;
      case '--refresh':
        options.refresh = true;
        break;
      case '--stats':
        options.stats = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Cache Warmer CLI
================

Manages the artist track cache (Last.fm with Spotify fallback).

Usage:
  node cache-warmer.js [options]

Options:
  --stats             Show cache statistics and exit
  --artist "Name"     Refresh single artist
  --refresh           Force refresh all artists (ignore staleness)
  --help, -h          Show this help message

Examples:
  node cache-warmer.js                      # Refresh missing/stale only
  node cache-warmer.js --stats              # Check cache status
  node cache-warmer.js --artist "Stromae"   # Refresh one artist
  node cache-warmer.js --refresh            # Force refresh everything
`);
}

function showStats() {
  console.log('Cache Statistics');
  console.log('================\n');

  const cacheStats = artistCache.getCacheStats();
  console.log(`Total cached:  ${cacheStats.totalArtists}`);
  console.log(`From Last.fm:  ${cacheStats.lastfmCount}`);
  console.log(`From Spotify:  ${cacheStats.spotifyCount}`);

  const status = getCacheStatus();
  console.log(`\nIn categories: ${status.total}`);
  console.log(`Fresh:         ${status.fresh}`);
  console.log(`Stale:         ${status.stale}`);
  console.log(`Missing:       ${status.missing}`);

  console.log('\nAPI Configuration:');
  console.log(`  Last.fm: ${lastfm.isConfigured() ? '✓ Configured' : '✗ Not configured (set LASTFM_API_KEY)'}`);
}

async function runCli() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  if (options.stats) {
    showStats();
    return;
  }

  console.log('Cache Warmer');
  console.log('============\n');

  if (!lastfm.isConfigured()) {
    console.warn('Warning: LASTFM_API_KEY not set, will use Spotify only\n');
  }

  // Single artist mode
  if (options.artist) {
    console.log(`Refreshing: ${options.artist}`);
    const result = await fetchArtistTracks(options.artist);
    if (result) {
      console.log(`  ✓ ${result.count} tracks from ${result.source}`);
    } else {
      console.log(`  ✗ No tracks found`);
    }
    return;
  }

  // Prune deleted artists
  const allArtists = getAllArtists();
  const pruned = artistCache.pruneArtists(allArtists);
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} deleted artists\n`);
  }

  // Determine what to refresh
  let toRefresh;
  if (options.refresh) {
    toRefresh = allArtists;
    console.log(`Force refreshing all ${toRefresh.length} artists\n`);
  } else {
    const status = getCacheStatus();
    toRefresh = [...status.missingArtists, ...status.staleArtists];
    console.log(`Found ${allArtists.length} artists (${status.fresh} fresh, ${status.missing} missing, ${status.stale} stale)\n`);

    if (toRefresh.length === 0) {
      console.log('All artists are fresh!');
      return;
    }
    console.log(`Refreshing ${toRefresh.length} artists...\n`);
  }

  // Refresh with progress
  const results = await refreshArtists(toRefresh, {
    onProgress: (p) => {
      const status = p.success > 0 ? '✓' : '✗';
      console.log(`  ${status} ${p.artist}`);
    }
  });

  console.log('\n' + '='.repeat(30));
  console.log(`Done: ${results.success} success, ${results.failed} failed`);
}

// Run CLI if executed directly
const isMain = process.argv[1]?.includes('cache-warmer');
if (isMain) {
  runCli().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
