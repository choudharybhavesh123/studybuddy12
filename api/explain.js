// Vercel serverless function. The API key stays here, never in the browser.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const mode = b.mode === "story" ? "story" : "rush";
  const topic = clean(b.topic, 300);
  const interest = clean(b.interest, 60);
  const level = clean(b.level, 40) || "school student";
  const minutes = Math.min(Math.max(parseInt(b.minutes, 10) || 60, 10), 480);

  if (!topic) return res.status(400).json({ error: "Please enter a topic." });
  if (mode === "story" && !interest) return res.status(400).json({ error: "Please pick an interest." });

  const system =
    "You are StudyBuddy, a friendly tutor for school students in India. " +
    "Be accurate first. If you are unsure about a fact, say so. " +
    "Use simple English, short sentences, and Markdown (## headings, - bullets, **bold**, tables). " +
    "Only help with studying. Keep everything safe and age-appropriate.";

  const prompt =
    mode === "rush"
      ? `A student (${level}) has ${minutes} minutes before an exam on: ${topic}.
Make a crash plan:
## Learn these first
The 5 highest-scoring ideas, one line each on why it scores.
## Skip these
What to ignore in this time, and why.
## Your ${minutes}-minute plan
A table: Time block | What to do. Last 5 minutes = review mistakes only.
## Quick notes
For each of the 5 ideas: a 3-line explanation, one memory trick, 2 quick questions.
## Answer check
Short answers to your quick questions.
Be direct. No fluff.`
      : `Explain "${topic}" to a ${level} who loves ${interest}.
Use ${interest} as the main analogy all the way through.
## The story
Explain the idea as if it happens inside the world of ${interest}.
## Match-up table
A table: Real concept | ${interest} version.
## Where the analogy breaks
Be honest about what the analogy gets wrong, so the student does not learn a wrong idea.
## Exam-ready version
The proper textbook-style definition in plain words, as it should be written in an exam.
## Test yourself
2 exam-style questions, then short answers.`;

  const key = process.env.GEMINI_API_KEY;
  const models = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash"].filter(Boolean);
  if (!models.length || !key) return res.status(500).json({ error: "Server is missing GEMINI_MODEL or GEMINI_API_KEY." });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastStatus = 0, lastMsg = "";

  // Try the main model, retry a couple of times if Google is busy, then try the backup model.
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7 },
            }),
          }
        );
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          if (text) return res.status(200).json({ text });
          lastStatus = 502;
          lastMsg = data?.promptFeedback?.blockReason ? "Blocked: " + data.promptFeedback.blockReason : "Empty answer";
          break; // try the next model
        }
        lastStatus = r.status;
        lastMsg = data?.error?.message || "";
        console.error("Gemini error", model, r.status, lastMsg);
        if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
        break; // other errors (bad key, bad model name): go to next model
      } catch (e) {
        lastStatus = 500; lastMsg = String(e.message || e);
        await sleep(800);
      }
    }
  }

  const friendly =
    lastStatus === 429 ? "Too many people are using the free AI right now. Wait a minute and try again."
    : lastStatus === 503 ? "Google's AI is busy right now. Try again in a minute."
    : lastStatus === 400 || lastStatus === 403 ? "Server setup problem (check the API key and model name)."
    : lastStatus === 404 ? "Model name not found. Check GEMINI_MODEL in Vercel."
    : "No answer came back. Try again or rephrase your topic.";
  return res.status(502).json({ error: friendly + (lastStatus ? " [code " + lastStatus + "]" : ""), detail: lastMsg.slice(0, 200) });
};
