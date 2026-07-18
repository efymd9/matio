// Tile-grid world map dataset — the well-known "world tile grid" cartogram
// pattern (one square per country on a coarse lat/lon-ish grid, in the spirit
// of the D3 community's World Tile Grid / Maarten Lambrechts' work). Every
// country occupies exactly one cell so it can carry a single choropleth value.
//
// Coordinate system: `col` grows eastward (0 = far west / Pacific-Americas),
// `row` grows southward (0 = far north / Arctic). Positions are DELIBERATELY
// approximate — the goal is that each continent is recognizable at a glance and
// that neighbours sit in sensible relative positions, NOT true projection
// accuracy. LATAM is laid out with the most care (this is a Spanish/English
// streaming site): the Americas occupy the left third, Europe/Africa the middle,
// Asia/Oceania the right.
//
// Pure data, no dependencies. Rendered by components/admin/world-map.tsx.

export type CountryTile = {
  /** Grid column, 0 = far west. */
  col: number;
  /** Grid row, 0 = far north. */
  row: number;
  /** English country name, used for the native tile tooltip. */
  name: string;
};

export const WORLD_TILE_GRID: Record<string, CountryTile> = {
  // ---- North America & Arctic ----
  GL: { col: 10, row: 0, name: "Greenland" },
  CA: { col: 4, row: 1, name: "Canada" },
  US: { col: 4, row: 3, name: "United States" },
  MX: { col: 3, row: 5, name: "Mexico" },

  // ---- Central America ----
  GT: { col: 2, row: 6, name: "Guatemala" },
  BZ: { col: 3, row: 6, name: "Belize" },
  SV: { col: 2, row: 7, name: "El Salvador" },
  HN: { col: 3, row: 7, name: "Honduras" },
  NI: { col: 3, row: 8, name: "Nicaragua" },
  CR: { col: 3, row: 9, name: "Costa Rica" },
  PA: { col: 4, row: 9, name: "Panama" },

  // ---- Caribbean ----
  BS: { col: 6, row: 4, name: "Bahamas" },
  CU: { col: 5, row: 5, name: "Cuba" },
  JM: { col: 5, row: 6, name: "Jamaica" },
  HT: { col: 6, row: 6, name: "Haiti" },
  DO: { col: 7, row: 6, name: "Dominican Republic" },
  PR: { col: 8, row: 6, name: "Puerto Rico" },
  KN: { col: 9, row: 5, name: "Saint Kitts and Nevis" },
  AG: { col: 9, row: 6, name: "Antigua and Barbuda" },
  DM: { col: 9, row: 7, name: "Dominica" },
  LC: { col: 9, row: 8, name: "Saint Lucia" },
  BB: { col: 10, row: 8, name: "Barbados" },
  VC: { col: 9, row: 9, name: "Saint Vincent and the Grenadines" },
  GD: { col: 8, row: 9, name: "Grenada" },
  TT: { col: 8, row: 11, name: "Trinidad and Tobago" },

  // ---- South America ----
  CO: { col: 5, row: 10, name: "Colombia" },
  VE: { col: 6, row: 10, name: "Venezuela" },
  GY: { col: 7, row: 10, name: "Guyana" },
  SR: { col: 8, row: 10, name: "Suriname" },
  GF: { col: 9, row: 10, name: "French Guiana" },
  EC: { col: 4, row: 11, name: "Ecuador" },
  PE: { col: 4, row: 12, name: "Peru" },
  BR: { col: 7, row: 12, name: "Brazil" },
  BO: { col: 5, row: 13, name: "Bolivia" },
  PY: { col: 6, row: 13, name: "Paraguay" },
  UY: { col: 6, row: 14, name: "Uruguay" },
  CL: { col: 4, row: 15, name: "Chile" },
  AR: { col: 5, row: 15, name: "Argentina" },
  FK: { col: 5, row: 17, name: "Falkland Islands" },

  // ---- Europe ----
  IS: { col: 11, row: 1, name: "Iceland" },
  NO: { col: 14, row: 0, name: "Norway" },
  SE: { col: 15, row: 1, name: "Sweden" },
  FI: { col: 16, row: 1, name: "Finland" },
  EE: { col: 17, row: 1, name: "Estonia" },
  IE: { col: 11, row: 2, name: "Ireland" },
  GB: { col: 12, row: 2, name: "United Kingdom" },
  DK: { col: 14, row: 2, name: "Denmark" },
  LV: { col: 17, row: 2, name: "Latvia" },
  BE: { col: 13, row: 3, name: "Belgium" },
  NL: { col: 14, row: 3, name: "Netherlands" },
  DE: { col: 15, row: 3, name: "Germany" },
  PL: { col: 16, row: 3, name: "Poland" },
  LT: { col: 17, row: 3, name: "Lithuania" },
  BY: { col: 18, row: 3, name: "Belarus" },
  FR: { col: 12, row: 4, name: "France" },
  LU: { col: 13, row: 4, name: "Luxembourg" },
  CZ: { col: 15, row: 4, name: "Czechia" },
  SK: { col: 16, row: 4, name: "Slovakia" },
  UA: { col: 18, row: 4, name: "Ukraine" },
  PT: { col: 11, row: 5, name: "Portugal" },
  ES: { col: 12, row: 5, name: "Spain" },
  CH: { col: 14, row: 5, name: "Switzerland" },
  AT: { col: 15, row: 5, name: "Austria" },
  HU: { col: 16, row: 5, name: "Hungary" },
  RO: { col: 18, row: 5, name: "Romania" },
  MD: { col: 19, row: 5, name: "Moldova" },
  IT: { col: 14, row: 6, name: "Italy" },
  SI: { col: 15, row: 6, name: "Slovenia" },
  HR: { col: 16, row: 6, name: "Croatia" },
  RS: { col: 17, row: 6, name: "Serbia" },
  BG: { col: 18, row: 6, name: "Bulgaria" },
  BA: { col: 15, row: 7, name: "Bosnia and Herzegovina" },
  ME: { col: 16, row: 7, name: "Montenegro" },
  MK: { col: 17, row: 7, name: "North Macedonia" },
  MT: { col: 15, row: 8, name: "Malta" },
  AL: { col: 16, row: 8, name: "Albania" },
  GR: { col: 17, row: 8, name: "Greece" },
  RU: { col: 22, row: 1, name: "Russia" },

  // ---- Middle East & Caucasus ----
  GE: { col: 20, row: 6, name: "Georgia" },
  TR: { col: 19, row: 7, name: "Turkey" },
  AM: { col: 20, row: 7, name: "Armenia" },
  AZ: { col: 21, row: 7, name: "Azerbaijan" },
  IR: { col: 22, row: 7, name: "Iran" },
  CY: { col: 19, row: 8, name: "Cyprus" },
  SY: { col: 20, row: 8, name: "Syria" },
  IQ: { col: 21, row: 8, name: "Iraq" },
  LB: { col: 19, row: 9, name: "Lebanon" },
  JO: { col: 20, row: 9, name: "Jordan" },
  KW: { col: 21, row: 9, name: "Kuwait" },
  QA: { col: 22, row: 9, name: "Qatar" },
  IL: { col: 19, row: 10, name: "Israel" },
  SA: { col: 21, row: 10, name: "Saudi Arabia" },
  AE: { col: 22, row: 10, name: "United Arab Emirates" },
  YE: { col: 21, row: 11, name: "Yemen" },
  OM: { col: 23, row: 11, name: "Oman" },

  // ---- Africa ----
  MA: { col: 10, row: 7, name: "Morocco" },
  TN: { col: 13, row: 7, name: "Tunisia" },
  DZ: { col: 12, row: 8, name: "Algeria" },
  LY: { col: 14, row: 8, name: "Libya" },
  MR: { col: 10, row: 9, name: "Mauritania" },
  EG: { col: 16, row: 9, name: "Egypt" },
  ER: { col: 18, row: 9, name: "Eritrea" },
  SN: { col: 10, row: 10, name: "Senegal" },
  ML: { col: 11, row: 10, name: "Mali" },
  NE: { col: 13, row: 10, name: "Niger" },
  TD: { col: 15, row: 10, name: "Chad" },
  SD: { col: 16, row: 10, name: "Sudan" },
  GM: { col: 10, row: 11, name: "Gambia" },
  GN: { col: 11, row: 11, name: "Guinea" },
  BF: { col: 12, row: 11, name: "Burkina Faso" },
  TG: { col: 13, row: 11, name: "Togo" },
  BJ: { col: 14, row: 11, name: "Benin" },
  NG: { col: 15, row: 11, name: "Nigeria" },
  CM: { col: 16, row: 11, name: "Cameroon" },
  CF: { col: 17, row: 11, name: "Central African Republic" },
  SS: { col: 18, row: 11, name: "South Sudan" },
  ET: { col: 19, row: 11, name: "Ethiopia" },
  DJ: { col: 20, row: 11, name: "Djibouti" },
  GW: { col: 10, row: 12, name: "Guinea-Bissau" },
  SL: { col: 11, row: 12, name: "Sierra Leone" },
  CI: { col: 12, row: 12, name: "Côte d'Ivoire" },
  GH: { col: 13, row: 12, name: "Ghana" },
  GQ: { col: 14, row: 12, name: "Equatorial Guinea" },
  GA: { col: 15, row: 12, name: "Gabon" },
  CG: { col: 16, row: 12, name: "Congo" },
  CD: { col: 17, row: 12, name: "DR Congo" },
  UG: { col: 18, row: 12, name: "Uganda" },
  KE: { col: 19, row: 12, name: "Kenya" },
  SO: { col: 20, row: 12, name: "Somalia" },
  LR: { col: 11, row: 13, name: "Liberia" },
  AO: { col: 15, row: 13, name: "Angola" },
  ZM: { col: 16, row: 13, name: "Zambia" },
  MW: { col: 17, row: 13, name: "Malawi" },
  TZ: { col: 18, row: 13, name: "Tanzania" },
  NA: { col: 14, row: 14, name: "Namibia" },
  BW: { col: 15, row: 14, name: "Botswana" },
  ZW: { col: 16, row: 14, name: "Zimbabwe" },
  MZ: { col: 17, row: 14, name: "Mozambique" },
  MG: { col: 19, row: 14, name: "Madagascar" },
  ZA: { col: 15, row: 15, name: "South Africa" },
  LS: { col: 16, row: 15, name: "Lesotho" },
  SZ: { col: 17, row: 15, name: "Eswatini" },
  MU: { col: 20, row: 15, name: "Mauritius" },

  // ---- Central & South Asia ----
  KZ: { col: 23, row: 4, name: "Kazakhstan" },
  UZ: { col: 23, row: 6, name: "Uzbekistan" },
  KG: { col: 24, row: 6, name: "Kyrgyzstan" },
  TJ: { col: 24, row: 7, name: "Tajikistan" },
  TM: { col: 22, row: 8, name: "Turkmenistan" },
  AF: { col: 23, row: 8, name: "Afghanistan" },
  PK: { col: 23, row: 9, name: "Pakistan" },
  NP: { col: 25, row: 9, name: "Nepal" },
  BT: { col: 26, row: 9, name: "Bhutan" },
  IN: { col: 24, row: 10, name: "India" },
  BD: { col: 25, row: 10, name: "Bangladesh" },
  MV: { col: 23, row: 12, name: "Maldives" },
  LK: { col: 24, row: 12, name: "Sri Lanka" },

  // ---- East Asia ----
  MN: { col: 25, row: 5, name: "Mongolia" },
  KP: { col: 27, row: 6, name: "North Korea" },
  JP: { col: 28, row: 6, name: "Japan" },
  CN: { col: 25, row: 7, name: "China" },
  KR: { col: 27, row: 7, name: "South Korea" },
  HK: { col: 26, row: 8, name: "Hong Kong" },
  TW: { col: 27, row: 8, name: "Taiwan" },

  // ---- Southeast Asia ----
  LA: { col: 26, row: 10, name: "Laos" },
  MM: { col: 25, row: 11, name: "Myanmar" },
  TH: { col: 26, row: 11, name: "Thailand" },
  VN: { col: 27, row: 11, name: "Vietnam" },
  PH: { col: 28, row: 11, name: "Philippines" },
  KH: { col: 27, row: 12, name: "Cambodia" },
  MY: { col: 26, row: 13, name: "Malaysia" },
  BN: { col: 27, row: 13, name: "Brunei" },
  SG: { col: 26, row: 14, name: "Singapore" },
  ID: { col: 27, row: 14, name: "Indonesia" },
  TL: { col: 28, row: 14, name: "Timor-Leste" },

  // ---- Oceania ----
  PG: { col: 29, row: 13, name: "Papua New Guinea" },
  SB: { col: 30, row: 14, name: "Solomon Islands" },
  VU: { col: 30, row: 15, name: "Vanuatu" },
  AU: { col: 27, row: 16, name: "Australia" },
  FJ: { col: 30, row: 16, name: "Fiji" },
  NZ: { col: 29, row: 18, name: "New Zealand" },
};

// Grid extent, derived so the SVG viewBox always frames every tile. Computed
// once at module load — the map is a static const.
const tiles = Object.values(WORLD_TILE_GRID);
export const GRID_COLS = tiles.reduce((m, t) => Math.max(m, t.col), 0) + 1;
export const GRID_ROWS = tiles.reduce((m, t) => Math.max(m, t.row), 0) + 1;
