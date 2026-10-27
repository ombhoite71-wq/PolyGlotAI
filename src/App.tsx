/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Loader2,
  RotateCcw,
  Volume2,
} from "lucide-react";

interface VocabularyItem {
  word: string;
  pronunciation: string;
  part_of_speech: string;
  meaning: string;
}

interface TranslationResult {
  translated_text: string;
  phonetic_transliteration: string;
  detected_language: string;
  cultural_nuances: string;
  key_vocabulary: VocabularyItem[];
}

const LANGUAGE_MAP: Record<string, string> = {
  English: "en-US",
  Hindi: "hi-IN",
  Marathi: "mr-IN",
  Spanish: "es-ES",
  French: "fr-FR",
  German: "de-DE",
  "Mandarin Chinese (Simplified)": "zh-CN",
  Japanese: "ja-JP",
  Korean: "ko-KR",
  Arabic: "ar-SA",
  Portuguese: "pt-BR",
  Russian: "ru-RU",
  Italian: "it-IT",
  Bengali: "bn-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN",
  Gujarati: "gu-IN",
  Punjabi: "pa-IN",
  Urdu: "ur-PK",
  Turkish: "tr-TR",
  Vietnamese: "vi-VN",
  Thai: "th-TH",
  Indonesian: "id-ID",
  Dutch: "nl-NL",
  Polish: "pl-PL",
  Ukrainian: "uk-UA",
  Greek: "el-GR",
  Hebrew: "he-IL",
  Swedish: "sv-SE",
  Swahili: "sw-KE",
};

const TARGET_LANGUAGES = Object.keys(LANGUAGE_MAP);
const SOURCE_LANGUAGES = ["Auto-Detect", ...TARGET_LANGUAGES];

const TONE_OPTIONS = [
  "Professional/Corporate",
  "Casual/Colloquial",
  "Academic",
  "Travel & Everyday",
  "Poetic/Creative",
] as const;

const FORMALITY_OPTIONS = ["Formal", "Informal"] as const;

const SAMPLE_PRESETS = [
  {
    label: "Business Proposal",
    sourceLang: "Auto-Detect",
    targetLang: "Japanese",
    tone: "Professional/Corporate",
    formality: "Formal",
    text: "We appreciate your team's thorough review of the quarterly architecture proposal. Let's align on the final deployment milestones by Friday.",
  },
  {
    label: "Warm Hospitality",
    sourceLang: "English",
    targetLang: "Marathi",
    tone: "Travel & Everyday",
    formality: "Formal",
    text: "Thank you so much for welcoming us into your home today. The traditional meal was unforgettable.",
  },
  {
    label: "Everyday Idiom",
    sourceLang: "English",
    targetLang: "Spanish",
    tone: "Casual/Colloquial",
    formality: "Informal",
    text: "Don't bite off more than you can chew with this sprint; let's tackle the toughest module together first.",
  },
];

export default function App() {
  // Translation Controls
  const [sourceLang, setSourceLang] = useState<string>("Auto-Detect");
  const [targetLang, setTargetLang] = useState<string>("Japanese");
  const [tone, setTone] = useState<string>("Professional/Corporate");
  const [formality, setFormality] = useState<string>("Formal");
  const [sourceText, setSourceText] = useState<string>(SAMPLE_PRESETS[0].text);

  // Output & States
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isBreakdownOpen, setIsBreakdownOpen] = useState<boolean>(true);
  const [copiedState, setCopiedState] = useState<boolean>(false);

  // Audio / TTS State
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Word & Character Metrics
  const charCount = sourceText.length;
  const wordCount = sourceText.trim() ? sourceText.trim().split(/\s+/).length : 0;

  const handleTranslate = async (
    overrideText?: string,
    overrideSrc?: string,
    overrideTgt?: string,
    overrideTone?: string,
    overrideFormality?: string
  ) => {
    const textToUse = overrideText !== undefined ? overrideText : sourceText;
    const srcToUse = overrideSrc !== undefined ? overrideSrc : sourceLang;
    const tgtToUse = overrideTgt !== undefined ? overrideTgt : targetLang;
    const toneToUse = overrideTone !== undefined ? overrideTone : tone;
    const formalityToUse = overrideFormality !== undefined ? overrideFormality : formality;

    setErrorBanner(null);
    setTtsNotice(null);

    if (!textToUse.trim()) {
      setErrorBanner("Please enter text to translate.");
      return;
    }

    setIsTranslating(true);
    setAudioDataUrl(null);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToUse.trim(),
          sourceLang: srcToUse,
          targetLang: tgtToUse,
          tone: toneToUse,
          formality: formalityToUse,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Translation failed.");
      }

      setResult(data);
    } catch {
      // Automatic fallback to Google Translate API if backend is not running locally
      try {
        const sl =
          srcToUse === "Auto-Detect"
            ? "auto"
            : (LANGUAGE_MAP[srcToUse] || "en").split("-")[0];
        const tl =
          tgtToUse === "Mandarin Chinese (Simplified)"
            ? "zh-CN"
            : (LANGUAGE_MAP[tgtToUse] || "en").split("-")[0];
        const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
          sl
        )}&tl=${encodeURIComponent(tl)}&dt=t&dt=rm&q=${encodeURIComponent(textToUse.trim())}`;
        const gtRes = await fetch(gtUrl);
        if (!gtRes.ok) throw new Error("Network error");
        const gtData = await gtRes.json();
        const chunks: string[] = [];
        let phonetic = "";
        if (Array.isArray(gtData?.[0])) {
          for (const seg of gtData[0]) {
            if (seg?.[0]) chunks.push(seg[0]);
            if (seg?.[2]) phonetic += seg[2] + " ";
          }
        }
        setResult({
          translated_text: chunks.join("") || textToUse.trim(),
          phonetic_transliteration: phonetic.trim(),
          detected_language:
            srcToUse === "Auto-Detect" ? (gtData?.[2]?.toUpperCase() || "Auto") : srcToUse,
          cultural_nuances: `Translated from ${srcToUse} to ${tgtToUse} (${toneToUse}, ${formalityToUse}).`,
          key_vocabulary: [],
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unexpected error communicating with translation API.";
        setErrorBanner(message);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    handleTranslate(
      SAMPLE_PRESETS[0].text,
      SAMPLE_PRESETS[0].sourceLang,
      SAMPLE_PRESETS[0].targetLang,
      SAMPLE_PRESETS[0].tone,
      SAMPLE_PRESETS[0].formality
    );
  }, []);

  const handleSwapLanguages = () => {
    let nextSource = targetLang;
    let nextTarget = sourceLang;

    if (sourceLang === "Auto-Detect") {
      if (result?.detected_language && TARGET_LANGUAGES.includes(result.detected_language)) {
        nextTarget = result.detected_language;
      } else {
        nextTarget = targetLang === "English" ? "Spanish" : "English";
      }
    }

    setSourceLang(nextSource);
    setTargetLang(nextTarget);

    if (result?.translated_text) {
      setSourceText(result.translated_text);
      setAudioDataUrl(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedState(true);
      setTimeout(() => setCopiedState(false), 1800);
    } catch {
      setErrorBanner("Unable to copy to clipboard.");
    }
  };

  const buildDownloadReport = () => {
    if (!result) return "";
    const vocabLines = (result.key_vocabulary || [])
      .map(
        (item, idx) =>
          `  ${idx + 1}. ${item.word} [${item.pronunciation}] (${item.part_of_speech}): ${item.meaning}`
      )
      .join("\n");

    return [
      "====================================================================",
      "POLYGLOT AI - TRANSLATION REPORT",
      "====================================================================",
      `Source Language : ${result.detected_language || sourceLang}`,
      `Target Language : ${targetLang}`,
      `Tone            : ${tone}`,
      `Formality       : ${formality}`,
      "--------------------------------------------------------------------",
      "",
      "ORIGINAL TEXT:",
      sourceText.trim(),
      "",
      "TRANSLATED TEXT:",
      result.translated_text,
      "",
      "ROMANIZED PRONUNCIATION:",
      result.phonetic_transliteration || "N/A",
      "",
      "CULTURAL NUANCES:",
      result.cultural_nuances || "N/A",
      "",
      "KEY VOCABULARY:",
      vocabLines || "  None listed.",
      "====================================================================",
    ].join("\n");
  };

  const handleDownloadTxt = () => {
    if (!result) return;
    const content = buildDownloadReport();
    const filename = `polyglot_${targetLang.toLowerCase().replace(/\s+/g, "_")}.txt`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePlayTTS = async () => {
    if (!result?.translated_text) return;
    setTtsNotice(null);

    if (audioDataUrl && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

    setIsGeneratingAudio(true);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: result.translated_text,
          targetLang,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.audioBase64) {
        throw new Error(data.error || "TTS fallback");
      }
      const dataUrl = `data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}`;
      setAudioDataUrl(dataUrl);
    } catch {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(result.translated_text);
        const langCode = LANGUAGE_MAP[targetLang] || "en-US";
        utterance.lang = langCode;
        window.speechSynthesis.speak(utterance);
        setTtsNotice(`Playing via browser speech (${langCode}).`);
      } else {
        setErrorBanner("Text-to-Speech is unavailable for this language.");
      }
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F0EA] text-[#111111] flex flex-col">
      {/* Top Bar: Clean 3-Zone Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-[#FFD600] border-b-[3px] border-[#111111]">
        {/* Zone 1: Brand Title */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-xl font-extrabold tracking-tight text-[#111111] whitespace-nowrap shrink-0 font-display"
        >
          PolyGlot AI
        </a>

        {/* Zone 2: Quick Sample Scenarios */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-bold text-[#111111]">
          {SAMPLE_PRESETS.map((preset) => (
            <a
              key={preset.label}
              href={`#${preset.label}`}
              onClick={(e) => {
                e.preventDefault();
                setSourceLang(preset.sourceLang);
                setTargetLang(preset.targetLang);
                setTone(preset.tone);
                setFormality(preset.formality);
                setSourceText(preset.text);
                handleTranslate(
                  preset.text,
                  preset.sourceLang,
                  preset.targetLang,
                  preset.tone,
                  preset.formality
                );
              }}
              className="hover:underline decoration-2 underline-offset-4 whitespace-nowrap shrink-0"
            >
              {preset.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={isTranslating}
            onClick={() => handleTranslate()}
            className="nb-btn px-4 py-2 text-xs font-bold bg-[#111111] text-[#FFD600] rounded-none whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isTranslating ? "Translating..." : "Translate Now"}
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto p-5 md:p-8 space-y-6">
        {/* Error Banner */}
        {errorBanner && (
          <div
            role="alert"
            className="nb-card bg-[#FF9AA2] p-4 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 font-bold text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="nb-btn bg-white px-3 py-1 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Unified Neobrutalist Control Bar: Languages + Tone + Formality */}
        <section className="nb-card bg-[#FFFFFF] p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {/* Source Language */}
            <div className="md:col-span-3">
              <label
                htmlFor="source-lang-select"
                className="block text-xs font-bold mb-1.5 text-[#111111]"
              >
                From Language
              </label>
              <select
                id="source-lang-select"
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="nb-input w-full bg-[#FFFDF7] px-3 py-2.5 text-sm font-bold text-[#111111] cursor-pointer"
              >
                {SOURCE_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            {/* Swap Button */}
            <div className="md:col-span-1 flex justify-center">
              <button
                type="button"
                onClick={handleSwapLanguages}
                title="Swap Languages"
                className="nb-btn w-full md:w-auto px-3.5 py-2.5 bg-[#FFD600] text-[#111111] font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span className="md:hidden">Swap</span>
              </button>
            </div>

            {/* Target Language */}
            <div className="md:col-span-3">
              <label
                htmlFor="target-lang-select"
                className="block text-xs font-bold mb-1.5 text-[#111111]"
              >
                To Language
              </label>
              <select
                id="target-lang-select"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="nb-input w-full bg-[#A7F3D0] px-3 py-2.5 text-sm font-bold text-[#111111] cursor-pointer"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            {/* Tone Select */}
            <div className="md:col-span-3">
              <label
                htmlFor="tone-select"
                className="block text-xs font-bold mb-1.5 text-[#111111]"
              >
                Tone
              </label>
              <select
                id="tone-select"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="nb-input w-full bg-[#FFFDF7] px-3 py-2.5 text-sm font-bold text-[#111111] cursor-pointer"
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Formality Toggle */}
            <div className="md:col-span-2">
              <span className="block text-xs font-bold mb-1.5 text-[#111111]">
                Formality
              </span>
              <div className="grid grid-cols-2 border-2 border-[#111111] shadow-[3px_3px_0px_0px_#111111] bg-white">
                {FORMALITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFormality(option)}
                    className={`py-2.5 px-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      formality === option
                        ? "bg-[#111111] text-[#FFD600]"
                        : "bg-white text-[#111111] hover:bg-neutral-100"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Side-by-Side Source & Translation Cards */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Source Input Card */}
          <div className="nb-card bg-white p-5 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b-2 border-[#111111]">
                <span className="text-sm font-extrabold font-display">
                  Source Text ({sourceLang})
                </span>
                <span className="text-xs font-mono font-semibold text-neutral-600">
                  {tone} · {formality}
                </span>
              </div>

              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={8}
                placeholder="Type or paste text to translate..."
                className="nb-input w-full bg-[#FFFDF7] p-4 text-base font-medium text-[#111111] placeholder-neutral-400 resize-y leading-relaxed"
              />
            </div>

            <div className="pt-4 mt-4 border-t-2 border-[#111111] flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-mono font-bold tabular-nums text-neutral-700">
                <span>{wordCount.toLocaleString()} words</span>
                <span aria-hidden="true"> · </span>
                <span>{charCount.toLocaleString()} chars</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSourceText("");
                    setResult(null);
                    setAudioDataUrl(null);
                  }}
                  className="nb-btn px-3.5 py-2 text-xs font-bold bg-white text-[#111111] flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>

                <button
                  type="button"
                  disabled={isTranslating}
                  onClick={() => handleTranslate()}
                  className="nb-btn px-5 py-2 text-xs font-extrabold bg-[#FFD600] text-[#111111] disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Translating...</span>
                    </>
                  ) : (
                    <span>Translate</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Translation Output Card */}
          <div className="nb-card bg-white p-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b-2 border-[#111111]">
                <span className="text-sm font-extrabold font-display">
                  Translation ({targetLang})
                </span>
                {result?.detected_language && (
                  <span className="text-xs font-mono font-bold text-[#111111]">
                    Detected: {result.detected_language}
                  </span>
                )}
              </div>

              {isTranslating ? (
                <div className="min-h-[210px] border-2 border-[#111111] bg-[#FFFDF7] p-6 flex flex-col justify-center items-center gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-[#111111]" />
                  <p className="text-xs font-bold">
                    Translating to {targetLang}...
                  </p>
                </div>
              ) : result ? (
                <div className="space-y-4">
                  <div className="border-2 border-[#111111] bg-[#A7F3D0]/35 p-4 space-y-3">
                    <p className="text-lg md:text-xl font-bold text-[#111111] leading-relaxed whitespace-pre-wrap">
                      {result.translated_text}
                    </p>

                    {result.phonetic_transliteration && (
                      <div className="pt-3 border-t-2 border-[#111111]">
                        <span className="block text-[11px] font-bold text-neutral-700 mb-1">
                          Phonetic Pronunciation
                        </span>
                        <p className="text-sm font-mono font-semibold text-[#111111] leading-relaxed">
                          {result.phonetic_transliteration}
                        </p>
                      </div>
                    )}
                  </div>

                  {audioDataUrl && (
                    <div className="pt-1">
                      <audio
                        ref={audioRef}
                        controls
                        autoPlay
                        src={audioDataUrl}
                        className="w-full h-9"
                      />
                    </div>
                  )}

                  {ttsNotice && (
                    <p className="text-xs font-mono font-bold text-neutral-700">
                      {ttsNotice}
                    </p>
                  )}
                </div>
              ) : (
                <div className="min-h-[210px] border-2 border-dashed border-[#111111] bg-[#FFFDF7] p-6 flex flex-col justify-center items-center text-center">
                  <p className="text-sm font-bold text-neutral-600 max-w-xs">
                    Enter text on the left and click Translate.
                  </p>
                </div>
              )}
            </div>

            {/* Output Utility Actions */}
            <div className="pt-4 mt-4 border-t-2 border-[#111111] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={!result}
                  onClick={() => result && handleCopy(result.translated_text)}
                  className="nb-btn px-3.5 py-2 text-xs font-bold bg-[#FFFDF7] text-[#111111] disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedState ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!result || isGeneratingAudio}
                  onClick={handlePlayTTS}
                  className="nb-btn px-3.5 py-2 text-xs font-bold bg-[#7DD3FC] text-[#111111] disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isGeneratingAudio ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading Audio...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Listen</span>
                    </>
                  )}
                </button>
              </div>

              <button
                type="button"
                disabled={!result}
                onClick={handleDownloadTxt}
                className="nb-btn px-3.5 py-2 text-xs font-bold bg-white text-[#111111] disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .txt</span>
              </button>
            </div>
          </div>
        </section>

        {/* Expandable Cultural Nuance & Key Vocabulary Breakdown */}
        {result && (
          <section className="nb-card bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setIsBreakdownOpen(!isBreakdownOpen)}
              className="w-full px-5 py-4 bg-[#FFD600] border-b-2 border-[#111111] flex items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-[#111111]" />
                <span className="text-sm font-extrabold text-[#111111] font-display">
                  Cultural Nuances & Key Vocabulary
                </span>
              </div>
              {isBreakdownOpen ? (
                <ChevronUp className="w-5 h-5 text-[#111111]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#111111]" />
              )}
            </button>

            {isBreakdownOpen && (
              <div className="p-5 space-y-5">
                {/* Cultural Context Note */}
                <div className="border-2 border-[#111111] bg-[#FFFDF7] p-4">
                  <h3 className="text-xs font-extrabold text-[#111111] mb-1">
                    Cultural & Contextual Nuance
                  </h3>
                  <p className="text-sm font-medium text-[#111111] leading-relaxed">
                    {result.cultural_nuances}
                  </p>
                </div>

                {/* Vocabulary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(result.key_vocabulary || []).map((item, idx) => (
                    <div
                      key={`${item.word}-${idx}`}
                      className="border-2 border-[#111111] shadow-[3px_3px_0px_0px_#111111] bg-[#FFFDF7] p-4 flex flex-col justify-between gap-2"
                    >
                      <div>
                        <div className="text-base font-extrabold text-[#111111]">
                          {item.word}
                        </div>
                        <div className="text-xs font-mono font-bold text-neutral-700 mt-0.5">
                          {item.pronunciation} · {item.part_of_speech}
                        </div>
                      </div>
                      <p className="text-xs font-medium text-[#111111] leading-relaxed pt-2 border-t-2 border-[#111111]">
                        {item.meaning}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
