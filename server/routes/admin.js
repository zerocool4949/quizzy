// Admin routes - edit movies.json / videogames.json, re-download clips

import { Router } from 'express';
import { unlinkSync } from 'fs';
import { warmMovieClips, getClipFilePath, slugify } from '../audioCache.js';
import { loadSoundtracks, saveSoundtracks } from '../soundtrackQuiz.js';

// Admin URL segment -> soundtrack mode
const ADMIN_TYPES = {
  movies: 'movie',
  videogames: 'videogame'
};

// Allows requests from an ADMIN_IPS address or carrying ADMIN_KEY
function requireAdmin(req, res, next) {
  const adminIps = (process.env.ADMIN_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  const key = req.query.key || req.headers['x-admin-key'];
  const ipAllowed = adminIps.includes(ip);
  const keyAllowed = process.env.ADMIN_KEY && key === process.env.ADMIN_KEY;
  if (!ipAllowed && !keyAllowed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const router = Router();
router.use(requireAdmin);

router.get('/:type', (req, res, next) => {
  const mode = ADMIN_TYPES[req.params.type];
  if (!mode) return next();
  res.json(loadSoundtracks(mode));
});

router.put('/:type', (req, res, next) => {
  const { type } = req.params;
  const mode = ADMIN_TYPES[type];
  if (!mode) return next();

  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  try {
    saveSoundtracks(mode, data);
    console.log(`[Admin] ${type}.json updated (${Object.keys(data).length} entries)`);
    res.json({ success: true, count: Object.keys(data).length });
    warmMovieClips(data).then(r => console.log(`[Admin] ${type} clips warm: ${r.downloaded} downloaded, ${r.failed} failed`));
  } catch (err) {
    console.error(`[Admin] Failed to save ${type}.json:`, err.message);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Re-download a clip (delete cached + re-warm)
router.post('/redownload', async (req, res) => {
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type or name' });
  const mode = ADMIN_TYPES[type];
  if (!mode) return res.status(400).json({ error: 'Invalid type' });
  const entry = loadSoundtracks(mode)[name];
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const track = entry.tracks?.[0];
  if (!track) return res.status(400).json({ error: 'No track' });
  const trackName = typeof track === 'string' ? track : track.name;
  const trackKey = typeof track === 'string' ? slugify(track) : (track.key || slugify(trackName));
  // Delete existing clip
  try { unlinkSync(getClipFilePath(name, trackKey)); } catch {}
  // Re-download
  const result = await warmMovieClips({ [name]: entry });
  console.log(`[Admin] Re-download ${name}: ${result.downloaded} downloaded, ${result.failed} failed`);
  res.json({ success: result.downloaded > 0, downloaded: result.downloaded, failed: result.failed });
});

export default router;
