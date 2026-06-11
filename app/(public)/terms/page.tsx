// DRAFT pending legal-counsel review. Trading party + contact details
// filled 2026-05-27 (Matvei Dobrovolskii, sole trader t/a Matio, England
// & Wales). The Stripe Checkout consent_collection.terms_of_service flow
// (digital-content waiver, §6) is wired in app/subscribe/actions.ts.
import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.termsTitle,
    alternates: { canonical: canonicalUrl("/terms") },
    robots: { index: true, follow: true },
  };
}

const LAST_UPDATED_ES = "27 de mayo de 2026";
const LAST_UPDATED_EN = "May 27, 2026";

export default async function TermsPage() {
  const { locale, t } = await getDict();
  return (
    <main className="bg-background pt-28 pb-24 sm:pt-32">
      <article className="mx-auto max-w-3xl px-6 sm:px-8">
        <header className="mb-10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            matio
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {t.legal.termsTitle}
          </h1>
          <p className="font-mono text-[11px] text-white/45">
            {t.legal.lastUpdated(locale === "en" ? LAST_UPDATED_EN : LAST_UPDATED_ES)}
          </p>
        </header>
        {locale === "en" ? <TermsEn /> : <TermsEs />}
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

function TermsEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="acceptance" title="1. Acceptance of these terms">
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) form a binding agreement
          between you and Matvei Dobrovolskii trading as Matio (&ldquo;matio&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;), with a business address at 221 Derby Road, Nottingham, NG7 1QJ, United Kingdom. By creating an account
          or paying for a subscription, you confirm you have read, understood and
          accept these Terms. If you do not accept them, do not use the service.
        </p>
        <p>
          You must be at least 16 years old to create an account. If you are
          younger, a parent or legal guardian must agree on your behalf.
        </p>
      </Section>

      <Section id="service" title="2. The service">
        <p>
          matio is a subscription video streaming service offering original
          short-form content (&ldquo;Content&rdquo;) at <strong>matio.tv</strong> and
          successor domains. Access is provided over the public internet on
          supported browsers and devices. We may add, change or remove Content
          at any time at our editorial discretion.
        </p>
      </Section>

      <Section id="account" title="3. Your account">
        <p>
          We use Clerk to handle sign-up and sign-in. You are responsible for
          keeping your sign-in credentials confidential and for everything that
          happens under your account. Notify us immediately if you suspect
          unauthorised use.
        </p>
      </Section>

      <Section id="trial" title="4. Free preview">
        <p>
          Each show offers a free 60-second preview per browser session, with no
          account required. We use a HTTP-only cookie and an HMAC-hashed IP
          address to limit previews to three per network per hour, to prevent
          the preview becoming a substitute for the paid service. The preview is
          a marketing courtesy and may be removed or changed without notice.
        </p>
      </Section>

      <Section id="subscription" title="5. Subscription, price and renewal">
        <p>
          Your membership begins with a 3-day trial for <strong>USD $1</strong>,
          charged today. After the trial it costs <strong>USD $38 per
          month</strong>, billed automatically from day 3, plus any VAT, sales
          tax or other indirect tax that applies in your billing country
          (calculated automatically by Stripe Tax at checkout). The subscription
          then renews monthly until cancelled. Cancel before the trial ends to
          avoid the $38 charge.
        </p>
        <p>
          You can cancel at any time from the Stripe Customer Portal — accessible
          from the &ldquo;Manage subscription&rdquo; menu — and your cancellation
          takes effect at the end of the current paid period. We do not refund
          partial months. If a payment fails we retry it, and access may be
          paused or cancelled if the issue is not resolved.
        </p>
        <p>
          We may change the price or the plan structure. We will give you at
          least 30 days&rsquo; advance notice by email, and any change applies
          from the next renewal — you can cancel before then if you do not
          accept the new terms.
        </p>
      </Section>

      <Section id="withdrawal" title="6. Digital content — right of withdrawal">
        <p>
          The matio service is digital content supplied immediately upon
          subscription. By subscribing, <strong>you expressly request that we
          begin supply immediately and you acknowledge that you lose your
          14-day statutory right of withdrawal once playback begins</strong>{" "}
          (Article 16(m) of EU Directive 2011/83/EU and equivalent UK
          regulations). If you are an EU or UK consumer, you must tick the
          consent box at checkout to confirm this; without that consent, the
          subscription cannot start.
        </p>
      </Section>

      <Section id="licence" title="7. Licence and acceptable use">
        <p>
          As long as your subscription is active, we grant you a personal,
          non-transferable, non-exclusive, revocable licence to stream Content
          on your devices for private, non-commercial use.
        </p>
        <p>You agree not to:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>download, copy, screen-record, transcode, scrape or distribute Content;</li>
          <li>defeat or attempt to defeat any access control, watermark, token or technical protection;</li>
          <li>share your account, password or session with anyone;</li>
          <li>use the service to operate any commercial broadcast or public performance;</li>
          <li>use bots, automated tools or load-testing against the service.</li>
        </ul>
        <p>
          We may suspend or terminate access if we reasonably believe you have
          breached these Terms.
        </p>
      </Section>

      <Section id="content-ip" title="8. Intellectual property">
        <p>
          All Content, software, design, trademarks and other material on the
          service are owned by matio or our licensors and protected by copyright
          and other intellectual-property laws. Nothing in these Terms transfers
          any of those rights to you.
        </p>
      </Section>

      <Section id="payments" title="9. Payments and Stripe">
        <p>
          Payments are processed by Stripe Payments Europe Ltd and its
          affiliates. By subscribing you also accept Stripe&rsquo;s applicable
          payer terms. We do not see or store your full payment-card details.
        </p>
      </Section>

      <Section id="warranty" title="10. Disclaimer of warranties">
        <p>
          The service is provided <em>as is</em> and <em>as available</em>. To
          the maximum extent permitted by law, we disclaim implied warranties of
          merchantability, fitness for a particular purpose and non-infringement.
          We do not promise uninterrupted availability, that any specific
          Content will remain available, or that the service will be free of
          defects or errors. Nothing in these Terms limits any rights you have
          as a consumer that cannot be limited or excluded by applicable law.
        </p>
      </Section>

      <Section id="liability" title="11. Limitation of liability">
        <p>
          To the maximum extent permitted by law, our total aggregate liability
          arising out of or related to these Terms or the service is limited to
          the greater of (a) the amount you paid us in the 12 months before the
          event that gave rise to the claim, or (b) USD $100. We are not liable
          for indirect, incidental, consequential or punitive damages, loss of
          profits, loss of data, or loss of business opportunity. None of this
          excludes liability for death, personal injury caused by negligence,
          fraud, or any other liability that cannot be excluded under
          applicable law.
        </p>
      </Section>

      <Section id="termination" title="12. Termination">
        <p>
          You can stop using the service at any time. We may suspend or
          terminate your access if you breach these Terms, or for legal,
          regulatory or operational reasons. On termination, sections 7
          (Licence), 8 (IP), 10 (Disclaimer), 11 (Liability), 13 (Governing law)
          and any others that should reasonably survive will continue to apply.
        </p>
      </Section>

      <Section id="law" title="13. Governing law and disputes">
        <p>
          These Terms are governed by the laws of England and Wales. The courts of
          England and Wales have exclusive jurisdiction over disputes, except that
          consumers may rely on mandatory protections of the law of their
          habitual residence. You can also use the European Commission&rsquo;s
          online dispute-resolution platform at{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            className="underline underline-offset-2 hover:text-white"
          >
            ec.europa.eu/consumers/odr
          </a>
          .
        </p>
      </Section>

      <Section id="changes" title="14. Changes to these terms">
        <p>
          We may update these Terms. If a change is material we will give
          reasonable notice (typically by email and a banner on the service).
          Continued use after a change takes effect counts as acceptance.
        </p>
      </Section>

      <Section id="contact" title="15. Contact">
        <p>
          Questions about these Terms or the service: <strong>hello@matio.tv</strong>.
          See also the <Link href="/privacy" className="underline underline-offset-2 hover:text-white">Privacy Policy</Link>{" "}
          and{" "}
          <Link href="/cookies" className="underline underline-offset-2 hover:text-white">Cookie Policy</Link>.
        </p>
      </Section>
    </div>
  );
}

function TermsEs() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="aceptacion" title="1. Aceptación de estos términos">
        <p>
          Estos Términos del servicio (los &laquo;Términos&raquo;) constituyen un
          contrato vinculante entre tú y Matvei Dobrovolskii trading as Matio (&laquo;matio&raquo;,
          &laquo;nosotros&raquo;), con domicilio en 221 Derby Road, Nottingham, NG7 1QJ, United Kingdom. Al crear
          una cuenta o pagar una suscripción, confirmas que has leído,
          comprendido y aceptado estos Términos. Si no los aceptas, no utilices
          el servicio.
        </p>
        <p>
          Debes tener al menos 16 años para crear una cuenta. Si eres menor, un
          padre, madre o tutor legal debe aceptar en tu nombre.
        </p>
      </Section>

      <Section id="servicio" title="2. El servicio">
        <p>
          matio es un servicio de streaming de vídeo por suscripción que ofrece
          contenido original de formato corto (el &laquo;Contenido&raquo;) en{" "}
          <strong>matio.tv</strong> y dominios sucesores. El acceso se presta a
          través de internet en navegadores y dispositivos compatibles. Podemos
          añadir, modificar o eliminar Contenido en cualquier momento a nuestra
          discreción editorial.
        </p>
      </Section>

      <Section id="cuenta" title="3. Tu cuenta">
        <p>
          Utilizamos Clerk para gestionar el registro y el inicio de sesión.
          Eres responsable de mantener la confidencialidad de tus credenciales y
          de todo lo que ocurra en tu cuenta. Avísanos de inmediato si sospechas
          un uso no autorizado.
        </p>
      </Section>

      <Section id="vista-previa" title="4. Vista previa gratuita">
        <p>
          Cada serie ofrece una vista previa gratuita de 60 segundos por sesión
          de navegador, sin necesidad de cuenta. Usamos una cookie HTTP-only y
          un hash HMAC de tu dirección IP para limitar las vistas previas a
          tres por red y hora, evitando que se conviertan en un sustituto del
          servicio de pago. La vista previa es una cortesía comercial y puede
          modificarse o eliminarse sin previo aviso.
        </p>
      </Section>

      <Section id="suscripcion" title="5. Suscripción, precio y renovación">
        <p>
          Tu membresía empieza con una prueba de 3 días por{" "}
          <strong>1 USD</strong>, que se cobra hoy. Pasada la prueba, cuesta{" "}
          <strong>38 USD al mes</strong>, con cargo automático a partir del día
          3, más el IVA, impuesto sobre ventas u otro tributo indirecto
          aplicable en tu país de facturación (calculado automáticamente por
          Stripe Tax al pagar). Después la suscripción se renueva mensualmente
          hasta que se cancele. Cancela antes de que termine la prueba para
          evitar el cargo de 38 USD.
        </p>
        <p>
          Puedes cancelar en cualquier momento desde el Portal del Cliente de
          Stripe — accesible a través del menú &laquo;Gestionar
          suscripción&raquo; — y la cancelación surtirá efecto al final del
          periodo facturado en curso. No reembolsamos meses parciales. Si un
          pago falla, lo reintentamos; el acceso puede suspenderse o cancelarse
          si la incidencia no se resuelve.
        </p>
        <p>
          Podemos modificar el precio o la estructura del plan. Te avisaremos
          por correo electrónico con al menos 30 días de antelación y el cambio
          se aplicará a partir de la siguiente renovación: puedes cancelar antes
          si no aceptas las nuevas condiciones.
        </p>
      </Section>

      <Section id="desistimiento" title="6. Contenido digital — derecho de desistimiento">
        <p>
          El servicio matio es contenido digital que se entrega de forma
          inmediata al contratar la suscripción. Al suscribirte{" "}
          <strong>solicitas expresamente que iniciemos el suministro de
          inmediato y reconoces que pierdes tu derecho legal de desistimiento
          de 14 días en cuanto comienza la reproducción</strong>{" "}
          (artículo 16.m de la Directiva 2011/83/UE y normativa española y
          europea equivalente). Si eres consumidor en la UE o el Reino Unido,
          debes marcar la casilla de consentimiento en el pago para
          confirmarlo; sin ese consentimiento, la suscripción no puede
          iniciarse.
        </p>
      </Section>

      <Section id="licencia" title="7. Licencia y uso aceptable">
        <p>
          Mientras tu suscripción esté activa, te concedemos una licencia
          personal, intransferible, no exclusiva y revocable para reproducir el
          Contenido en tus dispositivos con fines privados y no comerciales.
        </p>
        <p>Te comprometes a no:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>descargar, copiar, grabar la pantalla, transcodificar, recopilar o redistribuir el Contenido;</li>
          <li>eludir o intentar eludir cualquier control de acceso, marca de agua, token o protección técnica;</li>
          <li>compartir tu cuenta, contraseña o sesión con nadie;</li>
          <li>utilizar el servicio para emisiones comerciales o representaciones públicas;</li>
          <li>utilizar bots, herramientas automatizadas o pruebas de carga contra el servicio.</li>
        </ul>
        <p>
          Podemos suspender o cancelar el acceso si tenemos motivos razonables
          para creer que has incumplido estos Términos.
        </p>
      </Section>

      <Section id="propiedad" title="8. Propiedad intelectual">
        <p>
          Todo el Contenido, software, diseño, marcas y demás material del
          servicio son propiedad de matio o de nuestros licenciantes y están
          protegidos por la legislación de propiedad intelectual. Nada en
          estos Términos transfiere esos derechos.
        </p>
      </Section>

      <Section id="pagos" title="9. Pagos y Stripe">
        <p>
          Los pagos los procesa Stripe Payments Europe Ltd y sus afiliadas. Al
          suscribirte aceptas también los términos aplicables de Stripe. No
          vemos ni almacenamos los datos completos de tu tarjeta de pago.
        </p>
      </Section>

      <Section id="garantia" title="10. Exención de garantías">
        <p>
          El servicio se presta <em>tal cual</em> y <em>según disponibilidad</em>.
          En la máxima medida permitida por la ley, declinamos las garantías
          implícitas de comerciabilidad, idoneidad para un fin concreto y no
          infracción. No prometemos disponibilidad ininterrumpida, ni que un
          Contenido específico permanezca disponible, ni que el servicio esté
          libre de defectos o errores. Nada en estos Términos limita los
          derechos del consumidor que no pueden limitarse o excluirse según la
          legislación aplicable.
        </p>
      </Section>

      <Section id="responsabilidad" title="11. Limitación de responsabilidad">
        <p>
          En la máxima medida permitida por la ley, nuestra responsabilidad
          total agregada derivada de o relacionada con estos Términos o con el
          servicio se limita a la cantidad mayor entre (a) lo que nos hayas
          pagado en los 12 meses anteriores al hecho que dio lugar a la
          reclamación, o (b) 100 USD. No respondemos por daños indirectos,
          incidentales, consecuenciales o punitivos, lucro cesante, pérdida de
          datos o de oportunidades de negocio. Nada de esto excluye la
          responsabilidad por fallecimiento, lesiones personales por
          negligencia, dolo, ni cualquier otra responsabilidad que la ley no
          permita excluir.
        </p>
      </Section>

      <Section id="terminacion" title="12. Terminación">
        <p>
          Puedes dejar de usar el servicio en cualquier momento. Podemos
          suspender o cancelar tu acceso si incumples estos Términos o por
          motivos legales, regulatorios u operativos. Tras la terminación,
          permanecerán vigentes las secciones 7 (Licencia), 8 (Propiedad
          intelectual), 10 (Exención de garantías), 11 (Responsabilidad), 13
          (Legislación aplicable) y cualquier otra que deba sobrevivir
          razonablemente.
        </p>
      </Section>

      <Section id="ley" title="13. Legislación aplicable y resolución de litigios">
        <p>
          Estos Términos se rigen por la legislación de England and Wales. Los
          tribunales de England and Wales tienen jurisdicción exclusiva sobre los
          litigios, salvo que el consumidor pueda invocar protecciones
          imperativas de la ley de su residencia habitual. También puedes
          recurrir a la plataforma europea de resolución de litigios en línea
          en{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            className="underline underline-offset-2 hover:text-white"
          >
            ec.europa.eu/consumers/odr
          </a>
          .
        </p>
      </Section>

      <Section id="cambios" title="14. Cambios en estos términos">
        <p>
          Podemos actualizar estos Términos. Si un cambio es sustancial te
          avisaremos con un plazo razonable (normalmente por correo electrónico
          y mediante un aviso en el servicio). El uso continuado tras la
          entrada en vigor del cambio constituye aceptación.
        </p>
      </Section>

      <Section id="contacto" title="15. Contacto">
        <p>
          Para cualquier consulta sobre estos Términos o el servicio:{" "}
          <strong>hello@matio.tv</strong>. Consulta también la{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-white">
            Política de privacidad
          </Link>{" "}
          y la{" "}
          <Link href="/cookies" className="underline underline-offset-2 hover:text-white">
            Política de cookies
          </Link>
          .
        </p>
      </Section>
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
