// DRAFT pending legal-counsel review. Describes the cookies the site sets
// (Clerk + Stripe + attribution + Meta Pixel + PostHog). The attribution_first /
// attribution_last / _fbp / _fbc / ph_* marketing cookies are gated on
// cookie_consent.marketing via proxy.ts + the consent banner. Contact details
// filled 2026-05-27; Meta Pixel + Conversions API disclosure added 2026-05-29;
// PostHog disclosure added 2026-05-30.
import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.cookiesTitle,
    alternates: { canonical: canonicalUrl("/cookies") },
    robots: { index: true, follow: true },
  };
}

const LAST_UPDATED_ES = "29 de mayo de 2026";
const LAST_UPDATED_EN = "May 29, 2026";

export default async function CookiesPage() {
  const { locale, t } = await getDict();
  return (
    <main className="bg-background pt-28 pb-24 sm:pt-32">
      <article className="mx-auto max-w-3xl px-6 sm:px-8">
        <header className="mb-10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            matio
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {t.legal.cookiesTitle}
          </h1>
          <p className="font-mono text-[11px] text-white/45">
            {t.legal.lastUpdated(locale === "en" ? LAST_UPDATED_EN : LAST_UPDATED_ES)}
          </p>
        </header>
        {locale === "en" ? <CookiesEn /> : <CookiesEs />}
        <div className="mt-12 border-t border-white/[0.06] pt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-white/70 transition-colors hover:text-white"
          >
            ← {t.legal.backHome}
          </Link>
        </div>
      </article>
    </main>
  );
}

function CookiesEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="what" title="1. What cookies are">
        <p>
          Cookies are small text files a website stores on your device so it
          can remember you between visits. Some cookies are essential for the
          site to work; others help us understand how people arrive at the
          site so we can spend our marketing budget sensibly.
        </p>
      </Section>

      <Section id="we-use" title="2. Cookies we use">
        <p>
          The list below covers every cookie this site sets directly or via
          our processors. Categories follow the ePrivacy / GDPR conventions:
          <strong> strictly necessary</strong> cookies don&rsquo;t need
          consent; <strong>preferences</strong> and <strong>marketing</strong>{" "}
          cookies do.
        </p>

        <CookieTable
          rows={[
            {
              name: "__session, __client_uat (Clerk)",
              purpose:
                "Authentication. Keeps you signed in across page loads and lets the server verify your identity.",
              expiry: "Session and short-lived",
              category: "Strictly necessary",
            },
            {
              name: "trial_session",
              purpose:
                "Tracks your 60-second free preview per show so it can&rsquo;t be reset by reloading. Random opaque token, no personal data.",
              expiry: "1 year",
              category: "Strictly necessary",
            },
            {
              name: "locale",
              purpose: "Remembers your language preference (Spanish / English).",
              expiry: "1 year",
              category: "Preferences",
            },
            {
              name: "__stripe_mid, __stripe_sid (Stripe)",
              purpose:
                "Anti-fraud fingerprinting on Stripe Checkout pages. Set by Stripe directly when you start a checkout.",
              expiry: "Up to 1 year",
              category: "Strictly necessary",
            },
            {
              name: "attribution_first",
              purpose:
                "First UTM source / medium / campaign you arrived from. Used to attribute paid signups to the campaign that originally introduced you to matio.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "attribution_last",
              purpose:
                "Most recent UTM source / medium / campaign. Used to reconcile our attribution against ad-platform dashboards.",
              expiry: "30 days",
              category: "Marketing",
            },
            {
              name: "_fbp (Meta)",
              purpose:
                "Set by the Meta Pixel to identify your browser for advertising measurement and to attribute conversions to our Meta ad campaigns. Only set after you accept marketing cookies.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "_fbc / fbclid (Meta)",
              purpose:
                "Stores the Meta click identifier when you arrive from a Facebook or Instagram ad, so a later sign-up or subscription can be matched to that ad. Only used after you accept marketing cookies.",
              expiry: "90 days",
              category: "Marketing",
            },
            {
              name: "muxData / mux_viewer_id (Mux)",
              purpose:
                "Set by Mux Data (our video provider’s analytics) to measure watch time, unique viewers and playback quality. Only used after you accept marketing cookies.",
              expiry: "Up to 1 year",
              category: "Marketing",
            },
            {
              name: "ph_* (PostHog)",
              purpose:
                "Set by PostHog, our product-analytics tool, to identify your browser session and measure how visitors move through the site (funnel analytics, page views, feature interactions). Session replays and heatmaps are also recorded with all inputs and text masked. Only set after you accept marketing cookies.",
              expiry: "Up to 1 year",
              category: "Marketing",
            },
          ]}
        />
        <p>
          We use the <strong>Meta Pixel</strong> and Meta&rsquo;s{" "}
          <strong>Conversions API</strong> to measure how our advertising on
          Facebook and Instagram performs. These run{" "}
          <strong>only after you accept marketing cookies</strong> in the
          banner. When active they share a limited set of data with{" "}
          <strong>Meta Platforms Ireland Ltd</strong> &mdash; a hashed
          (SHA-256) version of your email address, your IP address, and event
          signals such as page views, sign-ups and subscriptions. We do not use
          Google Analytics. Our video provider <strong>Mux</strong> measures
          playback quality and watch time via <strong>Mux Data</strong>; like
          the Pixel, this runs <strong>only after you accept marketing
          cookies</strong> and sets a viewer identifier so we can count unique
          viewers. We also use <strong>PostHog</strong> (EU Cloud) for
          product analytics &mdash; measuring which steps of the sign-up
          funnel visitors reach and where they drop off. PostHog loads{" "}
          <strong>only after you accept marketing cookies</strong>, with
          autocapture disabled, session replay fully masked, and data
          processed on servers in the European Union (PostHog Cloud EU).
        </p>
      </Section>

      <Section id="manage" title="3. How to manage cookies">
        <p>
          In the EU, EEA, UK and Switzerland, marketing cookies are set{" "}
          <strong>only after you accept</strong> them in the banner. Elsewhere
          (where the law allows) they may be enabled by default &mdash; in
          either case you can <strong>turn them off at any time</strong>.
        </p>
        <p>
          You can refuse or withdraw your consent for non-essential cookies at
          any time through our cookie banner — reopen it whenever you like from
          the &ldquo;Cookie preferences&rdquo; link in the site footer.
        </p>
        <p>
          You can also delete cookies directly from your browser settings.
          Strictly-necessary cookies will be re-set on your next visit because
          the service can&rsquo;t function without them.
        </p>
      </Section>

      <Section id="changes" title="4. Changes to this policy">
        <p>
          We may update this Cookie Policy as we add or remove processors.
          The current version is dated above.
        </p>
      </Section>

      <Section id="contact" title="5. Contact">
        <p>
          Cookie questions: <strong>hello@matio.tv</strong>. See also our{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

function CookiesEs() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="que" title="1. Qué son las cookies">
        <p>
          Las cookies son pequeños archivos de texto que un sitio web guarda
          en tu dispositivo para reconocerte entre visitas. Algunas son
          imprescindibles para que el sitio funcione; otras nos ayudan a
          entender cómo llega la gente al servicio para invertir mejor el
          presupuesto de marketing.
        </p>
      </Section>

      <Section id="usamos" title="2. Cookies que utilizamos">
        <p>
          Esta lista incluye todas las cookies que el sitio coloca
          directamente o a través de nuestros encargados. Las categorías
          siguen las convenciones de ePrivacy / RGPD: las{" "}
          <strong>estrictamente necesarias</strong> no requieren
          consentimiento; las de <strong>preferencia</strong> y{" "}
          <strong>marketing</strong> sí.
        </p>

        <CookieTable
          rows={[
            {
              name: "__session, __client_uat (Clerk)",
              purpose:
                "Autenticación. Mantiene tu sesión iniciada entre páginas y permite que el servidor verifique tu identidad.",
              expiry: "Sesión y corta duración",
              category: "Estrictamente necesaria",
            },
            {
              name: "trial_session",
              purpose:
                "Controla tu vista previa gratuita de 60 segundos por serie para que no pueda reiniciarse recargando la página. Token aleatorio opaco, sin datos personales.",
              expiry: "1 año",
              category: "Estrictamente necesaria",
            },
            {
              name: "locale",
              purpose: "Recuerda tu idioma preferido (español o inglés).",
              expiry: "1 año",
              category: "Preferencia",
            },
            {
              name: "__stripe_mid, __stripe_sid (Stripe)",
              purpose:
                "Prevención de fraude en las páginas de pago de Stripe. Las coloca directamente Stripe cuando inicias el pago.",
              expiry: "Hasta 1 año",
              category: "Estrictamente necesaria",
            },
            {
              name: "attribution_first",
              purpose:
                "Primera fuente / medio / campaña UTM por la que llegaste. Sirve para atribuir las suscripciones de pago a la campaña que te dio a conocer matio originalmente.",
              expiry: "90 días",
              category: "Marketing",
            },
            {
              name: "attribution_last",
              purpose:
                "Última fuente / medio / campaña UTM. Permite cuadrar nuestra atribución con los paneles de las plataformas publicitarias.",
              expiry: "30 días",
              category: "Marketing",
            },
            {
              name: "_fbp (Meta)",
              purpose:
                "La coloca el Meta Pixel para identificar tu navegador en la medición publicitaria y atribuir conversiones a nuestras campañas de Meta. Solo se coloca tras aceptar las cookies de marketing.",
              expiry: "90 días",
              category: "Marketing",
            },
            {
              name: "_fbc / fbclid (Meta)",
              purpose:
                "Guarda el identificador de clic de Meta cuando llegas desde un anuncio de Facebook o Instagram, para vincular un registro o suscripción posterior a ese anuncio. Solo se usa tras aceptar las cookies de marketing.",
              expiry: "90 días",
              category: "Marketing",
            },
            {
              name: "muxData / mux_viewer_id (Mux)",
              purpose:
                "La coloca Mux Data (la analítica de nuestro proveedor de vídeo) para medir el tiempo de visionado, los espectadores únicos y la calidad de reproducción. Solo se usa tras aceptar las cookies de marketing.",
              expiry: "Hasta 1 año",
              category: "Marketing",
            },
            {
              name: "ph_* (PostHog)",
              purpose:
                "La coloca PostHog, nuestra herramienta de analítica de producto, para identificar tu sesión en el navegador y medir cómo los visitantes avanzan por el sitio (análisis de embudo, vistas de página, interacciones). Las sesiones también se graban con todos los campos e textos enmascarados. Solo se coloca tras aceptar las cookies de marketing.",
              expiry: "Hasta 1 año",
              category: "Marketing",
            },
          ]}
        />
        <p>
          Utilizamos el <strong>Meta Pixel</strong> y la{" "}
          <strong>API de Conversiones</strong> de Meta para medir el
          rendimiento de nuestra publicidad en Facebook e Instagram. Solo se
          activan <strong>después de que aceptes las cookies de marketing</strong>{" "}
          en el banner. Cuando están activos, comparten un conjunto limitado de
          datos con <strong>Meta Platforms Ireland Ltd</strong>: una versión
          cifrada (hash SHA-256) de tu correo electrónico, tu dirección IP y
          señales de eventos como visitas de página, registros y suscripciones.
          No utilizamos Google Analytics. Nuestro proveedor de vídeo{" "}
          <strong>Mux</strong> mide la calidad de reproducción y el tiempo de
          visionado mediante <strong>Mux Data</strong>; al igual que el Pixel,
          esto se ejecuta <strong>solo tras aceptar las cookies de
          marketing</strong> y coloca un identificador de espectador para contar
          espectadores únicos. También usamos <strong>PostHog</strong> (EU
          Cloud) para analítica de producto, midiendo qué pasos del embudo de
          registro alcanzan los visitantes y dónde abandonan. PostHog solo se
          carga <strong>tras aceptar las cookies de marketing</strong>, con la
          captura automática desactivada, las grabaciones de sesión completamente
          enmascaradas y los datos procesados en servidores de la Unión Europea
          (PostHog Cloud EU).
        </p>
      </Section>

      <Section id="gestionar" title="3. Cómo gestionar las cookies">
        <p>
          En la UE, el EEE, el Reino Unido y Suiza, las cookies de marketing se
          colocan <strong>solo después de que las aceptes</strong> en el banner.
          En otros lugares (donde la ley lo permite) pueden activarse por
          defecto; en cualquier caso, puedes{" "}
          <strong>desactivarlas en cualquier momento</strong>.
        </p>
        <p>
          Puedes rechazar o retirar tu consentimiento para las cookies no
          esenciales en cualquier momento desde nuestro banner de cookies:
          reábrelo cuando quieras desde el enlace &laquo;Preferencias de
          cookies&raquo; del pie de página.
        </p>
        <p>
          También puedes eliminar las cookies directamente desde la
          configuración del navegador. Las cookies estrictamente necesarias
          se volverán a establecer en tu próxima visita porque el servicio
          no puede funcionar sin ellas.
        </p>
      </Section>

      <Section id="cambios" title="4. Cambios en esta política">
        <p>
          Podemos actualizar esta Política de cookies a medida que añadamos
          o eliminemos encargados. La versión vigente lleva la fecha
          indicada arriba.
        </p>
      </Section>

      <Section id="contacto" title="5. Contacto">
        <p>
          Consultas sobre cookies: <strong>hello@matio.tv</strong>. Consulta
          también nuestra{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
            Política de privacidad
          </Link>{" "}
          y los{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white">
            Términos del servicio
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

function CookieTable({
  rows,
}: {
  rows: { name: string; purpose: string; expiry: string; category: string }[];
}) {
  return (
    <div className="-mx-1 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
            <th className="px-3 py-2 text-left font-semibold">Cookie</th>
            <th className="px-3 py-2 text-left font-semibold">Purpose</th>
            <th className="px-3 py-2 text-left font-semibold">Expiry</th>
            <th className="px-3 py-2 text-left font-semibold">Category</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-white/[0.05] align-top">
              <td className="px-3 py-3 font-mono text-xs text-white">{r.name}</td>
              <td className="px-3 py-3 text-white/70">{r.purpose}</td>
              <td className="px-3 py-3 text-white/70">{r.expiry}</td>
              <td className="px-3 py-3 text-white/70">{r.category}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
