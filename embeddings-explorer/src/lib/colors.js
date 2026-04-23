/**
 * Color palette for ~30 Tier 1 IAB categories.
 * Distinct, visually pleasing on dark backgrounds.
 */

const TIER1_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#eab308', // yellow
  '#6366f1', // indigo
  '#84cc16', // lime
  '#d946ef', // fuchsia
  '#0ea5e9', // sky
  '#f43f5e', // rose
  '#10b981', // emerald
  '#fb923c', // orange-light
  '#7c3aed', // violet-dark
  '#2dd4bf', // teal-light
  '#facc15', // yellow-bright
  '#e879f9', // fuchsia-light
  '#38bdf8', // sky-light
  '#4ade80', // green-light
  '#fb7185', // rose-light
  '#818cf8', // indigo-light
  '#a3e635', // lime-light
  '#fbbf24', // amber-light
  '#c084fc', // purple-light
  '#34d399', // emerald-light
];

const colorMap = new Map();

export function getTier1Color(tier1Name) {
  if (!colorMap.has(tier1Name)) {
    colorMap.set(tier1Name, TIER1_COLORS[colorMap.size % TIER1_COLORS.length]);
  }
  return colorMap.get(tier1Name);
}

export function getTier1ColorHex(tier1Name) {
  return getTier1Color(tier1Name);
}

export function getAllTier1Colors() {
  return new Map(colorMap);
}

export function initializeColors(categories) {
  const tier1s = [...new Set(categories.map(c => c.tier1Parent))].sort();
  tier1s.forEach((name, i) => {
    colorMap.set(name, TIER1_COLORS[i % TIER1_COLORS.length]);
  });
}
