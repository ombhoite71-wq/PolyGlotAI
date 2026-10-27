import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
from typing import List, Optional

import streamlit as st
from dotenv import load_dotenv
from google import genai
from google.genai import types
from gtts import gTTS
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# 1. Environment & Page Configuration
# ---------------------------------------------------------------------------
load_dotenv()

st.set_page_config(
    page_title="PolyGlot AI — Language Translation Tool",
    page_icon="🌐",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ---------------------------------------------------------------------------
# 2. Language Registry & Code Mapping (Top 30 World Languages)
# ---------------------------------------------------------------------------
LANGUAGE_MAP = {
    "English": "en",
    "Hindi": "hi",
    "Marathi": "mr",
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Mandarin Chinese (Simplified)": "zh-CN",
    "Japanese": "ja",
    "Korean": "ko",
    "Arabic": "ar",
    "Portuguese": "pt",
    "Russian": "ru",
    "Italian": "it",
    "Bengali": "bn",
    "Tamil": "ta",
    "Telugu": "te",
    "Gujarati": "gu",
    "Punjabi": "pa",
    "Urdu": "ur",
    "Turkish": "tr",
    "Vietnamese": "vi",
    "Thai": "th",
    "Indonesian": "id",
    "Dutch": "nl",
    "Polish": "pl",
    "Ukrainian": "uk",
    "Greek": "el",
    "Hebrew": "iw",
    "Swedish": "sv",
    "Swahili": "sw",
}

TARGET_LANGUAGES = list(LANGUAGE_MAP.keys())
SOURCE_LANGUAGES = ["Auto-Detect"] + TARGET_LANGUAGES

TONE_OPTIONS = [
    "Professional/Corporate",
    "Casual/Colloquial",
    "Academic",
    "Travel & Everyday",
    "Poetic/Creative",
]

FORMALITY_OPTIONS = [
    "Formal",
    "Informal",
]


# ---------------------------------------------------------------------------
# 3. Structured Output Schema (Pydantic)
# ---------------------------------------------------------------------------
class VocabularyItem(BaseModel):
    word: str = Field(description="The translated word or phrase in the target language.")
    pronunciation: str = Field(description="Romanized phonetic guide for this specific word.")
    part_of_speech: str = Field(description="Grammatical category (e.g., Noun, Verb, Idiom).")
    meaning: str = Field(description="Concise definition and contextual role in English.")


class TranslationResult(BaseModel):
    translated_text: str = Field(
        description="The pure, natural translation in the target language matching the requested tone and formality."
    )
    phonetic_transliteration: str = Field(
        description="Complete Romanized pronunciation guide (e.g., Pinyin, Romaji, or Latin transliteration)."
    )
    detected_language: str = Field(
        description="The detected source language name (e.g., 'English', 'Marathi', 'Japanese')."
    )
    cultural_nuances: str = Field(
        description="A brief 1-2 sentence note explaining idioms, cultural context, or tone adjustments made."
    )
    key_vocabulary: List[VocabularyItem] = Field(
        description="A list of 2-3 key translated words or expressions with their individual meanings."
    )


# ---------------------------------------------------------------------------
# 4. Neobrutalism CSS (Overrides Streamlit Dark-Mode Widget Defaults)
# ---------------------------------------------------------------------------
def inject_custom_css() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

        /* Hide default Streamlit top chrome & sidebar toggle clutter */
        header[data-testid="stHeader"] {
            background: transparent !important;
        }
        section[data-testid="stSidebar"] {
            display: none !important;
        }

        html, body, .stApp {
            background-color: #F4F0EA !important;
            color: #111111 !important;
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif !important;
        }

        /* Force all Streamlit widget labels to be high-contrast black */
        label,
        div[data-testid="stWidgetLabel"] p,
        div[data-testid="stMarkdownContainer"] p,
        div[data-testid="stCaptionContainer"] p {
            color: #111111 !important;
            font-weight: 700 !important;
        }

        /* Neobrutalist Selectboxes */
        div[data-baseweb="select"] > div {
            background-color: #FFFFFF !important;
            color: #111111 !important;
            border: 3px solid #111111 !important;
            border-radius: 0px !important;
            box-shadow: 4px 4px 0px 0px #111111 !important;
            font-weight: 700 !important;
        }
        div[data-baseweb="select"] span,
        div[data-baseweb="select"] div {
            color: #111111 !important;
            font-weight: 700 !important;
        }
        div[data-baseweb="select"] svg {
            fill: #111111 !important;
        }

        /* Neobrutalist TextArea (Fixes dark background / black text clash) */
        div[data-testid="stTextArea"] textarea {
            background-color: #FFFFFF !important;
            color: #111111 !important;
            caret-color: #111111 !important;
            -webkit-text-fill-color: #111111 !important;
            border: 3px solid #111111 !important;
            border-radius: 0px !important;
            box-shadow: 5px 5px 0px 0px #111111 !important;
            font-size: 1.05rem !important;
            font-weight: 600 !important;
            line-height: 1.6 !important;
            padding: 1rem !important;
        }
        div[data-testid="stTextArea"] textarea::placeholder {
            color: #666666 !important;
            -webkit-text-fill-color: #666666 !important;
        }
        div[data-baseweb="textarea"] {
            background-color: #FFFFFF !important;
            border: none !important;
        }

        /* Neobrutalist Buttons (Fixes invisible Swap & Translate button text) */
        div.stButton > button,
        div.stDownloadButton > button {
            background-color: #FFD600 !important;
            color: #111111 !important;
            border: 3px solid #111111 !important;
            border-radius: 0px !important;
            box-shadow: 4px 4px 0px 0px #111111 !important;
            font-weight: 800 !important;
            padding: 0.55rem 1rem !important;
            transition: transform 0.1s ease, box-shadow 0.1s ease !important;
        }
        div.stButton > button p,
        div.stButton > button span,
        div.stDownloadButton > button p,
        div.stDownloadButton > button span {
            color: #111111 !important;
            font-weight: 800 !important;
        }
        div.stButton > button:hover,
        div.stDownloadButton > button:hover {
            background-color: #FFE033 !important;
            color: #111111 !important;
            transform: translate(-1px, -1px) !important;
            box-shadow: 5px 5px 0px 0px #111111 !important;
        }
        div.stButton > button:active,
        div.stDownloadButton > button:active {
            transform: translate(2px, 2px) !important;
            box-shadow: 1px 1px 0px 0px #111111 !important;
        }

        /* Neobrutalist Header & Cards */
        .pg-header {
            padding: 1.25rem 1.5rem;
            background: #FFD600;
            border: 3px solid #111111;
            box-shadow: 6px 6px 0px 0px #111111;
            margin-bottom: 1.5rem;
        }
        .pg-title {
            font-size: 1.85rem;
            font-weight: 800;
            color: #111111 !important;
            margin: 0;
            letter-spacing: -0.02em;
        }

        .pg-card {
            background: #A7F3D0;
            border: 3px solid #111111;
            box-shadow: 5px 5px 0px 0px #111111;
            padding: 1.25rem;
            margin-bottom: 1rem;
            min-height: 240px;
        }
        .pg-card-empty {
            background: #FFFFFF;
            border: 3px solid #111111;
            box-shadow: 5px 5px 0px 0px #111111;
            padding: 1.5rem;
            min-height: 240px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333333;
            font-weight: 700;
            text-align: center;
        }
        .pg-card-label {
            font-size: 0.82rem;
            font-weight: 800;
            color: #111111;
            margin-bottom: 0.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .pg-translation-body {
            font-size: 1.3rem;
            line-height: 1.6;
            color: #111111;
            font-weight: 800;
            padding: 0.35rem 0;
            white-space: pre-wrap;
        }
        .pg-phonetic-box {
            margin-top: 1rem;
            padding-top: 0.85rem;
            border-top: 2px solid #111111;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.9rem;
            font-weight: 700;
            color: #111111;
        }
        .pg-counter {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.82rem;
            font-weight: 800;
            color: #111111;
            text-align: right;
            margin-top: 0.4rem;
            margin-bottom: 0.6rem;
        }
        .pg-vocab-item {
            padding: 1rem;
            background: #FFFFFF;
            border: 3px solid #111111;
            box-shadow: 4px 4px 0px 0px #111111;
            margin-bottom: 0.75rem;
        }
        .pg-vocab-word {
            font-weight: 800;
            color: #111111;
            font-size: 1.05rem;
        }
        .pg-vocab-meta {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            font-weight: 700;
            color: #444444;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


# ---------------------------------------------------------------------------
# 5. Session State Initialization & Callbacks
# ---------------------------------------------------------------------------
def init_session_state() -> None:
    if "source_lang" not in st.session_state:
        st.session_state.source_lang = "Auto-Detect"
    if "target_lang" not in st.session_state:
        st.session_state.target_lang = "Japanese"
    if "tone" not in st.session_state:
        st.session_state.tone = "Professional/Corporate"
    if "formality" not in st.session_state:
        st.session_state.formality = "Formal"
    if "source_text" not in st.session_state:
        st.session_state.source_text = (
            "We appreciate your team's thorough review of the quarterly architecture proposal. "
            "Let's align on the final deployment milestones by Friday."
        )
    if "translation_output" not in st.session_state:
        st.session_state.translation_output = None


def handle_swap_languages() -> None:
    src = st.session_state.source_lang
    tgt = st.session_state.target_lang

    if src == "Auto-Detect":
        detected = (
            st.session_state.translation_output.get("detected_language")
            if st.session_state.translation_output
            else None
        )
        if detected and detected in TARGET_LANGUAGES:
            st.session_state.source_lang = tgt
            st.session_state.target_lang = detected
        else:
            st.session_state.source_lang = tgt
            st.session_state.target_lang = "English" if tgt != "English" else "Spanish"
    else:
        st.session_state.source_lang = tgt
        st.session_state.target_lang = src

    if st.session_state.translation_output and st.session_state.translation_output.get("translated_text"):
        st.session_state.source_text = st.session_state.translation_output["translated_text"]


# ---------------------------------------------------------------------------
# 6. Dual-Engine Translation (Gemini 2.5 Flash + Keyless Google Translate API)
# ---------------------------------------------------------------------------
def parse_json_safely(raw_text: str) -> dict:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise ValueError("Unable to parse structured JSON response.")


def google_translate_fallback(
    text: str,
    source_lang: str,
    target_lang: str,
    tone: str,
    formality: str,
) -> dict:
    """Keyless Google Translate API fallback so the app works immediately without any API key."""
    sl = "auto" if source_lang == "Auto-Detect" else LANGUAGE_MAP.get(source_lang, "en")
    tl = LANGUAGE_MAP.get(target_lang, "en")

    params = urllib.parse.urlencode(
        {
            "client": "gtx",
            "sl": sl,
            "tl": tl,
            "dt": ["t", "rm"],
            "q": text,
        },
        doseq=True,
    )
    url = f"https://translate.googleapis.com/translate_a/single?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    translated_chunks = []
    phonetic_chunks = []
    if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
        for seg in data[0]:
            if isinstance(seg, list):
                if len(seg) > 0 and seg[0]:
                    translated_chunks.append(str(seg[0]))
                if len(seg) > 2 and seg[2]:
                    phonetic_chunks.append(str(seg[2]))

    translated_str = "".join(translated_chunks) or text
    phonetic_str = " ".join(phonetic_chunks).strip()
    detected_code = data[2] if isinstance(data, list) and len(data) > 2 else sl
    code_to_name = {v.lower(): k for k, v in LANGUAGE_MAP.items()}
    detected_name = code_to_name.get(str(detected_code).lower(), str(detected_code).upper())

    return {
        "translated_text": translated_str,
        "phonetic_transliteration": phonetic_str or "Standard script pronunciation",
        "detected_language": detected_name if source_lang == "Auto-Detect" else source_lang,
        "cultural_nuances": f"Translated into {target_lang} calibrated for a {tone} ({formality}) context.",
        "key_vocabulary": [],
    }


def run_translation(
    api_key: str,
    text: str,
    source_lang: str,
    target_lang: str,
    tone: str,
    formality: str,
) -> dict:
    # 1. If a Gemini API key is configured, try Gemini 2.5 Flash with automatic retry
    if api_key:
        client = genai.Client(api_key=api_key)
        system_instruction = (
            "You are PolyGlot AI, a Context-Aware Translation Engine. "
            "Translate the user's input accurately while adapting idioms, honorifics, and register to match "
            "the specified Translation Tone and Formality level. "
            "Return valid JSON matching the requested schema."
        )
        prompt = (
            f"Source Language: {source_lang}\n"
            f"Target Language: {target_lang}\n"
            f"Translation Tone: {tone}\n"
            f"Target Audience / Formality: {formality}\n\n"
            f"Source Text:\n{text}"
        )

        candidate_models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]
        for model_name in candidate_models:
            for attempt in range(2):
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            response_mime_type="application/json",
                            response_schema=TranslationResult,
                            temperature=0.3,
                        ),
                    )
                    if response and response.text:
                        return parse_json_safely(response.text)
                except Exception as exc:
                    err_str = str(exc).upper()
                    if "503" in err_str or "UNAVAILABLE" in err_str or "OVERLOADED" in err_str:
                        time.sleep(1.2 * (attempt + 1))
                        continue
                    break

    # 2. Automatic fallback to keyless Google Translate API
    return google_translate_fallback(text, source_lang, target_lang, tone, formality)


# ---------------------------------------------------------------------------
# 7. Native Text-to-Speech (gTTS + BytesIO)
# ---------------------------------------------------------------------------
def synthesize_speech_bytes(text: str, target_language: str) -> tuple[Optional[io.BytesIO], str]:
    lang_code = LANGUAGE_MAP.get(target_language, "en")
    audio_buffer = io.BytesIO()
    try:
        tts = gTTS(text=text, lang=lang_code, slow=False)
        tts.write_to_fp(audio_buffer)
        audio_buffer.seek(0)
        return audio_buffer, lang_code
    except Exception:
        fallback_code = lang_code.split("-")[0] if "-" in lang_code else "en"
        try:
            audio_buffer = io.BytesIO()
            tts = gTTS(text=text, lang=fallback_code, slow=False)
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            return audio_buffer, fallback_code
        except Exception as err:
            return None, str(err)


def build_download_report(
    source_text: str,
    source_lang: str,
    target_lang: str,
    tone: str,
    formality: str,
    result: dict,
) -> str:
    return (
        "====================================================================\n"
        "POLYGLOT AI - TRANSLATION REPORT\n"
        "====================================================================\n"
        f"Source Language : {result.get('detected_language') or source_lang}\n"
        f"Target Language : {target_lang}\n"
        f"Tone            : {tone}\n"
        f"Formality       : {formality}\n"
        "--------------------------------------------------------------------\n\n"
        "ORIGINAL TEXT:\n"
        f"{source_text.strip()}\n\n"
        "TRANSLATED TEXT:\n"
        f"{result.get('translated_text', '')}\n\n"
        "ROMANIZED PRONUNCIATION:\n"
        f"{result.get('phonetic_transliteration', '')}\n"
        "====================================================================\n"
    )


# ---------------------------------------------------------------------------
# 8. Main Application Layout (Neobrutalism, Zero Clutter)
# ---------------------------------------------------------------------------
def main() -> None:
    inject_custom_css()
    init_session_state()

    env_api_key = os.getenv("GEMINI_API_KEY", "").strip()

    # Neobrutalist Top Header Banner
    st.markdown(
        """
        <div class="pg-header">
            <h1 class="pg-title">PolyGlot AI</h1>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Unified Control Bar: Source Language | Swap | Target Language | Tone | Formality
    c_src, c_swap, c_tgt, c_tone, c_form = st.columns([3, 1.1, 3, 2.8, 2])
    with c_src:
        st.selectbox("From Language", options=SOURCE_LANGUAGES, key="source_lang")
    with c_swap:
        st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
        st.button("⇄ Swap", on_click=handle_swap_languages, use_container_width=True)
    with c_tgt:
        st.selectbox("To Language", options=TARGET_LANGUAGES, key="target_lang")
    with c_tone:
        selected_tone = st.selectbox("Tone", options=TONE_OPTIONS, key="tone")
    with c_form:
        selected_formality = st.selectbox("Formality", options=FORMALITY_OPTIONS, key="formality")

    st.markdown("<div style='height: 12px;'></div>", unsafe_allow_html=True)

    # Side-by-Side Source & Translation Cards
    input_col, output_col = st.columns(2, gap="large")

    with input_col:
        st.markdown(
            f'<div class="pg-card-label"><span>SOURCE TEXT ({st.session_state.source_lang})</span>'
            f'<span>{selected_tone} · {selected_formality}</span></div>',
            unsafe_allow_html=True,
        )
        source_text = st.text_area(
            label="Source Text",
            key="source_text",
            height=240,
            label_visibility="collapsed",
            placeholder="Type or paste text to translate...",
        )

        char_count = len(source_text)
        word_count = len(source_text.strip().split()) if source_text.strip() else 0
        st.markdown(
            f'<div class="pg-counter">{word_count:,} words · {char_count:,} chars</div>',
            unsafe_allow_html=True,
        )

        translate_clicked = st.button(
            "Translate Now",
            use_container_width=True,
        )

    # Run translation automatically on first load or when button clicked
    if translate_clicked or st.session_state.translation_output is None:
        if source_text and source_text.strip():
            with st.spinner(f"Translating to {st.session_state.target_lang}..."):
                try:
                    st.session_state.translation_output = run_translation(
                        api_key=env_api_key,
                        text=source_text.strip(),
                        source_lang=st.session_state.source_lang,
                        target_lang=st.session_state.target_lang,
                        tone=selected_tone,
                        formality=selected_formality,
                    )
                except Exception as exc:
                    st.error(f"Translation Error: {exc}")

    with output_col:
        result = st.session_state.translation_output
        detected_badge = (
            f"Detected: {result.get('detected_language', st.session_state.source_lang)}"
            if result
            else "Ready"
        )
        st.markdown(
            f'<div class="pg-card-label"><span>TRANSLATION ({st.session_state.target_lang})</span>'
            f'<span>{detected_badge}</span></div>',
            unsafe_allow_html=True,
        )

        if result:
            translated_str = result.get("translated_text", "")
            phonetic_str = result.get("phonetic_transliteration", "")

            st.markdown(
                f"""
                <div class="pg-card">
                    <div class="pg-translation-body">{translated_str}</div>
                    <div class="pg-phonetic-box">
                        Pronunciation: {phonetic_str if phonetic_str else "N/A"}
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            st.code(translated_str, language=None)

            u_col1, u_col2 = st.columns(2)
            with u_col1:
                report_txt = build_download_report(
                    source_text=source_text,
                    source_lang=st.session_state.source_lang,
                    target_lang=st.session_state.target_lang,
                    tone=selected_tone,
                    formality=selected_formality,
                    result=result,
                )
                st.download_button(
                    label="⬇ Download .txt",
                    data=report_txt.encode("utf-8"),
                    file_name=f"polyglot_{st.session_state.target_lang.lower().replace(' ', '_')}.txt",
                    mime="text/plain",
                    use_container_width=True,
                )
            with u_col2:
                audio_fp, _ = synthesize_speech_bytes(
                    text=translated_str,
                    target_language=st.session_state.target_lang,
                )
                if audio_fp:
                    st.audio(audio_fp, format="audio/mp3")
        else:
            st.markdown(
                '<div class="pg-card-empty">Enter text on the left and click Translate Now.</div>',
                unsafe_allow_html=True,
            )

    # Optional Cultural & Vocabulary Breakdown below
    if st.session_state.translation_output:
        res = st.session_state.translation_output
        vocab_list = res.get("key_vocabulary", [])
        nuance = res.get("cultural_nuances", "")
        if nuance or vocab_list:
            st.markdown("<div style='height: 12px;'></div>", unsafe_allow_html=True)
            st.markdown(
                f"""
                <div class="pg-vocab-item" style="background:#FFFDF7;">
                    <div class="pg-vocab-word">Cultural & Contextual Nuance</div>
                    <div style="margin-top:0.35rem;font-weight:600;">{nuance}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
            if vocab_list:
                v_cols = st.columns(min(len(vocab_list), 3))
                for idx, item in enumerate(vocab_list):
                    with v_cols[idx % len(v_cols)]:
                        st.markdown(
                            f"""
                            <div class="pg-vocab-item">
                                <div class="pg-vocab-word">{item.get('word', '')}</div>
                                <div class="pg-vocab-meta">{item.get('pronunciation', '')} · {item.get('part_of_speech', '')}</div>
                                <div style="margin-top: 0.4rem; font-size: 0.9rem; font-weight: 600;">
                                    {item.get('meaning', '')}
                                </div>
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )


if __name__ == "__main__":
    main()
