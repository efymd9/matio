// Copy for the public /ideas landing (#297) — the story-idea form, its
// How-it-works / FAQ blocks and the Idea Submission Terms sheet, es + en.
//
// A separate module rather than an `ideas` section in dictionaries.ts, for
// the same reason admin-dictionaries.ts and app-dictionaries.ts are separate:
// dictionaries.ts ships in the client bundle of EVERY page (the header calls
// useT()) and Metro bundles it into the app (mobile/src/shared/i18n.ts). The
// Terms, seven FAQ answers and the form copy in two languages would bloat
// both. Only app/(public)/ideas/* and components/ideas/* import this file.
// Universal — no imports beyond the Locale type.
//
// LEGAL STATUS: the Idea Submission Terms, the "Before you send it" summary,
// the privacy line and the FAQ promises are a DRAFT pending counsel review
// (docs/registry.md, #168). English is the text the owner approved; Spanish
// is a translation, and which language version prevails is a question for
// counsel. The mockup's inline notes addressed to counsel are
// deliberately NOT rendered — they live in the registry row and in #168.
//
// Any edit to the Terms or to the wording of ticks 1–3, in EITHER language,
// must bump IDEA_TERMS_VERSION in lib/idea-submission.ts — the version
// stamped on every row is the only proof of which text a fan agreed to.

import type { Locale } from "./dictionaries";

/** A sentence with one inline link: `before` + <link>{link}</link> + `after`. */
export type IdeasLinked = { before: string; link: string; after: string };

export const es = {
  meta: {
    title: "Escribe lo que pasa después",
    description:
      "Continúa una serie de Matio o propón una totalmente nueva. Las mejores ideas pueden llegar a una serie, con tu nombre en los créditos.",
  },
  formAria: "Envía a Matio una idea de historia",
  h1: ["Tu historia", "podría ser la próxima"] as [string, string],
  chapter: (n: number) => `Capítulo ${n} / 3`,
  chapterLabels: {
    1: "Capítulo 1 / 3 · Premisa",
    2: "Capítulo 2 / 3 · Tu historia",
    3: "Capítulo 3 / 3 · Tu crédito",
  },
  headings: { story: "Tu historia", credit: "Tu crédito" },
  barNext: "Siguiente",
  whatIf: "¿Y si…?",
  logline: {
    placeholder:
      "p. ej., Un cartero desterrado de su reino tiene una última carta que entregar: al rey que lo exilió.",
    help: "Una o dos frases, hasta 300 caracteres.",
  },
  pitchCta: "Cuenta tu historia",
  notContest:
    "Esto no es un concurso y no hay premio. Es la oportunidad de ver tu historia hecha realidad. Las mejores ideas pueden llegar a una serie de Matio, con tu nombre en los créditos.",
  series: {
    label: "¿Qué historia vas a escribir?",
    placeholder: "Elige una serie…",
    help: "¿Continúas una serie? Elige cuál. ¿Empiezas de cero? Elige «Una serie totalmente nueva».",
    newOption: "Una serie totalmente nueva",
  },
  workingTitle: {
    label: "Título provisional (opcional)",
    placeholder: "p. ej., La última carta",
    help: "Un nombre para tu idea. Sáltatelo si aún no lo tienes.",
  },
  story: {
    label: "Tu historia",
    help1:
      "Cuenta la historia. Sinopsis, escenas, giros: hasta 10.000 caracteres. Solo texto. No abrimos enlaces ni archivos adjuntos.",
    help2:
      "Solo ficción. No incluyas nombres de personas reales ni datos privados, tampoco los tuyos. Y, por favor, no tomes prestados personajes de historias de otros estudios.",
    placeholderShow: (show: string) =>
      `Continúa después del último episodio de ${show}. ¿Quién está en la escena, qué sale mal, cuál es el giro?`,
    placeholderNew:
      "¿Dónde estamos, a quién seguimos y qué se interpone en su camino? Escenas, giros y el final, si ya lo tienes.",
  },
  /** The counter's over-the-cap tail: "10.240 / 10.000 · {over}". */
  over: (k: string) => `${k} de más`,
  name: {
    label: "Nombre o seudónimo",
    placeholder: "Cómo quieres que aparezca tu crédito",
    help: "Así te daríamos crédito en pantalla.",
  },
  email: {
    label: "Correo electrónico",
    placeholder: "tu@ejemplo.com",
    help: "Es la única vía por la que te contactaremos.",
  },
  beforeYouSend: {
    title: "Antes de enviarla",
    items: [
      {
        lead: "Es tuya.",
        body: "La escribiste tú, no es una copia y no la has vendido.",
      },
      {
        lead: "Podemos usarla.",
        body: "Das a Matio una licencia gratuita y no exclusiva para usar, adaptar y desarrollar tu idea. Tú también puedes seguir usándola.",
      },
      {
        lead: "Sin obligación ni pago.",
        body: "Puede que nunca la produzcamos, y no pagamos por las ideas que se envían aquí.",
      },
      {
        lead: "Las grandes mentes piensan igual.",
        body: "Desarrollamos muchas historias. Si hacemos algo parecido, puede que no venga de la tuya.",
      },
      {
        lead: "Crédito a quien lo merece.",
        body: "Si convertimos tu idea en una serie o un episodio de Matio, te daremos crédito en pantalla con el nombre que nos indiques.",
      },
    ],
    draft: "(Borrador, pendiente de revisión legal.)",
  },
  ticks: {
    age: "Tengo 18 años o más.",
    terms: {
      before:
        "Esta idea es obra original mía (o tengo el visto bueno de mis coautores) y acepto las ",
      link: "Condiciones de envío de ideas",
      after: ".",
    },
    termsHelp:
      "Las condiciones completas se abren sobre esta página. Tu borrador se queda donde está.",
    optIn:
      "Quiero recibir correos sobre nuevos episodios de Matio y futuras convocatorias de historias. Puedo darme de baja cuando quiera.",
    optInHelp: "Opcional. No lo necesitas para enviar tu idea.",
  },
  privacy: {
    before:
      "Matio (DEEP ORDINARY LTD) guarda tu idea, tu nombre y tu correo para revisar tu idea y contactarte sobre ella. Los conservamos hasta 24 meses, o más solo si desarrollamos tu idea contigo. Nunca los vendemos ni se los mostramos a otros fans. Cómo tratamos tus datos y cuáles son tus derechos: ",
    link: "Política de privacidad",
    after: ".",
  },
  submit: "Enviar mi idea",
  sending: "Enviando…",
  errors: {
    summary: "Hay algunas cosas que revisar antes de poder enviarla.",
    series:
      "Elige la serie que continúas o selecciona «Una serie totalmente nueva».",
    title: "Deja el título por debajo de 100 caracteres.",
    loglineRequired: "Añade una premisa: una o dos frases.",
    loglineTooLong: "Tu premisa supera los 300 caracteres. Hazla más concisa.",
    storyRequired: "Cuéntanos la historia. Unas pocas líneas ya son un comienzo.",
    storyTooLong: "Tu historia supera los 10.000 caracteres. Recórtala un poco.",
    nameRequired: "Dinos cómo llamarte.",
    nameTooLong: "Que no pase de 80 caracteres.",
    email: "Ese correo no parece correcto.",
    age: "Marca la casilla para confirmar que tienes 18 años o más.",
    terms:
      "Marca la casilla para confirmar que la idea es tuya y que aceptas las condiciones.",
    rateLimited:
      "Son muchas ideas desde una misma red. Espera una hora y vuelve a intentarlo. Tu texto sigue aquí.",
    generic:
      "Algo salió mal por nuestra parte. Tu historia sigue aquí. Inténtalo de nuevo.",
  },
  success: {
    title: "Idea recibida",
    // "Gracias, {name}. Si tu idea encaja …, te escribiremos a {email}. …"
    thanks: "Gracias, ",
    afterName: ". Si tu idea encaja en una serie de Matio, te escribiremos a ",
    afterEmail: ". No podemos responder a todas las ideas.",
    onList:
      "Estás en la lista para nuevos episodios y futuras convocatorias de historias.",
    again: "Enviar otra idea →",
  },
  rail: {
    title: "Tu propuesta",
    steps: ["1 · Premisa", "2 · Tu historia", "3 · Tu crédito"] as [string, string, string],
    story: "Historia",
    newSeries: "Una serie totalmente nueva",
    choose: "Elige una serie…",
    done: "Hecho",
  },
  how: {
    title: "Cómo funciona",
    steps: [
      {
        num: "01",
        title: "Elige tu mundo",
        body: "Continúa una de nuestras series o empieza algo que aún no hayamos hecho.",
      },
      {
        num: "02",
        title: "Escríbela",
        body: "Una premisa y después la historia: sinopsis, escenas, giros. Solo texto, directamente desde tu móvil.",
      },
      {
        num: "03",
        title: "Nosotros nos encargamos",
        body: "Nuestro equipo revisa las ideas. Si la tuya encaja en una serie de Matio, te escribiremos. Si llega a la pantalla, el crédito es tuyo.",
      },
    ],
  },
  faq: {
    title: "Preguntas",
    owns: {
      q: "¿De quién es mi idea?",
      a: {
        before:
          "Tuya. Al enviarla, das a Matio una licencia gratuita y no exclusiva para usarla, adaptarla y desarrollarla, y tú puedes seguir usándola. El texto completo está en las ",
        link: "Condiciones de envío de ideas",
        after: ".",
      },
    },
    paid: {
      q: "¿Me pagarán?",
      a: "No. Esto no es un concurso y no pagamos por las ideas enviadas a través de esta página. Si convertimos tu idea en una serie o un episodio de Matio, te daremos crédito en pantalla con el nombre que nos indiques. Si queremos seguir trabajando contigo, te contactaremos, y cualquier otra cosa se acuerda por separado y por escrito.",
    },
    more: {
      q: "¿Puedo enviar más de una idea?",
      a: "Sí. Envía cada idea en su propio formulario, para que cada historia se sostenga por sí sola.",
    },
    language: {
      q: "¿En qué idioma debo escribir?",
      a: "En inglés o en español. Usa el idioma en el que cuentas historias.",
    },
    after: {
      q: "¿Qué pasa después de enviarla?",
      a: "Nuestro equipo revisa las ideas. Si la tuya encaja en una serie de Matio, te escribiremos. No podemos responder a todas las ideas y no hay un plazo fijo.",
    },
    keep: {
      q: "¿Cuánto tiempo guardan mi historia?",
      a: {
        before:
          "Hasta 24 meses, o más solo si desarrollamos tu idea contigo. Nunca la vendemos ni se la mostramos a otros fans. Los detalles están en nuestra ",
        link: "Política de privacidad",
        after: ".",
      },
    },
    delete: {
      q: "¿Cómo elimino mi envío?",
      // The link is the address itself (mailto:).
      a: {
        before: "Escribe a ",
        link: "contact@matio.tv",
        after:
          " desde la dirección que usaste y lo eliminaremos. También puedes pedirnos una copia de lo que tenemos.",
      },
    },
  },
  terms: {
    title: "Condiciones de envío de ideas",
    close: "Cerrar",
    scrimAria: "Cerrar las Condiciones de envío de ideas",
    version: "Versión ideas-2026-09-draft1 · Borrador, pendiente de revisión legal",
    intro:
      "Estas condiciones se aplican cuando envías una idea de historia a DEEP ORDINARY LTD («Matio», «nosotros»), 66 Paul Street, Londres EC2A 4NA, a través de matio.tv.",
    items: [
      { lead: "1. Quién puede enviar.", body: "Debes tener 18 años o más." },
      {
        lead: "2. Es tu idea.",
        body: "Confirmas que la escribiste tú (o que todas las personas que la coescribieron aceptan estas condiciones), que no está copiada de la obra de nadie y que no has vendido ni cedido en exclusiva sus derechos a nadie.",
      },
      {
        lead: "3. Lo que nos permites hacer.",
        body: "Das a Matio una licencia gratuita, mundial, no exclusiva, perpetua e irrevocable para leer, usar, adaptar, modificar, combinar y desarrollar tu idea, en cualquier serie, episodio u otra producción y en cualquier medio, y para permitir que nuestros socios de producción hagan lo mismo para producciones de Matio. La licencia no es exclusiva, así que conservas el derecho a usar tu idea tú mismo.",
      },
      {
        lead: "4. Sin obligación.",
        body: "No estamos obligados a usar ni a desarrollar tu idea, a responderte ni a explicar nuestras decisiones.",
      },
      {
        lead: "5. Ideas parecidas.",
        body: "Creamos muchas historias, y es habitual que distintas personas tengan ideas parecidas. Puede que ya estemos desarrollando, o que desarrollemos más adelante por nuestra cuenta, historias parecidas a la tuya. Eso no significa que hayamos usado tu idea y no te da ningún derecho a reclamarnos.",
      },
      {
        lead: "6. Sin pago.",
        body: "No pagamos por las ideas enviadas a través de esta página. Si queremos trabajar contigo en una producción, te contactaremos, y cualquier otra cosa se acordará por separado y por escrito.",
      },
      {
        lead: "7. Crédito.",
        body: "Si convertimos tu idea en una serie o un episodio de Matio, te daremos crédito en pantalla con el nombre o seudónimo que nos indicaste (por ejemplo, «Idea original de …»).",
      },
    ],
    // Item 8 carries the Privacy Policy link, so it is split out.
    data: {
      lead: "8. Tus datos personales.",
      before:
        "Tratamos tu nombre, tu correo y tu envío según lo descrito en nuestra ",
      link: "Política de privacidad",
      after: ".",
    },
    law: {
      lead: "9. Ley aplicable.",
      body: "Estas condiciones se rigen por las leyes de Inglaterra y Gales. Si eres consumidor, conservas la protección de la ley de tu lugar de residencia.",
    },
  },
};

export type IdeasDict = typeof es;

export const en: IdeasDict = {
  meta: {
    title: "Write what happens next",
    description:
      "Continue a Matio series or pitch a brand-new one. The best ideas may make it into a series, with your name in the credits.",
  },
  formAria: "Send Matio a story idea",
  h1: ["Your story", "could be next"],
  chapter: (n: number) => `Chapter ${n} / 3`,
  chapterLabels: {
    1: "Chapter 1 / 3 · Logline",
    2: "Chapter 2 / 3 · Your story",
    3: "Chapter 3 / 3 · Your credit",
  },
  headings: { story: "Your story", credit: "Your credit" },
  barNext: "Next",
  whatIf: "What if…",
  logline: {
    placeholder:
      "e.g. A postman banished from his kingdom has one last letter to deliver: to the king who exiled him.",
    help: "One or two sentences, up to 300 characters.",
  },
  pitchCta: "Pitch your story",
  notContest:
    "This isn't a contest, and there's no prize. It's a chance to see your story made. The best ideas may make it into a Matio series, with your name in the credits.",
  series: {
    label: "Which story are you writing?",
    placeholder: "Choose a series…",
    help: "Continuing a series? Pick which one. Starting fresh? Choose “A brand-new series”.",
    newOption: "A brand-new series",
  },
  workingTitle: {
    label: "Working title (optional)",
    placeholder: "e.g. The Last Letter",
    help: "A name for your idea. Skip it if you don't have one yet.",
  },
  story: {
    label: "Your story",
    help1:
      "Tell the story. Synopsis, scenes, twists: up to 10,000 characters. Text only. We don't open links or attachments.",
    help2:
      "Fiction only. Leave out real people's names and private details, yours included. And please don't borrow characters from other studios' stories.",
    placeholderShow: (show: string) =>
      `Pick up after the last episode of ${show}. Who's in the scene, what goes wrong, what's the twist?`,
    placeholderNew:
      "Where are we, who do we follow, and what stands in their way? Scenes, twists, the ending if you have one.",
  },
  over: (k: string) => `${k} over`,
  name: {
    label: "Name or pen name",
    placeholder: "How your credit should read",
    help: "This is how we'd credit you on screen.",
  },
  email: {
    label: "Email",
    placeholder: "you@example.com",
    help: "The only way we'll get in touch.",
  },
  beforeYouSend: {
    title: "Before you send it",
    items: [
      {
        lead: "It's yours.",
        body: "You wrote it, and it isn't copied or already sold.",
      },
      {
        lead: "We can use it.",
        body: "You give Matio a free, non-exclusive licence to use, adapt and build on your idea. You can still use it yourself.",
      },
      {
        lead: "No obligation, no payment.",
        body: "We may never make it, and we don't pay for ideas sent here.",
      },
      {
        lead: "Great minds think alike.",
        body: "We develop lots of stories. If we make something similar, it may not come from yours.",
      },
      {
        lead: "Credit where it's due.",
        body: "If we turn your idea into a Matio series or episode, we'll credit you on screen under the name you give us.",
      },
    ],
    draft: "(Draft, pending legal review.)",
  },
  ticks: {
    age: "I'm 18 or older.",
    terms: {
      before:
        "This idea is my own original work (or I have my co-writers' OK), and I agree to the ",
      link: "Idea Submission Terms",
      after: ".",
    },
    termsHelp:
      "The full terms open over this page. Your draft stays where it is.",
    optIn:
      "Email me about new Matio episodes and future story calls. Unsubscribe anytime.",
    optInHelp: "Optional. You don't need it to send your idea.",
  },
  privacy: {
    before:
      "Matio (DEEP ORDINARY LTD) keeps your idea, name and email to review your idea and contact you about it. We keep them for up to 24 months, or longer only if we develop your idea with you. We never sell them or show them to other fans. How we handle your data and your rights: ",
    link: "Privacy Policy",
    after: ".",
  },
  submit: "Send my idea",
  sending: "Sending…",
  errors: {
    summary: "A few things need a look before we can send it.",
    series:
      "Pick the series you're continuing, or choose “A brand-new series”.",
    title: "Keep the title under 100 characters.",
    loglineRequired: "Add a logline: one or two sentences.",
    loglineTooLong: "Your logline is over 300 characters. Make it tighter.",
    storyRequired: "Tell us the story. A few lines is a start.",
    storyTooLong: "Your story is over 10,000 characters. Trim it a little.",
    nameRequired: "Tell us what to call you.",
    nameTooLong: "Keep it under 80 characters.",
    email: "That email doesn't look right.",
    age: "Tick to confirm you're 18 or older.",
    terms: "Tick to confirm the idea is yours and you agree to the terms.",
    rateLimited:
      "That's a lot of ideas from one network. Give it an hour, then try again. Your text is still here.",
    generic:
      "Something went wrong on our side. Your story is still here. Try again.",
  },
  success: {
    title: "Idea received",
    thanks: "Thank you, ",
    afterName: ". If your idea is a fit for a Matio series, we'll email you at ",
    afterEmail: ". We can't reply to every idea.",
    onList: "You're on the list for new episodes and future story calls.",
    again: "Send another idea →",
  },
  rail: {
    title: "Your pitch",
    steps: ["1 · Logline", "2 · Your story", "3 · Your credit"],
    story: "Story",
    newSeries: "A brand-new series",
    choose: "Choose a series…",
    done: "Done",
  },
  how: {
    title: "How it works",
    steps: [
      {
        num: "01",
        title: "Pick your world",
        body: "Continue one of our series, or start something we haven't made yet.",
      },
      {
        num: "02",
        title: "Write it down",
        body: "A logline, then the story: synopsis, scenes, twists. Text only, straight from your phone.",
      },
      {
        num: "03",
        title: "We take it from there",
        body: "Our team reviews ideas. If yours fits a Matio series, we'll email you. If it makes it to screen, you get the credit.",
      },
    ],
  },
  faq: {
    title: "Questions",
    owns: {
      q: "Who owns my idea?",
      a: {
        before:
          "You do. By sending it, you give Matio a free, non-exclusive licence to use, adapt and build on it, and you can still use it yourself. The full wording is in the ",
        link: "Idea Submission Terms",
        after: ".",
      },
    },
    paid: {
      q: "Will I be paid?",
      a: "No. This isn't a contest, and we don't pay for ideas sent through this page. If we turn your idea into a Matio series or episode, we'll credit you on screen under the name you give us. If we want to work with you further, we'll contact you, and anything more is agreed separately in writing.",
    },
    more: {
      q: "Can I send more than one idea?",
      a: "Yes. Send each idea on its own form, so every story stands on its own.",
    },
    language: {
      q: "Which language should I write in?",
      a: "English or Spanish. Use whichever one you tell stories in.",
    },
    after: {
      q: "What happens after I send it?",
      a: "Our team reviews ideas. If yours fits a Matio series, we'll email you. We can't reply to every idea, and there's no set timeline.",
    },
    keep: {
      q: "How long do you keep my story?",
      a: {
        before:
          "Up to 24 months, or longer only if we develop your idea with you. We never sell it or show it to other fans. The details are in our ",
        link: "Privacy Policy",
        after: ".",
      },
    },
    delete: {
      q: "How do I delete my submission?",
      a: {
        before: "Email ",
        link: "contact@matio.tv",
        after:
          " from the address you used, and we'll delete it. You can also ask us for a copy of what we hold.",
      },
    },
  },
  terms: {
    title: "Idea Submission Terms",
    close: "Close",
    scrimAria: "Close the Idea Submission Terms",
    version: "Version ideas-2026-09-draft1 · Draft, pending legal review",
    intro:
      "These terms apply when you send a story idea to DEEP ORDINARY LTD (“Matio”, “we”), 66 Paul Street, London EC2A 4NA, through matio.tv.",
    items: [
      { lead: "1. Who can submit.", body: "You must be 18 or older." },
      {
        lead: "2. It's your idea.",
        body: "You confirm that you wrote it yourself (or that everyone who co-wrote it agrees to these terms), that it isn't copied from anyone else's work, and that you haven't sold or given exclusive rights in it to anyone else.",
      },
      {
        lead: "3. What you let us do.",
        body: "You give Matio a free, worldwide, non-exclusive, perpetual and irrevocable licence to read, use, adapt, change, combine and build on your idea, in any series, episode or other production and in any medium, and to let our production partners do the same for Matio productions. The licence is non-exclusive, so you keep the right to use your idea yourself.",
      },
      {
        lead: "4. No obligation.",
        body: "We don't have to use or develop your idea, reply to you, or explain our decisions.",
      },
      {
        lead: "5. Similar ideas.",
        body: "We create many stories, and people often have similar ideas. We may already be developing, or may later develop on our own, stories similar to yours. That doesn't mean we used your idea, and it gives you no claim against us.",
      },
      {
        lead: "6. No payment.",
        body: "We don't pay for ideas sent through this page. If we want to work with you on a production, we'll contact you, and anything further will be agreed separately in writing.",
      },
      {
        lead: "7. Credit.",
        body: "If we develop your idea into a Matio series or episode, we'll credit you on screen under the name or pen name you gave us (for example “Story idea by …”).",
      },
    ],
    data: {
      lead: "8. Your personal data.",
      before: "We handle your name, email and submission as described in our ",
      link: "Privacy Policy",
      after: ".",
    },
    law: {
      lead: "9. Law.",
      body: "These terms are governed by the laws of England and Wales. If you're a consumer, you keep the protections of the law where you live.",
    },
  },
};

export function ideasDictFor(locale: Locale): IdeasDict {
  return locale === "es" ? es : en;
}
