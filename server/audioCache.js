import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AUDIO_DIR = join(__dirname, 'data', 'audio');
const CLIP_SECONDS = 20;
const CLIP_START = 30;
const CLIP_CONCURRENCY = 2;
const CLIP_START_PERCENT = 0.3;
const YT_DLP_ARGS = [
  '--js-runtimes', 'node',
  '--remote-components', 'ejs:github'
];

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ensureAudioDir() {
  mkdirSync(AUDIO_DIR, { recursive: true });
}

function getBaseUrl() {
  if (process.env.SERVER_URL) return process.env.SERVER_URL;
  return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';
}

export function getMovieClipSeconds() {
  return CLIP_SECONDS;
}

export function getClipFileName(movieName, trackKey) {
  const movieSlug = slugify(movieName);
  const trackSlug = slugify(trackKey);
  return `${movieSlug}__${trackSlug}.mp3`;
}

export function getClipFilePath(movieName, trackKey) {
  return join(AUDIO_DIR, getClipFileName(movieName, trackKey));
}

export function getClipUrl(movieName, trackKey) {
  return `${getBaseUrl()}/audio/${getClipFileName(movieName, trackKey)}`;
}

export function hasClip(movieName, trackKey) {
  const filePath = getClipFilePath(movieName, trackKey);
  try {
    return statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function safeUnlink(filePath) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stdout.trim());
      return reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function getDurationSeconds(filePath) {
  const output = await runCommandCapture('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);
  const duration = parseFloat(output);
  return Number.isFinite(duration) ? duration : null;
}

function computeClipStart(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return CLIP_START;
  if (durationSeconds <= CLIP_SECONDS) return 0;

  const percentStart = Math.floor(durationSeconds * CLIP_START_PERCENT);
  const minStart = 20;
  const unclamped = Math.max(minStart, percentStart);
  const maxStart = Math.max(0, Math.floor(durationSeconds - CLIP_SECONDS));
  return Math.min(unclamped, maxStart);
}

function findDownloadedFile(tempBase) {
  const dir = dirname(tempBase);
  const prefix = tempBase.split(/[\\/]/).pop();
  const matches = readdirSync(dir).filter(name => name.startsWith(prefix));
  if (!matches.length) return null;
  return join(dir, matches[0]);
}

async function downloadClip(movieName, trackKey, query) {
  ensureAudioDir();
  const outputPath = getClipFilePath(movieName, trackKey);
  const tempBase = join(AUDIO_DIR, `tmp-${slugify(movieName)}-${slugify(trackKey)}-${Date.now()}`);
  const template = `${tempBase}.%(ext)s`;

  await runCommand('yt-dlp', [
    '--no-playlist',
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '-o', template,
    ...YT_DLP_ARGS,
    `ytsearch1:${query}`
  ]);

  const downloaded = findDownloadedFile(tempBase);
  if (!downloaded) {
    throw new Error('yt-dlp did not produce an output file');
  }

  try {
    let startAt = CLIP_START;
    try {
      const duration = await getDurationSeconds(downloaded);
      startAt = computeClipStart(duration);
    } catch {
      startAt = CLIP_START;
    }

    await runCommand('ffmpeg', [
      '-y',
      '-ss', String(startAt),
      '-t', String(CLIP_SECONDS),
      '-i', downloaded,
      '-acodec', 'libmp3lame',
      '-b:a', '192k',
      outputPath
    ]);
  } finally {
    safeUnlink(downloaded);
  }

  return outputPath;
}

export async function ensureMovieClip(movieName, trackKey, query) {
  if (!trackKey) throw new Error('Missing track key');
  if (hasClip(movieName, trackKey)) {
    return { status: 'cached', filePath: getClipFilePath(movieName, trackKey) };
  }

  await downloadClip(movieName, trackKey, query);
  return { status: 'downloaded', filePath: getClipFilePath(movieName, trackKey) };
}

export async function warmMovieClips(movies) {
  if (!movies || Object.keys(movies).length === 0) {
    return { total: 0, cached: 0, downloaded: 0, failed: 0 };
  }

  ensureAudioDir();

  const queue = [];
  for (const [movieName, movie] of Object.entries(movies)) {
    const composer = movie?.composer || '';
    const tracks = Array.isArray(movie?.tracks) ? movie.tracks : [];
    if (tracks.length === 0) continue;
    const track = tracks[0];
    {
      if (!track) continue;
      const name = typeof track === 'string' ? track : track.name;
      const key = typeof track === 'string' ? slugify(track) : (track.key || slugify(name));
      if (!name || !key) return;
      const query = (typeof track === 'object' && track.search)
        ? track.search
        : `${composer} ${name} ${movieName} soundtrack`;
      queue.push({ movieName, trackKey: key, query });
    }
  }

  const total = queue.length;
  let processed = 0;
  let cached = 0;
  let downloaded = 0;
  let failed = 0;

  const workers = Array.from({ length: Math.min(CLIP_CONCURRENCY, queue.length) }, () => (
    (async function worker() {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;
        try {
          const result = await ensureMovieClip(next.movieName, next.trackKey, next.query);
          processed++;
          if (result.status === 'cached') {
            cached++;
            console.log(`[Movie Clips] ${processed}/${total} cached: ${next.movieName} - ${next.trackKey}`);
          }
          if (result.status === 'downloaded') {
            downloaded++;
            console.log(`[Movie Clips] ${processed}/${total} downloaded: ${next.movieName} - ${next.trackKey}`);
          }
        } catch (error) {
          processed++;
          failed++;
          console.error(`[Movie Clips] ${processed}/${total} failed: ${next.movieName} - ${next.trackKey}: ${error.message}`);
        }
      }
    })()
  ));

  await Promise.all(workers);

  return { total: cached + downloaded + failed, cached, downloaded, failed };
}

function loadMoviesLocal() {
  try {
    const data = readFileSync(join(__dirname, 'movies.json'), 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function normalizeTrackLocal(track) {
  if (typeof track === 'string') return { name: track, key: track };
  if (!track || typeof track !== 'object') return { name: '', key: '' };
  const name = track.name || track.title || '';
  return { name, key: track.key || name };
}

function getExpectedClips(movies) {
  const expected = new Set();
  for (const [movieName, movie] of Object.entries(movies)) {
    const tracks = Array.isArray(movie?.tracks) ? movie.tracks : [];
    if (tracks.length === 0) continue;
    const track = normalizeTrackLocal(tracks[0]);
    if (!track.key) continue;
    expected.add(getClipFileName(movieName, track.key));
  }
  return expected;
}

export function pruneUnusedClips(movies) {
  ensureAudioDir();
  const expected = getExpectedClips(movies);
  const files = readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));

  let pruned = 0;
  for (const file of files) {
    if (!expected.has(file)) {
      const filePath = join(AUDIO_DIR, file);
      try {
        unlinkSync(filePath);
        console.log(`[Audio Prune] Removed: ${file}`);
        pruned++;
      } catch (err) {
        console.error(`[Audio Prune] Failed to remove ${file}: ${err.message}`);
      }
    }
  }
  return { total: files.length, pruned, kept: files.length - pruned };
}

export function getCacheStats(movies) {
  ensureAudioDir();
  const expected = getExpectedClips(movies);
  const files = readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  const fileSet = new Set(files);

  let cached = 0;
  let missing = 0;
  let orphaned = 0;
  let totalSize = 0;

  for (const file of expected) {
    if (fileSet.has(file)) {
      cached++;
      try {
        totalSize += statSync(join(AUDIO_DIR, file)).size;
      } catch {}
    } else {
      missing++;
    }
  }

  for (const file of files) {
    if (!expected.has(file)) {
      orphaned++;
      try {
        totalSize += statSync(join(AUDIO_DIR, file)).size;
      } catch {}
    }
  }

  return {
    movies: Object.keys(movies).length,
    cached,
    missing,
    orphaned,
    totalFiles: files.length,
    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
  };
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const movies = loadMoviesLocal();

  if (args.includes('--stats')) {
    const stats = getCacheStats(movies);
    console.log('\n📊 Movie Audio Cache Stats:');
    console.log(`   Movies in JSON:  ${stats.movies}`);
    console.log(`   Clips cached:    ${stats.cached}`);
    console.log(`   Clips missing:   ${stats.missing}`);
    console.log(`   Orphaned clips:  ${stats.orphaned}`);
    console.log(`   Total files:     ${stats.totalFiles}`);
    console.log(`   Total size:      ${stats.totalSizeMB} MB\n`);
    return;
  }

  if (args.includes('--prune')) {
    console.log('\n🧹 Pruning unused clips...');
    const result = pruneUnusedClips(movies);
    console.log(`   Pruned: ${result.pruned}, Kept: ${result.kept}\n`);
    return;
  }

  if (args.includes('--warm') || args.length === 0) {
    console.log('\n🎬 Warming movie clips...');
    const result = await warmMovieClips(movies);
    console.log(`   Cached: ${result.cached}, Downloaded: ${result.downloaded}, Failed: ${result.failed}\n`);
    return;
  }

  console.log(`
Usage: node server/audioCache.js [options]

Options:
  --warm    Download missing clips (default)
  --prune   Remove clips not in movies.json
  --stats   Show cache statistics
`);
}

// Run CLI if executed directly
if (process.argv[1]?.includes('audioCache')) {
  main().catch(console.error);
}
