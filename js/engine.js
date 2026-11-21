/**
 * js/engine.js — Moteur de déduction bayésien multi-univers (Pokémon & League of Legends).
 *
 * Modèle :
 * - Chaque candidat démarre avec un poids de 1.0.
 * - Chaque réponse met à jour les poids via des vraisemblances douces (jamais 0 absolu)
 *   pour tolérer les hésitations ou erreurs tout en convergeant rapidement.
 * - À chaque tour, le moteur choisit la question non posée maximisant le gain
 *   d'information (entropie binaire pondérée par les probabilités courantes).
 */

export const UNIVERSE_TYPES = Object.freeze({
  POKEMON: 'pokemon',
  LOL: 'lol',
});

export const ANSWER_TYPES = Object.freeze({
  YES: 'yes',
  PROBABLY_YES: 'probably_yes',
  DONT_KNOW: 'dont_know',
  PROBABLY_NO: 'probably_no',
  NO: 'no',
});

/**
 * Multiplicateurs bayésiens calibrés pour converger rapidement même sur 1025 Pokémon,
 * sans jamais tomber à 0 afin de tolérer une erreur du joueur.
 */
const LIKELIHOOD_TABLE = Object.freeze({
  [ANSWER_TYPES.YES]: { true: 1.0, false: 0.025 },
  [ANSWER_TYPES.PROBABLY_YES]: { true: 0.85, false: 0.25 },
  [ANSWER_TYPES.DONT_KNOW]: { true: 1.0, false: 1.0 },
  [ANSWER_TYPES.PROBABLY_NO]: { true: 0.25, false: 0.85 },
  [ANSWER_TYPES.NO]: { true: 0.025, false: 1.0 },
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
  'ailé (insecte)': 'Possède-t-il des ailes d’insecte (ailes membraneuses) ?',
  'insectoïde': 'A-t-il un corps segmenté ou recouvert d’une carapace insectoïde ?',
});

// IDs nationaux des lignées Starters & Pseudo-Légendaires (utilisables même sans re-fetch)
const POKEMON_STARTER_IDS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  152, 153, 154, 155, 156, 157, 158, 159, 160,
  252, 253, 254, 255, 256, 257, 258, 259, 260,
  387, 388, 389, 390, 391, 392, 393, 394, 395,
  495, 496, 497, 498, 499, 500, 501, 502, 503,
  650, 651, 652, 653, 654, 655, 656, 657, 658,
  722, 723, 724, 725, 726, 727, 728, 729, 730,
  810, 811, 812, 813, 814, 815, 816, 817, 818,
  906, 907, 908, 909, 910, 911, 912, 913, 914,
]);

const POKEMON_PSEUDO_LEGENDARY_IDS = new Set([
  147, 148, 149,
  246, 247, 248,
  371, 372, 373,
  374, 375, 376,
  443, 444, 445,
  633, 634, 635,
  704, 705, 706,
  782, 783, 784,
  885, 886, 887,
  996, 997, 998,
]);

const MOVE_QUESTIONS = Object.freeze([
  { move: 'Séisme', text: 'Votre Pokémon peut-il apprendre Séisme ?' },
  { move: 'Surf', text: 'Votre Pokémon peut-il apprendre Surf ?' },
  { move: 'Vol', text: 'Votre Pokémon peut-il apprendre Vol ?' },
  { move: 'Lance-Flammes', text: 'Votre Pokémon peut-il apprendre Lance-Flammes ?' },
  { move: 'Tonnerre', text: 'Votre Pokémon peut-il apprendre Tonnerre ?' },
  { move: 'Laser Glace', text: 'Votre Pokémon peut-il apprendre Laser Glace ?' },
  { move: 'Psyko', text: 'Votre Pokémon peut-il apprendre Psyko ?' },
  { move: "Ball'Ombre", text: "Votre Pokémon peut-il apprendre Ball'Ombre ?" },
  { move: 'Danse Lames', text: 'Votre Pokémon peut-il apprendre Danse Lames ?' },
  { move: 'Plénitude', text: 'Votre Pokémon peut-il apprendre Plénitude ?' },
  { move: 'Close Combat', text: 'Votre Pokémon peut-il apprendre Close Combat ?' },
  { move: 'Draco-Griffe', text: 'Votre Pokémon peut-il apprendre Draco-Griffe ?' },
  { move: 'Lance-Soleil', text: 'Votre Pokémon peut-il apprendre Lance-Soleil ?' },
  { move: 'Tunnel', text: 'Votre Pokémon peut-il apprendre Tunnel ?' },
  { move: 'Ultralaser', text: 'Votre Pokémon peut-il apprendre Ultralaser ?' },
  { move: 'Vibrobscur', text: 'Votre Pokémon peut-il apprendre Vibrobscur ?' },
  { move: 'Éclat Magique', text: 'Votre Pokémon peut-il apprendre Éclat Magique ?' },
  { move: 'Piège de Roc', text: 'Votre Pokémon peut-il apprendre Piège de Roc ?' },
  { move: 'Queue de Fer', text: 'Votre Pokémon peut-il apprendre Queue de Fer ?' },
  { move: 'Éco-Sphère', text: 'Votre Pokémon peut-il apprendre Éco-Sphère ?' },
  { move: 'Explosion', text: 'Votre Pokémon peut-il apprendre Explosion ?' },
  { move: 'Demi-Tour', text: 'Votre Pokémon peut-il apprendre Demi-Tour ?' },
  { move: 'Feu Follet', text: 'Votre Pokémon peut-il apprendre Feu Follet ?' },
  { move: 'Cage Éclair', text: 'Votre Pokémon peut-il apprendre Cage Éclair ?' },
]);

const LOL_REGION_TEXT = Object.freeze({
  Demacia: 'Votre champion est-il lié à Demacia ?',
  Noxus: 'Votre champion est-il lié à Noxus ?',
  Ionia: 'Votre champion vient-il d’Ionia ?',
  Piltover: 'Votre champion est-il originaire de Piltover ?',
  Zaun: 'Votre champion est-il lié à Zaun ?',
  Freljord: 'Votre champion vient-il de Freljord ?',
  Shurima: 'Votre champion est-il lié à Shurima ?',
  Bilgewater: 'Votre champion vient-il de Bilgewater ?',
  'Îles Obscures': 'Votre champion est-il lié aux Îles Obscures ?',
  Néant: 'Votre champion est-il lié au Néant (Void) ?',
  Targon: 'Votre champion est-il lié au Mont Targon ?',
  Bandle: 'Votre champion est-il lié à Bandle ?',
  Ixtal: 'Votre champion est-il originaire d’Ixtal ?',
});

const LOL_SPECIES_TEXT = Object.freeze({
  Humain: 'Votre champion est-il un humain ?',
  Yordle: 'Votre champion est-il un Yordle ?',
  Vastaya: 'Votre champion est-il un Vastaya (mi-humain, mi-animal) ?',
  Démon: 'Votre champion est-il un démon ?',
  Néant: 'Est-ce une créature née du Néant ?',
  Dragon: 'Votre champion est-il un dragon (ou demi-dragon) ?',
  'Mort-vivant': 'Est-ce un mort-vivant ou un spectre ?',
  'Robot / Golem': 'Est-ce un robot, un golem ou une créature mécanique ?',
  'Divinité / Aspect': 'Est-ce une divinité, un Transfiguré ou une Manifestation céleste ?',
  Darkin: 'Est-ce un Darkin ?',
  'Monstre / Esprit': 'Est-ce un monstre, un esprit ou une créature non-humaine ?',
});

const LOL_LANE_TEXT = Object.freeze({
  Top: 'Se joue-t-il principalement sur la Top lane ?',
  Jungle: 'Se joue-t-il principalement en Jungle ?',
  Mid: 'Se joue-t-il principalement sur la Mid lane ?',
  ADC: 'Se joue-t-il principalement en ADC (Bot lane) ?',
  Support: 'Se joue-t-il principalement en tant que Support ?',
});

const LOL_ROLE_TEXT = Object.freeze({
  Assassin: 'Votre champion est-il classé comme Assassin ?',
  Combattant: 'Votre champion est-il un Combattant (Bruiser / Fighter) ?',
  Mage: 'Votre champion est-il un Mage ?',
  Tireur: 'Votre champion est-il un Tireur (Marksman) ?',
  Support: 'Votre champion a-t-il un rôle de Support / Enchanteur ?',
  Tank: 'Votre champion est-il un Tank ?',
});

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

function appendNameQuestions(questions, items, entityLabel) {
  const presentLetters = new Set();
  for (const item of items) {
    const letter = getFirstLetter(item.name);
    if (letter) presentLetters.add(letter);
  }

  questions.push(
    {
      id: 'name_a_m',
      category: 'Nom',
      text: `Le nom de ${entityLabel} commence-t-il par une lettre entre A et M ?`,
      priority: 0.9,
      lateOnly: true,
      evaluate: (item) => {
        const c = getFirstLetter(item.name);
        return c ? c >= 'A' && c <= 'M' : null;
      },
    },
    {
      id: 'name_a_f',
      category: 'Nom',
      text: `Le nom de ${entityLabel} commence-t-il par une lettre entre A et F ?`,
      priority: 0.89,
      lateOnly: true,
      evaluate: (item) => {
        const c = getFirstLetter(item.name);
        return c ? c >= 'A' && c <= 'F' : null;
      },
    },
    {
      id: 'name_g_m',
      category: 'Nom',
      text: `Le nom de ${entityLabel} commence-t-il par une lettre entre G et M ?`,
      priority: 0.89,
      lateOnly: true,
      evaluate: (item) => {
        const c = getFirstLetter(item.name);
        return c ? c >= 'G' && c <= 'M' : null;
      },
    },
    {
      id: 'name_n_s',
      category: 'Nom',
      text: `Le nom de ${entityLabel} commence-t-il par une lettre entre N et S ?`,
      priority: 0.89,
      lateOnly: true,
      evaluate: (item) => {
        const c = getFirstLetter(item.name);
        return c ? c >= 'N' && c <= 'S' : null;
      },
    },
    {
      id: 'name_len_gte_8',
      category: 'Nom',
      text: `Le nom de ${entityLabel} comporte-t-il 8 lettres ou plus ?`,
      priority: 0.88,
      lateOnly: true,
      evaluate: (item) => getCleanLetterCount(item.name) >= 8,
    },
  );

  for (const letter of [...presentLetters].sort()) {
    questions.push({
      id: `name_letter_${letter}`,
      category: 'Nom',
      text: `Le nom de ${entityLabel} commence-t-il par la lettre « ${letter} » ?`,
      priority: 0.93,
      lateOnly: true,
      evaluate: (item) => getFirstLetter(item.name) === letter,
    });
  }
}

/* ==========================================================================
   BANQUE DE QUESTIONS : POKÉMON (concrètes, sans regroupements vagues)
   ========================================================================== */

function buildPokemonQuestionBank(pokemons) {
  const questions = [];

  const presentTypes = new Set();
  const presentGens = new Set();
  const presentColors = new Set();
  const presentShapes = new Set();
  const presentMoves = new Set();

  for (const p of pokemons) {
    for (const t of p.types || []) presentTypes.add(t);
    if (p.generation) presentGens.add(p.generation);
    if (p.color) presentColors.add(p.color);
    if (p.shape) presentShapes.add(p.shape);
    if (Array.isArray(p.notable_moves)) {
      for (const m of p.notable_moves) presentMoves.add(m);
    }
  }

  // --- 1. TYPES (uniquement précis + double-type) ---
  questions.push({
    id: 'type_dual',
    category: 'Type',
    text: 'Votre Pokémon possède-t-il un double type ?',
    priority: 1.05,
    evaluate: (p) => Array.isArray(p.types) && p.types.length >= 2,
  });

  for (const typeName of [...presentTypes].sort()) {
    questions.push({
      id: `type_${typeName.toLowerCase()}`,
      category: 'Type',
      text: `Votre Pokémon est-il de type ${typeName} ?`,
      priority: 1.08,
      evaluate: (p) => (p.types || []).includes(typeName),
    });
  }

  // --- 2. ATTAQUES EMBLÉMATIQUES (Séisme, Surf, Vol, Lance-Flammes, etc.) ---
  for (const mq of MOVE_QUESTIONS) {
    if (!presentMoves.has(mq.move)) continue;
    questions.push({
      id: `move_${mq.move.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      category: 'Attaque',
      text: mq.text,
      priority: 1.06,
      evaluate: (p) => (Array.isArray(p.notable_moves) ? p.notable_moves.includes(mq.move) : null),
    });
  }

  if (presentMoves.has('Soin') || presentMoves.has('Atterrissage')) {
    questions.push({
      id: 'move_heal_recovery',
      category: 'Attaque',
      text: 'Votre Pokémon peut-il apprendre Soin ou Atterrissage ?',
      priority: 1.03,
      evaluate: (p) =>
        Array.isArray(p.notable_moves)
          ? p.notable_moves.includes('Soin') || p.notable_moves.includes('Atterrissage')
          : null,
    });
  }

  // --- 3. GÉNÉRATIONS ---
  const genRanges = [
    {
      id: 'gen_lt_5',
      text: 'Est-il apparu avant la 5e génération (Générations 1 à 4) ?',
      fn: (g) => g <= 4,
    },
    {
      id: 'gen_lt_4',
      text: 'Est-il apparu dans les 3 premières générations (Kanto, Johto ou Hoenn) ?',
      fn: (g) => g <= 3,
    },
    {
      id: 'gen_lt_3',
      text: 'Est-il apparu dans les 2 premières générations (Kanto ou Johto) ?',
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
  ];

  for (const range of genRanges) {
    questions.push({
      id: range.id,
      category: 'Génération',
      text: range.text,
      priority: 1.04,
      evaluate: (p) => (typeof p.generation === 'number' ? range.fn(p.generation) : null),
    });
  }

  for (const gen of [...presentGens].sort((a, b) => a - b)) {
    const label = GENERATION_LABELS[gen] || `${gen}e génération`;
    questions.push({
      id: `gen_${gen}`,
      category: 'Génération',
      text: `Est-il apparu dans la ${label} ?`,
      priority: 1.06,
      evaluate: (p) => p.generation === gen,
    });
  }

  // --- 4. ÉVOLUTION ---
  questions.push(
    {
      id: 'evo_has_family',
      category: 'Évolution',
      text: 'Votre Pokémon fait-il partie d’une lignée d’évolution (il évolue ou est une évolution) ?',
      priority: 1.04,
      evaluate: (p) => p.evolution_stage !== 'single',
    },
    {
      id: 'evo_can_evolve',
      category: 'Évolution',
      text: 'Votre Pokémon peut-il encore évoluer en un autre Pokémon ?',
      priority: 1.06,
      evaluate: (p) => p.evolution_stage === 'base' || p.evolution_stage === 'middle',
    },
    {
      id: 'evo_is_evolved',
      category: 'Évolution',
      text: 'Votre Pokémon est-il déjà l’évolution d’un autre Pokémon ?',
      priority: 1.06,
      evaluate: (p) => p.evolution_stage === 'middle' || p.evolution_stage === 'final',
    },
    {
      id: 'evo_stage_base',
      category: 'Évolution',
      text: 'Est-ce le stade de base d’une lignée d’évolution ?',
      priority: 1.02,
      evaluate: (p) => p.evolution_stage === 'base',
    },
    {
      id: 'evo_stage_middle',
      category: 'Évolution',
      text: 'Est-ce un stade intermédiaire d’évolution ?',
      priority: 1.01,
      evaluate: (p) => p.evolution_stage === 'middle',
    },
    {
      id: 'evo_stage_final',
      category: 'Évolution',
      text: 'Est-ce le stade final d’une lignée d’évolution ?',
      priority: 1.04,
      evaluate: (p) => p.evolution_stage === 'final',
    },
  );

  // --- 5. STATUTS, LIGNÉES & FORMES SPÉCIALES ---
  questions.push(
    {
      id: 'status_starter',
      category: 'Lignée',
      text: 'Fait-il partie d’une lignée de Pokémon de départ (Starter) ?',
      priority: 1.06,
      evaluate: (p) =>
        typeof p.is_starter === 'boolean' ? p.is_starter : POKEMON_STARTER_IDS.has(p.id),
    },
    {
      id: 'status_pseudo_legend',
      category: 'Lignée',
      text: 'Fait-il partie d’une lignée de pseudo-légendaire (Dracolosse, Carchacrok, Lanssorien…) ?',
      priority: 1.04,
      evaluate: (p) =>
        typeof p.is_pseudo_legendary === 'boolean'
          ? p.is_pseudo_legendary
          : POKEMON_PSEUDO_LEGENDARY_IDS.has(p.id),
    },
    {
      id: 'status_legend_or_myth',
      category: 'Statut',
      text: 'Est-ce un Pokémon Légendaire ou Fabuleux ?',
      priority: 1.05,
      evaluate: (p) => Boolean(p.is_legendary || p.is_mythical),
    },
    {
      id: 'status_legendary',
      category: 'Statut',
      text: 'Est-ce un Pokémon Légendaire ?',
      priority: 1.03,
      evaluate: (p) => Boolean(p.is_legendary),
    },
    {
      id: 'status_mythical',
      category: 'Statut',
      text: 'Est-ce un Pokémon Fabuleux (comme Mew, Celebi ou Jirachi) ?',
      priority: 1.02,
      evaluate: (p) => Boolean(p.is_mythical),
    },
    {
      id: 'status_baby',
      category: 'Statut',
      text: 'Est-ce un Pokémon Bébé (comme Pichu, Togepi ou Riolu) ?',
      priority: 1.01,
      evaluate: (p) => Boolean(p.is_baby),
    },
    {
      id: 'status_genderless',
      category: 'Statut',
      text: 'Est-ce un Pokémon asexué (sans genre mâle ni femelle) ?',
      priority: 1.02,
      evaluate: (p) => (typeof p.is_genderless === 'boolean' ? p.is_genderless : null),
    },
    {
      id: 'form_mega',
      category: 'Forme spéciale',
      text: 'Votre Pokémon possède-t-il une Méga-Évolution ?',
      priority: 1.05,
      evaluate: (p) => Boolean(p.has_mega),
    },
    {
      id: 'form_gmax',
      category: 'Forme spéciale',
      text: 'Votre Pokémon possède-t-il une forme Gigamax ?',
      priority: 1.02,
      evaluate: (p) => Boolean(p.has_gmax),
    },
    {
      id: 'form_regional',
      category: 'Forme spéciale',
      text: 'Possède-t-il une forme régionale (Alola, Galar, Hisui ou Paldea) ?',
      priority: 1.04,
      evaluate: (p) => (typeof p.has_regional_form === 'boolean' ? p.has_regional_form : null),
    },
  );

  // --- 6. PROFIL DE COMBAT (si enrichi via fetch_pokemons.py) ---
  questions.push(
    {
      id: 'combat_bst_high',
      category: 'Combat',
      text: 'Est-il réputé puissant en combat (total de statistiques ≥ 500) ?',
      priority: 1.03,
      evaluate: (p) => (typeof p.bst === 'number' ? p.bst >= 500 : null),
    },
    {
      id: 'combat_bst_low',
      category: 'Combat',
      text: 'A-t-il des statistiques globales plutôt modestes (total < 360) ?',
      priority: 1.0,
      evaluate: (p) => (typeof p.bst === 'number' ? p.bst < 360 : null),
    },
    {
      id: 'combat_physical',
      category: 'Combat',
      text: 'Est-il plutôt orienté Attaquant Physique ?',
      priority: 1.03,
      evaluate: (p) => (p.attack_style ? p.attack_style === 'physique' : null),
    },
    {
      id: 'combat_special',
      category: 'Combat',
      text: 'Est-il plutôt orienté Attaquant Spécial ?',
      priority: 1.03,
      evaluate: (p) => (p.attack_style ? p.attack_style === 'spécial' : null),
    },
    {
      id: 'combat_fast',
      category: 'Combat',
      text: 'Est-il particulièrement rapide en combat (Vitesse ≥ 95) ?',
      priority: 1.02,
      evaluate: (p) => (typeof p.speed === 'number' ? p.speed >= 95 : null),
    },
    {
      id: 'combat_bulky',
      category: 'Combat',
      text: 'Est-il réputé très résistant ou doté de PV / Défenses élevés ?',
      priority: 1.0,
      evaluate: (p) => (typeof p.is_bulky === 'boolean' ? p.is_bulky : null),
    },
  );

  // --- 7. COULEURS (uniquement couleurs précises) ---
  for (const color of [...presentColors].sort()) {
    const label = COLOR_ARTICLES[color] || color.toLowerCase();
    questions.push({
      id: `color_${color.toLowerCase()}`,
      category: 'Couleur',
      text: `La couleur officielle dominante de votre Pokémon est-elle ${label} ?`,
      priority: 1.02,
      evaluate: (p) => p.color === color,
    });
  }

  // --- 8. MORPHOLOGIE ---
  const bipedShapes = new Set(['humanoïde', 'bipède à queue', 'avec jambes']);
  const wingedShapes = new Set(['ailé', 'ailé (insecte)']);

  questions.push(
    {
      id: 'shape_group_biped',
      category: 'Morphologie',
      text: 'Votre Pokémon se tient-il sur deux pattes (bipède ou humanoïde) ?',
      priority: 1.04,
      evaluate: (p) => (p.shape ? bipedShapes.has(p.shape) : null),
    },
    {
      id: 'shape_group_winged',
      category: 'Morphologie',
      text: 'Votre Pokémon possède-t-il des ailes comme trait principal ?',
      priority: 1.02,
      evaluate: (p) => (p.shape ? wingedShapes.has(p.shape) : null),
    },
  );

  for (const shape of [...presentShapes].sort()) {
    const text = SPECIFIC_SHAPE_TEXT[shape];
    if (!text) continue;
    questions.push({
      id: `shape_${shape}`,
      category: 'Morphologie',
      text,
      priority: shape === 'quadrupède' ? 1.04 : 0.98,
      evaluate: (p) => (p.shape ? p.shape === shape : null),
    });
  }

  // --- 9. HABITAT ---
  const habitatQuestions = [
    { id: 'habitat_forest', text: 'Vit-il naturellement dans les forêts ?', fn: (h) => h === 'forêt' },
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
    { id: 'habitat_grassland', text: 'Vit-il dans les plaines ou prairies ?', fn: (h) => h === 'plaine' },
    { id: 'habitat_urban', text: 'Vit-il principalement en milieu urbain ?', fn: (h) => h === 'urbain' },
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

  // --- 10. TAILLE & POIDS ---
  const sizeQuestions = [
    { id: 'height_gt_1', text: 'Mesure-t-il plus de 1 mètre ?', fn: (p) => p.height_m > 1.0 },
    { id: 'height_gt_1_5', text: 'Mesure-t-il plus de 1,5 mètre ?', fn: (p) => p.height_m > 1.5 },
    { id: 'height_lt_0_6', text: 'Est-il très petit (moins de 60 cm) ?', fn: (p) => p.height_m < 0.6 },
    { id: 'height_gt_2', text: 'Est-il très grand (plus de 2 mètres) ?', fn: (p) => p.height_m > 2.0 },
    { id: 'weight_gt_15', text: 'Pèse-t-il plus de 15 kg ?', fn: (p) => p.weight_kg > 15.0 },
    { id: 'weight_gt_50', text: 'Pèse-t-il plus de 50 kg ?', fn: (p) => p.weight_kg > 50.0 },
    { id: 'weight_gt_100', text: 'Pèse-t-il plus de 100 kg (poids lourd) ?', fn: (p) => p.weight_kg > 100.0 },
    { id: 'weight_lt_10', text: 'Est-il très léger (moins de 10 kg) ?', fn: (p) => p.weight_kg < 10.0 },
  ];

  for (const sq of sizeQuestions) {
    questions.push({
      id: sq.id,
      category: 'Mensurations',
      text: sq.text,
      priority: 0.97,
      evaluate: (p) =>
        typeof p.height_m === 'number' && typeof p.weight_kg === 'number' ? sq.fn(p) : null,
    });
  }

  // --- 11. NOM (fin de partie) ---
  appendNameQuestions(questions, pokemons, 'votre Pokémon');

  return questions;
}

/* ==========================================================================
   BANQUE DE QUESTIONS : LEAGUE OF LEGENDS
   ========================================================================== */

function buildLolQuestionBank(champions) {
  const questions = [];

  const presentRoles = new Set();
  const presentLanes = new Set();
  const presentRegions = new Set();
  const presentSpecies = new Set();

  for (const c of champions) {
    for (const r of c.roles || []) presentRoles.add(r);
    for (const l of c.lanes || []) presentLanes.add(l);
    if (c.region) presentRegions.add(c.region);
    if (c.species) presentSpecies.add(c.species);
  }

  // --- 1. VOIES (LANES) ---
  for (const lane of [...presentLanes].sort()) {
    const text = LOL_LANE_TEXT[lane];
    if (!text) continue;
    questions.push({
      id: `lol_lane_${lane.toLowerCase()}`,
      category: 'Voie',
      text,
      priority: 1.09,
      evaluate: (c) => (Array.isArray(c.lanes) ? c.lanes.includes(lane) : null),
    });
  }

  questions.push({
    id: 'lol_lane_flex',
    category: 'Voie',
    text: 'Votre champion se joue-t-il couramment sur plusieurs postes (Flex pick) ?',
    priority: 0.97,
    evaluate: (c) => (Array.isArray(c.lanes) ? c.lanes.length >= 2 : null),
  });

  // --- 2. PORTÉE & DÉGÂTS ---
  questions.push(
    {
      id: 'lol_range_melee',
      category: 'Combat',
      text: 'Votre champion attaque-t-il au corps à corps (Mêlée) ?',
      priority: 1.08,
      evaluate: (c) => (c.range_type ? c.range_type === 'Mêlée' : null),
    },
    {
      id: 'lol_dmg_ad',
      category: 'Dégâts',
      text: 'Inflige-t-il principalement des dégâts physiques (AD) ?',
      priority: 1.07,
      evaluate: (c) => (c.damage_type ? c.damage_type === 'Physique' : null),
    },
    {
      id: 'lol_dmg_ap',
      category: 'Dégâts',
      text: 'Inflige-t-il principalement des dégâts magiques (AP) ?',
      priority: 1.07,
      evaluate: (c) => (c.damage_type ? c.damage_type === 'Magique' : null),
    },
    {
      id: 'lol_dmg_hybrid',
      category: 'Dégâts',
      text: 'Inflige-t-il des dégâts mixtes / hybrides (AD et AP) ?',
      priority: 1.0,
      evaluate: (c) => (c.damage_type ? c.damage_type === 'Hybride' : null),
    },
  );

  // --- 3. CLASSES / RÔLES ---
  for (const role of [...presentRoles].sort()) {
    const text = LOL_ROLE_TEXT[role];
    if (!text) continue;
    questions.push({
      id: `lol_role_${role.toLowerCase()}`,
      category: 'Classe',
      text,
      priority: 1.06,
      evaluate: (c) => (Array.isArray(c.roles) ? c.roles.includes(role) : null),
    });
  }

  // --- 4. RESSOURCE ---
  questions.push(
    {
      id: 'lol_res_mana',
      category: 'Ressource',
      text: 'Votre champion utilise-t-il du Mana pour lancer ses sorts ?',
      priority: 1.05,
      evaluate: (c) => (c.resource ? c.resource === 'Mana' : null),
    },
    {
      id: 'lol_res_energy',
      category: 'Ressource',
      text: 'Votre champion utilise-t-il de l’Énergie (comme Zed, Akali ou Lee Sin) ?',
      priority: 1.04,
      evaluate: (c) => (c.resource ? c.resource === 'Énergie' : null),
    },
    {
      id: 'lol_res_manaless',
      category: 'Ressource',
      text: 'Joue-t-il sans aucune barre de ressource (comme Garen, Riven ou Katarina) ?',
      priority: 1.02,
      evaluate: (c) => (c.resource ? c.resource === 'Sans ressource' : null),
    },
  );

  // --- 5. GENRE & ESPÈCE ---
  questions.push(
    {
      id: 'lol_gender_male',
      category: 'Identité',
      text: 'Votre champion est-il un personnage masculin ?',
      priority: 1.06,
      evaluate: (c) => (c.gender ? c.gender === 'Homme' : null),
    },
    {
      id: 'lol_gender_female',
      category: 'Identité',
      text: 'Votre champion est-il un personnage féminin ?',
      priority: 1.06,
      evaluate: (c) => (c.gender ? c.gender === 'Femme' : null),
    },
  );

  for (const sp of [...presentSpecies].sort()) {
    const text = LOL_SPECIES_TEXT[sp];
    if (!text) continue;
    questions.push({
      id: `lol_species_${sp.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      category: 'Origine',
      text,
      priority: sp === 'Humain' ? 1.05 : 1.02,
      evaluate: (c) => (c.species ? c.species === sp : null),
    });
  }

  // --- 6. RÉGIONS DE RUNETERRA ---
  questions.push({
    id: 'lol_region_pz',
    category: 'Région',
    text: 'Votre champion est-il lié à Piltover ou à Zaun ?',
    priority: 1.03,
    evaluate: (c) => (c.region ? c.region === 'Piltover' || c.region === 'Zaun' : null),
  });

  for (const reg of [...presentRegions].sort()) {
    const text = LOL_REGION_TEXT[reg];
    if (!text) continue;
    questions.push({
      id: `lol_region_${reg.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      category: 'Région',
      text,
      priority: 1.04,
      evaluate: (c) => (c.region ? c.region === reg : null),
    });
  }

  // --- 7. ANCIENNETÉ ---
  questions.push(
    {
      id: 'lol_era_classic',
      category: 'Ancienneté',
      text: 'Est-ce un champion historique sorti entre 2009 et 2012 ?',
      priority: 1.03,
      evaluate: (c) => (typeof c.release_year === 'number' ? c.release_year <= 2012 : null),
    },
    {
      id: 'lol_era_before_2016',
      category: 'Ancienneté',
      text: 'Est-il sorti avant 2016 ?',
      priority: 1.01,
      evaluate: (c) => (typeof c.release_year === 'number' ? c.release_year < 2016 : null),
    },
    {
      id: 'lol_era_recent',
      category: 'Ancienneté',
      text: 'Est-il relativement récent (sorti à partir de 2020) ?',
      priority: 1.02,
      evaluate: (c) => (typeof c.release_year === 'number' ? c.release_year >= 2020 : null),
    },
  );

  // --- 8. MÉCANIQUES DE KIT ---
  questions.push(
    {
      id: 'lol_kit_dash',
      category: 'Compétences',
      text: 'Possède-t-il un dash, un bond ou une téléportation dans ses sorts ?',
      priority: 1.05,
      evaluate: (c) => (typeof c.has_dash === 'boolean' ? c.has_dash : null),
    },
    {
      id: 'lol_kit_stealth',
      category: 'Compétences',
      text: 'Peut-il devenir invisible ou camouflé ?',
      priority: 1.05,
      evaluate: (c) => (typeof c.has_stealth === 'boolean' ? c.has_stealth : null),
    },
    {
      id: 'lol_kit_heal_shield',
      category: 'Compétences',
      text: 'Possède-t-il un soin ou un bouclier dans ses compétences ?',
      priority: 1.03,
      evaluate: (c) => (typeof c.has_heal_shield === 'boolean' ? c.has_heal_shield : null),
    },
    {
      id: 'lol_kit_cc',
      category: 'Compétences',
      text: 'Possède-t-il un contrôle de foule puissant (étourdissement, charme, peur, projection ou grab) ?',
      priority: 1.04,
      evaluate: (c) => (typeof c.has_hard_cc === 'boolean' ? c.has_hard_cc : null),
    },
    {
      id: 'lol_kit_global',
      category: 'Compétences',
      text: 'Possède-t-il un ultime global ou à très longue portée sur la carte ?',
      priority: 1.04,
      evaluate: (c) => (typeof c.has_global_ult === 'boolean' ? c.has_global_ult : null),
    },
    {
      id: 'lol_kit_summon',
      category: 'Compétences',
      text: 'Peut-il invoquer un familier, un clone, des soldats ou des tourelles ?',
      priority: 1.03,
      evaluate: (c) => (typeof c.has_summon === 'boolean' ? c.has_summon : null),
    },
  );

  // --- 9. NOM (fin de partie) ---
  appendNameQuestions(questions, champions, 'votre champion');

  return questions;
}

/* ==========================================================================
   MOTEUR BAYÉSIEN GÉNÉRIQUE
   ========================================================================== */

export class AkinatorEngine {
  constructor(items, universe = UNIVERSE_TYPES.POKEMON) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('La base de données est vide ou invalide.');
    }
    this.universe = universe;
    this.items = items;
    this.questions =
      universe === UNIVERSE_TYPES.LOL
        ? buildLolQuestionBank(items)
        : buildPokemonQuestionBank(items);

    this.CERTAINTY_THRESHOLD = 0.85;
    this.FIRST_FORCED_GUESS_AT = 20;
    this.MAX_QUESTIONS_LIMIT = 25;
    this.lastOpeningQuestionId = null;
    this.reset();
  }

  reset() {
    this.weights = new Array(this.items.length).fill(1.0);
    this.askedQuestionIds = new Set();
    this.rejectedIds = new Set();
    this.history = [];
    this.questionCount = 0;
    this.currentQuestion = null;
    this.recentCategories = [];
    this.forcedGuessUsed = false;
  }

  getRankedCandidates() {
    let totalWeight = 0;
    const active = [];

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (this.rejectedIds.has(item.id)) continue;
      const w = this.weights[i];
      totalWeight += w;
      active.push({ item, weight: w, index: i });
    }

    if (totalWeight <= 0) {
      return active.map((entry) => ({
        item: entry.item,
        probability: active.length ? 1 / active.length : 0,
      }));
    }

    active.sort(
      (a, b) => b.weight - a.weight || String(a.item.name).localeCompare(String(b.item.name), 'fr'),
    );
    return active.map((entry) => ({
      item: entry.item,
      probability: entry.weight / totalWeight,
    }));
  }

  /**
   * Calcule la certitude [0, 1] à partir de l'écart entre le 1er et le 2e candidat,
   * pondéré par la domination relative pour éviter les questions redondantes sur 1025 entrées.
   */
  getCertainty() {
    const ranked = this.getRankedCandidates();
    if (ranked.length === 0) return 0;
    if (ranked.length === 1) return 1;
    const p1 = ranked[0].probability;
    const p2 = ranked[1].probability;
    const gap = Math.max(0, p1 - p2);
    const relativeLead = p1 + p2 > 0 ? gap / (p1 + p2) : 0;
    const score = gap + 0.16 * p1 * relativeLead;
    return Math.max(0, Math.min(1, score));
  }

  getPlausibleCount() {
    const ranked = this.getRankedCandidates();
    if (ranked.length === 0) return 0;
    let cumulative = 0;
    let count = 0;
    for (const entry of ranked) {
      cumulative += entry.probability;
      count += 1;
      if (cumulative >= 0.92 && entry.probability < 0.05) break;
    }
    return count;
  }

  getTopCandidates(limit = 5) {
    return this.getRankedCandidates().slice(0, limit);
  }

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
   * Calcule un facteur d'alternance pour éviter de poser plusieurs questions
   * de la même catégorie d'affilée (mémoire sur les 3 derniers tours).
   */
  getCategoryCooldownFactor(category) {
    const len = this.recentCategories.length;
    if (len >= 1 && this.recentCategories[len - 1] === category) return 0.72;
    if (len >= 2 && this.recentCategories[len - 2] === category) return 0.86;
    if (len >= 3 && this.recentCategories[len - 3] === category) return 0.94;
    return 1.0;
  }

  selectNextQuestion() {
    const ranked = this.getRankedCandidates();
    if (ranked.length <= 1) {
      this.currentQuestion = null;
      return null;
    }

    const activeEntries = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.rejectedIds.has(this.items[i].id)) continue;
      activeEntries.push({ index: i, item: this.items[i], weight: this.weights[i] });
    }

    const totalWeight = activeEntries.reduce((acc, e) => acc + e.weight, 0);
    if (totalWeight <= 0) {
      this.currentQuestion = null;
      return null;
    }

    const plausibleCount = this.getPlausibleCount();
    const allowLateQuestions = plausibleCount <= 8 || this.questionCount >= 12;

    const evaluatePool = (includeLate) => {
      const scored = [];

      for (const q of this.questions) {
        if (this.askedQuestionIds.has(q.id)) continue;
        if (q.lateOnly && !includeLate) continue;

        let pYes = 0;
        let pNo = 0;

        for (const entry of activeEntries) {
          const prob = entry.weight / totalWeight;
          if (prob < 1e-6) continue;
          const res = q.evaluate(entry.item);
          if (res === true) pYes += prob;
          else if (res === false) pNo += prob;
        }

        const coverage = pYes + pNo;
        if (coverage < 0.55 || pYes < 0.005 || pNo < 0.005) continue;

        const r = pYes / coverage;
        const entropy = -(r * Math.log2(r) + (1 - r) * Math.log2(1 - r));
        if (entropy < 0.04) continue;

        const categoryFactor = this.getCategoryCooldownFactor(q.category);
        // Éviter de recommencer deux parties de suite exactement par la même 1ère question
        const openingRepeatPenalty =
          this.questionCount === 0 && q.id === this.lastOpeningQuestionId ? 0.65 : 1.0;
        const score =
          entropy * coverage * (q.priority || 1.0) * categoryFactor * openingRepeatPenalty;

        scored.push({ question: q, score });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored;
    };

    let candidates = evaluatePool(allowLateQuestions);
    let bestScore = candidates.length > 0 ? candidates[0].score : 0;

    if (!allowLateQuestions && bestScore < 0.32) {
      const fallback = evaluatePool(true);
      if (fallback.length > 0 && fallback[0].score > bestScore) {
        candidates = fallback;
        bestScore = fallback[0].score;
      }
    }

    if (candidates.length === 0) {
      this.currentQuestion = null;
      return null;
    }

    // Sélection aléatoire pondérée parmi les meilleures questions proches de l'optimum
    // afin de varier l'ordre d'une partie à l'autre sans perdre en vitesse de déduction.
    const bandRatio = this.questionCount < 4 ? 0.85 : 0.92;
    const maxShortlist = this.questionCount < 4 ? 7 : 4;
    const minScore = bestScore * bandRatio;

    const shortlist = [];
    const seenCategories = new Set();
    for (const entry of candidates) {
      if (entry.score < minScore) break;
      // Privilégier la diversité de catégories dans le top
      if (!seenCategories.has(entry.question.category) || shortlist.length < 2) {
        shortlist.push(entry);
        seenCategories.add(entry.question.category);
      }
      if (shortlist.length >= maxShortlist) break;
    }

    let chosen = shortlist[0].question;
    if (shortlist.length > 1) {
      const weights = shortlist.map((e) => Math.pow(e.score / bestScore, 4));
      const sumW = weights.reduce((a, b) => a + b, 0);
      let roll = Math.random() * sumW;
      for (let i = 0; i < shortlist.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          chosen = shortlist[i].question;
          break;
        }
      }
    }

    if (this.questionCount === 0) {
      this.lastOpeningQuestionId = chosen.id;
    }

    this.currentQuestion = chosen;
    return chosen;
  }

  answerCurrentQuestion(answerType) {
    if (!this.currentQuestion) {
      throw new Error('Aucune question active à laquelle répondre.');
    }
    const likelihood = LIKELIHOOD_TABLE[answerType];
    if (!likelihood) {
      throw new Error(`Type de réponse inconnu : ${answerType}`);
    }

    this.history.push({
      type: 'answer',
      weights: [...this.weights],
      askedQuestionIds: new Set(this.askedQuestionIds),
      rejectedIds: new Set(this.rejectedIds),
      questionCount: this.questionCount,
      question: this.currentQuestion,
      recentCategories: [...this.recentCategories],
      forcedGuessUsed: this.forcedGuessUsed,
      answerType,
    });

    const q = this.currentQuestion;
    let maxWeight = 0;

    for (let i = 0; i < this.items.length; i++) {
      const evalResult = q.evaluate(this.items[i]);
      if (evalResult === true) {
        this.weights[i] *= likelihood.true;
      } else if (evalResult === false) {
        this.weights[i] *= likelihood.false;
      }
      if (!this.rejectedIds.has(this.items[i].id) && this.weights[i] > maxWeight) {
        maxWeight = this.weights[i];
      }
    }

    if (maxWeight > 0) {
      for (let i = 0; i < this.weights.length; i++) {
        this.weights[i] /= maxWeight;
      }
    }

    this.askedQuestionIds.add(q.id);
    this.recentCategories.push(q.category);
    if (this.recentCategories.length > 4) {
      this.recentCategories.shift();
    }
    this.questionCount += 1;
    this.currentQuestion = null;
  }

  rejectTopCandidate(itemId) {
    this.history.push({
      type: 'reject',
      weights: [...this.weights],
      askedQuestionIds: new Set(this.askedQuestionIds),
      rejectedIds: new Set(this.rejectedIds),
      questionCount: this.questionCount,
      question: this.currentQuestion,
      recentCategories: [...this.recentCategories],
      forcedGuessUsed: this.forcedGuessUsed,
      rejectedItemId: itemId,
    });

    this.rejectedIds.add(itemId);
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === itemId) {
        this.weights[i] *= 0.0001;
        break;
      }
    }

    if (this.questionCount >= this.FIRST_FORCED_GUESS_AT) {
      this.forcedGuessUsed = true;
    }

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

  undo() {
    if (this.history.length === 0) return null;

    let snapshot = this.history.pop();
    while (snapshot && snapshot.type === 'reject' && this.history.length > 0) {
      snapshot = this.history.pop();
    }
    if (!snapshot) return null;

    this.weights = snapshot.weights;
    this.askedQuestionIds = snapshot.askedQuestionIds;
    this.rejectedIds = snapshot.rejectedIds;
    this.questionCount = snapshot.questionCount;
    this.recentCategories = snapshot.recentCategories || [];
    this.forcedGuessUsed = snapshot.forcedGuessUsed;
    this.currentQuestion = snapshot.question || this.selectNextQuestion();

    return this.currentQuestion;
  }
}

// Alias conservé par rétrocompatibilité
export const PokeNatorEngine = AkinatorEngine;
