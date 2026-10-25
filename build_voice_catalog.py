"""
Builds voice_catalog.json for the Tweed Deerhead voice bank.

Pulls Microsoft's neural voice list (the same one Edge "Read Aloud" uses) and
narrows it to a curated set of countries, keeping a male and a female voice
wherever the service has one. The result is committed so the daemon never has
to hit the network just to show the picker.

Run manually when you want to refresh:
    python build_voice_catalog.py
"""

import asyncio
import json
import os
import sys

try:
    import edge_tts
except Exception as exc:  # pragma: no cover
    sys.exit("edge-tts is required: pip install --user edge-tts (%s)" % exc)

# locale -> (group, country label shown in the UI)
COUNTRIES = {
    # --- English speaking world (the ones asked for, first) ---
    "en-GB": ("English Voices", "British"),
    "en-AU": ("English Voices", "Australian"),
    "en-IN": ("English Voices", "Indian"),
    "en-IE": ("English Voices", "Irish"),
    "en-NZ": ("English Voices", "New Zealand"),
    "en-ZA": ("English Voices", "South African"),
    "en-CA": ("English Voices", "Canadian"),
    "en-SG": ("English Voices", "Singaporean"),
    "en-KE": ("English Voices", "Kenyan"),
    "en-TZ": ("English Voices", "Tanzanian"),
    "en-PH": ("English Voices", "Filipino"),
    "en-US": ("English Voices", "American"),

    # --- Rest of the world ---
    "es-ES": ("World Voices", "Spanish (Spain)"),
    "es-MX": ("World Voices", "Mexican Spanish"),
    "fr-FR": ("World Voices", "French"),
    "fr-CA": ("World Voices", "French (Canada)"),
    "de-DE": ("World Voices", "German"),
    "it-IT": ("World Voices", "Italian"),
    "pt-BR": ("World Voices", "Brazilian Portuguese"),
    "pt-PT": ("World Voices", "Portuguese"),
    "nl-NL": ("World Voices", "Dutch"),
    "sv-SE": ("World Voices", "Swedish"),
    "pl-PL": ("World Voices", "Polish"),
    "ru-RU": ("World Voices", "Russian"),
    "tr-TR": ("World Voices", "Turkish"),
    "hi-IN": ("World Voices", "Hindi"),
    "ja-JP": ("World Voices", "Japanese"),
    "ko-KR": ("World Voices", "Korean"),
    "zh-CN": ("World Voices", "Mandarin Chinese"),
    "ar-EG": ("World Voices", "Arabic (Egypt)"),
    "he-IL": ("World Voices", "Hebrew"),
    "el-GR": ("World Voices", "Greek"),
    "cs-CZ": ("World Voices", "Czech"),
    "da-DK": ("World Voices", "Danish"),
    "fi-FI": ("World Voices", "Finnish"),
    "nb-NO": ("World Voices", "Norwegian"),
    "hu-HU": ("World Voices", "Hungarian"),
    "ro-RO": ("World Voices", "Romanian"),
    "uk-UA": ("World Voices", "Ukrainian"),
    "vi-VN": ("World Voices", "Vietnamese"),
    "th-TH": ("World Voices", "Thai"),
    "id-ID": ("World Voices", "Indonesian"),
    "ms-MY": ("World Voices", "Malay"),
    "ta-IN": ("World Voices", "Tamil"),
    "te-IN": ("World Voices", "Telugu"),
    "bn-IN": ("World Voices", "Bengali"),
    "gu-IN": ("World Voices", "Gujarati"),
    "kn-IN": ("World Voices", "Kannada"),
    "ml-IN": ("World Voices", "Malayalam"),
    "mr-IN": ("World Voices", "Marathi"),
    "fa-IR": ("World Voices", "Persian"),
    "ur-PK": ("World Voices", "Urdu"),
}

# Voices we never want in the picker.
# Child voices don't suit a wall-mounted trophy, and a couple of them have no
# marker in their name so they are listed explicitly.
SKIP_MARKERS = ("Child",)
SKIP_VOICES = {
    "en-GB-MaisieNeural",
    "en-US-AnaNeural",
    "zh-CN-XiaoshuangNeural",
    "zh-CN-XiaoyouNeural",
    "ja-JP-ShioriNeural",
}

MAX_PER_GENDER = 2


def friendly_name(short_name):
    """en-GB-SoniaNeural -> Sonia ; en-IN-NeerjaExpressiveNeural -> Neerja Expressive"""
    core = short_name.split("-", 2)[2] if short_name.count("-") >= 2 else short_name
    core = core.replace("Neural", "").replace("Multilingual", "").replace("Expressive", " Expressive")
    core = core.strip()
    parts = []
    for chunk in core.replace("_", "").split():
        parts.append(chunk)
    # split CamelCase
    out = []
    for chunk in parts:
        word = ""
        for ch in chunk:
            if ch.isupper() and word:
                out.append(word)
                word = ch
            else:
                word += ch
        if word:
            out.append(word)
    return " ".join(out)


async def main():
    raw = await edge_tts.list_voices()

    voices = []
    for locale, (group, country) in COUNTRIES.items():
        matches = [v for v in raw if v.get("Locale") == locale]
        matches = [v for v in matches
                   if v["ShortName"] not in SKIP_VOICES
                   and not any(m in v["ShortName"] for m in SKIP_MARKERS)]
        matches.sort(key=lambda v: v["ShortName"])

        per_gender = {"Female": 0, "Male": 0}
        for v in matches:
            gender = v.get("Gender", "Unknown")
            if gender not in per_gender:
                continue
            if per_gender[gender] >= MAX_PER_GENDER:
                continue
            per_gender[gender] += 1
            voices.append({
                "id": "edge:" + v["ShortName"],
                "engine": "edge",
                "shortName": v["ShortName"],
                "name": friendly_name(v["ShortName"]),
                "gender": gender,
                "locale": locale,
                "country": country,
                "group": group,
            })

    # Local offline Scottish voice (Piper). Downloaded to voices/ on first use.
    voices.append({
        "id": "piper:en_GB-alba",
        "engine": "piper",
        "shortName": "en_GB-alba-medium",
        "name": "Alba",
        "gender": "Male",
        "locale": "en-GB-sct",
        "country": "Scottish",
        "group": "English Voices",
    })

    # Put the headline countries first inside their group
    priority = ["British", "Australian", "Indian", "Scottish", "Irish"]
    def sort_key(v):
        g = 0 if v["group"] == "English Voices" else 1
        p = priority.index(v["country"]) if v["country"] in priority else len(priority)
        return (g, p, v["country"], 0 if v["gender"] == "Female" else 1, v["name"])

    voices.sort(key=sort_key)

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voice_catalog.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"generated": True, "voices": voices}, fh, indent=2, ensure_ascii=False)

    print("wrote %s with %d voices" % (out_path, len(voices)))
    by_country = {}
    for v in voices:
        by_country.setdefault(v["country"], []).append("%s %s" % (v["gender"][0], v["name"]))
    for country, names in by_country.items():
        print("  %-22s %s" % (country, ", ".join(names)))


if __name__ == "__main__":
    asyncio.run(main())
