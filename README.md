# PokéNator & LoLNator

Application web 100 % statique (compatible **GitHub Pages**) inspirée d'Akinator, basée sur un moteur de déduction bayésien :

- **Pokémon** : les 1025 Pokémon (Générations 1 à 9), avec attaques emblématiques (*Séisme*, *Surf*, *Vol*, *Lance-Flammes*…), stats de combat, formes régionales, Méga/Gigamax, morphologie, couleurs et générations.
- **League of Legends** : les 173 champions en français (Riot Data Dragon), avec voies, classes, régions de Runeterra, espèces, ressources, types de dégâts et mécaniques de sorts.

## Lancer en local

```bash
python -m http.server 8000
```

Ouvrez ensuite `http://localhost:8000`.

## Mettre à jour les bases de données

```bash
python scripts/fetch_pokemons.py
python scripts/fetch_lol_champions.py
```

## Déploiement sur GitHub Pages

1. Créez un dépôt public sur GitHub et poussez / importez tous les fichiers de ce dossier (y compris `index.html`, `css/`, `js/`, `data/`, `.nojekyll`).
2. Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch** → branche `main`, dossier `/ (root)` → **Save**.
3. Votre site sera en ligne en ~1 minute à l'adresse `https://<votre-pseudo>.github.io/<nom-du-depot>/`.
