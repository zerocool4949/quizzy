import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCategoryList } from './music.js';
import { warmCache } from './cache-warmer.js';
import { warmMovieClips } from './audioCache.js';
import { loadSoundtracks } from './soundtrackQuiz.js';
import adminRouter from './routes/admin.js';
import { registerSocketHandlers } from './sockets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ quiet: true });

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Warm cache on startup (non-blocking)
warmCache().catch(err => console.error('[Cache Warmer] Error:', err.message));
for (const [mode, label] of [['movie', 'Movie'], ['videogame', 'Videogame']]) {
  warmMovieClips(loadSoundtracks(mode))
    .then((stats) => {
      console.log(`[${label} Clips] Ready. total=${stats.total} cached=${stats.cached} downloaded=${stats.downloaded} failed=${stats.failed}`);
    })
    .catch(err => console.error(`[${label} Clips] Error:`, err.message));
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());
app.use('/audio', express.static(path.join(__dirname, 'data', 'audio')));

// Get available categories from categories.json
app.get('/api/categories', (_req, res) => {
  res.json(getCategoryList());
});

app.use('/api/admin', adminRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

registerSocketHandlers(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
