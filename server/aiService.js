import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("⚠️ GEMINI_API_KEY not found in .env file. AI features will be disabled.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-pro" }) : null;

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

function getRandomStaticChallenge(gameType = 'basic') {
    const type = staticChallenges[gameType] ? gameType : 'basic';
    const challenges = staticChallenges[type];
    return challenges[Math.floor(Math.random() * challenges.length)];
}


export async function generateChallenge(gameType = 'basic') {
  if (!model) {
      console.log("AI Service disabled. Using static challenge.");
      return getRandomStaticChallenge(gameType);
  }

  const promptMap = {
    basic: "Generate a sweet, romantic question or simple activity for a couple playing a game. Keep it light and positive. Example: What's your favorite shared memory?",
    fun: "Generate a playful, flirty, or funny 'truth or dare' style challenge for a couple. Keep it lighthearted. Example: Dare: Impersonate your partner for 30 seconds.",
    spicy: "Generate a tasteful but spicy or intimate question or challenge for a couple in a romantic game. Avoid explicit language but encourage connection and flirtation. Example: Truth: What's something your partner does that secretly turns you on?"
  };

  const prompt = promptMap[gameType] || promptMap['basic'];

  try {
    console.log(`Requesting ${gameType} challenge from AI...`);
    const result = await model.generateContent(prompt);
    // Adjust based on actual Gemini API response structure
     const response = await result.response;
     const text = response.text().trim();

    if (!text) {
        throw new Error("No content generated");
    }
    console.log(`AI generated: ${text}`);
    return text;
  } catch (err) {
    console.error("Gemini generation failed:", err.message);
    console.log("Falling back to static challenge.");
    return getRandomStaticChallenge(gameType); // Fallback to static
  }
}
