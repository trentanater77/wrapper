const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

exports.handler = async function (event) {
  const body = JSON.parse(event.body);
  const prompt = body.prompt;

  try {
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ result: response.data.choices[0].message.content }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: "OpenAI request failed",
    };
  }
};
