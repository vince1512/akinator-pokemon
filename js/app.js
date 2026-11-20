/**
 * js/app.js — Gestion de l'interface utilisateur, des états de jeu, du thème et de l'historique.
 */

import { ANSWER_TYPES, PokeNatorEngine } from './engine.js';

const DATA_URL = './data/pokemons.json';
const THEME_STORAGE_KEY = 'pokenator-theme';

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
  loadError: document.getElementById('load-error'),
  dbCountHeader: document.getElementById('db-count-header'),
  homeDbCount: document.getElementById('home-db-count'),
  homeGenRange: document.getElementById('home-gen-range'),
  sampleDrawer: document.getElementById('sample-drawer'),
  sampleList: document.getElementById('sample-list'),

  btnTheme: document.getElementById('btn-theme'),
  btnStart: document.getElementById('btn-start'),
  btnUndo: document.getElementById('btn-undo'),
  btnRestartQ: document.getElementById('btn-restart-q'),
  btnGuessYes: document.getElementById('btn-guess-yes'),
  btnGuessNo: document.getElementById('btn-guess-no'),
  btnGuessUndo: document.getElementById('btn-guess-undo'),
  btnReplayVictory: document.getElementById('btn-replay-victory'),
  btnReplayFail: document.getElementById('btn-replay-fail'),

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
  guessGen: document.getElementById('guess-gen'),
  guessSprite: document.getElementById('guess-sprite'),
  guessName: document.getElementById('guess-name'),
  guessTypes: document.getElementById('guess-types'),
  guessMeta: document.getElementById('guess-meta'),

  victoryHeadline: document.getElementById('victory-headline'),
  victoryId: document.getElementById('victory-id'),
  victoryGen: document.getElementById('victory-gen'),
  victorySprite: document.getElementById('victory-sprite'),
  victoryName: document.getElementById('victory-name'),
  victoryTypes: document.getElementById('victory-types'),

  failSubtitle: document.getElementById('fail-subtitle'),
  top5Grid: document.getElementById('top5-grid'),
};

let engine = null;
let currentScreen = 'home';
let currentGuess = null;

/* ==========================================================================
   Utilitaires d'affichage
   ========================================================================== */

function formatDexId(id) {
  return `#${String(id).padStart(4, '0')}`;
}

function normalizeTypeClass(typeName) {
  return (
    'type-' +
    typeName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
  );
}

function renderTypeBadges(container, types) {
  container.innerHTML = '';
  for (const typeName of types || []) {
    const span = document.createElement('span');
    span.className = `type-badge ${normalizeTypeClass(typeName)}`;
    span.textContent = typeName;
    container.appendChild(span);
  }
}

function setArtwork(imgEl, pokemon) {
  imgEl.src = pokemon.sprite;
  imgEl.alt = `Artwork officiel de ${pokemon.name}`;
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" fill="#1e293b" stroke="#38bdf8" stroke-width="4"/>
          <text x="60" y="68" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="24" font-weight="700">?</text>
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
   Thème sombre / clair
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

/* ==========================================================================
   Boucle de jeu
   ========================================================================== */

function startGame() {
  if (!engine) return;
  engine.reset();
  currentGuess = null;
  advanceTurn();
}

function advanceTurn() {
  if (!engine) return;

  if (engine.shouldProposeGuess()) {
    const top = engine.getTopCandidates(1)[0];
    if (top) {
      showGuessScreen(top);
      return;
    }
  }

  const nextQuestion = engine.selectNextQuestion();
  if (!nextQuestion) {
    const top = engine.getTopCandidates(1)[0];
    // Si aucune question utile ne reste et qu'on n'a pas encore proposé le meilleur candidat
    if (top && engine.questionCount < engine.MAX_QUESTIONS_LIMIT) {
      showGuessScreen(top);
    } else {
      showFailScreen();
    }
    return;
  }

  renderQuestionScreen(nextQuestion);
}

function renderQuestionScreen(question) {
  const turnNumber = engine.questionCount + 1;
  const certaintyPct = Math.round(engine.getCertainty() * 100);
  const plausibleCount = engine.getPlausibleCount();

  dom.questionNumber.textContent = `Question #${turnNumber}`;
  dom.candidatesPill.textContent =
    plausibleCount <= 1 ? '1 piste forte' : `~${plausibleCount} pistes`;

  dom.certaintyValue.textContent = `${certaintyPct} %`;
  dom.certaintyFill.style.width = `${certaintyPct}%`;
  dom.certaintyBar.setAttribute('aria-valuenow', String(certaintyPct));

  // Animation de l'avatar selon l'avancement
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

  // Relancer l'animation d'apparition de la bulle
  dom.questionBubble.classList.remove('animate-pop');
  void dom.questionBubble.offsetWidth;
  dom.questionBubble.classList.add('animate-pop');

  dom.btnUndo.disabled = !engine.canUndo();
  showScreen('question');
}

function handleAnswer(answerType) {
  if (!engine || currentScreen !== 'question') return;
  engine.answerCurrentQuestion(answerType);
  advanceTurn();
}

function handleUndo() {
  if (!engine || !engine.canUndo()) return;
  const restoredQuestion = engine.undo();
  currentGuess = null;
  if (restoredQuestion) {
    renderQuestionScreen(restoredQuestion);
  } else {
    advanceTurn();
  }
}

function showGuessScreen(candidate) {
  currentGuess = candidate;
  const { pokemon } = candidate;
  const certaintyPct = Math.round(engine.getCertainty() * 100);

  dom.guessId.textContent = formatDexId(pokemon.id);
  dom.guessGen.textContent = `Gén. ${pokemon.generation}`;
  dom.guessName.textContent = pokemon.name;
  setArtwork(dom.guessSprite, pokemon);
  renderTypeBadges(dom.guessTypes, pokemon.types);
  dom.guessMeta.textContent = `Certitude : ${certaintyPct} % · Question #${engine.questionCount}`;
  dom.btnGuessUndo.disabled = !engine.canUndo();

  showScreen('guess');
}

function handleGuessConfirm() {
  if (!currentGuess) return;
  const { pokemon } = currentGuess;
  const count = engine.questionCount;
  const plural = count > 1 ? 'questions' : 'question';

  dom.victoryHeadline.textContent = `Trouvé en ${count} ${plural} !`;
  dom.victoryId.textContent = formatDexId(pokemon.id);
  dom.victoryGen.textContent = `Gén. ${pokemon.generation}`;
  dom.victoryName.textContent = pokemon.name;
  setArtwork(dom.victorySprite, pokemon);
  renderTypeBadges(dom.victoryTypes, pokemon.types);

  showScreen('victory');
}

function handleGuessReject() {
  if (!engine || !currentGuess) return;
  const status = engine.rejectTopCandidate(currentGuess.pokemon.id);
  currentGuess = null;

  if (status === 'exhausted') {
    showFailScreen();
    return;
  }

  // Revenir directement sur la nouvelle question sélectionnée par rejectTopCandidate
  if (engine.currentQuestion) {
    renderQuestionScreen(engine.currentQuestion);
  } else {
    advanceTurn();
  }
}

function showFailScreen() {
  const top5 = engine.getTopCandidates(5);
  dom.top5Grid.innerHTML = '';

  if (top5.length === 0) {
    dom.failSubtitle.textContent =
      'Aucun autre candidat ne correspond aux pistes restantes.';
  } else {
    dom.failSubtitle.textContent =
      'Voici les 5 Pokémon les plus probables restants selon vos réponses :';
  }

  top5.forEach((entry, idx) => {
    const { pokemon, probability } = entry;
    const card = document.createElement('article');
    card.className = 'mini-card';

    const rank = document.createElement('span');
    rank.className = 'mini-rank';
    rank.textContent = `#${idx + 1}`;

    const img = document.createElement('img');
    img.className = 'mini-sprite';
    setArtwork(img, pokemon);

    const name = document.createElement('h3');
    name.className = 'mini-name';
    name.textContent = pokemon.name;

    const dex = document.createElement('span');
    dex.className = 'mini-id';
    dex.textContent = formatDexId(pokemon.id);

    const typesWrap = document.createElement('div');
    typesWrap.className = 'types-row';
    renderTypeBadges(typesWrap, pokemon.types);

    const prob = document.createElement('span');
    prob.className = 'mini-prob';
    prob.textContent = `${Math.round(probability * 100)} %`;

    card.append(rank, img, name, dex, typesWrap, prob);
    dom.top5Grid.appendChild(card);
  });

  showScreen('fail');
}

/* ==========================================================================
   Initialisation & chargement JSON
   ========================================================================== */

async function loadDatabase() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const pokemons = await response.json();
    if (!Array.isArray(pokemons) || pokemons.length === 0) {
      throw new Error('Fichier JSON vide');
    }

    engine = new PokeNatorEngine(pokemons);

    const count = pokemons.length;
    dom.dbCountHeader.textContent = `${count} Pokémon`;
    dom.homeDbCount.textContent = `${count} Pokémon`;

    const gens = pokemons.map((p) => p.generation).filter(Boolean);
    if (gens.length > 0) {
      const minG = Math.min(...gens);
      const maxG = Math.max(...gens);
      dom.homeGenRange.textContent = minG === maxG ? `Gén. ${minG}` : `Gén. ${minG} à ${maxG}`;
    }

    // Si on est en mode échantillon, proposer la liste dépliable pour faciliter les tests immédiats
    if (count <= 30) {
      dom.sampleDrawer.classList.remove('hidden');
      dom.sampleList.innerHTML = '';
      for (const p of pokemons) {
        const chip = document.createElement('span');
        chip.className = 'sample-chip';
        chip.textContent = `${p.name} (#${p.id})`;
        dom.sampleList.appendChild(chip);
      }
    }

    dom.btnStart.disabled = false;
  } catch (err) {
    console.error('Erreur lors du chargement de data/pokemons.json :', err);
    dom.dbCountHeader.textContent = 'Erreur DB';
    dom.homeDbCount.textContent = 'Indisponible';
    dom.loadError.classList.remove('hidden');
  }
}

function bindEvents() {
  dom.btnTheme.addEventListener('click', toggleTheme);
  dom.btnStart.addEventListener('click', startGame);
  dom.btnUndo.addEventListener('click', handleUndo);
  dom.btnRestartQ.addEventListener('click', () => {
    engine?.reset();
    showScreen('home');
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

  // Raccourcis clavier (1–5 pour répondre, Backspace pour annuler)
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (currentScreen === 'question') {
      const ans = KEY_TO_ANSWER[e.key];
      if (ans) {
        e.preventDefault();
        handleAnswer(ans);
      } else if (e.key === 'Backspace' && engine?.canUndo()) {
        e.preventDefault();
        handleUndo();
      }
    }
  });
}

initTheme();
bindEvents();
loadDatabase();
