// /home/aakas/couple-games/server/sockets.js

import { Server } from 'socket.io';
import {
    createRoom,
    joinRoom,
    getRoom,
    removePlayer,
    getRoomBySocketId,
    updateGameState,
    updatePlayerSocket, // <-- Import new function
    findWaitingPlayerSlot // <-- Import new function
} from './rooms.js';
import { generateChallenge } from './aiService.js';

export function setupSocketHandlers(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: "*", // Restrict in production
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);

        // Create Room
        socket.on('createRoom', () => {
            try {
                // createRoom now uses the new player structure
                const roomData = createRoom(socket.id);
                socket.join(roomData.roomCode);
                // Client side create.html expects playerNumber 1
                socket.emit('roomCreated', { roomCode: roomData.roomCode, playerNumber: 1 });
                console.log(`Socket ${socket.id} created and joined room ${roomData.roomCode} as Player 1`);
            } catch (error) {
                console.error("Error creating room:", error);
                socket.emit('error', { message: 'Failed to create room.' });
            }
        });

        // Join Room (Lobby)
        socket.on('joinRoom', ({ roomCode }) => {
            try {
                const result = joinRoom(roomCode, socket.id);
                if (result.error) {
                    socket.emit('error', { message: result.error });
                    return;
                }

                const room = result.room;
                socket.join(roomCode);
                // Player number is fixed (2) when joining successfully
                socket.emit('joined', { roomCode: room.roomCode, playerNumber: 2 });
                console.log(`Socket ${socket.id} joined room ${roomCode} as Player 2 (lobby)`);

                // Notify both players in the lobby that the game is ready to start
                if (room.players[0]?.socketId && room.players[1]?.socketId) {
                    console.log(`Room ${roomCode} is full. Notifying players to ready.`);
                    io.to(roomCode).emit('gameReady', { roomCode });
                }
            } catch (error) {
                console.error(`Error joining room ${roomCode}:`, error);
                socket.emit('error', { message: 'Failed to join room.' });
            }
        });

        // REMOVED 'getPlayerNumber' - This logic is now handled by 'joinGameRoom'

        // Start Game (Triggered by Player 1 from Lobby)
        socket.on('startGame', async ({ gameType }) => {
            // Find room by the current socket ID (should be Player 1)
            const room = getRoomBySocketId(socket.id);

            // Validate room and player status
            if (!room) {
                return socket.emit('error', { message: 'Could not find your room.' });
            }
            if (room.players[0].socketId !== socket.id) {
                return socket.emit('error', { message: 'Only Player 1 can start the game.' });
            }
            if (!room.players[1].socketId) { // Check if Player 2 exists in the lobby
                return socket.emit('error', { message: 'Waiting for Player 2 to join.' });
            }
            if (room.players.some(p => p.joinedGameScreen)) {
                // Avoid restarting if game screen already joined
                return socket.emit('error', { message: 'Game already in progress or starting.' });
            }

            console.log(`Attempting to start game type ${gameType} in room ${room.roomCode}`);
            console.log(`Lobby players: P1=${room.players[0].socketId}, P2=${room.players[1].socketId}`);

            // Set initial game state (Player 1 - index 0 - starts)
            updateGameState(room.roomCode, {
                gameType: gameType,
                round: 1,
                turn: 1, // Player number whose turn it is
                currentChallenge: "Loading first challenge...", // Placeholder
                gameOver: false,
                history: []
            });

            // Fetch first challenge asynchronously
            try {
                const challenge = await generateChallenge(gameType);
                updateGameState(room.roomCode, { currentChallenge: challenge });
                console.log(`First challenge for ${room.roomCode}: ${challenge}`);
            } catch (error) {
                console.error(`Failed to fetch initial challenge for ${room.roomCode}:`, error);
                updateGameState(room.roomCode, { currentChallenge: "Couldn't load challenge. Tell your partner something you appreciate!" });
                io.to(room.roomCode).emit('error', { message: 'Error loading first challenge.' });
            }

            // *** IMPORTANT: Only emit 'gameStarted' to trigger navigation ***
            // Do NOT emit 'yourTurn'/'opponentTurn' here. Wait for joinGameRoom.
            io.to(room.roomCode).emit('gameStarted', { gameType });
            console.log(`Emitted 'gameStarted' to room ${room.roomCode}. Clients should navigate.`);
        });

        // *** NEW HANDLER: Player connects from play.html ***
        socket.on('joinGameRoom', ({ roomCode }) => {
            console.log(`Socket ${socket.id} attempting to join GAME SCREEN for room ${roomCode}`);
            const room = getRoom(roomCode);

            if (!room) {
                console.log(`joinGameRoom: Room ${roomCode} not found for ${socket.id}.`);
                return socket.emit('error', { message: `Room ${roomCode} not found.` });
            }

            // Find which player slot this new socket belongs to
            // This relies on finding the player who hasn't joined the game screen yet
            const playerSlot = findWaitingPlayerSlot(roomCode, socket.id);

            if (!playerSlot) {
                // Maybe they are already joined, or both slots are somehow filled/marked joined
                // Check if this socket ID already matches a player marked as joined (reconnect case)
                const alreadyJoinedPlayer = room.players.find(p => p.socketId === socket.id && p.joinedGameScreen);
                if (alreadyJoinedPlayer) {
                    console.log(`Player ${alreadyJoinedPlayer.playerNumber} (${socket.id}) reconnected to game screen for room ${roomCode}`);
                    // Re-join Socket.IO room just in case
                    socket.join(roomCode);
                    // Send current state again
                    socket.emit('gameJoined', { playerNumber: alreadyJoinedPlayer.playerNumber, gameState: room.gameState });
                    return; // Already handled
                } else {
                    console.log(`joinGameRoom: Could not find waiting player slot for ${socket.id} in room ${roomCode}. State:`, room.players);
                    return socket.emit('error', { message: 'Could not assign you to a player slot. Is the game full or already started?' });
                }
            }

            const playerNumber = playerSlot.playerNumber;

            // Update the player's socket ID in the room data
            const updateResult = updatePlayerSocket(roomCode, playerNumber, socket.id);
            if (updateResult.error) {
                console.error(`joinGameRoom: Error updating socket: ${updateResult.error}`);
                return socket.emit('error', { message: 'Failed to update connection status.' });
            }

            // Join the Socket.IO room for broadcasts
            socket.join(roomCode);
            console.log(`Player ${playerNumber} (${socket.id}) successfully joined game screen for room ${roomCode}.`);

            // Send confirmation and initial state to the joining player
            socket.emit('gameJoined', { playerNumber, gameState: room.gameState });

            // Check if BOTH players are now on the game screen
            const updatedRoom = getRoom(roomCode); // Get fresh room data
            if (updatedRoom.players.every(p => p.joinedGameScreen)) {
                console.log(`Both players now on game screen for room ${roomCode}. Broadcasting initial state.`);
                // Now that both are connected, broadcast the definitive game state
                io.to(roomCode).emit('gameStateUpdate', updatedRoom.gameState);
            } else {
                console.log(`Player ${playerNumber} joined game screen. Waiting for Player ${playerNumber === 1 ? 2 : 1}.`);
            }
        });


        // Player Action -> Renamed to 'completeTurn' for clarity
        socket.on('completeTurn', async () => {
            const room = getRoomBySocketId(socket.id);
            if (!room || !room.gameState.currentChallenge || room.gameState.gameOver) {
                return socket.emit('error', { message: 'Game not active or turn invalid.' });
            }

            const player = room.players.find(p => p.socketId === socket.id);
            if (!player) {
                 return socket.emit('error', { message: 'Could not identify player.' });
            }

            // Ensure it's the player's turn
            if (room.gameState.turn !== player.playerNumber) {
                 return socket.emit('error', { message: 'Not your turn.' });
            }

            console.log(`Player ${player.playerNumber} (${socket.id}) completed turn in room ${room.roomCode}`);

            // Notify the opponent
            const opponent = room.players.find(p => p.playerNumber !== player.playerNumber);
            if (opponent && opponent.socketId) {
                io.to(opponent.socketId).emit('opponentActionCompleted'); // Notify opponent UI
            }

            // Advance turn
            const nextTurnPlayerNumber = opponent ? opponent.playerNumber : player.playerNumber; // Stay on current if opponent missing
            updateGameState(room.roomCode, {
                turn: nextTurnPlayerNumber,
                // Increment round only when Player 2 completes turn (or adjust as needed)
                round: room.gameState.turn === 2 ? room.gameState.round + 1 : room.gameState.round,
                history: [...room.gameState.history, { player: player.playerNumber, challenge: room.gameState.currentChallenge }] // Add to history
            });


            // Fetch next challenge
            let nextChallenge = "Loading next challenge...";
            try {
                nextChallenge = await generateChallenge(room.gameState.gameType);
            } catch (error) {
                console.error(`Failed to fetch next challenge for ${room.roomCode}:`, error);
                nextChallenge = "Challenge load error. Share a compliment!";
                io.to(room.roomCode).emit('error', { message: 'Error loading next challenge.' });
            }
            updateGameState(room.roomCode, { currentChallenge: nextChallenge });

            // Broadcast the new game state to BOTH players
            const updatedRoom = getRoom(room.roomCode); // Get the latest state
            io.to(room.roomCode).emit('gameStateUpdate', updatedRoom.gameState);
            console.log(`Emitted gameStateUpdate to room ${room.roomCode}. Next turn: Player ${nextTurnPlayerNumber}`);
        });


        // Disconnect
        socket.on('disconnect', (reason) => {
            console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
            // removePlayer now just nullifies socketId and joined flag
            const result = removePlayer(socket.id);

            if (result && result.roomCode && !result.isEmpty) {
                // Notify the remaining player
                const remainingPlayerSocketId = result.remainingPlayerId;
                const message = `Player ${result.disconnectedPlayerNumber} has disconnected. Waiting for them to rejoin...`;
                io.to(remainingPlayerSocketId).emit('playerLeft', { message });
                console.log(`Notified player ${remainingPlayerSocketId} in room ${result.roomCode} about disconnect.`);
                // Optional: Pause game by setting turn to null?
                // updateGameState(result.roomCode, { turn: null });
                // io.to(remainingPlayerSocketId).emit('gameStateUpdate', getRoom(result.roomCode).gameState);
            } else if (result && result.isEmpty) {
                console.log(`Room ${result.roomCode} is now empty and removed after disconnect.`);
            }
        });
    });

    console.log('Socket.IO handlers set up');
    return io;
}
