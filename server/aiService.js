import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

const MAX_HISTORY_FOR_PROMPT = 7; // Limit history items sent in the prompt

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("⚠️ GEMINI_API_KEY not found in .env file. AI features will be disabled.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
// Updated model name
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) : null;

// Simple static fallback challenges
const staticChallenges = {
  basic: [
    "What's one small thing your partner does that always makes you smile?",
    "Share your favorite memory of just the two of you.",
    "What are you most grateful for about your partner today?",
    "Describe your partner in three positive words.",
    "What's a future dream you share together?",
  ],
  fun: [
    "Dare: Try to make your partner laugh in the next 60 seconds.",
    "Truth: What's the most embarrassing thing you've done in front of your partner?",
    "Dare: Serenade your partner with the first song that comes to mind (even if it's silly).",
    "Truth: If you could swap lives for a day, what's the first thing you'd do?",
    "Dare: Give your partner a compliment using only gestures.",
  ],
  spicy: [
    "Truth: What's something you find incredibly attractive about your partner?",
    "Dare: Describe your ideal romantic evening together.",
    "Truth: What's a fantasy you've thought about sharing with your partner?",
    "Dare: Send your partner a flirty text message right now.",
    "Truth: Where is your favorite place to be kissed?",
  ],
};

function getRandomStaticChallenge(gameType = 'basic', history = []) {
  const type = staticChallenges[gameType] ? gameType : 'basic';
  const typeChallenges = staticChallenges[type];
  const recentChallenges = history.slice(-MAX_HISTORY_FOR_PROMPT).map(h => h.challenge); // Use same limit for consistency

  let availableChallenges = typeChallenges.filter(challenge => !recentChallenges.includes(challenge));

  if (availableChallenges.length === 0) {
    console.warn(`No unique static challenges left for type ${gameType}, reusing...`);
    availableChallenges = typeChallenges; // Fallback to full list if all used recently
  }
  return availableChallenges[Math.floor(Math.random() * availableChallenges.length)];
}


export async function generateChallenge(gameType = 'basic', history = [], isRetry = false) {
  if (!model) {
    console.log("AI Service disabled. Using static challenge.");
    return getRandomStaticChallenge(gameType);
  }

  const promptMap = {
    basic: "Generate ONLY the text for one sweet and romantic question OR a simple activity command directed from one long-distance partner to the other. Format as a direct question ('What do you...') or command ('Tell me...'). Do NOT include labels or introductory text. Example output: What's one small thing I do that makes you feel most loved?",
    fun: "Generate ONLY the text for one playful, flirty, or funny 'truth or dare' style challenge directed from one long-distance partner to the other (must be doable remotely). Format as a direct question ('What is your...') or command ('Show me...'). Do NOT include labels or introductory text. Example output: Describe your current surroundings to me using only animal sounds.",
    spicy: "Generate ONLY the text for one direct romantic/spicy question (truth) OR a direct command (dare) directed from one long-distance partner to the other, focusing on connection, sexual desire, or preferences. Keep it tasteful but intriguing and spicy hot sexual. Do NOT include labels or introductory text. Example output: Describe your most vivid sensual fantasy involving me."
  };

  let fullPrompt = promptMap[gameType] || promptMap['basic'];

  // Add limited history context if available
  const recentHistory = history.slice(-MAX_HISTORY_FOR_PROMPT);
  if (recentHistory.length > 0) {
    const historyText = recentHistory.map((item, index) => `${index + 1}. ${item.challenge}`).join('\n');
    fullPrompt += `\n\n---\nCONTEXT: Avoid generating challenges similar in topic or format to these recent ones:\n${historyText}\n---`;
  }
  if (isRetry) {
    fullPrompt += "\n\nPlease ensure the new challenge is significantly different from the previous ones provided in the context.";
  }

  try {
    console.log(`Requesting ${gameType} challenge from AI (Retry: ${isRetry})...`);
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0.7,
      },
    });

    const response = await result.response; // Access response correctly
    const text = response.text().trim(); // Get text content

    if (!text) {
      console.warn("AI returned empty content, falling back to static.");
      return getRandomStaticChallenge(gameType, history); // Pass history to static fallback
    }
    console.log(`AI generated: ${text}`);
    return text;
  } catch (err) {
    // Log the specific error from the API if available
    console.error("Gemini generation failed:", err.message || err);
    if (err.response && err.response.data) {
      console.error("API Error Details:", err.response.data);
    }
    console.log("Falling back to static challenge.");
    return getRandomStaticChallenge(gameType, history); // Pass history to static fallback
  }
}
