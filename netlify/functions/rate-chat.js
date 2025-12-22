// netlify/functions/rate-chat.js
// Updates user karma after a chat session

const { getFirebaseAdmin } = require('./utils/firebase-admin');

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
    const { raterId, ratedUserId, rating, roomId } = JSON.parse(event.body);

    if (!raterId || !ratedUserId || rating === undefined) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "raterId, ratedUserId, and rating are required",
        }),
      };
    }

    // Validate rating (1-5 scale, or thumbs up/down as 1/0)
    const numericRating = parseInt(rating, 10);
    if (isNaN(numericRating) || numericRating < 0 || numericRating > 5) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Rating must be between 0 and 5",
        }),
      };
    }

    const firebase = getFirebaseAdmin({ requireDatabaseURL: true });
    const db = firebase.database();

    // Calculate karma change
    // Rating 0-2 = negative, 3 = neutral, 4-5 = positive
    let karmaChange = 0;
    if (numericRating >= 4) {
      karmaChange = 1; // Positive rating
    } else if (numericRating <= 2) {
      karmaChange = -1; // Negative rating
    }

    // Update karma using transaction for atomicity
    const karmaRef = db.ref(`user_karma/${ratedUserId}`);
    
    await karmaRef.transaction((current) => {
      if (current === null) {
        // First rating for this user
        return {
          score: karmaChange,
          matches_count: 1,
          ratings: [numericRating],
          last_rated: Date.now(),
        };
      }
      
      return {
        score: (current.score || 0) + karmaChange,
        matches_count: (current.matches_count || 0) + 1,
        ratings: [...(current.ratings || []).slice(-99), numericRating], // Keep last 100 ratings
        last_rated: Date.now(),
      };
    });

    // Log the rating (optional: store in separate ratings collection)
    if (roomId) {
      await db.ref(`match_ratings/${roomId}/${raterId}`).set({
        rated_user: ratedUserId,
        rating: numericRating,
        timestamp: Date.now(),
      });
    }

    // Clean up queue entry for rater
    await db.ref(`matchmaking_queue/${raterId}`).remove();

    console.log(`⭐ User ${ratedUserId} rated ${numericRating}/5 by ${raterId} (karma ${karmaChange > 0 ? '+' : ''}${karmaChange})`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        message: "Rating submitted",
        karma_change: karmaChange,
      }),
    };
  } catch (error) {
    console.error("❌ Rating failed:", error);

    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to submit rating",
        message: error.message,
      }),
    };
  }
};
