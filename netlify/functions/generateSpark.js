// netlify/functions/generateSpark.js
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,   // <— pulled from the env var you just set
});

exports.handler = async function (event) {
  const { prompt } = JSON.parse(event.body);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",          // your chosen model
      messages: [{ role: "user", content: prompt }],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ result: response.choices[0].message.content }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "OpenAI request failed" };
  }
};
