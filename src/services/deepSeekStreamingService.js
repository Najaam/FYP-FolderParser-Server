const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
const DEEPSEEK_API_KEY = process.env.deepseek_model_api || process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

function getChunkContent(payload) {
  if (!payload || payload === "[DONE]") return "";
  try {
    return JSON.parse(payload)?.choices?.[0]?.delta?.content || "";
  } catch {
    return "";
  }
}

async function* streamDeepSeekCompletion(prompt, temperature = 0.2, signal) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DeepSeek API key is missing. Please add deepseek_model_api in your .env file.");
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature,
      stream: true,
      messages: [
        { role: "system", content: "You are a precise software testing assistant. Return only the exact format requested. Do not add markdown unless explicitly requested." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`DeepSeek is not responding properly. Status: ${response.status}. ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() || "";
    for (const message of messages) {
      const data = message.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      const content = getChunkContent(data);
      if (content) yield content;
    }
    if (done) break;
  }
}

module.exports = { streamDeepSeekCompletion };
