import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.VEO_MODEL || "veo-3.1-generate-preview";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const jobs = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function apiHeaders() {
  return {
    "x-goog-api-key": process.env.GEMINI_API_KEY || "",
    "Content-Type": "application/json"
  };
}

function safeError(body, fallback = "Gemini API request failed") {
  return body?.error?.message || body?.message || fallback;
}

app.get("/api/health", async (_req, res) => {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    ok: true,
    configured,
    model: MODEL,
    message: configured
      ? "Gemini API key is configured."
      : "Gemini API key is not configured."
  });
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ error: "GEMINI_API_KEY is not configured. Run npm run setup." });
    }

    const prompt = String(req.body.prompt || "").trim();
    const aspectRatio = req.body.aspectRatio === "16:9" ? "16:9" : "9:16";
    const durationSeconds = ["4", "6", "8"].includes(String(req.body.durationSeconds))
      ? String(req.body.durationSeconds)
      : "8";

    if (!prompt) return res.status(400).json({ error: "Prompt is required." });
    if (!req.file) return res.status(400).json({ error: "Please select an image." });

    const mimeType = req.file.mimetype || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return res.status(400).json({ error: "Use JPG, PNG or WEBP image." });
    }

    // Image-to-video requests use the official Veo REST long-running operation.
    // 720p supports 4/6/8 seconds. Reference/image-based generation requires 8s
    // on the current Veo 3.1 API, so force 8s for image input.
    const finalDuration = "8";

    const payload = {
      instances: [{
        prompt,
        image: {
          inlineData: {
            mimeType,
            data: req.file.buffer.toString("base64")
          }
        }
      }],
      parameters: {
        aspectRatio,
        durationSeconds: finalDuration,
        resolution: "720p",
        numberOfVideos: 1,
        personGeneration: "allow_adult"
      }
    };

    const response = await fetch(
      `${BASE_URL}/models/${encodeURIComponent(MODEL)}:predictLongRunning`,
      {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: safeError(data) });

    const operationName = data.name;
    if (!operationName) {
      return res.status(502).json({ error: "Gemini did not return an operation name." });
    }

    const id = crypto.randomUUID();
    jobs.set(id, {
      id,
      operationName,
      status: "processing",
      createdAt: Date.now(),
      videoUri: null,
      error: null
    });

    res.json({ jobId: id, status: "processing" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

app.get("/api/status/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  try {
    if (job.status === "ready" || job.status === "error") return res.json(job);

    const response = await fetch(
      `${BASE_URL}/${job.operationName}`,
      { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } }
    );
    const data = await response.json();

    if (!response.ok) {
      job.status = "error";
      job.error = safeError(data);
      return res.status(response.status).json(job);
    }

    if (!data.done) {
      job.status = "processing";
      return res.json({
        id: job.id,
        status: "processing",
        createdAt: job.createdAt
      });
    }

    if (data.error) {
      job.status = "error";
      job.error = safeError(data);
      return res.json(job);
    }

    const uri = data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) {
      job.status = "error";
      job.error = "Generation finished, but no video URI was returned.";
      return res.json(job);
    }

    job.status = "ready";
    job.videoUri = uri;

    return res.json({
      id: job.id,
      status: "ready",
      videoUrl: `/api/video/${job.id}`,
      createdAt: job.createdAt
    });
  } catch (err) {
    job.status = "error";
    job.error = err.message || "Status check failed.";
    return res.status(500).json(job);
  }
});

app.get("/api/video/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "ready" || !job.videoUri) {
    return res.status(404).send("Video is not ready.");
  }

  try {
    const response = await fetch(job.videoUri, {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text || "Video download failed.");
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `inline; filename="ksr-studio-${job.id}.mp4"`);
    if (response.headers.get("content-length")) {
      res.setHeader("Content-Length", response.headers.get("content-length"));
    }

    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
      res.end();
    } else {
      res.end(Buffer.from(await response.arrayBuffer()));
    }
  } catch (err) {
    res.status(500).send(err.message || "Video proxy failed.");
  }
});

app.listen(PORT, () => {
  console.log(`\nKSR Studio V7 running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log("Stop with Ctrl+C.\n");
});
