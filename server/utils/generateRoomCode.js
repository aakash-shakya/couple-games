import { customAlphabet } from 'nanoid';

// Generates a secure, URL-friendly, 8-character room code
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nanoid = customAlphabet(alphabet, 8);

export function generateRoomCode() {
  return nanoid();
}
