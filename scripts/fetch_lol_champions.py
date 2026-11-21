#!/usr/bin/env python3
"""
fetch_lol_champions.py — Récupère l'ensemble des champions de League of Legends
en français depuis l'API officielle Riot Data Dragon et génère data/lol_champions.json.

Aucune dépendance externe requise (bibliothèque standard Python 3 uniquement).

Exemples :
    python scripts/fetch_lol_champions.py
    python scripts/fetch_lol_champions.py --output data/lol_champions.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
DDRAGON_CHAMPIONS_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/data/fr_FR/championFull.json"
DDRAGON_SPLASH_URL = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/{id}_0.jpg"
DDRAGON_ICON_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{id}.png"
MERAKI_URL = "https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json"
USER_AGENT = "PokeNator-LoL-Fetcher/1.0"

ROLE_FR: Dict[str, str] = {
    "Assassin": "Assassin",
    "Fighter": "Combattant",
    "Mage": "Mage",
    "Marksman": "Tireur",
    "Support": "Support",
    "Tank": "Tank",
}

LANE_MAP: Dict[str, str] = {
    "TOP": "Top",
    "JUNGLE": "Jungle",
    "MIDDLE": "Mid",
    "BOTTOM": "ADC",
    "SUPPORT": "Support",
}

# Métadonnées de Runeterra et de gameplay par ID Data Dragon :
# (region, lanes, gender, species, damage_type, release_year)
# gender : "Homme" | "Femme" | "Autre"
# species : "Humain" | "Yordle" | "Vastaya" | "Démon" | "Néant" | "Dragon" |
#           "Mort-vivant" | "Robot / Golem" | "Divinité / Aspect" | "Darkin" | "Monstre / Esprit"
# damage_type : "Physique" | "Magique" | "Hybride"
CHAMPION_META: Dict[str, Tuple[str, List[str], str, str, str, int]] = {
    "Aatrox": ("Runeterra", ["Top"], "Homme", "Darkin", "Physique", 2013),
    "Ahri": ("Ionia", ["Mid"], "Femme", "Vastaya", "Magique", 2011),
    "Akali": ("Ionia", ["Mid", "Top"], "Femme", "Humain", "Magique", 2010),
    "Akshan": ("Shurima", ["Mid", "Top"], "Homme", "Humain", "Physique", 2021),
    "Alistar": ("Runeterra", ["Support"], "Homme", "Monstre / Esprit", "Magique", 2009),
    "Ambessa": ("Noxus", ["Top", "Jungle"], "Femme", "Humain", "Physique", 2024),
    "Amumu": ("Shurima", ["Jungle", "Support"], "Homme", "Mort-vivant", "Magique", 2009),
    "Anivia": ("Freljord", ["Mid"], "Femme", "Divinité / Aspect", "Magique", 2009),
    "Annie": ("Runeterra", ["Mid", "Support"], "Femme", "Humain", "Magique", 2009),
    "Aphelios": ("Targon", ["ADC"], "Homme", "Humain", "Physique", 2019),
    "Ashe": ("Freljord", ["ADC", "Support"], "Femme", "Humain", "Physique", 2009),
    "AurelionSol": ("Targon", ["Mid"], "Homme", "Dragon", "Magique", 2016),
    "Aurora": ("Freljord", ["Mid", "Top"], "Femme", "Vastaya", "Magique", 2024),
    "Azir": ("Shurima", ["Mid"], "Homme", "Divinité / Aspect", "Magique", 2014),
    "Bard": ("Runeterra", ["Support"], "Autre", "Divinité / Aspect", "Magique", 2015),
    "Belveth": ("Néant", ["Jungle"], "Femme", "Néant", "Physique", 2022),
    "Blitzcrank": ("Zaun", ["Support"], "Autre", "Robot / Golem", "Magique", 2009),
    "Brand": ("Runeterra", ["Support", "Mid", "Jungle"], "Homme", "Monstre / Esprit", "Magique", 2011),
    "Braum": ("Freljord", ["Support"], "Homme", "Humain", "Magique", 2014),
    "Briar": ("Noxus", ["Jungle"], "Femme", "Monstre / Esprit", "Physique", 2023),
    "Caitlyn": ("Piltover", ["ADC"], "Femme", "Humain", "Physique", 2011),
    "Camille": ("Piltover", ["Top"], "Femme", "Humain", "Physique", 2016),
    "Cassiopeia": ("Noxus", ["Mid", "Top"], "Femme", "Monstre / Esprit", "Magique", 2010),
    "Chogath": ("Néant", ["Top"], "Autre", "Néant", "Magique", 2009),
    "Corki": ("Bandle", ["ADC", "Mid"], "Homme", "Yordle", "Physique", 2009),
    "Darius": ("Noxus", ["Top"], "Homme", "Humain", "Physique", 2012),
    "Diana": ("Targon", ["Jungle", "Mid"], "Femme", "Divinité / Aspect", "Magique", 2012),
    "DrMundo": ("Zaun", ["Top", "Jungle"], "Homme", "Humain", "Physique", 2009),
    "Draven": ("Noxus", ["ADC"], "Homme", "Humain", "Physique", 2012),
    "Ekko": ("Zaun", ["Mid", "Jungle"], "Homme", "Humain", "Magique", 2015),
    "Elise": ("Îles Obscures", ["Jungle"], "Femme", "Monstre / Esprit", "Magique", 2012),
    "Evelynn": ("Runeterra", ["Jungle"], "Femme", "Démon", "Magique", 2009),
    "Ezreal": ("Piltover", ["ADC"], "Homme", "Humain", "Physique", 2010),
    "Fiddlesticks": ("Runeterra", ["Jungle"], "Autre", "Démon", "Magique", 2009),
    "Fiora": ("Demacia", ["Top"], "Femme", "Humain", "Physique", 2012),
    "Fizz": ("Bilgewater", ["Mid"], "Homme", "Yordle", "Magique", 2011),
    "Galio": ("Demacia", ["Mid", "Support"], "Homme", "Robot / Golem", "Magique", 2010),
    "Gangplank": ("Bilgewater", ["Top"], "Homme", "Humain", "Physique", 2009),
    "Garen": ("Demacia", ["Top"], "Homme", "Humain", "Physique", 2010),
    "Gnar": ("Freljord", ["Top"], "Homme", "Yordle", "Physique", 2014),
    "Gragas": ("Freljord", ["Top", "Jungle", "Mid"], "Homme", "Humain", "Magique", 2010),
    "Graves": ("Bilgewater", ["Jungle"], "Homme", "Humain", "Physique", 2011),
    "Gwen": ("Îles Obscures", ["Top"], "Femme", "Humain", "Magique", 2021),
    "Hecarim": ("Îles Obscures", ["Jungle"], "Homme", "Mort-vivant", "Physique", 2012),
    "Heimerdinger": ("Piltover", ["Top", "Mid", "Support"], "Homme", "Yordle", "Magique", 2009),
    "Hwei": ("Ionia", ["Mid", "Support"], "Homme", "Humain", "Magique", 2023),
    "Illaoi": ("Bilgewater", ["Top"], "Femme", "Humain", "Physique", 2015),
    "Irelia": ("Ionia", ["Top", "Mid"], "Femme", "Humain", "Physique", 2010),
    "Ivern": ("Ionia", ["Jungle"], "Homme", "Monstre / Esprit", "Magique", 2016),
    "Janna": ("Zaun", ["Support"], "Femme", "Divinité / Aspect", "Magique", 2009),
    "JarvanIV": ("Demacia", ["Jungle"], "Homme", "Humain", "Physique", 2011),
    "Jax": ("Runeterra", ["Top", "Jungle"], "Homme", "Monstre / Esprit", "Hybride", 2009),
    "Jayce": ("Piltover", ["Top", "Mid"], "Homme", "Humain", "Physique", 2012),
    "Jhin": ("Ionia", ["ADC"], "Homme", "Humain", "Physique", 2016),
    "Jinx": ("Zaun", ["ADC"], "Femme", "Humain", "Physique", 2013),
    "KSante": ("Shurima", ["Top"], "Homme", "Humain", "Physique", 2022),
    "Kaisa": ("Néant", ["ADC"], "Femme", "Humain", "Hybride", 2018),
    "Kalista": ("Îles Obscures", ["ADC"], "Femme", "Mort-vivant", "Physique", 2014),
    "Karma": ("Ionia", ["Support", "Mid"], "Femme", "Humain", "Magique", 2011),
    "Karthus": ("Îles Obscures", ["Jungle", "ADC"], "Homme", "Mort-vivant", "Magique", 2009),
    "Kassadin": ("Néant", ["Mid"], "Homme", "Humain", "Magique", 2009),
    "Katarina": ("Noxus", ["Mid"], "Femme", "Humain", "Hybride", 2009),
    "Kayle": ("Demacia", ["Top"], "Femme", "Divinité / Aspect", "Hybride", 2009),
    "Kayn": ("Ionia", ["Jungle"], "Homme", "Darkin", "Physique", 2017),
    "Kennen": ("Ionia", ["Top"], "Homme", "Yordle", "Magique", 2010),
    "Khazix": ("Néant", ["Jungle"], "Homme", "Néant", "Physique", 2012),
    "Kindred": ("Runeterra", ["Jungle"], "Autre", "Divinité / Aspect", "Physique", 2015),
    "Kled": ("Noxus", ["Top"], "Homme", "Yordle", "Physique", 2016),
    "KogMaw": ("Néant", ["ADC"], "Autre", "Néant", "Hybride", 2010),
    "Leblanc": ("Noxus", ["Mid"], "Femme", "Humain", "Magique", 2010),
    "LeeSin": ("Ionia", ["Jungle"], "Homme", "Humain", "Physique", 2011),
    "Leona": ("Targon", ["Support"], "Femme", "Divinité / Aspect", "Magique", 2011),
    "Lillia": ("Ionia", ["Jungle"], "Femme", "Monstre / Esprit", "Magique", 2020),
    "Lissandra": ("Freljord", ["Mid"], "Femme", "Humain", "Magique", 2013),
    "Lucian": ("Runeterra", ["ADC"], "Homme", "Humain", "Physique", 2013),
    "Lulu": ("Bandle", ["Support"], "Femme", "Yordle", "Magique", 2012),
    "Lux": ("Demacia", ["Mid", "Support"], "Femme", "Humain", "Magique", 2010),
    "Malphite": ("Ixtal", ["Top"], "Homme", "Robot / Golem", "Magique", 2009),
    "Malzahar": ("Néant", ["Mid"], "Homme", "Humain", "Magique", 2010),
    "Maokai": ("Îles Obscures", ["Support", "Jungle", "Top"], "Homme", "Monstre / Esprit", "Magique", 2011),
    "MasterYi": ("Ionia", ["Jungle"], "Homme", "Humain", "Physique", 2009),
    "Mel": ("Noxus", ["Mid", "Support"], "Femme", "Humain", "Magique", 2025),
    "Milio": ("Ixtal", ["Support"], "Homme", "Humain", "Magique", 2023),
    "MissFortune": ("Bilgewater", ["ADC"], "Femme", "Humain", "Physique", 2010),
    "MonkeyKing": ("Ionia", ["Jungle", "Top"], "Homme", "Vastaya", "Physique", 2011),
    "Mordekaiser": ("Noxus", ["Top"], "Homme", "Mort-vivant", "Magique", 2010),
    "Morgana": ("Demacia", ["Support", "Mid"], "Femme", "Divinité / Aspect", "Magique", 2009),
    "Naafiri": ("Shurima", ["Mid", "Jungle"], "Femme", "Darkin", "Physique", 2023),
    "Nami": ("Runeterra", ["Support"], "Femme", "Vastaya", "Magique", 2012),
    "Nasus": ("Shurima", ["Top"], "Homme", "Divinité / Aspect", "Physique", 2009),
    "Nautilus": ("Bilgewater", ["Support"], "Homme", "Mort-vivant", "Magique", 2012),
    "Neeko": ("Ixtal", ["Mid", "Support"], "Femme", "Vastaya", "Magique", 2018),
    "Nidalee": ("Ixtal", ["Jungle"], "Femme", "Humain", "Magique", 2009),
    "Nilah": ("Bilgewater", ["ADC"], "Femme", "Humain", "Physique", 2022),
    "Nocturne": ("Runeterra", ["Jungle"], "Homme", "Démon", "Physique", 2011),
    "Nunu": ("Freljord", ["Jungle"], "Homme", "Humain", "Magique", 2009),
    "Olaf": ("Freljord", ["Top", "Jungle"], "Homme", "Humain", "Physique", 2010),
    "Orianna": ("Piltover", ["Mid"], "Femme", "Robot / Golem", "Magique", 2011),
    "Ornn": ("Freljord", ["Top"], "Homme", "Divinité / Aspect", "Magique", 2017),
    "Pantheon": ("Targon", ["Top", "Jungle", "Mid", "Support"], "Homme", "Divinité / Aspect", "Physique", 2010),
    "Poppy": ("Demacia", ["Top", "Jungle", "Support"], "Femme", "Yordle", "Physique", 2010),
    "Pyke": ("Bilgewater", ["Support"], "Homme", "Mort-vivant", "Physique", 2018),
    "Qiyana": ("Ixtal", ["Mid", "Jungle"], "Femme", "Humain", "Physique", 2019),
    "Quinn": ("Demacia", ["Top"], "Femme", "Humain", "Physique", 2013),
    "Rakan": ("Ionia", ["Support"], "Homme", "Vastaya", "Magique", 2017),
    "Rammus": ("Shurima", ["Jungle"], "Homme", "Monstre / Esprit", "Magique", 2009),
    "RekSai": ("Néant", ["Jungle"], "Femme", "Néant", "Physique", 2014),
    "Rell": ("Noxus", ["Support"], "Femme", "Humain", "Magique", 2020),
    "Renata": ("Zaun", ["Support"], "Femme", "Humain", "Magique", 2022),
    "Renekton": ("Shurima", ["Top"], "Homme", "Divinité / Aspect", "Physique", 2011),
    "Rengar": ("Ixtal", ["Jungle", "Top"], "Homme", "Vastaya", "Physique", 2012),
    "Riven": ("Noxus", ["Top"], "Femme", "Humain", "Physique", 2011),
    "Rumble": ("Bandle", ["Top"], "Homme", "Yordle", "Magique", 2011),
    "Ryze": ("Runeterra", ["Mid"], "Homme", "Humain", "Magique", 2009),
    "Samira": ("Noxus", ["ADC"], "Femme", "Humain", "Physique", 2020),
    "Sejuani": ("Freljord", ["Jungle"], "Femme", "Humain", "Magique", 2012),
    "Senna": ("Îles Obscures", ["Support", "ADC"], "Femme", "Humain", "Physique", 2019),
    "Seraphine": ("Piltover", ["Support", "Mid", "ADC"], "Femme", "Humain", "Magique", 2020),
    "Sett": ("Ionia", ["Top"], "Homme", "Vastaya", "Physique", 2020),
    "Shaco": ("Runeterra", ["Jungle", "Support"], "Homme", "Démon", "Hybride", 2009),
    "Shen": ("Ionia", ["Top", "Support"], "Homme", "Humain", "Hybride", 2010),
    "Shyvana": ("Demacia", ["Jungle"], "Femme", "Dragon", "Hybride", 2011),
    "Singed": ("Zaun", ["Top"], "Homme", "Humain", "Magique", 2009),
    "Sion": ("Noxus", ["Top"], "Homme", "Mort-vivant", "Physique", 2009),
    "Sivir": ("Shurima", ["ADC"], "Femme", "Humain", "Physique", 2009),
    "Skarner": ("Ixtal", ["Jungle", "Top"], "Homme", "Monstre / Esprit", "Physique", 2011),
    "Smolder": ("Runeterra", ["ADC", "Mid"], "Homme", "Dragon", "Physique", 2024),
    "Sona": ("Demacia", ["Support"], "Femme", "Humain", "Magique", 2010),
    "Soraka": ("Targon", ["Support"], "Femme", "Divinité / Aspect", "Magique", 2009),
    "Swain": ("Noxus", ["Mid", "Support"], "Homme", "Humain", "Magique", 2010),
    "Sylas": ("Demacia", ["Mid", "Jungle"], "Homme", "Humain", "Magique", 2019),
    "Syndra": ("Ionia", ["Mid"], "Femme", "Humain", "Magique", 2012),
    "TahmKench": ("Bilgewater", ["Support", "Top"], "Homme", "Démon", "Magique", 2015),
    "Taliyah": ("Shurima", ["Mid", "Jungle"], "Femme", "Humain", "Magique", 2016),
    "Talon": ("Noxus", ["Mid", "Jungle"], "Homme", "Humain", "Physique", 2011),
    "Taric": ("Targon", ["Support"], "Homme", "Divinité / Aspect", "Magique", 2009),
    "Teemo": ("Bandle", ["Top"], "Homme", "Yordle", "Magique", 2009),
    "Thresh": ("Îles Obscures", ["Support"], "Homme", "Mort-vivant", "Magique", 2013),
    "Tristana": ("Bandle", ["ADC", "Mid"], "Femme", "Yordle", "Physique", 2009),
    "Trundle": ("Freljord", ["Top", "Jungle"], "Homme", "Monstre / Esprit", "Physique", 2010),
    "Tryndamere": ("Freljord", ["Top"], "Homme", "Humain", "Physique", 2009),
    "TwistedFate": ("Bilgewater", ["Mid"], "Homme", "Humain", "Magique", 2009),
    "Twitch": ("Zaun", ["ADC"], "Homme", "Monstre / Esprit", "Physique", 2009),
    "Udyr": ("Freljord", ["Jungle", "Top"], "Homme", "Humain", "Hybride", 2009),
    "Urgot": ("Zaun", ["Top"], "Homme", "Humain", "Physique", 2010),
    "Varus": ("Ionia", ["ADC"], "Homme", "Darkin", "Physique", 2012),
    "Vayne": ("Demacia", ["ADC", "Top"], "Femme", "Humain", "Physique", 2011),
    "Veigar": ("Bandle", ["Mid"], "Homme", "Yordle", "Magique", 2009),
    "Velkoz": ("Néant", ["Support", "Mid"], "Autre", "Néant", "Magique", 2014),
    "Vex": ("Îles Obscures", ["Mid"], "Femme", "Yordle", "Magique", 2021),
    "Vi": ("Piltover", ["Jungle"], "Femme", "Humain", "Physique", 2012),
    "Viego": ("Îles Obscures", ["Jungle"], "Homme", "Mort-vivant", "Physique", 2021),
    "Viktor": ("Zaun", ["Mid"], "Homme", "Humain", "Magique", 2011),
    "Vladimir": ("Noxus", ["Mid", "Top"], "Homme", "Humain", "Magique", 2010),
    "Volibear": ("Freljord", ["Top", "Jungle"], "Homme", "Divinité / Aspect", "Hybride", 2011),
    "Warwick": ("Zaun", ["Jungle", "Top"], "Homme", "Monstre / Esprit", "Hybride", 2009),
    "Xayah": ("Ionia", ["ADC"], "Femme", "Vastaya", "Physique", 2017),
    "Xerath": ("Shurima", ["Mid", "Support"], "Homme", "Divinité / Aspect", "Magique", 2011),
    "XinZhao": ("Demacia", ["Jungle"], "Homme", "Humain", "Physique", 2010),
    "Yasuo": ("Ionia", ["Mid", "Top"], "Homme", "Humain", "Physique", 2013),
    "Yone": ("Ionia", ["Mid", "Top"], "Homme", "Humain", "Hybride", 2020),
    "Yorick": ("Îles Obscures", ["Top"], "Homme", "Humain", "Physique", 2011),
    "Yuumi": ("Bandle", ["Support"], "Femme", "Monstre / Esprit", "Magique", 2019),
    "Zac": ("Zaun", ["Jungle", "Top"], "Homme", "Monstre / Esprit", "Magique", 2013),
    "Zed": ("Ionia", ["Mid", "Jungle"], "Homme", "Humain", "Physique", 2012),
    "Zeri": ("Zaun", ["ADC"], "Femme", "Humain", "Physique", 2022),
    "Ziggs": ("Zaun", ["ADC", "Mid"], "Homme", "Yordle", "Magique", 2012),
    "Zilean": ("Runeterra", ["Support", "Mid"], "Homme", "Humain", "Magique", 2009),
    "Zoe": ("Targon", ["Mid"], "Femme", "Divinité / Aspect", "Magique", 2017),
    "Zyra": ("Ixtal", ["Support", "Jungle"], "Femme", "Monstre / Esprit", "Magique", 2012),
}

GLOBAL_ULT_CHAMPS = {
    "Ashe", "AurelionSol", "Briar", "Draven", "Ezreal", "Galio", "Gangplank",
    "Jinx", "Karthus", "Nocturne", "Pantheon", "Ryze", "Senna", "Shen",
    "Soraka", "Taliyah", "TwistedFate", "Vex", "Xerath", "Ziggs",
}

STEALTH_CHAMPS = {
    "Akali", "Akshan", "Aurora", "Evelynn", "Kaisa", "Khazix", "Leblanc",
    "MonkeyKing", "Neeko", "Pyke", "Qiyana", "Rengar", "Senna", "Shaco",
    "Talon", "Teemo", "Twitch", "Vayne", "Viego",
}

SUMMON_CHAMPS = {
    "Annie", "Azir", "Belveth", "Elise", "Heimerdinger", "Ivern", "Kalista",
    "Leblanc", "Malzahar", "Maokai", "Naafiri", "Neeko", "Orianna", "Shaco",
    "Yorick", "Zyra",
}


def fetch_json(url: str, timeout: float = 20.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_resource(partype: str) -> str:
    low = (partype or "").strip().lower()
    if low == "mana":
        return "Mana"
    if "énergie" in low or "energy" in low:
        return "Énergie"
    if not low or low in {"aucun", "none", "rien"}:
        return "Sans ressource"
    return "Ressource spéciale"


def extract_spell_text(champ_data: Dict[str, Any]) -> str:
    parts: List[str] = []
    passive = champ_data.get("passive") or {}
    parts.append(str(passive.get("description") or ""))
    for spell in champ_data.get("spells") or []:
        parts.append(str(spell.get("description") or ""))
        parts.append(str(spell.get("tooltip") or ""))
    raw = " ".join(parts).lower()
    return re.sub(r"<[^>]+>", " ", raw)


def detect_kit_traits(champ_id: str, champ_data: Dict[str, Any]) -> Dict[str, bool]:
    txt = extract_spell_text(champ_data)
    has_dash = bool(
        re.search(
            r"\b(ruée|ruee|bondit|bondir|saute|sauter|se téléporte|téléport|fonce|se propulse|dash|blink)\b",
            txt,
        )
    )
    has_stealth = champ_id in STEALTH_CHAMPS or bool(
        re.search(r"\b(invisible|invisibilité|camouflage|camouflé|furtivité)\b", txt)
    )
    has_heal_shield = bool(
        re.search(r"\b(bouclier|soigne|soin|rend des pv|régénère|pv rendus)\b", txt)
    )
    has_hard_cc = bool(
        re.search(
            r"\b(étourdit|étourdi|étourdissement|projette dans les airs|charme|peur|effraie|provoque|immobilise|attire|supprime|repousse|endort)\b",
            txt,
        )
    )
    has_global_ult = champ_id in GLOBAL_ULT_CHAMPS
    has_summon = champ_id in SUMMON_CHAMPS
    return {
        "has_dash": has_dash,
        "has_stealth": has_stealth,
        "has_heal_shield": has_heal_shield,
        "has_hard_cc": has_hard_cc,
        "has_global_ult": has_global_ult,
        "has_summon": has_summon,
    }


def infer_fallback_meta(champ_data: Dict[str, Any], meraki_entry: Optional[Dict[str, Any]]) -> Tuple[str, List[str], str, str, str, int]:
    """Déduit des métadonnées propres pour tout nouveau champion non encore listé dans CHAMPION_META."""
    tags = champ_data.get("tags") or []
    info = champ_data.get("info") or {}

    lanes: List[str] = []
    if meraki_entry and meraki_entry.get("positions"):
        lanes = [LANE_MAP.get(pos, pos) for pos in meraki_entry["positions"] if pos in LANE_MAP]
    if not lanes:
        if "Marksman" in tags:
            lanes = ["ADC"]
        elif "Support" in tags:
            lanes = ["Support"]
        elif "Mage" in tags or "Assassin" in tags:
            lanes = ["Mid"]
        else:
            lanes = ["Top"]

    magic = int(info.get("magic") or 0)
    attack = int(info.get("attack") or 0)
    if magic >= attack + 2:
        damage_type = "Magique"
    elif attack >= magic + 2:
        damage_type = "Physique"
    else:
        damage_type = "Hybride"

    release_year = 2025
    if meraki_entry and meraki_entry.get("releaseDate"):
        try:
            release_year = int(str(meraki_entry["releaseDate"])[:4])
        except ValueError:
            pass

    return ("Runeterra", lanes, "Autre", "Humain", damage_type, release_year)


def build_champions_dataset() -> List[Dict[str, Any]]:
    versions = fetch_json(DDRAGON_VERSIONS_URL)
    latest_version = versions[0]
    print(f"Data Dragon version : {latest_version}")

    full_data = fetch_json(DDRAGON_CHAMPIONS_URL.format(version=latest_version))
    champions_raw: Dict[str, Any] = full_data.get("data") or {}

    meraki_data: Dict[str, Any] = {}
    try:
        meraki_data = fetch_json(MERAKI_URL, timeout=10.0)
    except Exception:  # noqa: BLE001
        meraki_data = {}

    results: List[Dict[str, Any]] = []
    for champ_id, cdata in sorted(champions_raw.items(), key=lambda kv: kv[1].get("name", kv[0])):
        meraki_entry = meraki_data.get(champ_id)
        if champ_id in CHAMPION_META:
            region, lanes, gender, species, damage_type, release_year = CHAMPION_META[champ_id]
        else:
            region, lanes, gender, species, damage_type, release_year = infer_fallback_meta(
                cdata, meraki_entry
            )

        roles_fr = [ROLE_FR.get(tag, tag) for tag in (cdata.get("tags") or [])]
        attack_range = float((cdata.get("stats") or {}).get("attackrange") or 150)
        range_type = "Mêlée" if attack_range <= 325 else "À distance"
        if champ_id in {"Thresh", "Rakan", "Urgot"}:
            range_type = "À distance" if champ_id in {"Thresh", "Urgot"} else "Mêlée"

        resource = normalize_resource(str(cdata.get("partype") or ""))
        traits = detect_kit_traits(champ_id, cdata)

        results.append(
            {
                "id": champ_id,
                "name": str(cdata.get("name") or champ_id),
                "title": str(cdata.get("title") or "").strip(),
                "roles": roles_fr,
                "lanes": lanes,
                "region": region,
                "gender": gender,
                "species": species,
                "range_type": range_type,
                "resource": resource,
                "damage_type": damage_type,
                "release_year": release_year,
                **traits,
                "sprite": DDRAGON_SPLASH_URL.format(id=champ_id),
                "icon": DDRAGON_ICON_URL.format(version=latest_version, id=champ_id),
            }
        )

    return results


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass

    parser = argparse.ArgumentParser(
        description="Télécharge tous les champions League of Legends en français via Riot Data Dragon."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "lol_champions.json",
        help="Chemin du fichier JSON de sortie (défaut : data/lol_champions.json)",
    )
    args = parser.parse_args()

    print("LoLNator — Récupération des champions League of Legends depuis Riot Data Dragon...")
    try:
        champions = build_champions_dataset()
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        print(f"Erreur réseau lors de la récupération : {exc}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        json.dump(champions, fh, ensure_ascii=False, indent=2)

    print(f"Terminé : {len(champions)} champions enregistrés dans {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
