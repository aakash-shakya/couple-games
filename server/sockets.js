import { Server } from 'socket.io';
import {
  createRoom,
  joinRoom,
  getRoom,
  removePlayer,
  getRoomBySocketId,
  updateGameState,
  updatePlayerSocket,
  findWaitingPlayerSlot
} from './rooms.js';
import { generateChallenge } from './aiService.js';

const MAX_CHALLENGE_RETRIES = 2; // Max attempts to get a non-duplicate challenge

export function setupSocketHandlers(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*", // Restrict in production
      methods: ["GET", "POST"]
    }
  });

  // Helper function to get a unique challenge with retries
  async function getUniqueChallenge(roomCode, gameType, history, attempt = 1) {
 
    // Pass history and indicate if it's a retry attempt
    const newChallenge = await generateChallenge(gameType, history, attempt > 1);

    if (!newChallenge) {
      console.error(`Challenge generation failed completely for ${roomCode} after attempt ${attempt}.`);
      return "Error: Couldn't generate a challenge. Maybe tell your partner a secret?"; // Final fallback
    }

    // Check against recent history (e.g., last 7 items, matching MAX_HISTORY_FOR_PROMPT)
    const recentChallenges = history.slice(-7).map(h => h.challenge);
    if (recentChallenges.includes(newChallenge)) {
      console.warn(`Duplicate challenge detected: "${newChallenge}". Attempting retry ${attempt + 1}...`);
      if (attempt < MAX_CHALLENGE_RETRIES) {
        // Wait a tiny bit before retrying to avoid hammering API
        await new Promise(resolve => setTimeout(resolve, 150));
        return getUniqueChallenge(roomCode, gameType, history, attempt + 1);
      } else {
        console.error(`Max retries reached for ${roomCode}. Falling back to generic challenge.`);
        // Use a very generic static challenge as a last resort
        // Or return a specific error message challenge
        return "Couldn't find a unique challenge! Quick, share your favorite memory together!";
      }
    }

    // Unique challenge found
 
    return newChallenge;
  }

  io.on('connection', (socket) => {
 

    socket.on('createRoom', () => {
      try {
        const roomData = createRoom(socket.id);
        socket.join(roomData.roomCode);
        socket.emit('roomCreated', { roomCode: roomData.roomCode, playerNumber: 1 });
 
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit('error', { message: 'Failed to create room.' });
      }
    });

    socket.on('joinRoom', ({ roomCode }) => {
      try {
        const result = joinRoom(roomCode, socket.id);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }

        const room = result.room;
        socket.join(roomCode);
        socket.emit('joined', { roomCode: room.roomCode, playerNumber: 2 });
 

        if (room.players[0]?.socketId && room.players[1]?.socketId) {
 
          io.to(roomCode).emit('gameReady', { roomCode });
        }
      } catch (error) {
        console.error(`Error joining room ${roomCode}:`, error);
        socket.emit('error', { message: 'Failed to join room.' });
      }
    });

    socket.on('startGame', async ({ gameType }) => {
      const room = getRoomBySocketId(socket.id);

      if (!room) {
        return socket.emit('error', { message: 'Could not find your room.' });
      }
      if (room.players[0].socketId !== socket.id) {
        return socket.emit('error', { message: 'Only Player 1 can start the game.' });
      }
      if (!room.players[1].socketId) {
        return socket.emit('error', { message: 'Waiting for Player 2 to join.' });
      }
      if (room.players.some(p => p.joinedGameScreen)) {
        return socket.emit('error', { message: 'Game already in progress or starting.' });
      }

 
 

      updateGameState(room.roomCode, {
        gameType: gameType,
        round: 1,
        turn: 1,
        currentChallenge: "Loading first challenge...",
        gameOver: false,
        history: [],
        pendingTextConfirmation: false
      });

      const currentRoomState = getRoom(room.roomCode); // Get state *after* initial update
      try {
        const challenge = await getUniqueChallenge(room.roomCode, gameType, currentRoomState.gameState.history); // Use helper
        updateGameState(room.roomCode, { currentChallenge: challenge });
 
      } catch (error) {
        console.error(`Error during initial challenge fetch for ${room.roomCode}:`, error);
        updateGameState(room.roomCode, { currentChallenge: "Couldn't load challenge. Tell your partner something you appreciate!" });
        io.to(roomCode).emit('error', { message: 'Error loading first challenge.' });
      }

      io.to(room.roomCode).emit('gameStarted', { gameType });
 
    });

    socket.on('joinGameRoom', ({ roomCode }) => {
 
      const room = getRoom(roomCode);

      if (!room) {
 
        return socket.emit('error', { message: `Room ${roomCode} not found.` });
      }

      const playerSlot = findWaitingPlayerSlot(roomCode, socket.id);

      if (!playerSlot) {
        const alreadyJoinedPlayer = room.players.find(p => p.socketId === socket.id && p.joinedGameScreen);
        if (alreadyJoinedPlayer) {
 
          socket.join(roomCode);
          socket.emit('gameJoined', { playerNumber: alreadyJoinedPlayer.playerNumber, gameState: room.gameState });
          const otherPlayer = room.players.find(p => p.socketId !== socket.id && p.joinedGameScreen);
          if (otherPlayer && otherPlayer.socketId) {
            io.to(otherPlayer.socketId).emit('playerRejoined', { playerNumber: alreadyJoinedPlayer.playerNumber });
 
          }
          return;
        } else {
 
          return socket.emit('error', { message: 'Could not assign you to a player slot. Is the game full or already started?' });
        }
      }

      const playerNumber = playerSlot.playerNumber;
      const updateResult = updatePlayerSocket(roomCode, playerNumber, socket.id);
      if (updateResult.error) {
        console.error(`joinGameRoom: Error updating socket: ${updateResult.error}`);
        return socket.emit('error', { message: 'Failed to update connection status.' });
      }

      socket.join(roomCode);
 

      socket.emit('gameJoined', { playerNumber, gameState: room.gameState });

      const updatedRoom = getRoom(roomCode);
      if (updatedRoom.players.every(p => p.joinedGameScreen)) {
 
        io.to(roomCode).emit('gameStateUpdate', updatedRoom.gameState);
      } else {
 
      }
    });

    socket.on('sendTextAnswer', (answer) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
 
        io.to(receiver.socketId).emit('receiveTextAnswer', answer);
        updateGameState(room.roomCode, { pendingTextConfirmation: true });
 
      }
    });

    socket.on('sendReaction', async (reaction) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      if (!room.gameState.pendingTextConfirmation) {
 
        return;
      }

 
      updateGameState(room.roomCode, { pendingTextConfirmation: false });

      const player = room.players.find(p => p.socketId === socket.id);
      const opponent = room.players.find(p => p.socketId !== socket.id);
      if (!opponent) return;

      io.to(opponent.socketId).emit('receiveReaction', reaction);
 

      const nextTurnPlayerNumber = player.playerNumber;
      updateGameState(room.roomCode, {
        turn: nextTurnPlayerNumber,
        round: room.gameState.turn === 2 ? room.gameState.round + 1 : room.gameState.round,
        history: [...room.gameState.history, { player: opponent.playerNumber, challenge: room.gameState.currentChallenge }]
      });

      const updatedRoomForNextChallenge = getRoom(room.roomCode); // Get state *after* history update
      let nextChallenge = "Loading next challenge...";
      try {
        nextChallenge = await getUniqueChallenge(room.roomCode, updatedRoomForNextChallenge.gameState.gameType, updatedRoomForNextChallenge.gameState.history); // Use helper
      } catch (error) {
        console.error(`Error during next challenge fetch for ${room.roomCode}:`, error);
        io.to(room.roomCode).emit('error', { message: 'Error loading next challenge.' });
      }
      updateGameState(room.roomCode, { currentChallenge: nextChallenge });

      const updatedRoom = getRoom(room.roomCode);
      io.to(room.roomCode).emit('gameStateUpdate', updatedRoom.gameState);
 
    });

    socket.on('webcamStatus', (status) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
 
        io.to(receiver.socketId).emit('partnerWebcamStatus', status);
      }
    });

    socket.on('offer', ({ sdp }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
 
        io.to(receiver.socketId).emit('offer', { sdp });
      }
    });

    socket.on('answer', ({ sdp }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
 
        io.to(receiver.socketId).emit('answer', { sdp });
      }
    });

    socket.on('iceCandidate', ({ candidate }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
 
        io.to(receiver.socketId).emit('iceCandidate', { candidate });
      }
    });

    socket.on('completeTurn', async () => {
      const room = getRoomBySocketId(socket.id);
      if (!room || !room.gameState.currentChallenge || room.gameState.gameOver) {
        return socket.emit('error', { message: 'Game not active or turn invalid.' });
      }

      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) {
        return socket.emit('error', { message: 'Could not identify player.' });
      }

      if (room.gameState.turn !== player.playerNumber) {
        return socket.emit('error', { message: 'Not your turn.' });
      }

      if (room.gameState.pendingTextConfirmation) {
 
        return;
      }

 

      const opponent = room.players.find(p => p.playerNumber !== player.playerNumber);
      if (opponent && opponent.socketId) {
        io.to(opponent.socketId).emit('opponentActionCompleted');
      }

      const nextTurnPlayerNumber = opponent ? opponent.playerNumber : player.playerNumber;
      updateGameState(room.roomCode, {
        turn: nextTurnPlayerNumber,
        round: room.gameState.turn === 2 ? room.gameState.round + 1 : room.gameState.round,
        history: [...room.gameState.history, { player: player.playerNumber, challenge: room.gameState.currentChallenge }]
      });

      const updatedRoomForNextChallenge = getRoom(room.roomCode); // Get state *after* history update
      let nextChallenge = "Loading next challenge...";
      try {
        nextChallenge = await getUniqueChallenge(room.roomCode, updatedRoomForNextChallenge.gameState.gameType, updatedRoomForNextChallenge.gameState.history); // Use helper
      } catch (error) {
        console.error(`Error during next challenge fetch for ${room.roomCode}:`, error);
        io.to(room.roomCode).emit('error', { message: 'Error loading next challenge.' });
      }
      updateGameState(room.roomCode, { currentChallenge: nextChallenge });

      const updatedRoom = getRoom(room.roomCode);
      io.to(room.roomCode).emit('gameStateUpdate', updatedRoom.gameState);
 
    });

    // --- Typing Indicator Handlers ---
    socket.on('startTyping', () => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;
      const receiver = room.players.find(p => p.socketId !== socket.id);
      if (receiver && receiver.socketId) {
        // console.log(`Relaying startTyping from ${socket.id} to ${receiver.socketId}`); // Optional debug
        io.to(receiver.socketId).emit('partnerTyping');
      }
    });

    socket.on('stopTyping', () => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;
      const receiver = room.players.find(p => p.socketId !== socket.id);
      if (receiver && receiver.socketId) {
        // console.log(`Relaying stopTyping from ${socket.id} to ${receiver.socketId}`); // Optional debug
        io.to(receiver.socketId).emit('partnerStoppedTyping');
      }
    });
    // --- End Typing Indicator Handlers ---

    socket.on('disconnect', (reason) => {
 
      const result = removePlayer(socket.id);

      if (result && result.roomCode && !result.isEmpty) {
        const remainingPlayerSocketId = result.remainingPlayerId;
        const message = `Player ${result.disconnectedPlayerNumber} has disconnected. Waiting for them to rejoin...`;
        // Also notify the remaining player that the disconnected partner stopped typing
        io.to(remainingPlayerSocketId).emit('partnerStoppedTyping');
        io.to(remainingPlayerSocketId).emit('playerLeft', {
          message,
          disconnectedPlayerNumber: result.disconnectedPlayerNumber
        });
 
      } else if (result && result.isEmpty) {
 
      }
    });
  });

 
  return io;
}