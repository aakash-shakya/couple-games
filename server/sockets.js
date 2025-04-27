import { Server } from 'socket.io';
import { createRoom, joinRoom, getRoom, removePlayer, getRoomBySocketId, updateGameState } from './rooms.js';
import { generateChallenge } from './aiService.js';

export function setupSocketHandlers(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*", // Allow all origins for simplicity in dev, restrict in production
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create Room
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

    // Join Room
    socket.on('joinRoom', ({ roomCode }) => {
      try {
        const result = joinRoom(roomCode, socket.id);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }

        const room = result.room;
        socket.join(roomCode);
        socket.emit('joined', { roomCode: room.roomCode, playerNumber: room.players.length });
        console.log(`Socket ${socket.id} joined room ${roomCode} as Player ${room.players.length}`);

        // Notify both players that the game can start
        if (room.players.length === 2) {
           console.log(`Room ${roomCode} is full. Notifying players.`);
           io.to(roomCode).emit('gameReady', { roomCode });
        }
      } catch (error) {
        console.error(`Error joining room ${roomCode}:`, error);
        socket.emit('error', { message: 'Failed to join room.' });
      }
    });

    // Start Game
    socket.on('startGame', async ({ gameType }) => {
        const room = getRoomBySocketId(socket.id);
        if (!room || room.players.length !== 2) {
            socket.emit('error', { message: 'Cannot start game. Need two players.' });
            return;
        }
        if (room.players[0] !== socket.id) {
             socket.emit('error', { message: 'Only Player 1 can start the game.' });
             return;
        }

        console.log(`Starting game type ${gameType} in room ${room.roomCode}`);
        updateGameState(room.roomCode, { gameType: gameType, round: 1, turn: 0 }); // Player 1 starts

        // Fetch first challenge
        const challenge = await generateChallenge(gameType);
        updateGameState(room.roomCode, { currentChallenge: challenge });

        io.to(room.roomCode).emit('gameStarted', { gameType });
        // Send the first challenge, indicating whose turn it is
        io.to(room.players[0]).emit('yourTurn', { challenge });
        io.to(room.players[1]).emit('opponentTurn', { challenge });
    });

    // Player Action (e.g., completed dare, answered truth)
    socket.on('playerAction', async ({ action }) => {
        const room = getRoomBySocketId(socket.id);
        if (!room || !room.gameState.currentChallenge) {
            socket.emit('error', { message: 'Game not active or no challenge pending.' });
            return;
        }

        // Basic validation: ensure it's the player's turn
        const currentPlayerIndex = room.gameState.turn;
        if (room.players[currentPlayerIndex] !== socket.id) {
             socket.emit('error', { message: 'Not your turn.' });
             return;
        }

        console.log(`Player ${socket.id} performed action: ${action} in room ${room.roomCode}`);
        // Notify opponent about the action (optional, depending on game flow)
        const opponentSocketId = room.players.find(pId => pId !== socket.id);
        if (opponentSocketId) {
            io.to(opponentSocketId).emit('opponentAction', { action });
        }

        // Advance turn and fetch next challenge
        const nextTurnIndex = (currentPlayerIndex + 1) % 2;
        const nextPlayerSocketId = room.players[nextTurnIndex];
        updateGameState(room.roomCode, { turn: nextTurnIndex, round: room.gameState.round + 0.5 }); // Increment half round per turn

        const challenge = await generateChallenge(room.gameState.gameType);
        updateGameState(room.roomCode, { currentChallenge: challenge });

        // Send new challenge to the next player
        io.to(nextPlayerSocketId).emit('yourTurn', { challenge });
        io.to(socket.id).emit('opponentTurn', { challenge }); // Notify current player it's now opponent's turn
    });


    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      const result = removePlayer(socket.id);
      if (result && result.roomCode && !result.isEmpty) {
        // Notify the remaining player
        io.to(result.remainingPlayerId).emit('playerLeft', { message: 'Your partner has disconnected.' });
        console.log(`Notified player ${result.remainingPlayerId} in room ${result.roomCode} about disconnect.`);
      } else if (result && result.isEmpty) {
          console.log(`Room ${result.roomCode} is now empty and has been removed.`);
      }
    });
  });

  console.log('Socket.IO handlers set up');
  return io; // Return io instance if needed elsewhere
}
