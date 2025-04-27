// In-memory storage for rooms
// In a production scenario, consider using Redis or another persistent store
const rooms = new Map(); // Map<roomCode, roomData>

const ROOM_EXPIRY_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds

export function createRoom(socketId) {
  const roomCode = generateRoomCode();
  const roomData = {
    roomCode,
    players: [socketId], // Store socket IDs
    gameState: {
      gameType: null,
      currentChallenge: null,
      round: 0,
      history: [],
      turn: 0, // Index of the player whose turn it is
    },
    createdAt: Date.now(),
    timer: null, // To store the expiry timer
  };
  rooms.set(roomCode, roomData);
  console.log(`Room created: ${roomCode}`);
  // Start expiry timer
  roomData.timer = setTimeout(() => expireRoom(roomCode), ROOM_EXPIRY_TIME);
  return roomData;
}

export function joinRoom(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) {
    return { error: 'Room not found' };
  }
  if (room.players.length >= 2) {
    return { error: 'Room is full' };
  }
  if (room.players.includes(socketId)) {
    return { error: 'Already in room' }; // Should ideally not happen
  }

  room.players.push(socketId);
  // Reset expiry timer since there's activity
  clearTimeout(room.timer);
  room.timer = setTimeout(() => expireRoom(roomCode), ROOM_EXPIRY_TIME);
  console.log(`Player ${socketId} joined room ${roomCode}`);
  return { room };
}

export function getRoom(roomCode) {
  return rooms.get(roomCode);
}

export function getRoomBySocketId(socketId) {
    for (const [roomCode, room] of rooms.entries()) {
        if (room.players.includes(socketId)) {
            return room;
        }
    }
    return null;
}


export function removePlayer(socketId) {
  for (const [roomCode, room] of rooms.entries()) {
    const playerIndex = room.players.indexOf(socketId);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      console.log(`Player ${socketId} removed from room ${roomCode}`);
      // If room becomes empty, expire it immediately
      if (room.players.length === 0) {
        expireRoom(roomCode);
        return { roomCode, isEmpty: true };
      } else {
         // Reset expiry timer if one player remains
         clearTimeout(room.timer);
         room.timer = setTimeout(() => expireRoom(roomCode), ROOM_EXPIRY_TIME);
         return { roomCode, isEmpty: false, remainingPlayerId: room.players[0] };
      }
    }
  }
  return null; // Player not found in any room
}

export function updateGameState(roomCode, newState) {
    const room = rooms.get(roomCode);
    if (room) {
        room.gameState = { ...room.gameState, ...newState };
        // Reset expiry timer on activity
        clearTimeout(room.timer);
        room.timer = setTimeout(() => expireRoom(roomCode), ROOM_EXPIRY_TIME);
    }
}


function expireRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room) {
    clearTimeout(room.timer); // Clear timer just in case
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} expired and removed.`);
    // Optionally notify players if they are still somehow connected
    // io.to(roomCode).emit('roomExpired');
  }
}

// Import needed utility at the top
import { generateRoomCode } from './utils/generateRoomCode.js';
