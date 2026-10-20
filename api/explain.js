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

  try {
    const model = process.env.GEMINI_MODEL; // copy exact name from Google AI Studio
    const key = process.env.GEMINI_API_KEY;
    if (!model || !key) return res.status(500).json({ error: "Server is missing GEMINI_MODEL or GEMINI_API_KEY." });

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
    if (r.status === 429) return res.status(429).json({ error: "Too many requests right now. Wait a minute and try again." });
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    if (!text) return res.status(502).json({ error: "No answer came back. Try rephrasing your topic." });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
