import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.VEO_MODEL || "veo-3.1-generate-preview";
const VIDEO_DIR = path.join(__dirname, "videos");
fs.mkdirSync(VIDEO_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const jobs = new Map();

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? new GoogleGenAI({ apiKey }) : null;
}

function errorMessage(err) {
  if (!err) return "Unknown Gemini API error.";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.error?.message) return err.error.message;
  try { return JSON.stringify(err); } catch { return "Gemini API request failed."; }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    progress: job.progress,
    videoUrl: job.videoUrl || null,
    error: job.error || null
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL
  });
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    const ai = getClient();
    if (!ai) return res.status(503).json({ error: "GEMINI_API_KEY is not configured on Render." });

    const prompt = String(req.body?.prompt || "").trim();
    const aspectRatio = req.body?.aspectRatio === "16:9" ? "16:9" : "9:16";
    const durationSeconds = Number(req.body?.durationSeconds || 8);

    if (!prompt) return res.status(400).json({ error: "Prompt is required." });
    if (!req.file) return res.status(400).json({ error: "Please select an image." });
    if (!["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Use JPG, PNG or WEBP image." });
    }

    // IMPORTANT: Do not construct a raw REST `inlineData` object here.
    // The official JS SDK accepts an Image object with imageBytes + mimeType.
    let operation = await ai.models.generateVideos({
      model: MODEL,
      prompt,
      image: {
        imageBytes: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype
      },
      config: {
        aspectRatio,
        durationSeconds: 8,
        resolution: "720p",
        numberOfVideos: 1,
        personGeneration: "allow_adult"
      }
    });

    const id = crypto.randomUUID();
    jobs.set(id, {
      id,
      operation,
      status: "processing",
      progress: 5,
      message: "Veo is generating your video…",
      createdAt: Date.now(),
      videoUrl: null,
      error: null,
      durationSeconds
    });

    res.json({ ok: true, jobId: id, status: "processing" });
  } catch (err) {
    console.error("Veo start error:", err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get("/api/status/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found. The server may have restarted." });

  if (job.status === "ready" || job.status === "error") {
    return res.json(publicJob(job));
  }

  try {
    const ai = getClient();
    if (!ai) throw new Error("GEMINI_API_KEY is not configured on Render.");

    job.operation = await ai.operations.getVideosOperation({ operation: job.operation });

    if (!job.operation.done) {
      job.progress = Math.min(88, job.progress + 4);
      job.message = "Veo is creating your video…";
      return res.json(publicJob(job));
    }

    if (job.operation.error) {
      throw new Error(errorMessage(job.operation.error));
    }

    const generated = job.operation.response?.generatedVideos?.[0]?.video;
    if (!generated) throw new Error("Generation finished, but no video was returned.");

    job.status = "downloading";
    job.progress = 92;
    job.message = "Saving MP4…";

    const filename = `KSR_${Date.now()}_${crypto.randomBytes(3).toString("hex")}.mp4`;
    const outputPath = path.join(VIDEO_DIR, filename);

    // Let the official SDK handle the generated-video download/authentication.
    await ai.files.download({
      file: generated,
      downloadPath: outputPath
    });

    job.status = "ready";
    job.progress = 100;
    job.message = "🎬 Video ready!";
    job.videoUrl = `/api/video/${encodeURIComponent(filename)}`;
    return res.json(publicJob(job));
  } catch (err) {
    console.error("Veo status error:", err);
    job.status = "error";
    job.message = "Generation failed.";
    job.error = errorMessage(err);
    return res.status(500).json(publicJob(job));
  }
});

app.get("/api/video/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(VIDEO_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Video not found.");
  res.type("mp4").sendFile(filePath);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`KSR Studio V8 running on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
});
