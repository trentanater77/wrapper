// netlify/functions/find-match.js
// Finds semantic matches using cosine similarity between topic vectors

const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize Firebase Admin (singleton pattern)
function getFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin;
  }

  const projectId = process.env.FIREBASE_MAIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const databaseURL = process.env.FIREBASE_MAIN_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !databaseURL) {
    throw new Error("Firebase configuration missing");
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  let credential;
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      credential = admin.credential.cert(serviceAccount);
    } catch (e) {
      console.warn("⚠️ Could not parse service account JSON");
    }
  } else if (clientEmail && privateKey) {
    credential = admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    });
  }

  admin.initializeApp({
    credential: credential || admin.credential.applicationDefault(),
    databaseURL,
  });

  return admin;
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

// Generate a unique room ID
function generateRoomId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `match-${timestamp}-${random}`;
}

// Matching thresholds
const PERFECT_MATCH_THRESHOLD = 0.80;
const GOOD_MATCH_THRESHOLD = 0.65;
const FALLBACK_THRESHOLD = 0.50;
const QUEUE_TIMEOUT_MS = 30000; // 30 seconds before fallback

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
    const { userId } = JSON.parse(event.body);

    if (!userId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "userId is required" }),
      };
    }

    const firebase = getFirebaseAdmin();
    const db = firebase.database();
    const queueRef = db.ref("matchmaking_queue");

    // Get current user's entry
    const currentUserSnapshot = await queueRef.child(userId).once("value");
    const currentUser = currentUserSnapshot.val();

    if (!currentUser) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "User not in queue",
          match: false,
        }),
      };
    }

    // If already matched, return the match info
    if (currentUser.status === "matched" && currentUser.room_id) {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          match: true,
          room_id: currentUser.room_id,
          matched_with: currentUser.matched_with,
          your_topic: currentUser.topic_text,
          their_topic: currentUser.matched_topic || "Unknown",
        }),
      };
    }

    // Get all waiting users
    const allUsersSnapshot = await queueRef
      .orderByChild("status")
      .equalTo("waiting")
      .once("value");

    const allUsers = allUsersSnapshot.val() || {};
    const waitingUsers = Object.entries(allUsers).filter(
      ([id, user]) => id !== userId && user.topic_vector
    );

    console.log(`🔍 User ${userId} searching among ${waitingUsers.length} waiting users`);

    if (waitingUsers.length === 0) {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          match: false,
          waiting: true,
          message: "No other users in queue yet",
          queue_position: 1,
        }),
      };
    }

    // Calculate time in queue for fallback logic
    const timeInQueue = Date.now() - currentUser.timestamp;
    const useFallback = timeInQueue > QUEUE_TIMEOUT_MS;

    // Determine threshold based on time in queue
    let threshold = PERFECT_MATCH_THRESHOLD;
    if (useFallback) {
      threshold = FALLBACK_THRESHOLD;
      console.log(`⏰ User ${userId} in queue for ${Math.round(timeInQueue / 1000)}s, using fallback threshold`);
    }

    // Find best match using cosine similarity
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [otherId, otherUser] of waitingUsers) {
      // Optional: filter by mode if specified
      if (currentUser.mode && otherUser.mode && currentUser.mode !== otherUser.mode) {
        continue;
      }

      const similarity = cosineSimilarity(
        currentUser.topic_vector,
        otherUser.topic_vector
      );

      console.log(`  📊 Similarity with ${otherId}: ${(similarity * 100).toFixed(1)}%`);

      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = { id: otherId, user: otherUser, similarity };
      }
    }

    // If no match meets threshold but user has been waiting long, match with anyone
    if (!bestMatch && useFallback && waitingUsers.length > 0) {
      // Find the best available match regardless of similarity
      for (const [otherId, otherUser] of waitingUsers) {
        const similarity = cosineSimilarity(
          currentUser.topic_vector,
          otherUser.topic_vector
        );
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = { id: otherId, user: otherUser, similarity };
        }
      }
      console.log(`🎲 Fallback match for ${userId} with similarity ${(bestSimilarity * 100).toFixed(1)}%`);
    }

    if (!bestMatch) {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          match: false,
          waiting: true,
          message: useFallback
            ? "Still searching for a match..."
            : "Looking for the perfect match...",
          queue_position: waitingUsers.length + 1,
          time_waiting: Math.round(timeInQueue / 1000),
        }),
      };
    }

    // MATCH FOUND! Update both users atomically
    const roomId = generateRoomId();

    console.log(`🎉 Match found! ${userId} <-> ${bestMatch.id} (${(bestSimilarity * 100).toFixed(1)}% similarity)`);

    // Use transaction to ensure atomic update
    const updates = {};
    updates[`matchmaking_queue/${userId}/status`] = "matched";
    updates[`matchmaking_queue/${userId}/matched_with`] = bestMatch.id;
    updates[`matchmaking_queue/${userId}/room_id`] = roomId;
    updates[`matchmaking_queue/${userId}/matched_topic`] = bestMatch.user.topic_text;
    updates[`matchmaking_queue/${userId}/similarity`] = bestSimilarity;
    updates[`matchmaking_queue/${userId}/matched_at`] = Date.now();

    updates[`matchmaking_queue/${bestMatch.id}/status`] = "matched";
    updates[`matchmaking_queue/${bestMatch.id}/matched_with`] = userId;
    updates[`matchmaking_queue/${bestMatch.id}/room_id`] = roomId;
    updates[`matchmaking_queue/${bestMatch.id}/matched_topic`] = currentUser.topic_text;
    updates[`matchmaking_queue/${bestMatch.id}/similarity`] = bestSimilarity;
    updates[`matchmaking_queue/${bestMatch.id}/matched_at`] = Date.now();

    await db.ref().update(updates);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        match: true,
        room_id: roomId,
        matched_with: bestMatch.id,
        your_topic: currentUser.topic_text,
        their_topic: bestMatch.user.topic_text,
        similarity: Math.round(bestSimilarity * 100),
      }),
    };
  } catch (error) {
    console.error("❌ Match finding failed:", error);

    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to find match",
        message: error.message,
      }),
    };
  }
};
