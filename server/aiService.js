import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

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
    basic: "Generate one sweet and romantic question or a simple, engaging activity specifically designed for a long-distance couple playing a game. Focus on fostering connection and positive feelings despite the distance. Example: What's one small thing your partner does, even from afar, that makes you feel most loved?",
    fun: "Generate one playful, flirty, or funny 'truth or dare' style challenge tailored for a long-distance couple. The challenge should be easily doable remotely and bring laughter or lighthearted fun. Example: Dare: Describe your current surroundings to your partner using only animal sounds for one minute.",
    spicy: "Generate one tasteful yet spicy or intimate question or challenge crafted for a long-distance couple in a romantic game. The prompt should encourage connection and flirtation across the distance without being explicit. Example: Truth: If we were together right now, what's the first intimate thing you'd want to do?"
  };

  const prompt = promptMap[gameType] || promptMap['basic'];

  try {
    console.log(`Requesting ${gameType} challenge from AI using model gemini-2.0-flash...`); // Log model name
    const result = await model.generateContent({
      prompt: prompt,
      generationConfig: {
        temperature: temperature,
      },
    });
    const response = await result.response; // Access response correctly
    const text = response.text().trim(); // Get text content

    if (!text) {
        console.warn("AI returned empty content, falling back to static.");
        return getRandomStaticChallenge(gameType); // Fallback if AI gives empty response
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
    return getRandomStaticChallenge(gameType); // Fallback to static on any error
  }
}
