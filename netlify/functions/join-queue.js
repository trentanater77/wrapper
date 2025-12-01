// netlify/functions/join-queue.js
// Adds a user to the matchmaking queue in Firebase

const admin = require("firebase-admin");

// Initialize Firebase Admin (singleton pattern)
function getFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin;
  }

  // Try to initialize with available credentials
  const projectId = process.env.FIREBASE_MAIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const databaseURL = process.env.FIREBASE_MAIN_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !databaseURL) {
    throw new Error("Firebase configuration missing");
  }

  // Check for service account JSON
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

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      },
      body: "",
    };
  }

  // Handle DELETE - remove user from queue
  if (event.httpMethod === "DELETE") {
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
      await db.ref(`matchmaking_queue/${userId}`).remove();

      console.log(`🗑️ User ${userId} removed from queue`);

      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ success: true, message: "Removed from queue" }),
      };
    } catch (error) {
      console.error("❌ Failed to remove from queue:", error);
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Failed to remove from queue" }),
      };
    }
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { userId, topicText, topicVector, mode } = JSON.parse(event.body);

    if (!userId || !topicText || !topicVector) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "userId, topicText, and topicVector are required",
        }),
      };
    }

    const firebase = getFirebaseAdmin();
    const db = firebase.database();

    // Create queue entry
    const queueEntry = {
      topic_text: topicText.trim().slice(0, 500),
      topic_vector: topicVector,
      mode: mode || "casual", // debate, vent, casual
      timestamp: Date.now(),
      status: "waiting",
      matched_with: null,
      room_id: null,
    };

    // Write to matchmaking_queue (auto-creates node if doesn't exist)
    await db.ref(`matchmaking_queue/${userId}`).set(queueEntry);

    console.log(`✅ User ${userId} joined queue with topic: "${topicText.slice(0, 30)}..."`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        message: "Joined matchmaking queue",
        userId,
        status: "waiting",
      }),
    };
  } catch (error) {
    console.error("❌ Failed to join queue:", error);

    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to join queue",
        message: error.message,
      }),
    };
  }
};
