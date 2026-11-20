#!/usr/bin/env python3
"""
fetch_pokemons.py — Récupère les 1025 Pokémon (Générations 1 à 9) depuis PokeAPI
et génère le fichier statique data/pokemons.json pour l'application PokéNator.

Aucune dépendance externe requise (utilise uniquement la bibliothèque standard Python 3).

Exemples d'utilisation :
    python scripts/fetch_pokemons.py
    python scripts/fetch_pokemons.py --workers 10 --output data/pokemons.json
    python scripts/fetch_pokemons.py --limit 151  # Tester uniquement la 1ère génération
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

API_BASE = "https://pokeapi.co/api/v2"
ARTWORK_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/"
    "sprites/pokemon/other/official-artwork/{id}.png"
)
TOTAL_POKEMONS_DEFAULT = 1025
USER_AGENT = "PokeNator-Fetcher/1.0 (+https://pokeapi.co)"

GENERATION_MAP: Dict[str, int] = {
    "generation-i": 1,
    "generation-ii": 2,
    "generation-iii": 3,
    "generation-iv": 4,
    "generation-v": 5,
    "generation-vi": 6,
    "generation-vii": 7,
    "generation-viii": 8,
    "generation-ix": 9,
}

TYPE_FR: Dict[str, str] = {
    "normal": "Normal",
    "fire": "Feu",
    "water": "Eau",
    "grass": "Plante",
    "electric": "Électrik",
    "ice": "Glace",
    "fighting": "Combat",
    "poison": "Poison",
    "ground": "Sol",
    "flying": "Vol",
    "psychic": "Psy",
    "bug": "Insecte",
    "rock": "Roche",
    "ghost": "Spectre",
    "dragon": "Dragon",
    "dark": "Ténèbres",
    "steel": "Acier",
    "fairy": "Fée",
}

COLOR_FR: Dict[str, str] = {
    "black": "Noir",
    "blue": "Bleu",
    "brown": "Marron",
    "gray": "Gris",
    "green": "Vert",
    "pink": "Rose",
    "purple": "Violet",
    "red": "Rouge",
    "white": "Blanc",
    "yellow": "Jaune",
}

SHAPE_FR: Dict[str, str] = {
    "ball": "sphérique",
    "squiggle": "serpentin",
    "fish": "pisciforme",
    "arms": "avec bras",
    "blob": "amorphe",
    "upright": "bipède à queue",
    "legs": "avec jambes",
    "quadruped": "quadrupède",
    "wings": "ailé",
    "tentacles": "tentaculaire",
    "heads": "multiple",
    "humanoid": "humanoïde",
    "bug-wings": "ailé (insecte)",
    "armor": "insectoïde",
}

HABITAT_FR: Dict[str, str] = {
    "cave": "grotte",
    "forest": "forêt",
    "grassland": "plaine",
    "mountain": "montagne",
    "rare": "rare",
    "rough-terrain": "terrain accidenté",
    "sea": "mer",
    "urban": "urbain",
    "waters-edge": "bord de l'eau",
}


class RateLimitedFetcher:
    """Client HTTP thread-safe avec retries exponentiels et cache des chaînes d'évolution."""

    def __init__(self, max_retries: int = 5, timeout: float = 20.0, min_delay: float = 0.03) -> None:
        self.max_retries = max_retries
        self.timeout = timeout
        self.min_delay = min_delay
        self._rate_lock = threading.Lock()
        self._last_request_ts = 0.0

        self._chain_cache_lock = threading.Lock()
        self._chain_cache: Dict[str, Dict[str, str]] = {}
        self._chain_inflight: Dict[str, threading.Event] = {}

    def fetch_json(self, url: str) -> Dict[str, Any]:
        """Effectue une requête GET JSON avec respect du débit et backoff sur erreurs transitoires."""
        last_err: Optional[Exception] = None
        for attempt in range(self.max_retries):
            with self._rate_lock:
                now = time.monotonic()
                elapsed = now - self._last_request_ts
                if elapsed < self.min_delay:
                    time.sleep(self.min_delay - elapsed)
                self._last_request_ts = time.monotonic()

            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                last_err = exc
                if exc.code == 404:
                    raise
                # 429 Too Many Requests ou 5xx : attente exponentielle
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                wait_s = float(retry_after) if retry_after and retry_after.isdigit() else (1.0 * (2 ** attempt))
                time.sleep(min(wait_s, 15.0))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                last_err = exc
                time.sleep(min(0.8 * (2 ** attempt), 12.0))

        raise RuntimeError(f"Échec après {self.max_retries} tentatives pour {url}: {last_err}")

    def get_evolution_stages(self, chain_url: Optional[str]) -> Dict[str, str]:
        """
        Retourne un mapping {species_name: stage} pour toute une chaîne d'évolution.
        Cache partagé entre threads pour éviter les requêtes redondantes.
        """
        if not chain_url:
            return {}

        with self._chain_cache_lock:
            if chain_url in self._chain_cache:
                return self._chain_cache[chain_url]
            if chain_url in self._chain_inflight:
                event = self._chain_inflight[chain_url]
                is_owner = False
            else:
                event = threading.Event()
                self._chain_inflight[chain_url] = event
                is_owner = True

        if not is_owner:
            event.wait(timeout=60.0)
            with self._chain_cache_lock:
                return self._chain_cache.get(chain_url, {})

        stages: Dict[str, str] = {}
        try:
            chain_data = self.fetch_json(chain_url)
            root = chain_data.get("chain")
            if root:
                stages = parse_evolution_chain(root)
        finally:
            with self._chain_cache_lock:
                self._chain_cache[chain_url] = stages
                self._chain_inflight.pop(chain_url, None)
                event.set()

        return stages


def parse_evolution_chain(root: Dict[str, Any]) -> Dict[str, str]:
    """
    Déduit le stade d'évolution de chaque espèce dans la chaîne :
      - 'single' : espèce racine sans aucune évolution
      - 'base'   : espèce racine ayant au moins une évolution
      - 'middle' : évolution intermédiaire (a une pré-évolution ET une évolution suivante)
      - 'final'  : stade terminal d'une lignée d'évolution
    """
    stages: Dict[str, str] = {}

    def walk(node: Dict[str, Any], depth: int) -> None:
        species_name = node.get("species", {}).get("name")
        children = node.get("evolves_to") or []
        if species_name:
            if depth == 0:
                stages[species_name] = "single" if not children else "base"
            else:
                stages[species_name] = "middle" if children else "final"
        for child in children:
            walk(child, depth + 1)

    walk(root, 0)
    return stages


def extract_french_name(species_data: Dict[str, Any], fallback_slug: str) -> str:
    """Extrait le nom français depuis species.names, avec repli sur l'anglais puis le slug."""
    names = species_data.get("names") or []
    english_name: Optional[str] = None
    for entry in names:
        lang = (entry.get("language") or {}).get("name")
        if lang == "fr" and entry.get("name"):
            return str(entry["name"]).strip()
        if lang == "en" and entry.get("name"):
            english_name = str(entry["name"]).strip()
    if english_name:
        return english_name
    return fallback_slug.replace("-", " ").title()


def fetch_single_pokemon(fetcher: RateLimitedFetcher, poke_id: int) -> Dict[str, Any]:
    """Récupère et normalise les données d'un Pokémon par son numéro national."""
    pokemon_data = fetcher.fetch_json(f"{API_BASE}/pokemon/{poke_id}")
    species_data = fetcher.fetch_json(f"{API_BASE}/pokemon-species/{poke_id}")

    species_slug = species_data.get("name") or pokemon_data.get("name") or str(poke_id)
    name_fr = extract_french_name(species_data, species_slug)

    gen_slug = (species_data.get("generation") or {}).get("name", "")
    generation = GENERATION_MAP.get(gen_slug, 1)

    sorted_types = sorted(pokemon_data.get("types") or [], key=lambda t: t.get("slot", 0))
    types_fr = [
        TYPE_FR.get(t["type"]["name"], t["type"]["name"].capitalize())
        for t in sorted_types
        if t.get("type", {}).get("name")
    ]

    color_slug = (species_data.get("color") or {}).get("name", "")
    color_fr = COLOR_FR.get(color_slug, color_slug.capitalize() if color_slug else "Inconnu")

    shape_slug = (species_data.get("shape") or {}).get("name", "")
    shape_fr = SHAPE_FR.get(shape_slug, shape_slug if shape_slug else "inconnu")

    habitat_slug = (species_data.get("habitat") or {}).get("name")
    habitat_fr = HABITAT_FR.get(habitat_slug, habitat_slug) if habitat_slug else None

    is_legendary = bool(species_data.get("is_legendary", False))
    is_mythical = bool(species_data.get("is_mythical", False))
    is_baby = bool(species_data.get("is_baby", False))

    chain_url = (species_data.get("evolution_chain") or {}).get("url")
    chain_stages = fetcher.get_evolution_stages(chain_url)
    evolution_stage = chain_stages.get(species_slug, "single")

    varieties = species_data.get("varieties") or []
    variety_names = [
        (v.get("pokemon") or {}).get("name", "").lower()
        for v in varieties
    ]
    has_mega = any("-mega" in vname for vname in variety_names)
    has_gmax = any("-gmax" in vname for vname in variety_names)

    # PokeAPI : height en décimètres, weight en hectogrammes
    height_m = round((pokemon_data.get("height") or 0) / 10.0, 1)
    weight_kg = round((pokemon_data.get("weight") or 0) / 10.0, 1)

    return {
        "id": poke_id,
        "name": name_fr,
        "generation": generation,
        "types": types_fr,
        "color": color_fr,
        "shape": shape_fr,
        "habitat": habitat_fr,
        "is_legendary": is_legendary,
        "is_mythical": is_mythical,
        "is_baby": is_baby,
        "evolution_stage": evolution_stage,
        "has_mega": has_mega,
        "has_gmax": has_gmax,
        "height_m": height_m,
        "weight_kg": weight_kg,
        "sprite": ARTWORK_URL_TEMPLATE.format(id=poke_id),
    }


def render_progress(done: int, total: int, errors: int, start_time: float) -> None:
    """Affiche une barre de progression compacte dans le terminal."""
    elapsed = max(time.monotonic() - start_time, 0.001)
    ratio = done / total if total else 1.0
    bar_width = 28
    filled = int(round(bar_width * ratio))
    enc = (getattr(sys.stdout, "encoding", None) or "").lower()
    use_unicode = "utf" in enc
    full_ch, empty_ch = ("█", "░") if use_unicode else ("#", "-")
    bar = full_ch * filled + empty_ch * (bar_width - filled)
    rate = done / elapsed
    eta = (total - done) / rate if rate > 0 else 0.0
    err_txt = f" | erreurs: {errors}" if errors else ""
    line = (
        f"\r[{bar}] {done:4d}/{total} ({ratio * 100:5.1f}%) "
        f"| {elapsed:5.1f}s | ETA {eta:5.1f}s{err_txt}"
    )
    sys.stdout.write(line)
    sys.stdout.flush()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass

    parser = argparse.ArgumentParser(
        description="Télécharge la base Pokédex (1 à 1025) depuis PokeAPI pour PokéNator."
    )
    parser.add_argument("--start", type=int, default=1, help="ID de départ (défaut : 1)")
    parser.add_argument(
        "--limit",
        type=int,
        default=TOTAL_POKEMONS_DEFAULT,
        help=f"ID de fin inclus (défaut : {TOTAL_POKEMONS_DEFAULT})",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Nombre de threads parallèles (défaut : 8, recommandé <= 12)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "pokemons.json",
        help="Chemin du fichier JSON de sortie (défaut : data/pokemons.json)",
    )
    args = parser.parse_args()

    if args.start < 1 or args.limit < args.start:
        print("Erreur : --start doit être >= 1 et --limit >= --start.", file=sys.stderr)
        return 1

    ids = list(range(args.start, args.limit + 1))
    total = len(ids)
    workers = max(1, min(args.workers, 16))

    print(f"PokéNator — Récupération de {total} Pokémon (#{args.start} à #{args.limit}) avec {workers} threads...")
    fetcher = RateLimitedFetcher(min_delay=0.03)
    results: List[Dict[str, Any]] = []
    failures: List[Tuple[int, str]] = []
    start_time = time.monotonic()

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_id = {
            executor.submit(fetch_single_pokemon, fetcher, poke_id): poke_id
            for poke_id in ids
        }
        completed = 0
        for future in concurrent.futures.as_completed(future_to_id):
            poke_id = future_to_id[future]
            try:
                results.append(future.result())
            except Exception as exc:  # noqa: BLE001
                failures.append((poke_id, str(exc)))
            completed += 1
            render_progress(completed, total, len(failures), start_time)

    print()  # Nouvelle ligne après la barre de progression

    # Seconde passe séquentielle sur les éventuels échecs isolés
    if failures:
        print(f"Nouvelle tentative pour {len(failures)} Pokémon en échec...")
        still_failed: List[Tuple[int, str]] = []
        for poke_id, _ in failures:
            try:
                time.sleep(0.5)
                results.append(fetch_single_pokemon(fetcher, poke_id))
            except Exception as exc:  # noqa: BLE001
                still_failed.append((poke_id, str(exc)))
        failures = still_failed

    results.sort(key=lambda item: item["id"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)

    elapsed = time.monotonic() - start_time
    print(f"Terminé en {elapsed:.1f}s : {len(results)} Pokémon enregistrés dans {args.output}")
    if failures:
        print(f"Attention : {len(failures)} échec(s) persistant(s) :", file=sys.stderr)
        for poke_id, msg in failures[:10]:
            print(f"  - #{poke_id}: {msg}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
