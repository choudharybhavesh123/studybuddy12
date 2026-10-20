// Vercel serverless function. The API key stays here, never in the browser.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const b = req.body || {};
  const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const mode = b.mode === "story" ? "story" : "rush";
  const topic = clean(b.topic, 300);
  const interest = clean(b.interest, 60);
  const level = clean(b.level, 40) || "average";
  const syllabus = String(b.syllabus || "").trim().slice(0, 3000);
  const days = b.examUnit === "days";
  const examVal = Math.min(Math.max(parseFloat(b.examVal) || 1, 0.25), 60);
  const perDay = Math.min(Math.max(parseFloat(b.perDay) || 4, 1), 14);
  const totalHours = Math.round((days ? examVal * perDay : examVal) * 10) / 10;

  if (!topic) return res.status(400).json({ error: "Please enter a subject or topic." });
  if (mode === "rush" && !syllabus) return res.status(400).json({ error: "Tell us what syllabus is left." });

  const system =
    "You are a study coach for school and college students in India. " +
    "Be accurate first. If you are unsure about a fact, say so. " +
    "Use simple English, short sentences, and Markdown (## headings, - bullets, **bold**, tables). " +
    "Never use LaTeX or dollar signs. Write formulas in plain text with Unicode, like 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ or (a+b)² = a² + 2ab + b². " +
    "Only help with studying. Keep everything safe and age-appropriate.";

  const prompt =
    mode === "rush"
      ? `Build a detailed exam survival plan.
Subject: ${topic}
Exam is in: ${examVal} ${days ? "day(s)" : "hour(s)"}
Real study time available: about ${totalHours} hours${days ? ` (${perDay} hours per day)` : ""}
Student level: ${level}
Syllabus left:
${syllabus}

Write these sections exactly:
## Reality check
2 honest lines: how much of this can be covered in the time, and what score is realistic.
## Priority map
A table: Topic | Priority | Time | Why. Priority must be exactly Must, Should or Skip. Times must add up to no more than ${totalHours} hours including breaks and revision.
## Your timeline
A table: When | What to do | Goal. ${days ? "Go day by day (Day 1, Day 2...), with a morning, afternoon and evening slot." : "Go in blocks of 10-30 minutes."} Include short breaks, one revision slot, and a mini self-test. Do not schedule the last night badly: sleep matters.
## Memory tricks
For each Must topic: 3 lines of key points plus one memory trick.
## Practice questions
2 likely exam questions per Must topic, with short answers.
## Last 30 minutes before the exam
A short checklist.
Be specific to this syllabus. No generic advice.`
      : !interest
      ? `Explain "${topic}" simply to an Indian school student. If it is a question, answer it directly first.
## In simple words
A clear explanation in short sentences.
## Example
One everyday example.
## Exam-ready version
How to write it in an exam, in plain words.
## Test yourself
2 exam-style questions, then short answers.`
      : `Explain "${topic}" to a ${level === "average" ? "school student" : level + " student"} who loves ${interest}.
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
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY in Vercel." });

  const norm = (m) => String(m || "").trim().replace(/^["']+|["']+$/g, "").replace(/^models\//, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastStatus = 0, lastMsg = "";

  // Ask Google for one answer from one model. Retries if Google is busy.
  async function callModel(model) {const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
          if (text) return text;
          lastStatus = 502;
          lastMsg = data?.promptFeedback?.blockReason ? "Blocked: " + data.promptFeedback.blockReason : "Empty answer";
          return null;
        }
        lastStatus = r.status;
        lastMsg = data?.error?.message || "";
        console.error("Gemini error", model, r.status, lastMsg);
        if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
        return null;
      } catch (e) {
        lastStatus = 500; lastMsg = String(e.message || e);
        await sleep(800);
      }
    }
    return null;
  }

  // Ask Google which Flash models THIS key can use, newest first.
  async function discover() {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": key },
      });
      const d = await r.json();
      const names = (d.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((n) => /flash/.test(n) && !/image|tts|audio|live|embed|robot|computer|thinking|exp/.test(n));
      const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
      const score = (n) => ver(n) * 10 - (/lite/.test(n) ? 5 : 0) - (/preview/.test(n) ? 1 : 0);
      return names.sort((a, b) => score(b) - score(a));
    } catch (e) { return []; }
  }

  const tried = new Set();
  const attempt = async (m) => {
    if (!m || tried.has(m)) return null;
    tried.add(m);
    const t = await callModel(m);
    if (t) globalThis.__gm = m; // remember the model that worked
    return t;
  };

  let text = null;
  for (const m of [globalThis.__gm, norm(process.env.GEMINI_MODEL), norm(process.env.GEMINI_FALLBACK_MODEL)]) {
    text = await attempt(m);
    if (text) break;
  }
  // Model name rejected? Find a working one automatically.
  if (!text && (lastStatus === 404 || lastStatus === 400)) {
    for (const m of (await discover()).slice(0, 4)) {
      text = await attempt(m);
      if (text) break;
    }
  }
  if (text) return res.status(200).json({ text });

  const friendly =
    lastStatus === 429 ? "Too many people are using the free AI right now. Wait a minute and try again."
    : lastStatus === 503 ? "Google's AI is busy right now. Try again in a minute."
    : lastStatus === 400 || lastStatus === 403 ? "The AI key was rejected. Check GEMINI_API_KEY in Vercel."
    : lastStatus === 404 ? "No working AI model was found for this key. Check GEMINI_API_KEY in Vercel."
    : "No answer came back. Try again or rephrase your topic.";
  return res.status(502).json({ error: friendly + (lastStatus ? " [code " + lastStatus + "]" : ""), detail: lastMsg.slice(0, 200) });
};
