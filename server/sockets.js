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
    console.log(`Attempt ${attempt} to get unique challenge for ${roomCode}. History size: ${history.length}`);
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
    console.log(`Unique challenge obtained for ${roomCode}: "${newChallenge}"`);
    return newChallenge;
  }

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', () => {
      try {
        const roomData = createRoom(socket.id);
        socket.join(roomData.roomCode);
        socket.emit('roomCreated', { roomCode: roomData.roomCode, playerNumber: 1 });
        console.log(`Socket ${socket.id} created and joined room ${roomData.roomCode} as Player 1`);
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
        console.log(`Socket ${socket.id} joined room ${roomCode} as Player 2 (lobby)`);

        if (room.players[0]?.socketId && room.players[1]?.socketId) {
          console.log(`Room ${roomCode} is full. Notifying players to ready.`);
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

      console.log(`Attempting to start game type ${gameType} in room ${room.roomCode}`);
      console.log(`Lobby players: P1=${room.players[0].socketId}, P2=${room.players[1].socketId}`);

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
        console.log(`First challenge for ${room.roomCode}: ${challenge}`);
      } catch (error) {
        console.error(`Error during initial challenge fetch for ${room.roomCode}:`, error);
        updateGameState(room.roomCode, { currentChallenge: "Couldn't load challenge. Tell your partner something you appreciate!" });
        io.to(roomCode).emit('error', { message: 'Error loading first challenge.' });
      }

      io.to(room.roomCode).emit('gameStarted', { gameType });
      console.log(`Emitted 'gameStarted' to room ${room.roomCode}. Clients should navigate.`);
    });

    socket.on('joinGameRoom', ({ roomCode }) => {
      console.log(`Socket ${socket.id} attempting to join GAME SCREEN for room ${roomCode}`);
      const room = getRoom(roomCode);

      if (!room) {
        console.log(`joinGameRoom: Room ${roomCode} not found for ${socket.id}.`);
        return socket.emit('error', { message: `Room ${roomCode} not found.` });
      }

      const playerSlot = findWaitingPlayerSlot(roomCode, socket.id);

      if (!playerSlot) {
        const alreadyJoinedPlayer = room.players.find(p => p.socketId === socket.id && p.joinedGameScreen);
        if (alreadyJoinedPlayer) {
          console.log(`Player ${alreadyJoinedPlayer.playerNumber} (${socket.id}) reconnected to game screen for room ${roomCode}`);
          socket.join(roomCode);
          socket.emit('gameJoined', { playerNumber: alreadyJoinedPlayer.playerNumber, gameState: room.gameState });
          const otherPlayer = room.players.find(p => p.socketId !== socket.id && p.joinedGameScreen);
          if (otherPlayer && otherPlayer.socketId) {
            io.to(otherPlayer.socketId).emit('playerRejoined', { playerNumber: alreadyJoinedPlayer.playerNumber });
            console.log(`Notified Player ${otherPlayer.playerNumber} of Player ${alreadyJoinedPlayer.playerNumber} reconnection in room ${roomCode}`);
          }
          return;
        } else {
          console.log(`joinGameRoom: Could not find waiting player slot for ${socket.id} in room ${roomCode}. State:`, room.players);
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
      console.log(`Player ${playerNumber} (${socket.id}) successfully joined game screen for room ${roomCode}.`);

      socket.emit('gameJoined', { playerNumber, gameState: room.gameState });

      const updatedRoom = getRoom(roomCode);
      if (updatedRoom.players.every(p => p.joinedGameScreen)) {
        console.log(`Both players now on game screen for room ${roomCode}. Broadcasting initial state.`);
        io.to(roomCode).emit('gameStateUpdate', updatedRoom.gameState);
      } else {
        console.log(`Player ${playerNumber} joined game screen. Waiting for Player ${playerNumber === 1 ? 2 : 1}.`);
      }
    });

    socket.on('sendTextAnswer', (answer) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
        console.log(`Relaying text answer from P${sender.playerNumber} to P${receiver.playerNumber} in room ${room.roomCode}`);
        io.to(receiver.socketId).emit('receiveTextAnswer', answer);
        updateGameState(room.roomCode, { pendingTextConfirmation: true });
        console.log(`Set pendingTextConfirmation to true for room ${room.roomCode}`);
      }
    });

    socket.on('sendReaction', async (reaction) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      if (!room.gameState.pendingTextConfirmation) {
        console.log(`Received sendReaction but no pending confirmation in room ${room.roomCode}`);
        return;
      }

      console.log(`Player sent reaction ${reaction} in room ${room.roomCode}`);
      updateGameState(room.roomCode, { pendingTextConfirmation: false });

      const player = room.players.find(p => p.socketId === socket.id);
      const opponent = room.players.find(p => p.socketId !== socket.id);
      if (!opponent) return;

      io.to(opponent.socketId).emit('receiveReaction', reaction);
      console.log(`Relayed reaction ${reaction} to P${opponent.playerNumber} in room ${room.roomCode}`);

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
      console.log(`Emitted gameStateUpdate to room ${room.roomCode} after reaction. Next turn: Player ${nextTurnPlayerNumber}`);
    });

    socket.on('webcamStatus', (status) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
        console.log(`Relaying webcam status (${status.active}) from P${sender.playerNumber} to P${receiver.playerNumber} in room ${room.roomCode}`);
        io.to(receiver.socketId).emit('partnerWebcamStatus', status);
      }
    });

    socket.on('offer', ({ sdp }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
        console.log(`Relaying WebRTC offer from P${sender.playerNumber} to P${receiver.playerNumber} in room ${room.roomCode}`);
        io.to(receiver.socketId).emit('offer', { sdp });
      }
    });

    socket.on('answer', ({ sdp }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
        console.log(`Relaying WebRTC answer from P${sender.playerNumber} to P${receiver.playerNumber} in room ${room.roomCode}`);
        io.to(receiver.socketId).emit('answer', { sdp });
      }
    });

    socket.on('iceCandidate', ({ candidate }) => {
      const room = getRoomBySocketId(socket.id);
      if (!room) return;

      const sender = room.players.find(p => p.socketId === socket.id);
      const receiver = room.players.find(p => p.socketId !== socket.id);

      if (sender && receiver && receiver.socketId) {
        console.log(`Relaying WebRTC ICE candidate from P${sender.playerNumber} to P${receiver.playerNumber} in room ${room.roomCode}`);
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
        console.log(`Turn completion delayed for room ${room.roomCode}: Waiting for reaction.`);
        return;
      }

      console.log(`Player ${player.playerNumber} (${socket.id}) completed turn in room ${room.roomCode}`);

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
      console.log(`Emitted gameStateUpdate to room ${room.roomCode}. Next turn: Player ${nextTurnPlayerNumber}`);
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
      console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
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
        console.log(`Notified player ${remainingPlayerSocketId} in room ${result.roomCode} about disconnect.`);
      } else if (result && result.isEmpty) {
        console.log(`Room ${result.roomCode} is now empty and removed after disconnect.`);
      }
    });
  });

  console.log('Socket.IO handlers set up');
  return io;
}