/**
 * Rod / gear name recognition — mirrors OpenMacro XTernal Memory.ahk.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const KNOWN_ROD_NAMES = [
  "Bellona's Waraxe",
  "Pinion's Aria",
  'Tranquility Rod',
  'Rod Of The Eternal King',
  'Rod Of The Depths',
  'Rod Of Time',
  'Rod Of The Zenith',
  'Rod Of The Forgotten Fang',
  'Flimsy Rod',
  'Training Rod',
  'Plastic Rod',
  'Steady Rod',
  'Reinforced Rod',
  'Phoenix Rod',
  'Mythical Rod',
  'No-Life Rod',
  'Sunken Rod',
  'Trident Rod',
  'Kings Rod',
  'Wisdom Rod',
  'Toxinburst Rod',
  'The Lost Rod',
  'Riptide Rod',
  'Lucid Rod',
  'Celestial Rod',
  'Seasons Rod',
  "Krampus's Rod",
  'Precision Rod',
  'Resourceful Rod',
  'Toxic Spire Rod',
  'Gardenkeeper Rod',
  'Voyager Rod',
  'Vineweaver Rod',
  'Requiem Rod',
  'Destiny Rod',
  'Abyssal Specter Rod',
  'Dead Man\'s Rod',
  'Crystalized Rod',
  'Auric Rod',
  'Scurvy Rod',
  'Event Horizon Rod',
  'Eidolon Rod',
  'Brine-infused Rod',
  'Heaven\'s Rod',
  'Astral Rod',
  'Rainbow Cluster Rod',
  'Wicked Fang Rod',
  'Fang of the Eclipse',
  'Sanguine Spire',
  'Ruinous Oath',
  'Sand Castle Caster',
  'Sweet-Stinger',
  'Splitbranch Twig',
  'Bloomspire: Twisted Toxins',
  'Lullaby Rod',
  'Dreambreaker Rod'
];

const KNOWN_SPEAR_NAMES = [
  "Poseidon's Spear",
  'Poison-Tipped Spear',
  'Barbed Spear',
  'Withered Spear',
  'Royal Spear',
  'Coral Spear',
  'Steady Spear',
  'Flimsy Spear',
  'Mini Spear',
  'Prism Spear'
];

/**
 * Known Harpoon Guns (Fisch). Many titles do NOT contain "harpoon"
 * (Frost Biter, Relic Piercer, …). Keep adding new guns here when found;
 * pattern matchers below cover most future "Harpoon Gun" names automatically.
 */
const KNOWN_HARPOON_NAMES = [
  // Explicit "Harpoon" / "Harpoon Gun"
  'Halibut Harpoon Gun',
  'Halibut Harpoon',
  'Fungal Harpoon Gun',
  'Steady Harpoon Gun',
  'Pufferfish Harpoon',
  // No "harpoon" in the display name
  'Frost Biter',
  'Great Dream Waker',
  'Crystal Crasher',
  'Relic Piercer',
  'Trident Striker',
  'Scrap-Cannon',
  'Titanic Scalder',
  'Sightless Oracle',
  'Cusk-Shot',
  'Clickbait Chaser',
  'Party Puffer'
];

/** Any tool whose name includes harpoon / harpoon gun. */
const HARPOON_KEYWORD_RE = /\bharpoon(\s*guns?)?\b/i;

/**
 * Explicit multi-word aliases for guns that omit "harpoon".
 * Prefer these over bare suffixes when possible.
 */
const HARPOON_STYLE_RE =
  /\b(frost\s*biter|great\s*dream\s*waker|crystal\s*crasher|relic\s*piercer|trident\s*striker|scrap[-\s]?cannon|titanic\s*scalder|sightless\s*oracle|cusk[-\s]?shot|clickbait\s*chaser|party\s*puffer|pufferfish)\b/i;

/**
 * Future-proof Fisch gun suffixes (e.g. "Void Piercer", "Solar Striker").
 * Only applied when the name is not already a rod/spear.
 */
const HARPOON_SUFFIX_RE =
  /\b[\w''-]+(?:\s+[\w''-]+)*\s+(Piercer|Striker|Crasher|Scalder|Oracle|Chaser|Biter|Waker)\b/i;

const HARPOON_COMPOUND_RE = /\b[\w''-]+[-\s]?(Cannon|Shot)\b/i;

/** Names / patterns that count as fishing gear even without "Rod" in the title. */
const FISHING_GEAR_KEYWORD_RE =
  /\b(rod|spear|harpoon|waraxe|twig|caster|stinger|oath|spire|fang|aria|axe|gun|piercer|striker|crasher|cannon|oracle|chaser)\b/i;

function normalizeRodDisplayText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function firstMeaningfulLine(cleanText) {
  for (const line of String(cleanText || '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function matchKnownName(cleanText, names) {
  for (const name of names) {
    if (cleanText.includes(name)) return name;
  }
  return '';
}

function extractPureRodName(text) {
  const cleanText = normalizeRodDisplayText(text);
  if (!cleanText) return '';

  const known = matchKnownName(cleanText, KNOWN_ROD_NAMES);
  if (known) return known;

  for (const line of cleanText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "Pinion's Aria" || /\brod\b/i.test(trimmed)) return trimmed;
  }

  return '';
}

function extractPureSpearName(text) {
  const cleanText = normalizeRodDisplayText(text);
  if (!cleanText) return '';

  const known = matchKnownName(cleanText, KNOWN_SPEAR_NAMES);
  if (known) return known;

  for (const line of cleanText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && /\bspear\b/i.test(trimmed)) return trimmed;
  }

  return '';
}

function looksLikeHarpoonGunName(cleanText) {
  const clean = String(cleanText || '').trim();
  if (!clean) return false;
  // Don't steal rod/spear titles.
  if (/\brod\b/i.test(clean) || /\bspear\b/i.test(clean)) return false;
  if (matchKnownName(clean, KNOWN_HARPOON_NAMES)) return true;
  if (HARPOON_KEYWORD_RE.test(clean)) return true;
  if (HARPOON_STYLE_RE.test(clean)) return true;
  if (HARPOON_SUFFIX_RE.test(clean)) return true;
  if (HARPOON_COMPOUND_RE.test(clean)) return true;
  return false;
}

function extractPureHarpoonName(text) {
  const cleanText = normalizeRodDisplayText(text);
  if (!cleanText) return '';

  const known = matchKnownName(cleanText, KNOWN_HARPOON_NAMES);
  if (known) return known;

  for (const line of cleanText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (looksLikeHarpoonGunName(trimmed)) return trimmed;
  }

  return '';
}

function extractFishingGearName(text) {
  return (
    extractPureHarpoonName(text) ||
    extractPureSpearName(text) ||
    extractPureRodName(text)
  );
}

function isSpearText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('spear');
}

function isHarpoonText(text) {
  const clean = normalizeRodDisplayText(text);
  if (!clean) return false;
  return looksLikeHarpoonGunName(clean) || !!extractPureHarpoonName(clean);
}

function isPinionRodText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('pinion');
}

function isBellonaRodText(text) {
  const t = normalizeRodDisplayText(text).toLowerCase();
  return t.includes('bellona') || t.includes('waraxe');
}

function isTranquilityRodText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('tranquility');
}

function isLullabyRodText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('lullaby');
}

function isDreambreakerRodText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('dreambreaker');
}

function isRequiemRodText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('requiem');
}

/** @deprecated Prefer isHarpoonText — kept for older call sites. */
function isHalibutHarpoonText(text) {
  return isHarpoonText(text);
}

function hasFishingGearKeyword(text) {
  return FISHING_GEAR_KEYWORD_RE.test(normalizeRodDisplayText(text));
}

function isRecognizedRodText(text) {
  const clean = normalizeRodDisplayText(text);
  if (!clean) return false;
  if (extractPureHarpoonName(clean) || isHarpoonText(clean)) return true;
  if (extractPureRodName(clean)) return true;
  return (
    isBellonaRodText(clean) ||
    isPinionRodText(clean) ||
    isTranquilityRodText(clean) ||
    isLullabyRodText(clean) ||
    isRequiemRodText(clean) ||
    isDreambreakerRodText(clean) ||
    hasFishingGearKeyword(clean)
  );
}

function isFishingGearText(text) {
  return isHarpoonText(text) || isSpearText(text) || isRecognizedRodText(text);
}

function resolveRodKind(text) {
  if (isHarpoonText(text)) return 'harpoon';
  if (isTranquilityRodText(text)) return 'tranquility';
  if (isLullabyRodText(text)) return 'lullaby';
  if (isPinionRodText(text)) return 'pinion';
  if (isBellonaRodText(text)) return 'bellona';
  if (isRequiemRodText(text)) return 'requiem';
  if (isDreambreakerRodText(text)) return 'dreambreaker';
  return 'generic';
}

/** Coarse gear class for activity log: rod | harpoon | spear. */
function resolveGearType(text) {
  if (!String(text || '').trim()) return '';
  if (isHarpoonText(text)) return 'harpoon';
  if (isSpearText(text)) return 'spear';
  return 'rod';
}

function displayRodName(text) {
  const clean = normalizeRodDisplayText(text);
  if (!clean) return '';
  return (
    extractFishingGearName(clean) ||
    (hasFishingGearKeyword(clean) ? firstMeaningfulLine(clean) : '') ||
    firstMeaningfulLine(clean)
  );
}

module.exports = {
  KNOWN_ROD_NAMES,
  KNOWN_SPEAR_NAMES,
  KNOWN_HARPOON_NAMES,
  normalizeRodDisplayText,
  extractPureRodName,
  extractPureSpearName,
  extractPureHarpoonName,
  extractFishingGearName,
  isSpearText,
  isHarpoonText,
  isPinionRodText,
  isBellonaRodText,
  isTranquilityRodText,
  isLullabyRodText,
  isDreambreakerRodText,
  isRequiemRodText,
  isHalibutHarpoonText,
  isRecognizedRodText,
  isFishingGearText,
  resolveRodKind,
  resolveGearType,
  displayRodName
};
