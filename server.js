import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { setupWebSocket } from './src/broadcast.js';
import { bootstrap, startRealtimeSync } from './src/supabase.js';
import './src/cloudinary.js'; // Initialiseer Cloudinary
import { appPasswordAuth } from './src/middleware.js';

import missionsRouter from './src/routes/missions.js';
import teamsRouter    from './src/routes/teams.js';
import uploadsRouter  from './src/routes/uploads.js';
import quizRouter     from './src/routes/quiz.js';
import adminRouter    from './src/routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = http.createServer(app);
setupWebSocket(server);

app.use(express.json());
app.use(appPasswordAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', missionsRouter);
app.use('/api', teamsRouter);
app.use('/api', uploadsRouter);
app.use('/api', quizRouter);
app.use('/api', adminRouter);

const PORT = process.env.PORT || 3000;

async function start() {
  await bootstrap();
  startRealtimeSync();
  server.listen(PORT, () =>
    console.log(`🚀 Barcelona Stadsspel op http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin.html`),
  );
}

start();
