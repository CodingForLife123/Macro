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
  'Requiem Rod'
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
  'Mini Spear'
];

function normalizeRodDisplayText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function extractPureRodName(text) {
  const cleanText = normalizeRodDisplayText(text);
  if (!cleanText) return '';

  for (const rodName of KNOWN_ROD_NAMES) {
    if (cleanText.includes(rodName)) return rodName;
  }

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

  for (const spearName of KNOWN_SPEAR_NAMES) {
    if (cleanText.includes(spearName)) return spearName;
  }

  for (const line of cleanText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && /\bspear\b/i.test(trimmed)) return trimmed;
  }

  return '';
}

function extractFishingGearName(text) {
  return extractPureSpearName(text) || extractPureRodName(text);
}

function isSpearText(text) {
  return normalizeRodDisplayText(text).toLowerCase().includes('spear');
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

function isRecognizedRodText(text) {
  const clean = normalizeRodDisplayText(text);
  if (!clean) return false;
  if (extractPureRodName(clean)) return true;
  return (
    isBellonaRodText(clean) ||
    isPinionRodText(clean) ||
    isTranquilityRodText(clean) ||
    isLullabyRodText(clean) ||
    isRequiemRodText(clean) ||
    isDreambreakerRodText(clean)
  );
}

function isFishingGearText(text) {
  return isRecognizedRodText(text) || isSpearText(text);
}

function resolveRodKind(text) {
  if (isTranquilityRodText(text)) return 'tranquility';
  if (isLullabyRodText(text)) return 'lullaby';
  if (isPinionRodText(text)) return 'pinion';
  if (isBellonaRodText(text)) return 'bellona';
  if (isRequiemRodText(text)) return 'requiem';
  if (isDreambreakerRodText(text)) return 'dreambreaker';
  return 'generic';
}

function displayRodName(text) {
  const clean = normalizeRodDisplayText(text);
  if (!clean) return '';
  return (
    extractFishingGearName(clean) ||
    extractPureRodName(clean) ||
    clean.split('\n')[0].trim()
  );
}

module.exports = {
  KNOWN_ROD_NAMES,
  KNOWN_SPEAR_NAMES,
  normalizeRodDisplayText,
  extractPureRodName,
  extractPureSpearName,
  extractFishingGearName,
  isSpearText,
  isPinionRodText,
  isBellonaRodText,
  isTranquilityRodText,
  isLullabyRodText,
  isDreambreakerRodText,
  isRequiemRodText,
  isRecognizedRodText,
  isFishingGearText,
  resolveRodKind,
  displayRodName
};
