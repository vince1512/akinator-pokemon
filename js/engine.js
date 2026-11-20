/**
 * js/engine.js — Moteur de déduction bayésien / probabiliste pour PokéNator.
 *
 * Modèle :
 * - Chaque Pokémon démarre avec un poids de 1.0.
 * - Chaque réponse met à jour les poids via des vraisemblances douces (jamais 0 absolu)
 *   afin de tolérer les hésitations ou erreurs du joueur.
 * - À chaque tour, le moteur sélectionne la question non posée maximisant le gain
 *   d'information (entropie binaire pondérée par les probabilités courantes).
 */

export const ANSWER_TYPES = Object.freeze({
  YES: 'yes',
  PROBABLY_YES: 'probably_yes',
  DONT_KNOW: 'dont_know',
  PROBABLY_NO: 'probably_no',
  NO: 'no',
});

/**
 * Multiplicateurs bayésiens par réponse selon la vérité de l'attribut (true / false).
 * Aucun multiplicateur n'est nul afin de tolérer une erreur du joueur.
 */
const LIKELIHOOD_TABLE = Object.freeze({
  [ANSWER_TYPES.YES]: { true: 1.0, false: 0.05 },
  [ANSWER_TYPES.PROBABLY_YES]: { true: 0.8, false: 0.3 },
  [ANSWER_TYPES.DONT_KNOW]: { true: 1.0, false: 1.0 },
  [ANSWER_TYPES.PROBABLY_NO]: { true: 0.3, false: 0.8 },
  [ANSWER_TYPES.NO]: { true: 0.05, false: 1.0 },
});

const GENERATION_LABELS = Object.freeze({
  1: '1ère génération (Kanto)',
  2: '2e génération (Johto)',
  3: '3e génération (Hoenn)',
  4: '4e génération (Sinnoh)',
  5: '5e génération (Unys)',
  6: '6e génération (Kalos)',
  7: '7e génération (Alola)',
  8: '8e génération (Galar)',
  9: '9e génération (Paldea)',
});

const COLOR_ARTICLES = Object.freeze({
  Rouge: 'le rouge',
  Bleu: 'le bleu',
  Jaune: 'le jaune',
  Vert: 'le vert',
  Noir: 'le noir',
  Blanc: 'le blanc',
  Marron: 'le marron',
  Violet: 'le violet',
  Gris: 'le gris',
  Rose: 'le rose',
});

const SPECIFIC_SHAPE_TEXT = Object.freeze({
  'sphérique': 'A-t-il un corps principalement sphérique (en forme de boule) ?',
  'serpentin': 'A-t-il un corps allongé de type serpentin (sans membres ou presque) ?',
  'pisciforme': 'A-t-il une forme de poisson avec des nageoires ?',
  'avec bras': 'Possède-t-il des bras mais pas de jambes visibles ?',
  'amorphe': 'A-t-il un corps mou, gélatineux ou amorphe ?',
  'bipède à queue': 'Est-ce un bipède muni d’une queue bien visible ?',
  'avec jambes': 'A-t-il un corps posé sur des jambes sans bras distincts ?',
  'quadrupède': 'Votre Pokémon marche-t-il à quatre pattes (quadrupède) ?',
  'ailé': 'Possède-t-il une paire d’ailes (oiseau, chauve-souris, dragon ailé) ?',
  'tentaculaire': 'Possède-t-il des tentacules ou plus de quatre pattes ?',
  'multiple': 'Est-il composé de plusieurs têtes ou de plusieurs corps réunis ?',
  'humanoïde': 'A-t-il une silhouette humanoïde (bipède sans queue notable) ?',
  'ailé (insecte)': 'Possède-t-il des ailes d’insecte (deux paires ou ailes membraneuses) ?',
  'insectoïde': 'A-t-il un corps segmenté ou recouvert d’une carapace insectoïde ?',
});

/**
 * Normalise une chaîne pour extraire sa première lettre ASCII majuscule (A-Z).
 */
function getFirstLetter(name) {
  if (!name) return '';
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return clean.charAt(0) || '';
}

function getCleanLetterCount(name) {
  if (!name) return 0;
  return name.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '').length;
}

/**
 * Construit dynamiquement la banque de questions à partir des attributs du jeu de données.
 */
function buildQuestionBank(pokemons) {
  const questions = [];

  const presentTypes = new Set();
  const presentGens = new Set();
  const presentColors = new Set();
  const presentShapes = new Set();
  const presentLetters = new Set();

  for (const p of pokemons) {
    for (const t of p.types || []) presentTypes.add(t);
    if (p.generation) presentGens.add(p.generation);
    if (p.color) presentColors.add(p.color);
    if (p.shape) presentShapes.add(p.shape);
    const letter = getFirstLetter(p.name);
    if (letter) presentLetters.add(letter);
  }

  // --- 1. TYPES ---
  questions.push({
    id: 'type_dual',
    category: 'Type',
    text: 'Votre Pokémon possède-t-il un double type ?',
    priority: 1.03,
    evaluate: (p) => Array.isArray(p.types) && p.types.length >= 2,
  });

  // Groupes de types pour accélérer la dichotomie sur 1025 Pokémon
  const typeGroups = [
    {
      id: 'type_group_elemental',
      text: 'Votre Pokémon est-il de type Feu, Eau ou Plante ?',
      set: new Set(['Feu', 'Eau', 'Plante']),
    },
    {
      id: 'type_group_physical',
      text: 'Votre Pokémon est-il de type Normal, Combat, Sol ou Roche ?',
      set: new Set(['Normal', 'Combat', 'Sol', 'Roche']),
    },
    {
      id: 'type_group_mystic',
      text: 'Votre Pokémon est-il de type Psy, Spectre, Ténèbres ou Fée ?',
      set: new Set(['Psy', 'Spectre', 'Ténèbres', 'Fée']),
    },
    {
      id: 'type_group_special',
      text: 'Votre Pokémon est-il de type Électrik, Glace, Dragon, Acier ou Vol ?',
      set: new Set(['Électrik', 'Glace', 'Dragon', 'Acier', 'Vol']),
    },
    {
      id: 'type_group_nature',
      text: 'Votre Pokémon est-il de type Insecte, Poison ou Plante ?',
      set: new Set(['Insecte', 'Poison', 'Plante']),
    },
  ];

  for (const grp of typeGroups) {
    questions.push({
      id: grp.id,
      category: 'Type',
      text: grp.text,
      priority: 1.01,
      evaluate: (p) => (p.types || []).some((t) => grp.set.has(t)),
    });
  }

  for (const typeName of [...presentTypes].sort()) {
    questions.push({
      id: `type_${typeName.toLowerCase()}`,
      category: 'Type',
      text: `Votre Pokémon est-il de type ${typeName} ?`,
      priority: 1.04,
      evaluate: (p) => (p.types || []).includes(typeName),
    });
  }

  // --- 2. GÉNÉRATIONS ---
  const genRanges = [
    {
      id: 'gen_lt_5',
      text: 'Est-il apparu avant la 5e génération (Générations 1 à 4) ?',
      fn: (g) => g <= 4,
    },
    {
      id: 'gen_lt_4',
      text: 'Est-il apparu avant la 4e génération (Kanto, Johto ou Hoenn) ?',
      fn: (g) => g <= 3,
    },
    {
      id: 'gen_lt_3',
      text: 'Est-il apparu dans les deux premières générations (Kanto ou Johto) ?',
      fn: (g) => g <= 2,
    },
    {
      id: 'gen_gte_6',
      text: 'Est-il apparu à partir de la 6e génération (Kalos à Paldea) ?',
      fn: (g) => g >= 6,
    },
    {
      id: 'gen_gte_7',
      text: 'Est-il apparu à partir de la 7e génération (Alola, Galar ou Paldea) ?',
      fn: (g) => g >= 7,
    },
    {
      id: 'gen_mid_3_5',
      text: 'Est-il apparu entre la 3e et la 5e génération (Hoenn, Sinnoh ou Unys) ?',
      fn: (g) => g >= 3 && g <= 5,
    },
    {
      id: 'gen_mid_5_7',
      text: 'Est-il apparu entre la 5e et la 7e génération (Unys, Kalos ou Alola) ?',
      fn: (g) => g >= 5 && g <= 7,
    },
  ];

  for (const range of genRanges) {
    questions.push({
      id: range.id,
      category: 'Génération',
      text: range.text,
      priority: 1.03,
      evaluate: (p) => (typeof p.generation === 'number' ? range.fn(p.generation) : null),
    });
  }

  for (const gen of [...presentGens].sort((a, b) => a - b)) {
    const label = GENERATION_LABELS[gen] || `${gen}e génération`;
    questions.push({
      id: `gen_${gen}`,
      category: 'Génération',
      text: `Est-il apparu dans la ${label} ?`,
      priority: 1.04,
      evaluate: (p) => p.generation === gen,
    });
  }

  // --- 3. STADE D'ÉVOLUTION ---
  questions.push(
    {
      id: 'evo_has_family',
      category: 'Évolution',
      text: 'Votre Pokémon fait-il partie d’une lignée d’évolution (il évolue ou est une évolution) ?',
      priority: 1.02,
      evaluate: (p) => p.evolution_stage !== 'single',
    },
    {
      id: 'evo_can_evolve',
      category: 'Évolution',
      text: 'Votre Pokémon peut-il encore évoluer en un autre Pokémon ?',
      priority: 1.03,
      evaluate: (p) => p.evolution_stage === 'base' || p.evolution_stage === 'middle',
    },
    {
      id: 'evo_is_evolved',
      category: 'Évolution',
      text: 'Votre Pokémon est-il déjà l’évolution d’un autre Pokémon ?',
      priority: 1.03,
      evaluate: (p) => p.evolution_stage === 'middle' || p.evolution_stage === 'final',
    },
    {
      id: 'evo_stage_base',
      category: 'Évolution',
      text: 'Est-ce le stade de base d’une lignée d’évolution ?',
      priority: 1.01,
      evaluate: (p) => p.evolution_stage === 'base',
    },
    {
      id: 'evo_stage_middle',
      category: 'Évolution',
      text: 'Est-ce un stade intermédiaire d’évolution (entre une pré-évolution et une évolution finale) ?',
      priority: 1.0,
      evaluate: (p) => p.evolution_stage === 'middle',
    },
    {
      id: 'evo_stage_final',
      category: 'Évolution',
      text: 'Est-ce le stade final d’une lignée d’évolution ?',
      priority: 1.02,
      evaluate: (p) => p.evolution_stage === 'final',
    },
  );

  // --- 4. STATUTS SPÉCIAUX & FORMES ---
  questions.push(
    {
      id: 'status_legend_or_myth',
      category: 'Statut',
      text: 'Est-ce un Pokémon Légendaire ou Fabuleux ?',
      priority: 1.03,
      evaluate: (p) => Boolean(p.is_legendary || p.is_mythical),
    },
    {
      id: 'status_legendary',
      category: 'Statut',
      text: 'Est-ce un Pokémon Légendaire ?',
      priority: 1.01,
      evaluate: (p) => Boolean(p.is_legendary),
    },
    {
      id: 'status_mythical',
      category: 'Statut',
      text: 'Est-ce un Pokémon Fabuleux (comme Mew, Celebi ou Jirachi) ?',
      priority: 1.0,
      evaluate: (p) => Boolean(p.is_mythical),
    },
    {
      id: 'status_baby',
      category: 'Statut',
      text: 'Est-ce un Pokémon Bébé (comme Pichu, Togepi ou Riolu) ?',
      priority: 1.0,
      evaluate: (p) => Boolean(p.is_baby),
    },
    {
      id: 'form_mega',
      category: 'Forme spéciale',
      text: 'Votre Pokémon possède-t-il une Méga-Évolution ?',
      priority: 1.02,
      evaluate: (p) => Boolean(p.has_mega),
    },
    {
      id: 'form_gmax',
      category: 'Forme spéciale',
      text: 'Votre Pokémon possède-t-il une forme Gigamax ?',
      priority: 1.01,
      evaluate: (p) => Boolean(p.has_gmax),
    },
    {
      id: 'form_special_any',
      category: 'Forme spéciale',
      text: 'Possède-t-il une Méga-Évolution ou une forme Gigamax ?',
      priority: 1.01,
      evaluate: (p) => Boolean(p.has_mega || p.has_gmax),
    },
  );

  // --- 5. COULEURS ---
  const warmColors = new Set(['Rouge', 'Jaune', 'Rose', 'Marron']);
  questions.push({
    id: 'color_warm',
    category: 'Couleur',
    text: 'Sa couleur dominante est-elle plutôt chaude (rouge, jaune, rose ou marron) ?',
    priority: 0.99,
    evaluate: (p) => (p.color ? warmColors.has(p.color) : null),
  });

  const darkColors = new Set(['Noir', 'Gris', 'Violet', 'Bleu']);
  questions.push({
    id: 'color_cool_dark',
    category: 'Couleur',
    text: 'Sa couleur dominante est-elle bleue, violette, grise ou noire ?',
    priority: 0.99,
    evaluate: (p) => (p.color ? darkColors.has(p.color) : null),
  });

  for (const color of [...presentColors].sort()) {
    const label = COLOR_ARTICLES[color] || color.toLowerCase();
    questions.push({
      id: `color_${color.toLowerCase()}`,
      category: 'Couleur',
      text: `La couleur officielle dominante de votre Pokémon est-elle ${label} ?`,
      priority: 1.0,
      evaluate: (p) => p.color === color,
    });
  }

  // --- 6. MORPHOLOGIE (SHAPE) ---
  const bipedShapes = new Set(['humanoïde', 'bipède à queue', 'avec jambes']);
  const wingedShapes = new Set(['ailé', 'ailé (insecte)']);
  const roundShapes = new Set(['sphérique', 'amorphe']);
  const elongatedShapes = new Set(['serpentin', 'pisciforme']);

  questions.push(
    {
      id: 'shape_group_biped',
      category: 'Morphologie',
      text: 'Votre Pokémon se tient-il sur deux pattes (bipède ou humanoïde) ?',
      priority: 1.02,
      evaluate: (p) => (p.shape ? bipedShapes.has(p.shape) : null),
    },
    {
      id: 'shape_group_winged',
      category: 'Morphologie',
      text: 'Votre Pokémon possède-t-il des ailes comme trait morphologique principal ?',
      priority: 1.0,
      evaluate: (p) => (p.shape ? wingedShapes.has(p.shape) : null),
    },
    {
      id: 'shape_group_round',
      category: 'Morphologie',
      text: 'A-t-il un corps arrondi, sphérique ou amorphe ?',
      priority: 0.98,
      evaluate: (p) => (p.shape ? roundShapes.has(p.shape) : null),
    },
    {
      id: 'shape_group_elongated',
      category: 'Morphologie',
      text: 'A-t-il un corps allongé (serpentin) ou en forme de poisson ?',
      priority: 0.98,
      evaluate: (p) => (p.shape ? elongatedShapes.has(p.shape) : null),
    },
  );

  for (const shape of [...presentShapes].sort()) {
    const text = SPECIFIC_SHAPE_TEXT[shape];
    if (!text) continue;
    questions.push({
      id: `shape_${shape}`,
      category: 'Morphologie',
      text,
      priority: shape === 'quadrupède' ? 1.02 : 0.97,
      evaluate: (p) => (p.shape ? p.shape === shape : null),
    });
  }

  // --- 7. HABITAT (null pour Gén 4+ : évalué de façon neutre si absent) ---
  const habitatQuestions = [
    {
      id: 'habitat_forest',
      text: 'Vit-il naturellement dans les forêts ?',
      fn: (h) => h === 'forêt',
    },
    {
      id: 'habitat_water',
      text: 'Vit-il dans la mer ou au bord de l’eau ?',
      fn: (h) => h === 'mer' || h === "bord de l'eau",
    },
    {
      id: 'habitat_mountain_cave',
      text: 'Vit-il en montagne ou dans les grottes ?',
      fn: (h) => h === 'montagne' || h === 'grotte',
    },
    {
      id: 'habitat_grassland',
      text: 'Vit-il dans les plaines ou prairies ?',
      fn: (h) => h === 'plaine',
    },
    {
      id: 'habitat_urban',
      text: 'Vit-il principalement en milieu urbain ?',
      fn: (h) => h === 'urbain',
    },
  ];

  for (const hq of habitatQuestions) {
    questions.push({
      id: hq.id,
      category: 'Habitat',
      text: hq.text,
      priority: 0.94,
      evaluate: (p) => (p.habitat ? hq.fn(p.habitat) : null),
    });
  }

  // --- 8. TAILLE & POIDS ---
  const sizeQuestions = [
    {
      id: 'height_gt_1',
      text: 'Mesure-t-il plus de 1 mètre ?',
      fn: (p) => p.height_m > 1.0,
    },
    {
      id: 'height_gt_1_5',
      text: 'Mesure-t-il plus de 1,5 mètre ?',
      fn: (p) => p.height_m > 1.5,
    },
    {
      id: 'height_lt_0_6',
      text: 'Est-il très petit (moins de 60 cm) ?',
      fn: (p) => p.height_m < 0.6,
    },
    {
      id: 'height_gt_2',
      text: 'Est-il très grand (plus de 2 mètres) ?',
      fn: (p) => p.height_m > 2.0,
    },
    {
      id: 'weight_gt_15',
      text: 'Pèse-t-il plus de 15 kg ?',
      fn: (p) => p.weight_kg > 15.0,
    },
    {
      id: 'weight_gt_50',
      text: 'Pèse-t-il plus de 50 kg ?',
      fn: (p) => p.weight_kg > 50.0,
    },
    {
      id: 'weight_gt_100',
      text: 'Pèse-t-il plus de 100 kg (poids lourd) ?',
      fn: (p) => p.weight_kg > 100.0,
    },
    {
      id: 'weight_lt_10',
      text: 'Est-il très léger (moins de 10 kg) ?',
      fn: (p) => p.weight_kg < 10.0,
    },
  ];

  for (const sq of sizeQuestions) {
    questions.push({
      id: sq.id,
      category: 'Mensurations',
      text: sq.text,
      priority: 0.97,
      evaluate: (p) => (typeof p.height_m === 'number' && typeof p.weight_kg === 'number' ? sq.fn(p) : null),
    });
  }

  // --- 9. NOM / PREMIÈRE LETTRE (activées quand la liste se resserre) ---
  questions.push(
    {
      id: 'name_a_m',
      category: 'Nom',
      text: 'Son nom français commence-t-il par une lettre entre A et M ?',
      priority: 0.92,
      lateOnly: true,
      evaluate: (p) => {
        const c = getFirstLetter(p.name);
        return c ? c >= 'A' && c <= 'M' : null;
      },
    },
    {
      id: 'name_a_f',
      category: 'Nom',
      text: 'Son nom français commence-t-il par une lettre entre A et F ?',
      priority: 0.91,
      lateOnly: true,
      evaluate: (p) => {
        const c = getFirstLetter(p.name);
        return c ? c >= 'A' && c <= 'F' : null;
      },
    },
    {
      id: 'name_g_m',
      category: 'Nom',
      text: 'Son nom français commence-t-il par une lettre entre G et M ?',
      priority: 0.91,
      lateOnly: true,
      evaluate: (p) => {
        const c = getFirstLetter(p.name);
        return c ? c >= 'G' && c <= 'M' : null;
      },
    },
    {
      id: 'name_n_s',
      category: 'Nom',
      text: 'Son nom français commence-t-il par une lettre entre N et S ?',
      priority: 0.91,
      lateOnly: true,
      evaluate: (p) => {
        const c = getFirstLetter(p.name);
        return c ? c >= 'N' && c <= 'S' : null;
      },
    },
    {
      id: 'name_len_gte_8',
      category: 'Nom',
      text: 'Son nom français comporte-t-il 8 lettres ou plus ?',
      priority: 0.9,
      lateOnly: true,
      evaluate: (p) => getCleanLetterCount(p.name) >= 8,
    },
  );

  for (const letter of [...presentLetters].sort()) {
    questions.push({
      id: `name_letter_${letter}`,
      category: 'Nom',
      text: `Son nom français commence-t-il par la lettre « ${letter} » ?`,
      priority: 0.93,
      lateOnly: true,
      evaluate: (p) => getFirstLetter(p.name) === letter,
    });
  }

  return questions;
}

export class PokeNatorEngine {
  constructor(pokemons) {
    if (!Array.isArray(pokemons) || pokemons.length === 0) {
      throw new Error('La base de Pokémon est vide ou invalide.');
    }
    this.pokemons = pokemons;
    this.questions = buildQuestionBank(pokemons);
    this.CERTAINTY_THRESHOLD = 0.85;
    this.FIRST_FORCED_GUESS_AT = 20;
    this.MAX_QUESTIONS_LIMIT = 25;
    this.reset();
  }

  reset() {
    this.weights = new Array(this.pokemons.length).fill(1.0);
    this.askedQuestionIds = new Set();
    this.rejectedIds = new Set();
    this.history = [];
    this.questionCount = 0;
    this.currentQuestion = null;
    this.lastCategory = null;
    this.forcedGuessUsed = false;
  }

  /**
   * Retourne la liste triée des candidats non rejetés avec leur probabilité normalisée.
   */
  getRankedCandidates() {
    let totalWeight = 0;
    const active = [];

    for (let i = 0; i < this.pokemons.length; i++) {
      const p = this.pokemons[i];
      if (this.rejectedIds.has(p.id)) continue;
      const w = this.weights[i];
      totalWeight += w;
      active.push({ pokemon: p, weight: w, index: i });
    }

    if (totalWeight <= 0) {
      return active.map((entry) => ({
        pokemon: entry.pokemon,
        probability: active.length ? 1 / active.length : 0,
      }));
    }

    active.sort((a, b) => b.weight - a.weight || a.pokemon.id - b.pokemon.id);
    return active.map((entry) => ({
      pokemon: entry.pokemon,
      probability: entry.weight / totalWeight,
    }));
  }

  /**
   * Calcule la certitude [0, 1] basée sur l'écart de probabilité entre le 1er et le 2e candidat.
   */
  getCertainty() {
    const ranked = this.getRankedCandidates();
    if (ranked.length === 0) return 0;
    if (ranked.length === 1) return 1;
    const gap = ranked[0].probability - ranked[1].probability;
    return Math.max(0, Math.min(1, gap));
  }

  /**
   * Estime le nombre de pistes encore sérieusement envisageables (capturant ~92 % de la masse).
   */
  getPlausibleCount() {
    const ranked = this.getRankedCandidates();
    if (ranked.length === 0) return 0;
    let cumulative = 0;
    let count = 0;
    for (const item of ranked) {
      cumulative += item.probability;
      count += 1;
      if (cumulative >= 0.92 && item.probability < 0.05) break;
    }
    return count;
  }

  getTopCandidates(limit = 5) {
    return this.getRankedCandidates().slice(0, limit);
  }

  /**
   * Indique si le moteur doit passer en phase de proposition.
   */
  shouldProposeGuess() {
    if (this.questionCount === 0) return false;
    const ranked = this.getRankedCandidates();
    if (ranked.length === 0) return false;

    if (this.getCertainty() >= this.CERTAINTY_THRESHOLD) {
      return true;
    }
    if (!this.forcedGuessUsed && this.questionCount >= this.FIRST_FORCED_GUESS_AT) {
      return true;
    }
    if (this.questionCount >= this.MAX_QUESTIONS_LIMIT) {
      return true;
    }
    return false;
  }

  /**
   * Sélectionne la meilleure question non posée en maximisant l'entropie (split proche de 50/50)
   * pondérée par la probabilité courante des candidats.
   */
  selectNextQuestion() {
    const ranked = this.getRankedCandidates();
    if (ranked.length <= 1) {
      this.currentQuestion = null;
      return null;
    }

    // Construire un accès rapide aux probabilités par index Pokémon
    const activeEntries = [];
    for (let i = 0; i < this.pokemons.length; i++) {
      if (this.rejectedIds.has(this.pokemons[i].id)) continue;
      activeEntries.push({ index: i, pokemon: this.pokemons[i], weight: this.weights[i] });
    }

    const totalWeight = activeEntries.reduce((acc, e) => acc + e.weight, 0);
    if (totalWeight <= 0) {
      this.currentQuestion = null;
      return null;
    }

    const plausibleCount = this.getPlausibleCount();
    const allowLateQuestions = plausibleCount <= 12 || this.questionCount >= 10;

    const evaluatePool = (includeLate) => {
      let bestQuestion = null;
      let bestScore = 0;

      for (const q of this.questions) {
        if (this.askedQuestionIds.has(q.id)) continue;
        if (q.lateOnly && !includeLate) continue;

        let pYes = 0;
        let pNo = 0;
        let pUnk = 0;

        for (const entry of activeEntries) {
          const prob = entry.weight / totalWeight;
          if (prob < 1e-6) continue;
          const res = q.evaluate(entry.pokemon);
          if (res === true) pYes += prob;
          else if (res === false) pNo += prob;
          else pUnk += prob;
        }

        const coverage = pYes + pNo;
        // Ignorer les questions quasi-unanimement vraies/fausses ou trop souvent inconnues
        if (coverage < 0.55 || pYes < 0.005 || pNo < 0.005) continue;

        const r = pYes / coverage;
        const entropy = -(r * Math.log2(r) + (1 - r) * Math.log2(1 - r));
        if (entropy < 0.04) continue;

        // Légère variation pour éviter d'enchaîner 3 questions de la même catégorie à gain égal
        const categoryPenalty = q.category === this.lastCategory ? 0.94 : 1.0;
        const score = entropy * coverage * (q.priority || 1.0) * categoryPenalty;

        if (score > bestScore) {
          bestScore = score;
          bestQuestion = q;
        }
      }

      return { bestQuestion, bestScore };
    };

    let { bestQuestion, bestScore } = evaluatePool(allowLateQuestions);

    // Si aucune question standard n'apporte un bon gain d'information, débloquer les questions sur le nom
    if (!allowLateQuestions && (!bestQuestion || bestScore < 0.35)) {
      const fallback = evaluatePool(true);
      if (fallback.bestScore > bestScore) {
        bestQuestion = fallback.bestQuestion;
        bestScore = fallback.bestScore;
      }
    }

    this.currentQuestion = bestQuestion;
    return bestQuestion;
  }

  /**
   * Applique une des 5 réponses à la question courante et sauvegarde un instantané pour l'historique (Undo).
   */
  answerCurrentQuestion(answerType) {
    if (!this.currentQuestion) {
      throw new Error('Aucune question active à laquelle répondre.');
    }
    const likelihood = LIKELIHOOD_TABLE[answerType];
    if (!likelihood) {
      throw new Error(`Type de réponse inconnu : ${answerType}`);
    }

    // Sauvegarder l'état avant mise à jour (pour "Question précédente")
    this.history.push({
      type: 'answer',
      weights: [...this.weights],
      askedQuestionIds: new Set(this.askedQuestionIds),
      rejectedIds: new Set(this.rejectedIds),
      questionCount: this.questionCount,
      question: this.currentQuestion,
      lastCategory: this.lastCategory,
      forcedGuessUsed: this.forcedGuessUsed,
      answerType,
    });

    const q = this.currentQuestion;
    let maxWeight = 0;

    for (let i = 0; i < this.pokemons.length; i++) {
      const evalResult = q.evaluate(this.pokemons[i]);
      if (evalResult === true) {
        this.weights[i] *= likelihood.true;
      } else if (evalResult === false) {
        this.weights[i] *= likelihood.false;
      }
      // Si evalResult === null (attribut inconnu), le poids reste inchangé (x1.0)
      if (!this.rejectedIds.has(this.pokemons[i].id) && this.weights[i] > maxWeight) {
        maxWeight = this.weights[i];
      }
    }

    // Normaliser pour éviter tout underflow flottant après de nombreux tours
    if (maxWeight > 0) {
      for (let i = 0; i < this.weights.length; i++) {
        this.weights[i] /= maxWeight;
      }
    }

    this.askedQuestionIds.add(q.id);
    this.lastCategory = q.category;
    this.questionCount += 1;
    this.currentQuestion = null;
  }

  /**
   * Rejette le Pokémon proposé ("Non, continuer") et décide si la partie continue ou bascule en Top 5.
   * @returns {'continue' | 'exhausted'}
   */
  rejectTopCandidate(pokemonId) {
    this.history.push({
      type: 'reject',
      weights: [...this.weights],
      askedQuestionIds: new Set(this.askedQuestionIds),
      rejectedIds: new Set(this.rejectedIds),
      questionCount: this.questionCount,
      question: this.currentQuestion,
      lastCategory: this.lastCategory,
      forcedGuessUsed: this.forcedGuessUsed,
      rejectedPokemonId: pokemonId,
    });

    this.rejectedIds.add(pokemonId);
    for (let i = 0; i < this.pokemons.length; i++) {
      if (this.pokemons[i].id === pokemonId) {
        this.weights[i] *= 0.0001;
        break;
      }
    }

    if (this.questionCount >= this.FIRST_FORCED_GUESS_AT) {
      this.forcedGuessUsed = true;
    }

    // Si on a déjà atteint ou dépassé 25 questions, on passe à l'écran Top 5
    if (this.questionCount >= this.MAX_QUESTIONS_LIMIT) {
      return 'exhausted';
    }

    const nextQ = this.selectNextQuestion();
    if (!nextQ) {
      return 'exhausted';
    }

    return 'continue';
  }

  canUndo() {
    return this.history.length > 0;
  }

  /**
   * Annule la dernière action (réponse ou rejet) et restaure les poids et la question associée.
   * @returns {object|null} La question restaurée
   */
  undo() {
    if (this.history.length === 0) return null;

    // Si le dernier événement était un rejet, on remonte jusqu'à la dernière réponse pour revenir en phase question
    let snapshot = this.history.pop();
    while (snapshot && snapshot.type === 'reject' && this.history.length > 0) {
      snapshot = this.history.pop();
    }
    if (!snapshot) return null;

    this.weights = snapshot.weights;
    this.askedQuestionIds = snapshot.askedQuestionIds;
    this.rejectedIds = snapshot.rejectedIds;
    this.questionCount = snapshot.questionCount;
    this.lastCategory = snapshot.lastCategory;
    this.forcedGuessUsed = snapshot.forcedGuessUsed;
    this.currentQuestion = snapshot.question || this.selectNextQuestion();

    return this.currentQuestion;
  }
}
