// Themes map semantic roles to SGR colour codes. Segments never hardcode a colour.
// `bg`, `track` and `ink` are only read by the powerline and capsule styles and the smooth bar.

const base = {
  sep: "90",
  muted: "90",
  text: "0",
  strong: "1",
};

export const THEMES = {
  dark: {
    ...base,
    bg: { base: "48;5;236", alt: "48;5;238", accent: "48;5;117" },
    track: "48;5;237",
    ink: "38;5;234",
    model: "38;5;117",
    mode: "38;5;141",
    dir: "1;38;5;252",
    git: "38;5;176",
    pr: "38;5;110",
    cost: "38;5;114",
    tip: "38;5;180",
    good: "38;5;114",
    warn: "38;5;221",
    bad: "38;5;203",
    crit: "38;5;197",
    add: "38;5;114",
    del: "38;5;203",
  },
  light: {
    ...base,
    bg: { base: "48;5;254", alt: "48;5;252", accent: "48;5;25" },
    track: "48;5;253",
    ink: "38;5;231",
    sep: "37",
    muted: "37",
    model: "38;5;25",
    mode: "38;5;91",
    dir: "1;38;5;236",
    git: "38;5;126",
    pr: "38;5;24",
    cost: "38;5;28",
    tip: "38;5;94",
    good: "38;5;28",
    warn: "38;5;130",
    bad: "38;5;124",
    crit: "38;5;160",
    add: "38;5;28",
    del: "38;5;124",
  },
  nord: {
    ...base,
    bg: { base: "48;5;237", alt: "48;5;239", accent: "48;5;110" },
    track: "48;5;238",
    ink: "38;5;235",
    model: "38;5;110",
    mode: "38;5;139",
    dir: "1;38;5;253",
    git: "38;5;108",
    pr: "38;5;109",
    cost: "38;5;150",
    tip: "38;5;179",
    good: "38;5;150",
    warn: "38;5;222",
    bad: "38;5;174",
    crit: "38;5;168",
    add: "38;5;150",
    del: "38;5;174",
  },
  mono: {
    ...base,
    bg: { base: "7", alt: "7", accent: "7" },
    track: "",
    ink: "",
    model: "1",
    mode: "90",
    dir: "1",
    git: "90",
    pr: "90",
    cost: "0",
    tip: "90",
    good: "0",
    warn: "1",
    bad: "1",
    crit: "1;4",
    add: "0",
    del: "90",
  },
};

export const THEME_NAMES = Object.keys(THEMES);

export function getTheme(name) {
  return THEMES[name] || THEMES.dark;
}

// Shared load ramp: green, amber, red, bright red. Used by context and both rate limits
// so one glance means the same thing everywhere.
export function loadRole(pct) {
  const v = Number(pct) || 0;
  if (v >= 90) return "crit";
  if (v >= 75) return "bad";
  if (v >= 50) return "warn";
  return "good";
}

export const loadColor = (theme, pct) => theme[loadRole(pct)];
