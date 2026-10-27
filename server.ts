import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function parseJsonWithFallback(rawText: string) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Failed to parse structured JSON translation output from Gemini.");
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // 1. Return the Streamlit app.py and requirements.txt source files
  app.get("/api/streamlit-source", (_req, res) => {
    try {
      const appPyPath = path.resolve(__dirname, "app.py");
      const reqTxtPath = path.resolve(__dirname, "requirements.txt");
      const appPy = fs.existsSync(appPyPath) ? fs.readFileSync(appPyPath, "utf-8") : "";
      const requirementsTxt = fs.existsSync(reqTxtPath) ? fs.readFileSync(reqTxtPath, "utf-8") : "";
      res.json({ appPy, requirementsTxt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load source files.";
      res.status(500).json({ error: message });
    }
  });

  // 2. Context-Aware Translation Endpoint (Gemini 2.5 Flash with structured JSON)
  app.post("/api/translate", async (req, res) => {
    try {
      const { text, sourceLang, targetLang, tone, formality } = req.body;

      if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "Please provide non-empty source text to translate." });
        return;
      }

      const systemInstruction =
        "You are PolyGlot AI, a Principal Computational Linguist and Cultural Localization Engine. " +
        "Translate the user's input accurately while adapting idioms, honorifics, and register to match " +
        "the specified Translation Tone and Formality level. " +
        "Always return valid JSON matching the requested schema with:\n" +
        "- translated_text: Pure translated string in the target script.\n" +
        "- phonetic_transliteration: Romanized pronunciation guide (e.g., Pinyin, Romaji, or Latin phonetic transliteration for Hindi/Marathi/Arabic/Russian/etc.).\n" +
        "- detected_language: Detected source language name.\n" +
        "- cultural_nuances: A concise 1-2 sentence explanation of cultural context, idioms, or tone adjustments made.\n" +
        "- key_vocabulary: 2-3 essential translated words/phrases with their pronunciation, part_of_speech, and meaning.";

      const prompt =
        `Source Language: ${sourceLang || "Auto-Detect"}\n` +
        `Target Language: ${targetLang || "English"}\n` +
        `Translation Tone: ${tone || "Professional/Corporate"}\n` +
        `Target Audience / Formality: ${formality || "Formal"}\n\n` +
        `Source Text:\n${text.trim()}`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          translated_text: {
            type: Type.STRING,
            description: "Pure translated string in the target language matching the requested tone and formality.",
          },
          phonetic_transliteration: {
            type: Type.STRING,
            description: "Complete Romanized pronunciation guide (e.g., Pinyin, Romaji, or Latin transliteration).",
          },
          detected_language: {
            type: Type.STRING,
            description: "Detected source language name (e.g., English, Hindi, Marathi, Spanish, Japanese).",
          },
          cultural_nuances: {
            type: Type.STRING,
            description: "A brief 1-2 sentence note explaining idioms, cultural context, or tone adjustments made.",
          },
          key_vocabulary: {
            type: Type.ARRAY,
            description: "A list of 2-3 key translated words with their individual meanings.",
            items: {
              type: Type.OBJECT,
              properties: {
                word: {
                  type: Type.STRING,
                  description: "The translated word or phrase in the target language.",
                },
                pronunciation: {
                  type: Type.STRING,
                  description: "Romanized phonetic guide for this word.",
                },
                part_of_speech: {
                  type: Type.STRING,
                  description: "Grammatical category (e.g., Noun, Verb, Idiom).",
                },
                meaning: {
                  type: Type.STRING,
                  description: "Concise meaning and contextual role in English.",
                },
              },
              required: ["word", "pronunciation", "part_of_speech", "meaning"],
            },
          },
        },
        required: [
          "translated_text",
          "phonetic_transliteration",
          "detected_language",
          "cultural_nuances",
          "key_vocabulary",
        ],
      };

      const candidateModels = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-flash-latest"];
      let responseText: string | undefined;

      if (process.env.GEMINI_API_KEY) {
        const ai = getGenAIClient();
        for (const modelName of candidateModels) {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                  systemInstruction,
                  responseMimeType: "application/json",
                  responseSchema,
                  temperature: 0.3,
                },
              });
              if (response.text) {
                responseText = response.text;
                break;
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message.toUpperCase() : String(err).toUpperCase();
              if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("OVERLOADED")) {
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
                continue;
              }
              break;
            }
          }
          if (responseText) break;
        }
      }

      if (responseText) {
        const parsed = parseJsonWithFallback(responseText);
        res.json(parsed);
        return;
      }

      // Automatic fallback to Google Translate API endpoint if Gemini is overloaded or key is not set locally
      const langCodes: Record<string, string> = {
        "Auto-Detect": "auto",
        English: "en",
        Hindi: "hi",
        Marathi: "mr",
        Spanish: "es",
        French: "fr",
        German: "de",
        "Mandarin Chinese (Simplified)": "zh-CN",
        Japanese: "ja",
        Korean: "ko",
        Arabic: "ar",
        Portuguese: "pt",
        Russian: "ru",
        Italian: "it",
        Bengali: "bn",
        Tamil: "ta",
        Telugu: "te",
        Gujarati: "gu",
        Punjabi: "pa",
        Urdu: "ur",
        Turkish: "tr",
        Vietnamese: "vi",
        Thai: "th",
        Indonesian: "id",
        Dutch: "nl",
        Polish: "pl",
        Ukrainian: "uk",
        Greek: "el",
        Hebrew: "iw",
        Swedish: "sv",
        Swahili: "sw",
      };
      const sl = langCodes[sourceLang] || "auto";
      const tl = langCodes[targetLang] || "en";
      const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sl
      )}&tl=${encodeURIComponent(tl)}&dt=t&dt=rm&q=${encodeURIComponent(text.trim())}`;

      const gtRes = await fetch(gtUrl);
      if (!gtRes.ok) {
        throw new Error("Translation API service is temporarily unreachable.");
      }
      const gtData = await gtRes.json();
      const translatedChunks: string[] = [];
      let transliteration = "";

      if (Array.isArray(gtData?.[0])) {
        for (const segment of gtData[0]) {
          if (segment?.[0]) translatedChunks.push(segment[0]);
          if (segment?.[2]) transliteration += segment[2] + " ";
        }
      }

      res.json({
        translated_text: translatedChunks.join("") || text.trim(),
        phonetic_transliteration: transliteration.trim(),
        detected_language: sourceLang === "Auto-Detect" ? (gtData?.[2]?.toUpperCase() || "Auto") : sourceLang,
        cultural_nuances: `Translated from ${sourceLang} to ${targetLang} (${tone}, ${formality}).`,
        key_vocabulary: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation request failed.";
      res.status(500).json({ error: message });
    }
  });

  // 3. Neural Text-to-Speech Endpoint (Gemini TTS -> 24kHz WAV)
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, targetLang } = req.body;
      if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "Text is required for speech synthesis." });
        return;
      }

      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style: `Clear, natural native pronunciation in ${targetLang || "the target language"}`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error("No audio payload returned from speech engine.");
      }

      res.json({ audioBase64: base64Audio, mimeType: "audio/wav" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech synthesis failed.";
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PolyGlot AI server listening on http://localhost:${PORT}`);
  });
}

startServer();
