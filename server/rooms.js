// /home/aakas/couple-games/server/rooms.js

// Import needed utility at the top
import { generateRoomCode } from './utils/generateRoomCode.js';

// In-memory storage for rooms
const rooms = new Map(); // Map<roomCode, roomData>

const ROOM_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds
const SHORT_EXPIRY_TIME = 15 * 1000; // 15 seconds (grace period for navigation/reconnect)

// --- Helper ---
// Modified to accept optional duration
function resetRoomTimer(room, duration = ROOM_EXPIRY_TIME) {
    if (!room) return;
    clearTimeout(room.timer);
    // console.log(`Setting timer for room ${room.roomCode} (${duration}ms)`); // Optional: for debugging timers
    room.timer = setTimeout(() => expireRoom(room.roomCode), duration);
}

// --- Modified expireRoom ---
// Added a check before deleting to handle race conditions
function expireRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (room) {
        // Double-check if a player reconnected just before expiry
        const activePlayer = room.players.find(p => p.socketId !== null);
        if (activePlayer) {
 
            resetRoomTimer(room, ROOM_EXPIRY_TIME); // Reset to full timer
            return; // Don't expire
        }

        // Proceed with expiry if no active players found
        clearTimeout(room.timer); // Ensure timer is cleared before deleting
        rooms.delete(roomCode);
 
    } else {
        // console.log(`ExpireRoom called for non-existent room: ${roomCode}`); // Optional debug
    }
}


export function createRoom(initialSocketId) {
    const roomCode = generateRoomCode();
    const roomData = {
        roomCode,
        // Structure: Track player number, current socket, and joined status
        players: [
            { socketId: initialSocketId, playerNumber: 1, joinedGameScreen: false }, // Player 1 (creator)
            { socketId: null, playerNumber: 2, joinedGameScreen: false }           // Player 2 (placeholder)
        ],
        gameState: {
            gameType: null,
            currentChallenge: null,
            round: 0,
            history: [],
            turn: null, // Player number (1 or 2) whose turn it is
            gameOver: false,
        },
        createdAt: Date.now(),
        timer: null,
    };
    rooms.set(roomCode, roomData);
 
    resetRoomTimer(roomData, ROOM_EXPIRY_TIME); // Start expiry timer
    return roomData;
}

export function joinRoom(roomCode, socketId) {
    const room = rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };

    const player1 = room.players[0];
    const player2 = room.players[1];

    // Prevent creator joining as P2
    if (player1.socketId === socketId) {
        return { error: 'You cannot join your own room as Player 2.' };
    }

    // Check if P2 slot is filled by someone else
    if (player2.socketId && player2.socketId !== socketId) {
        return { error: 'Room is full' };
    }

    // Assign P2 if slot is empty or if it's the same P2 socket rejoining lobby
    if (!player2.socketId || player2.socketId === socketId) {
        player2.socketId = socketId;
        player2.joinedGameScreen = false; // Ensure flag is reset on lobby join/rejoin
        resetRoomTimer(room, ROOM_EXPIRY_TIME); // Reset expiry timer
 
        return { room };
    }

    // Should not be reached, but covers edge cases
    return { error: 'Failed to join room' };
}

export function getRoom(roomCode) {
    return rooms.get(roomCode);
}

export function getRoomBySocketId(socketId) {
    for (const room of rooms.values()) {
        // Check both player slots
        if (room.players[0]?.socketId === socketId || room.players[1]?.socketId === socketId) {
            return room;
        }
    }
    return null;
}

// Update socket ID when player connects from play.html
export function updatePlayerSocket(roomCode, playerNumber, newSocketId) {
    const room = rooms.get(roomCode);
    if (!room) return { error: 'Room not found during socket update' };

    const playerSlot = room.players.find(p => p.playerNumber === playerNumber);
    if (!playerSlot) return { error: `Player number ${playerNumber} not found in room ${roomCode}` };

 
    playerSlot.socketId = newSocketId;
    playerSlot.joinedGameScreen = true; // Mark as successfully joined the game screen
    resetRoomTimer(room, ROOM_EXPIRY_TIME); // *** Use full expiry time here ***
    return { room };
}

// Find player slot by original socket ID (less reliable) or player number
// Helps identify which player (1 or 2) is trying to join the game screen
export function findWaitingPlayerSlot(roomCode, newSocketId) {
    const room = rooms.get(roomCode);
    if (!room) return null;

    // Find the first player slot that hasn't joined the game screen yet
    // This assumes players join the game screen sequentially (P1 then P2, or P2 then P1)
    const waitingSlot = room.players.find(p => !p.joinedGameScreen);
    return waitingSlot; // Returns the player object { socketId: oldIdOrNull, playerNumber: X, joinedGameScreen: false } or null
}


// Modified removePlayer to handle disconnects gracefully during navigation
export function removePlayer(socketId) {
    for (const [roomCode, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.socketId === socketId);

        if (playerIndex !== -1) {
            const playerNumber = room.players[playerIndex].playerNumber;
 

            // Nullify socket and mark as not joined
            room.players[playerIndex].socketId = null;
            room.players[playerIndex].joinedGameScreen = false;

            const remainingPlayer = room.players.find(p => p.socketId !== null);

            if (!remainingPlayer) {
                // *** CHANGE: Don't expire immediately ***
                // Both players appear disconnected. Set a SHORT timer.
                // If they don't rejoin via joinGameRoom quickly, it will expire.
 
                resetRoomTimer(room, SHORT_EXPIRY_TIME); // Use short expiry
                // Indicate potentially empty, but room still exists for now
                return { roomCode, isEmpty: false, potentiallyEmpty: true };
            } else {
                // One player remains, reset timer to full duration
                resetRoomTimer(room, ROOM_EXPIRY_TIME); // Use full expiry
                return { roomCode, isEmpty: false, remainingPlayerId: remainingPlayer.socketId, disconnectedPlayerNumber: playerNumber };
            }
        }
    }
    return null; // Player not found in any room
}

export function updateGameState(roomCode, newState) {
    const room = rooms.get(roomCode);
    if (room) {
        // Merge the new state into the existing game state
        room.gameState = { ...room.gameState, ...newState };
        resetRoomTimer(room, ROOM_EXPIRY_TIME); // Reset expiry timer on activity
 
    } else {
        console.warn(`Attempted to update state for non-existent room: ${roomCode}`);
    }
}
