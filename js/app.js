/**
 * js/app.js — Gestion multi-univers (Pokémon & League of Legends),
 * interface utilisateur, états de jeu, thème et historique.
 */

import { ANSWER_TYPES, AkinatorEngine, UNIVERSE_TYPES } from './engine.js';

const THEME_STORAGE_KEY = 'pokenator-theme';
const UNIVERSE_STORAGE_KEY = 'pokenator-universe';

const UNIVERSES = Object.freeze({
  [UNIVERSE_TYPES.POKEMON]: {
    id: UNIVERSE_TYPES.POKEMON,
    dataUrl: './data/pokemons.json',
    brandName: 'PokéNator',
    brandSub: 'DEX-AI v2',
    titleHighlight: 'Pokémon',
    desc: 'Choisissez secrètement un Pokémon dans votre tête, répondez à mes questions (types, attaques, génération…) et laissez le moteur bayésien remonter la piste.',
    unitSingular: 'Pokémon',
    unitPlural: 'Pokémon',
    metaLabel: 'Générations',
    victoryPill: 'Pokémon identifié !',
    failKicker: 'Bien joué, dresseur !',
    footerSource: 'Données & Artworks : PokeAPI',
    sampleThreshold: 30,
    fetchCmd: 'python scripts/fetch_pokemons.py',
    fetchTotalLabel: 'les 1025 Pokémon',
  },
  [UNIVERSE_TYPES.LOL]: {
    id: UNIVERSE_TYPES.LOL,
    dataUrl: './data/lol_champions.json',
    brandName: 'LoLNator',
    brandSub: 'HEXTECH-AI',
    titleHighlight: 'Champion LoL',
    desc: 'Pensez à un champion de League of Legends, répondez aux questions (voie, classe, région, mécanique…) et laissez le moteur bayésien deviner qui se cache dans la Faille.',
    unitSingular: 'Champion',
    unitPlural: 'Champions',
    metaLabel: 'Régions',
    victoryPill: 'Champion identifié !',
    failKicker: 'Bien joué, invocateur !',
    footerSource: 'Données & Artworks : Riot Data Dragon',
    sampleThreshold: 40,
    fetchCmd: 'python scripts/fetch_lol_champions.py',
    fetchTotalLabel: 'tous les champions (~170)',
  },
});

const KEY_TO_ANSWER = Object.freeze({
  '1': ANSWER_TYPES.YES,
  '2': ANSWER_TYPES.PROBABLY_YES,
  '3': ANSWER_TYPES.DONT_KNOW,
  '4': ANSWER_TYPES.PROBABLY_NO,
  '5': ANSWER_TYPES.NO,
});

const screens = {
  home: document.getElementById('screen-home'),
  question: document.getElementById('screen-question'),
  guess: document.getElementById('screen-guess'),
  victory: document.getElementById('screen-victory'),
  fail: document.getElementById('screen-fail'),
};

const dom = {
  brandName: document.getElementById('brand-name'),
  brandSub: document.getElementById('brand-sub'),
  dbCountHeader: document.getElementById('db-count-header'),
  footerSource: document.getElementById('footer-source'),

  loadError: document.getElementById('load-error'),
  loadErrorTitle: document.getElementById('load-error-title'),

  switchButtons: document.querySelectorAll('[data-universe]'),
  univCountPokemon: document.getElementById('univ-count-pokemon'),
  univCountLol: document.getElementById('univ-count-lol'),

  homeTitleHighlight: document.getElementById('home-title-highlight'),
  homeDesc: document.getElementById('home-desc'),
  homeDbCount: document.getElementById('home-db-count'),
  homeMetaLabel: document.getElementById('home-meta-label'),
  homeMetaValue: document.getElementById('home-meta-value'),
  homeQCount: document.getElementById('home-q-count'),
  enrichTip: document.getElementById('enrich-tip'),
  enrichTipText: document.getElementById('enrich-tip-text'),
  sampleDrawer: document.getElementById('sample-drawer'),
  sampleSummary: document.getElementById('sample-summary'),
  sampleNote: document.getElementById('sample-note'),
  sampleList: document.getElementById('sample-list'),

  btnTheme: document.getElementById('btn-theme'),
  btnStart: document.getElementById('btn-start'),
  btnUndo: document.getElementById('btn-undo'),
  btnRestartQ: document.getElementById('btn-restart-q'),
  btnGuessYes: document.getElementById('btn-guess-yes'),
  btnGuessNo: document.getElementById('btn-guess-no'),
  btnGuessUndo: document.getElementById('btn-guess-undo'),
  btnReplayVictory: document.getElementById('btn-replay-victory'),
  btnHomeVictory: document.getElementById('btn-home-victory'),
  btnReplayFail: document.getElementById('btn-replay-fail'),
  btnHomeFail: document.getElementById('btn-home-fail'),

  questionNumber: document.getElementById('question-number'),
  candidatesPill: document.getElementById('candidates-pill'),
  certaintyValue: document.getElementById('certainty-value'),
  certaintyFill: document.getElementById('certainty-fill'),
  certaintyBar: document.getElementById('certainty-progressbar'),
  aiAvatar: document.getElementById('ai-avatar'),
  questionBubble: document.getElementById('question-bubble'),
  questionCategory: document.getElementById('question-category'),
  questionText: document.getElementById('question-text'),
  answerButtons: document.querySelectorAll('.answer-btn'),

  guessId: document.getElementById('guess-id'),
  guessTag: document.getElementById('guess-tag'),
  guessStage: document.getElementById('guess-stage'),
  guessSprite: document.getElementById('guess-sprite'),
  guessName: document.getElementById('guess-name'),
  guessSubtitle: document.getElementById('guess-subtitle'),
  guessBadges: document.getElementById('guess-badges'),
  guessMeta: document.getElementById('guess-meta'),

  victoryPill: document.getElementById('victory-pill'),
  victoryHeadline: document.getElementById('victory-headline'),
  victoryId: document.getElementById('victory-id'),
  victoryTag: document.getElementById('victory-tag'),
  victoryStage: document.getElementById('victory-stage'),
  victorySprite: document.getElementById('victory-sprite'),
  victoryName: document.getElementById('victory-name'),
  victorySubtitle: document.getElementById('victory-subtitle'),
  victoryBadges: document.getElementById('victory-badges'),

  failKicker: document.getElementById('fail-kicker'),
  failSubtitle: document.getElementById('fail-subtitle'),
  top5Grid: document.getElementById('top5-grid'),
};

const engines = {
  [UNIVERSE_TYPES.POKEMON]: null,
  [UNIVERSE_TYPES.LOL]: null,
};

const datasets = {
  [UNIVERSE_TYPES.POKEMON]: null,
  [UNIVERSE_TYPES.LOL]: null,
};

const loadErrors = {
  [UNIVERSE_TYPES.POKEMON]: false,
  [UNIVERSE_TYPES.LOL]: false,
};

let activeUniverse = UNIVERSE_TYPES.POKEMON;
let currentScreen = 'home';
let currentGuess = null;

function getEngine() {
  return engines[activeUniverse];
}

function getConfig() {
  return UNIVERSES[activeUniverse];
}

/* ==========================================================================
   Utilitaires d'affichage
   ========================================================================== */

function formatDexId(id) {
  return `#${String(id).padStart(4, '0')}`;
}

function normalizeBadgeClass(label) {
  return (
    'type-' +
    String(label)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
  );
}

function renderBadges(container, labels) {
  container.innerHTML = '';
  for (const label of labels || []) {
    const span = document.createElement('span');
    span.className = `type-badge ${normalizeBadgeClass(label)}`;
    span.textContent = label;
    container.appendChild(span);
  }
}

function setArtwork(imgEl, item) {
  imgEl.src = item.sprite;
  imgEl.alt = `Illustration officielle de ${item.name}`;
  imgEl.onerror = () => {
    if (item.icon && imgEl.src !== item.icon) {
      imgEl.src = item.icon;
      return;
    }
    imgEl.onerror = null;
    imgEl.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
          <rect width="120" height="120" rx="16" fill="#1e293b"/>
          <text x="60" y="70" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="34" font-weight="700">?</text>
        </svg>`,
      );
  };
}

function showScreen(name) {
  currentScreen = name;
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name);
  }
}

/* ==========================================================================
   Thème & Univers
   ========================================================================== */

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = saved || (prefersLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
}

function selectUniverse(universeId, goHome = true) {
  if (!UNIVERSES[universeId]) return;
  activeUniverse = universeId;
  localStorage.setItem(UNIVERSE_STORAGE_KEY, universeId);
  document.documentElement.setAttribute('data-universe', universeId);

  // Mettre à jour les boutons actifs (header + cartes accueil)
  dom.switchButtons.forEach((btn) => {
    const isActive = btn.dataset.universe === universeId;
    btn.classList.toggle('active', isActive);
    if (btn.getAttribute('role') === 'tab') {
      btn.setAttribute('aria-selected', String(isActive));
    }
  });

  refreshUniverseUI();

  if (goHome) {
    currentGuess = null;
    getEngine()?.reset();
    showScreen('home');
  }
}

function refreshUniverseUI() {
  const cfg = getConfig();
  const data = datasets[activeUniverse];
  const eng = getEngine();
  const hasErr = loadErrors[activeUniverse];

  dom.brandName.textContent = cfg.brandName;
  dom.brandSub.textContent = cfg.brandSub;
  dom.homeTitleHighlight.textContent = cfg.titleHighlight;
  dom.homeDesc.textContent = cfg.desc;
  dom.homeMetaLabel.textContent = cfg.metaLabel;
  dom.victoryPill.textContent = cfg.victoryPill;
  dom.failKicker.textContent = cfg.failKicker;
  dom.footerSource.textContent = cfg.footerSource;

  dom.loadError.classList.toggle('hidden', !hasErr);
  if (hasErr) {
    dom.loadErrorTitle.textContent = `Impossible de charger ${cfg.dataUrl.replace('./', '')}.`;
  }

  if (!data || !eng) {
    dom.dbCountHeader.textContent = hasErr ? 'Erreur DB' : 'Chargement…';
    dom.homeDbCount.textContent = hasErr ? 'Indisponible' : '…';
    dom.homeMetaValue.textContent = '—';
    dom.homeQCount.textContent = '—';
    dom.btnStart.disabled = true;
    dom.sampleDrawer.classList.add('hidden');
    dom.enrichTip.classList.add('hidden');
    return;
  }

  const count = data.length;
  const unit = count > 1 ? cfg.unitPlural : cfg.unitSingular;
  dom.dbCountHeader.textContent = `${count} ${unit}`;
  dom.homeDbCount.textContent = `${count} ${unit}`;
  dom.homeQCount.textContent = `${eng.questions.length} critères`;

  if (activeUniverse === UNIVERSE_TYPES.POKEMON) {
    const gens = data.map((p) => p.generation).filter(Boolean);
    if (gens.length > 0) {
      const minG = Math.min(...gens);
      const maxG = Math.max(...gens);
      dom.homeMetaValue.textContent = minG === maxG ? `Gén. ${minG}` : `Gén. ${minG} à ${maxG}`;
    }
    const hasMoves = data.some((p) => Array.isArray(p.notable_moves) && p.notable_moves.length > 0);
    if (!hasMoves) {
      dom.enrichTip.classList.remove('hidden');
      dom.enrichTipText.innerHTML =
        'Astuce : relancez <code>python scripts/fetch_pokemons.py</code> pour activer les nouvelles questions d’attaques (<em>Séisme, Surf, Vol, Lance-Flammes…</em>) et de statistiques de combat !';
    } else {
      dom.enrichTip.classList.add('hidden');
    }
  } else {
    const regions = new Set(data.map((c) => c.region).filter(Boolean));
    dom.homeMetaValue.textContent = `${regions.size} régions`;
    dom.enrichTip.classList.add('hidden');
  }

  // Tiroir pratique quand on est encore en mode échantillon
  if (count <= cfg.sampleThreshold) {
    dom.sampleDrawer.classList.remove('hidden');
    dom.sampleSummary.textContent = `Mode échantillon : voir les ${count} ${unit} chargés`;
    dom.sampleNote.innerHTML = `Lancez <code>${cfg.fetchCmd}</code> pour télécharger ${cfg.fetchTotalLabel}.`;
    dom.sampleList.innerHTML = '';
    for (const item of data) {
      const chip = document.createElement('span');
      chip.className = 'sample-chip';
      chip.textContent =
        activeUniverse === UNIVERSE_TYPES.POKEMON
          ? `${item.name} (#${item.id})`
          : `${item.name} (${(item.lanes || []).join('/')})`;
      dom.sampleList.appendChild(chip);
    }
  } else {
    dom.sampleDrawer.classList.add('hidden');
  }

  dom.btnStart.disabled = false;
}

/* ==========================================================================
   Boucle de jeu
   ========================================================================== */

function startGame() {
  const eng = getEngine();
  if (!eng) return;
  eng.reset();
  currentGuess = null;
  advanceTurn();
}

function advanceTurn() {
  const eng = getEngine();
  if (!eng) return;

  if (eng.shouldProposeGuess()) {
    const top = eng.getTopCandidates(1)[0];
    if (top) {
      showGuessScreen(top);
      return;
    }
  }

  const nextQuestion = eng.selectNextQuestion();
  if (!nextQuestion) {
    const top = eng.getTopCandidates(1)[0];
    if (top && eng.questionCount < eng.MAX_QUESTIONS_LIMIT) {
      showGuessScreen(top);
    } else {
      showFailScreen();
    }
    return;
  }

  renderQuestionScreen(nextQuestion);
}

function renderQuestionScreen(question) {
  const eng = getEngine();
  const turnNumber = eng.questionCount + 1;
  const certaintyPct = Math.round(eng.getCertainty() * 100);
  const plausibleCount = eng.getPlausibleCount();

  dom.questionNumber.textContent = `Question #${turnNumber}`;
  dom.candidatesPill.textContent =
    plausibleCount <= 1 ? '1 piste forte' : `~${plausibleCount} pistes`;

  dom.certaintyValue.textContent = `${certaintyPct} %`;
  dom.certaintyFill.style.width = `${certaintyPct}%`;
  dom.certaintyBar.setAttribute('aria-valuenow', String(certaintyPct));

  dom.aiAvatar.classList.remove('state-searching', 'state-warming', 'state-confident');
  if (certaintyPct >= 65) {
    dom.aiAvatar.classList.add('state-confident');
  } else if (certaintyPct >= 25) {
    dom.aiAvatar.classList.add('state-warming');
  } else {
    dom.aiAvatar.classList.add('state-searching');
  }

  dom.questionCategory.textContent = question.category;
  dom.questionText.textContent = question.text;

  dom.questionBubble.classList.remove('animate-pop');
  void dom.questionBubble.offsetWidth;
  dom.questionBubble.classList.add('animate-pop');

  dom.btnUndo.disabled = !eng.canUndo();
  showScreen('question');
}

function handleAnswer(answerType) {
  const eng = getEngine();
  if (!eng || currentScreen !== 'question') return;
  eng.answerCurrentQuestion(answerType);
  advanceTurn();
}

function handleUndo() {
  const eng = getEngine();
  if (!eng || !eng.canUndo()) return;
  const restoredQuestion = eng.undo();
  currentGuess = null;
  if (restoredQuestion) {
    renderQuestionScreen(restoredQuestion);
  } else {
    advanceTurn();
  }
}

function populateCard(prefix, item) {
  const isLol = activeUniverse === UNIVERSE_TYPES.LOL;
  const idEl = dom[`${prefix}Id`];
  const tagEl = dom[`${prefix}Tag`];
  const stageEl = dom[`${prefix}Stage`];
  const spriteEl = dom[`${prefix}Sprite`];
  const nameEl = dom[`${prefix}Name`];
  const subtitleEl = dom[`${prefix}Subtitle`];
  const badgesEl = dom[`${prefix}Badges`];

  stageEl.classList.toggle('stage-lol', isLol);
  nameEl.textContent = item.name;
  setArtwork(spriteEl, item);

  if (isLol) {
    idEl.textContent = item.region || 'Runeterra';
    tagEl.textContent = (item.lanes || []).join(' · ') || 'Faille';
    if (item.title) {
      subtitleEl.textContent = `« ${item.title} »`;
      subtitleEl.classList.remove('hidden');
    } else {
      subtitleEl.classList.add('hidden');
    }
    renderBadges(badgesEl, item.roles);
  } else {
    idEl.textContent = formatDexId(item.id);
    tagEl.textContent = `Gén. ${item.generation}`;
    subtitleEl.classList.add('hidden');
    renderBadges(badgesEl, item.types);
  }
}

function showGuessScreen(candidate) {
  const eng = getEngine();
  currentGuess = candidate;
  const { item } = candidate;
  const certaintyPct = Math.round(eng.getCertainty() * 100);

  populateCard('guess', item);
  dom.guessMeta.textContent = `Certitude : ${certaintyPct} % · Question #${eng.questionCount}`;
  dom.btnGuessUndo.disabled = !eng.canUndo();

  showScreen('guess');
}

function handleGuessConfirm() {
  const eng = getEngine();
  if (!eng || !currentGuess) return;
  const { item } = currentGuess;
  const count = eng.questionCount;
  const plural = count > 1 ? 'questions' : 'question';

  dom.victoryHeadline.textContent = `Trouvé en ${count} ${plural} !`;
  populateCard('victory', item);
  showScreen('victory');
}

function handleGuessReject() {
  const eng = getEngine();
  if (!eng || !currentGuess) return;
  const status = eng.rejectTopCandidate(currentGuess.item.id);
  currentGuess = null;

  if (status === 'exhausted') {
    showFailScreen();
    return;
  }

  if (eng.currentQuestion) {
    renderQuestionScreen(eng.currentQuestion);
  } else {
    advanceTurn();
  }
}

function showFailScreen() {
  const eng = getEngine();
  const isLol = activeUniverse === UNIVERSE_TYPES.LOL;
  const top5 = eng.getTopCandidates(5);
  dom.top5Grid.innerHTML = '';

  if (top5.length === 0) {
    dom.failSubtitle.textContent = 'Aucun autre candidat ne correspond aux pistes restantes.';
  } else {
    dom.failSubtitle.textContent = isLol
      ? 'Voici les 5 champions les plus probables restants selon vos réponses :'
      : 'Voici les 5 Pokémon les plus probables restants selon vos réponses :';
  }

  top5.forEach((entry, idx) => {
    const { item, probability } = entry;
    const card = document.createElement('article');
    card.className = 'mini-card';

    const rank = document.createElement('span');
    rank.className = 'mini-rank';
    rank.textContent = `#${idx + 1}`;

    const img = document.createElement('img');
    img.className = isLol ? 'mini-sprite mini-sprite-lol' : 'mini-sprite';
    setArtwork(img, item);

    const name = document.createElement('h3');
    name.className = 'mini-name';
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'mini-id';
    meta.textContent = isLol ? `${item.region} · ${(item.lanes || []).join('/')}` : formatDexId(item.id);

    const badgesWrap = document.createElement('div');
    badgesWrap.className = 'types-row';
    renderBadges(badgesWrap, isLol ? item.roles : item.types);

    const prob = document.createElement('span');
    prob.className = 'mini-prob';
    prob.textContent = `${Math.round(probability * 100)} %`;

    card.append(rank, img, name, meta, badgesWrap, prob);
    dom.top5Grid.appendChild(card);
  });

  showScreen('fail');
}

/* ==========================================================================
   Chargement parallèle des deux bases JSON
   ========================================================================== */

async function loadUniverseDataset(universeId) {
  const cfg = UNIVERSES[universeId];
  try {
    const response = await fetch(cfg.dataUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const items = await response.json();
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Fichier JSON vide');
    }
    datasets[universeId] = items;
    engines[universeId] = new AkinatorEngine(items, universeId);
    loadErrors[universeId] = false;

    const countLabel = `${items.length} ${items.length > 1 ? cfg.unitPlural : cfg.unitSingular}`;
    if (universeId === UNIVERSE_TYPES.POKEMON) {
      dom.univCountPokemon.textContent = countLabel;
    } else {
      dom.univCountLol.textContent = countLabel;
    }
  } catch (err) {
    console.error(`Erreur lors du chargement de ${cfg.dataUrl} :`, err);
    loadErrors[universeId] = true;
    if (universeId === UNIVERSE_TYPES.POKEMON) {
      dom.univCountPokemon.textContent = 'Indisponible';
    } else {
      dom.univCountLol.textContent = 'Indisponible';
    }
  }

  if (universeId === activeUniverse) {
    refreshUniverseUI();
  }
}

function bindEvents() {
  dom.btnTheme.addEventListener('click', toggleTheme);
  dom.btnStart.addEventListener('click', startGame);
  dom.btnUndo.addEventListener('click', handleUndo);

  const goHome = () => {
    getEngine()?.reset();
    currentGuess = null;
    showScreen('home');
  };

  dom.btnRestartQ.addEventListener('click', goHome);
  dom.btnHomeVictory.addEventListener('click', goHome);
  dom.btnHomeFail.addEventListener('click', goHome);

  dom.switchButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetUniv = btn.dataset.universe;
      if (targetUniv !== activeUniverse) {
        selectUniverse(targetUniv, true);
      }
    });
  });

  dom.answerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      handleAnswer(btn.dataset.answer);
    });
  });

  dom.btnGuessYes.addEventListener('click', handleGuessConfirm);
  dom.btnGuessNo.addEventListener('click', handleGuessReject);
  dom.btnGuessUndo.addEventListener('click', handleUndo);

  dom.btnReplayVictory.addEventListener('click', startGame);
  dom.btnReplayFail.addEventListener('click', startGame);

  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (currentScreen === 'question') {
      const ans = KEY_TO_ANSWER[e.key];
      if (ans) {
        e.preventDefault();
        handleAnswer(ans);
      } else if (e.key === 'Backspace' && getEngine()?.canUndo()) {
        e.preventDefault();
        handleUndo();
      }
    }
  });
}

initTheme();
bindEvents();

const savedUniverse = localStorage.getItem(UNIVERSE_STORAGE_KEY);
selectUniverse(
  savedUniverse && UNIVERSES[savedUniverse] ? savedUniverse : UNIVERSE_TYPES.POKEMON,
  true,
);

Promise.all([
  loadUniverseDataset(UNIVERSE_TYPES.POKEMON),
  loadUniverseDataset(UNIVERSE_TYPES.LOL),
]);
