// netlify/functions/embed-topic.js
// Converts user topic text into OpenAI embedding vector

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { text } = JSON.parse(event.body);

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Text is required" }),
      };
    }

    const cleanedText = text.trim().slice(0, 500); // Limit to 500 chars

    console.log(`🧠 Generating embedding for: "${cleanedText.slice(0, 50)}..."`);

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: cleanedText,
    });

    const vector = response.data[0].embedding;

    console.log(`✅ Generated embedding with ${vector.length} dimensions`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        vector: vector,
        dimensions: vector.length,
      }),
    };
  } catch (error) {
    console.error("❌ Embedding generation failed:", error);

    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to generate embedding",
        message: error.message,
      }),
    };
  }
};
