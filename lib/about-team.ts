import type { Locale } from "./i18n/dictionaries";

// The /about team roster — owner-authored content from the Claude Design
// «About page v3» mock (2026-08-16). Lives here rather than in the i18n
// dictionaries: the dictionary ships whole in the client bundle on every
// page, while this roster is needed on exactly one route and travels to the
// client as props of the team slider.
//
// Card gradients are per-member CONTENT (like TONE_GRADIENT in lib/design.ts),
// all in the espresso/rust family; they are data passed via inline style, not
// Tailwind classes — the no-magic-styles check governs classes, not data.

export type TeamMember = {
  name: string;
  initials: string;
  role: string;
  desc: string;
  // CSS background-image for the card face.
  gradient: string;
};

type RosterEntry = {
  name: string;
  initials: string;
  c1: string;
  c2: string;
  en: { role: string; desc: string };
  es: { role: string; desc: string };
};

const ROSTER: RosterEntry[] = [
  {
    name: "Alina Kovaleva",
    initials: "AK",
    c1: "#8a2f1c",
    c2: "#2e0f08",
    en: {
      role: "Creative Director",
      desc: "Invents the universes our stories live in. Keeps the tone, style and genre boundaries of every project.",
    },
    es: {
      role: "Directora creativa",
      desc: "Inventa los universos donde viven nuestras historias. Cuida el tono, el estilo y los límites de género de cada proyecto.",
    },
  },
  {
    name: "Mark Osipov",
    initials: "MO",
    c1: "#6e3a14",
    c2: "#271204",
    en: {
      role: "Showrunner",
      desc: "Keeps a series from falling apart between episodes. Gathers the team around one vision, from pitch to edit.",
    },
    es: {
      role: "Showrunner",
      desc: "Evita que una serie se desarme entre episodios. Reúne al equipo en torno a una sola visión, del pitch al montaje.",
    },
  },
  {
    name: "Daria Luneva",
    initials: "DL",
    c1: "#7a1f2e",
    c2: "#2b0a10",
    en: {
      role: "Lead Writer",
      desc: "Writes dialogue that makes you put the phone down and finish the episode. Loves difficult, inconvenient characters.",
    },
    es: {
      role: "Guionista principal",
      desc: "Escribe diálogos que te hacen soltar el teléfono y terminar el episodio. Ama a los personajes difíciles e incómodos.",
    },
  },
  {
    name: "Timur Rakhimov",
    initials: "TR",
    c1: "#5c2416",
    c2: "#1c0b05",
    en: {
      role: "Director",
      desc: "Turns script into frame. Insists on atmosphere even where a simple shot would do.",
    },
    es: {
      role: "Director",
      desc: "Convierte el guion en fotograma. Insiste en la atmósfera incluso donde bastaría un plano simple.",
    },
  },
  {
    name: "Eva Sokolova",
    initials: "ES",
    c1: "#9c5a1e",
    c2: "#372007",
    en: {
      role: "AI Art Director",
      desc: "Builds each project's visual world through dozens of AI tools, until the image breathes the right mood.",
    },
    es: {
      role: "Directora de arte IA",
      desc: "Construye el mundo visual de cada proyecto con decenas de herramientas de IA, hasta que la imagen respira el ánimo justo.",
    },
  },
  {
    name: "Kirill Zemtsov",
    initials: "KZ",
    c1: "#7a2e1f",
    c2: "#2a0f08",
    en: {
      role: "Cinematographer",
      desc: "Sets light and angle so even a static frame holds tension.",
    },
    es: {
      role: "Director de fotografía",
      desc: "Ajusta la luz y el ángulo para que incluso un plano estático sostenga la tensión.",
    },
  },
  {
    name: "Polina Vershinina",
    initials: "PV",
    c1: "#8a5a24",
    c2: "#2f1e0a",
    en: {
      role: "Writer",
      desc: "Owns structure and plot turns. Hides the ending so you can't guess it early.",
    },
    es: {
      role: "Guionista",
      desc: "Domina la estructura y los giros de la trama. Esconde el final para que no puedas adivinarlo antes de tiempo.",
    },
  },
  {
    name: "Artyom Grinev",
    initials: "AG",
    c1: "#6b2c22",
    c2: "#240e08",
    en: {
      role: "Editor",
      desc: "Builds the story's rhythm frame by frame. Believes a pause hits harder than a hard cut.",
    },
    es: {
      role: "Montador",
      desc: "Construye el ritmo de la historia fotograma a fotograma. Cree que una pausa golpea más fuerte que un corte seco.",
    },
  },
  {
    name: "Sofia Malysheva",
    initials: "SM",
    c1: "#94502c",
    c2: "#33190c",
    en: {
      role: "Sound Designer",
      desc: "Builds the sound world — from silence to a whisper off-screen.",
    },
    es: {
      role: "Diseñadora de sonido",
      desc: "Construye el mundo sonoro — del silencio a un susurro fuera de plano.",
    },
  },
  {
    name: "Nikita Orlov",
    initials: "NO",
    c1: "#a8401f",
    c2: "#3a1408",
    en: {
      role: "AI Engineer",
      desc: "Tunes the tools the whole production stands on.",
    },
    es: {
      role: "Ingeniero de IA",
      desc: "Afina las herramientas sobre las que se sostiene toda la producción.",
    },
  },
  {
    name: "Viktoria Naumova",
    initials: "VN",
    c1: "#7d3a2a",
    c2: "#2b120a",
    en: {
      role: "Producer",
      desc: "Keeps projects on time and on budget, solving problems before they appear.",
    },
    es: {
      role: "Productora",
      desc: "Mantiene los proyectos en plazo y presupuesto, resolviendo problemas antes de que aparezcan.",
    },
  },
  {
    name: "Roman Belov",
    initials: "RB",
    c1: "#8c6a2a",
    c2: "#30240b",
    en: {
      role: "Colorist",
      desc: "Sets each scene's mood with a single shade.",
    },
    es: {
      role: "Colorista",
      desc: "Define el ánimo de cada escena con un solo matiz.",
    },
  },
  {
    name: "Ksenia Dorokhova",
    initials: "KD",
    c1: "#74321a",
    c2: "#280f06",
    en: {
      role: "Casting Director",
      desc: "Casts the voices and faces of our characters — even when they're AI models.",
    },
    es: {
      role: "Directora de casting",
      desc: "Elige las voces y los rostros de nuestros personajes — incluso cuando son modelos de IA.",
    },
  },
  {
    name: "Gleb Sitnikov",
    initials: "GS",
    c1: "#8f2f1c",
    c2: "#310e06",
    en: {
      role: "Composer",
      desc: "Writes music that carries the emotion of a scene even when everyone is silent.",
    },
    es: {
      role: "Compositor",
      desc: "Escribe música que sostiene la emoción de una escena incluso cuando todos callan.",
    },
  },
  {
    name: "Mila Krylova",
    initials: "MK",
    c1: "#7a4d1f",
    c2: "#2c1a08",
    en: {
      role: "SMM & Distribution",
      desc: "Decides how and where viewers meet each project.",
    },
    es: {
      role: "SMM y distribución",
      desc: "Decide cómo y dónde los espectadores se encuentran con cada proyecto.",
    },
  },
];

export const TEAM_SIZE = ROSTER.length;

export function teamForLocale(locale: Locale): TeamMember[] {
  return ROSTER.map((m) => ({
    name: m.name,
    initials: m.initials,
    role: m[locale].role,
    desc: m[locale].desc,
    gradient: `linear-gradient(160deg, ${m.c1} 0%, ${m.c2} 65%)`,
  }));
}
