// Soundtrack quiz generation (movie and video game modes)

import { readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureMovieClip, getClipUrl } from './audioCache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Per-mode config. Result keys (answerKey, correctFlag, summaryKey) are part of the client payload.
export const SOUNDTRACK_MODES = {
  movie: {
    file: 'movies.json',
    plural: 'movies',
    itunesEntity: 'movie',
    answerKey: 'correctMovie',
    correctFlag: 'movieCorrect',
    summaryKey: 'movie',
    logTag: 'MovieQuiz',
    progressPhase: 'Fetching movie soundtracks'
  },
  videogame: {
    file: 'videogames.json',
    plural: 'video games',
    itunesEntity: 'software',
    answerKey: 'correctGame',
    correctFlag: 'videogameCorrect',
    summaryKey: 'game',
    logTag: 'VideogameQuiz',
    progressPhase: 'Fetching video game soundtracks'
  }
};

export function isSoundtrackMode(mode) {
  return Object.hasOwn(SOUNDTRACK_MODES, mode);
}

// Fetch poster/cover art from iTunes (no API key needed)
async function fetchArtwork(name, year, entity) {
  try {
    const query = year ? `${name} ${year}` : name;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=${entity}&limit=3`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return '';

    const data = await response.json();

    // Prefer exact title match, fall back to first result
    const results = data.results || [];
    const normalizedName = name.toLowerCase();
    const match = results.find(r =>
      r.trackName?.toLowerCase() === normalizedName ||
      r.collectionName?.toLowerCase() === normalizedName
    ) || results[0];

    // Get higher resolution (replace 100x100 with 600x600)
    return match?.artworkUrl100 ? match.artworkUrl100.replace('100x100', '600x600') : '';
  } catch {
    // Silently fail - artwork is optional
    return '';
  }
}

const caches = {};

export function clearSoundtracksCache(mode) {
  delete caches[mode];
}

export function loadSoundtracks(mode) {
  if (caches[mode]) return caches[mode];

  const { file } = SOUNDTRACK_MODES[mode];
  try {
    caches[mode] = JSON.parse(readFileSync(join(__dirname, file), 'utf8'));
    return caches[mode];
  } catch (error) {
    console.error(`Failed to load ${file}:`, error.message);
    return {};
  }
}

// Write via temp file + rename so a crash mid-write can't corrupt the JSON
export function saveSoundtracks(mode, data) {
  const filePath = join(__dirname, SOUNDTRACK_MODES[mode].file);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
  clearSoundtracksCache(mode);
}

// Shuffle array in place
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Generate a simple ID from entry name
function entryId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function normalizeTrack(track) {
  if (typeof track === 'string') {
    return { name: track, key: track };
  }
  if (!track || typeof track !== 'object') {
    return { name: '', key: '' };
  }
  const name = track.name || track.title || '';
  return {
    name,
    key: track.key || name,
    search: track.search
  };
}

export async function getSoundtrackQuizTracks(mode, count = 10, onProgress = null, excludeIds = []) {
  const config = SOUNDTRACK_MODES[mode];
  const entries = loadSoundtracks(mode);
  const names = Object.keys(entries);

  if (names.length === 0) {
    throw new Error(`No ${config.plural} configured in ${config.file}`);
  }

  if (names.length < 2) {
    throw new Error(`Need at least 2 ${config.plural} for a quiz`);
  }

  // Filter out previously used entries if possible, otherwise allow repeats
  const excludeSet = new Set((excludeIds || []).map(id => String(id)));
  let namesToUse = names.filter(name => !excludeSet.has(entryId(name)));
  if (namesToUse.length < count) {
    if (excludeSet.size > 0) {
      console.log(`[${config.logTag}] Not enough fresh ${config.plural} (${namesToUse.length}/${count}), allowing repeats`);
    }
    namesToUse = names;
  }

  const shuffled = shuffle([...namesToUse]);
  const rounds = [];
  // Cap attempts so broken clips (e.g. yt-dlp failing) can't loop forever
  const maxAttempts = count + shuffled.length;

  for (let attempt = 0; attempt < maxAttempts && rounds.length < count; attempt++) {
    if (onProgress) {
      onProgress({ current: rounds.length + 1, total: count, phase: config.progressPhase });
    }

    // Cycle through entries
    const name = shuffled[attempt % shuffled.length];
    const entry = entries[name];
    const tracks = Array.isArray(entry.tracks) ? entry.tracks : [];
    const track = tracks.map(normalizeTrack).find(t => t.name && t.key);
    if (!track) {
      console.log(`[${config.logTag}] No tracks configured for: ${name}`);
      continue;
    }

    const searchQuery = track.search || `${entry.composer} ${track.name} ${name} soundtrack`;
    console.log(`[${config.logTag}] Clip: "${track.name}" from "${name}" (${entry.composer})`);

    try {
      await ensureMovieClip(name, track.key, searchQuery);
    } catch {
      // Skip this entry if no clip could be cached
      console.log(`[${config.logTag}] Could not cache clip for: ${track.name} (${name})`);
      continue;
    }

    const artwork = await fetchArtwork(name, entry.year, config.itunesEntity);

    rounds.push({
      roundNumber: rounds.length + 1,
      previewUrl: getClipUrl(name, track.key),
      albumArt: artwork,
      correctId: entryId(name),
      [config.answerKey]: name,
      correctTrack: track.name,
      correctComposer: entry.composer,
      correctYear: entry.year
    });
  }

  if (rounds.length === 0) {
    throw new Error('Could not generate any valid rounds. Check yt-dlp/ffmpeg availability.');
  }

  return rounds;
}
