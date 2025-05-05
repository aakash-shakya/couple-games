import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { setupSocketHandlers } from './sockets.js';

// Load environment variables
dotenv.config();

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Setup Socket.IO
const io = setupSocketHandlers(server); // Pass the server instance

const PORT = process.env.PORT || 3000;

// Serve static files from the 'client' directory
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// Basic route for root - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Optional: Explicit routes for other HTML pages if needed
app.get('/join', (req, res) => {
  res.sendFile(path.join(clientPath, 'join.html'));
});
app.get('/create', (req, res) => {
  res.sendFile(path.join(clientPath, 'create.html'));
});
app.get('/play/:roomCode', (req, res) => {
    // You might want to validate the roomCode here before serving
    res.sendFile(path.join(clientPath, 'play.html'));
});


server.listen(PORT, () => {
 
 
});
