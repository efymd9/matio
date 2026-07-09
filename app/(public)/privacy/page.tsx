// DRAFT pending legal-counsel review (esp. Art. 13/14 UK GDPR disclosures
// + retention periods). Controller details filled 2026-05-27 (Matvei
// Dobrovolskii, sole trader t/a Matio, UK). No DPO appointed (not required
// under Art. 37). Supervisory authorities named inline: AEPD (ES) / ICO (UK).
// Sole trader, so "business address" not "registered office".
// PostHog disclosure added 2026-05-30. Google Analytics (GA4) disclosure
// added 2026-06-24.
import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { canonicalUrl } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return {
    title: t.legal.privacyTitle,
    description: t.legal.privacyDescription,
    alternates: { canonical: canonicalUrl("/privacy") },
    robots: { index: true, follow: true },
  };
}

const LAST_UPDATED_ES = "24 de junio de 2026";
const LAST_UPDATED_EN = "June 24, 2026";

export default async function PrivacyPage() {
  const { locale, t } = await getDict();
  return (
    <main className="bg-background pt-28 pb-24 sm:pt-32">
      <article className="mx-auto max-w-3xl px-6 sm:px-8">
        <header className="mb-10 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            matio
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-cream sm:text-4xl">
            {t.legal.privacyTitle}
          </h1>
          <p className="font-mono text-[11px] text-cream/45">
            {t.legal.lastUpdated(locale === "en" ? LAST_UPDATED_EN : LAST_UPDATED_ES)}
          </p>
        </header>
        {locale === "en" ? <PrivacyEn /> : <PrivacyEs />}
        <div className="mt-12 border-t border-white/[0.06] pt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-cream/70 transition-colors hover:text-cream"
          >
            ← {t.legal.backHome}
          </Link>
        </div>
      </article>
    </main>
  );
}

function PrivacyEn() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="controller" title="1. Who we are">
        <p>
          Matvei Dobrovolskii trading as Matio, with its business address at 221 Derby Road, Nottingham, NG7 1QJ, United Kingdom,
          is the data controller for the personal data processed through{" "}
          <strong>matio.tv</strong>. You can reach us at{" "}
          <strong>hello@matio.tv</strong>. Our data-protection contact is
          the same address. We have not appointed a Data Protection Officer
          and are not required to under Article 37 UK GDPR.
        </p>
      </Section>

      <Section id="data" title="2. What we collect">
        <p>We process the following categories of personal data:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Account data</strong> — email address, name (if you give
            one), authentication tokens. Collected and stored by Clerk on our
            behalf. We also mirror a minimal user record (Clerk id, email,
            role) in our own database to power authorisation.
          </li>
          <li>
            <strong>Subscription and payment data</strong> — billing name and
            address (required for VAT calculation), payment method, invoice
            history, subscription status, period end. Collected and stored by
            Stripe on our behalf. We never see your full card number; we only
            receive a Stripe customer reference and a redacted last-four.
          </li>
          <li>
            <strong>Usage data</strong> — which episodes you watched and the
            playback position, recorded per (user, episode) so you can resume.
            For anonymous previews we record a session token, the show id, an
            expiry timestamp, and a HMAC hash of your IP (the raw IP is never
            stored).
          </li>
          <li>
            <strong>Marketing-attribution data</strong> — if you arrive from a
            campaign URL we record the source / medium / campaign in two cookies
            and may attach the snapshot to your account at checkout for revenue
            attribution. If you accept marketing cookies, we also run the Meta
            Pixel and Meta Conversions API for advertising measurement (sharing a
            hashed email address, IP address and conversion events with Meta),
            PostHog for product analytics (funnel and engagement events, masked
            session replays, processed in the EU), and Google Analytics (GA4)
            for site-traffic measurement.
            See the <Link href="/cookies" className="underline underline-offset-2 hover:text-white">Cookie Policy</Link>.
          </li>
          <li>
            <strong>Communications</strong> — emails you send us, support
            conversations, and (when wired) transactional email such as
            receipts and security notices.
          </li>
          <li>
            <strong>Technical data</strong> — IP address, browser user-agent,
            request logs needed to operate, secure and debug the service.
            Held for up to 30 days.
          </li>
        </ul>
      </Section>

      <Section id="purposes" title="3. Why we use it (lawful bases)">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>To deliver the service to you</strong> (account, playback,
            subscription billing). Lawful basis: <em>performance of the contract</em>{" "}
            you enter into when you subscribe.
          </li>
          <li>
            <strong>To meet our legal obligations</strong> (VAT/tax records,
            consumer-rights compliance, anti-fraud, replying to lawful requests
            from authorities). Lawful basis: <em>legal obligation</em>.
          </li>
          <li>
            <strong>To keep the service secure</strong> (rate-limit abuse,
            detect fraud, debug). Lawful basis: <em>legitimate interests</em> —
            operating a stable, safe service.
          </li>
          <li>
            <strong>To improve the service</strong> (aggregate analytics,
            playback-quality monitoring via Mux Data). Lawful basis:{" "}
            <em>legitimate interests</em>.
          </li>
          <li>
            <strong>Marketing and advertising measurement</strong> via the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_first</code>{" "}
            and{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_last</code>{" "}
            cookies and, where enabled, the Meta Pixel, Meta Conversions API,
            PostHog (product-analytics funnel measurement), and Google Analytics
            (site-traffic measurement).
            Lawful basis: <em>consent</em> — these run only after you accept
            marketing cookies in the banner, and stop if you withdraw consent.
          </li>
        </ul>
      </Section>

      <Section id="sharing" title="4. Who we share data with">
        <p>
          We rely on third-party processors who handle data on our instructions.
          The current subprocessor list:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Clerk Inc.</strong> (US) — authentication. EU/UK transfers
            covered by Standard Contractual Clauses (SCCs).
          </li>
          <li>
            <strong>Stripe Payments Europe Ltd</strong> (Ireland) — payments and
            billing. Stripe may transfer some data to its US affiliates under
            SCCs.
          </li>
          <li>
            <strong>Mux Inc.</strong> (US) — video transcoding, storage and
            signed playback. SCCs.
          </li>
          <li>
            <strong>Vercel Inc.</strong> (US, EU regions for compute) — hosting.
            Our application functions run in Frankfurt (eu-central-1); the CDN
            is global. SCCs.
          </li>
          <li>
            <strong>Neon Inc.</strong> (US, EU region for our database) — our
            Postgres database is hosted on AWS Frankfurt (eu-central-1). SCCs.
          </li>
          <li>
            <strong>Meta Platforms Ireland Ltd</strong> (Ireland, with
            transfers to Meta Platforms Inc. in the US) — advertising
            measurement via the Meta Pixel and Conversions API. Only engaged
            after you accept marketing cookies. We share a hashed (SHA-256)
            email address, IP address and conversion events so Meta can
            attribute and optimise our ad campaigns. US transfers covered by
            SCCs.
          </li>
          <li>
            <strong>PostHog Inc.</strong> (US, EU Cloud region for our project)
            — product analytics. Our PostHog project is hosted on PostHog&rsquo;s
            EU Cloud (servers in the European Union), so behavioral and usage
            data stays in the EU. Only engaged after you accept marketing cookies.
            We send funnel events (page views, feature interactions, sign-up
            steps) and masked session replays. SCCs cover any onward transfers to
            PostHog&rsquo;s US infrastructure.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Ireland, with transfers to
            Google LLC in the US) — site analytics via Google Analytics 4. Only
            engaged after you accept marketing cookies. We share usage and device
            data (page views, approximate location from IP, browser/device
            details) so we can measure site traffic. US transfers covered by SCCs.
          </li>
        </ul>
        <p>
          We do not sell your personal data. We may disclose information when
          required by law, to enforce these terms, or to protect rights, safety
          or property.
        </p>
      </Section>

      <Section id="transfers" title="5. International transfers">
        <p>
          Some of the processors above are established in the United States.
          Where personal data leaves the EEA / UK, we rely on the European
          Commission&rsquo;s Standard Contractual Clauses and, where relevant,
          the UK International Data Transfer Addendum. Stripe is established
          in Ireland and processes most billing data in the EU.
        </p>
      </Section>

      <Section id="retention" title="6. How long we keep it">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Account</strong>: while your account exists, plus a short
            grace period after deletion.
          </li>
          <li>
            <strong>Payment and tax records</strong>: kept for as long as
            required by tax and accounting law (typically 6–10 years depending
            on jurisdiction).
          </li>
          <li>
            <strong>Watch progress</strong>: kept while the account exists.
          </li>
          <li>
            <strong>Trial sessions</strong>: retained for 30 days for abuse
            analytics, then deleted or fully anonymised.
          </li>
          <li>
            <strong>Request and security logs</strong>: 30 days.
          </li>
        </ul>
      </Section>

      <Section id="rights" title="7. Your rights">
        <p>
          You have the right to access, rectify, erase, restrict, port and
          object to the processing of your personal data, and to withdraw any
          consent you have given (e.g. by clearing marketing cookies in the
          cookie banner). To exercise these rights, contact us at{" "}
          <strong>hello@matio.tv</strong>. We will respond within 30 days.
        </p>
        <p>
          If you believe we have not handled your data correctly, you can lodge
          a complaint with your supervisory authority. In Spain that is the
          Agencia Española de Protección de Datos (AEPD,{" "}
          <a href="https://www.aepd.es" className="underline underline-offset-2 hover:text-white">
            aepd.es
          </a>
          ). In the UK that is the Information Commissioner&rsquo;s Office
          (ICO,{" "}
          <a href="https://ico.org.uk" className="underline underline-offset-2 hover:text-white">
            ico.org.uk
          </a>
          ). Your local authority elsewhere in the EEA is equally competent.
        </p>
      </Section>

      <Section id="children" title="8. Children">
        <p>
          The service is intended for users aged 16 and over. We do not
          knowingly collect personal data from children below that age. If we
          learn we have, we will delete it.
        </p>
      </Section>

      <Section id="security" title="9. Security">
        <p>
          We take appropriate technical and organisational measures to protect
          your data: TLS everywhere, encrypted-at-rest databases, scoped
          credentials, signed playback tokens, webhook signature verification,
          and least-privilege access controls. No system is completely secure;
          if a personal-data breach is likely to affect you, we will notify
          you and the relevant authority as required by law.
        </p>
      </Section>

      <Section id="changes" title="10. Changes to this policy">
        <p>
          We may update this Privacy Policy. If a change is material we will
          give reasonable notice (typically by email and a banner on the
          service).
        </p>
      </Section>

      <Section id="contact" title="11. Contact">
        <p>
          Privacy questions: <strong>hello@matio.tv</strong>. See also our{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/cookies" className="underline underline-offset-2 hover:text-white">
            Cookie Policy
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

function PrivacyEs() {
  return (
    <div className="prose-legal space-y-8 text-[15px] leading-relaxed text-white/75">
      <Section id="responsable" title="1. Quiénes somos">
        <p>
          Matvei Dobrovolskii trading as Matio, con domicilio profesional en 221 Derby Road, Nottingham, NG7 1QJ, United Kingdom, es
          el responsable del tratamiento de los datos personales recogidos a
          través de <strong>matio.tv</strong>. Puedes contactarnos en{" "}
          <strong>hello@matio.tv</strong>. Nuestro contacto en materia de
          protección de datos es esa misma dirección. No hemos designado un
          Delegado de Protección de Datos y no estamos obligados a hacerlo
          conforme al artículo 37 del RGPD del Reino Unido.
        </p>
      </Section>

      <Section id="datos" title="2. Qué datos recogemos">
        <p>Tratamos las siguientes categorías de datos personales:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Datos de cuenta</strong>: dirección de correo electrónico,
            nombre (si lo facilitas) y tokens de autenticación. Los recoge y
            almacena Clerk por cuenta nuestra. También guardamos un registro
            mínimo (id Clerk, email, rol) en nuestra base de datos para
            gestionar la autorización.
          </li>
          <li>
            <strong>Datos de suscripción y pago</strong>: nombre y dirección de
            facturación (necesarios para el cálculo del IVA), método de pago,
            historial de facturas, estado de la suscripción y fecha de
            vencimiento del periodo. Los recoge y almacena Stripe por cuenta
            nuestra. Nunca vemos el número completo de tu tarjeta; recibimos
            sólo una referencia de cliente de Stripe y los últimos cuatro
            dígitos enmascarados.
          </li>
          <li>
            <strong>Datos de uso</strong>: qué episodios has visto y la
            posición de reproducción, registrados por (usuario, episodio) para
            reanudar. Para las vistas previas anónimas registramos un token de
            sesión, el id de la serie, una fecha de expiración y un hash HMAC
            de tu dirección IP (la IP en claro no se almacena).
          </li>
          <li>
            <strong>Datos de atribución</strong>: si llegas desde una URL de
            campaña, guardamos la fuente, el medio y el nombre de campaña en
            dos cookies y podemos vincular la instantánea a tu cuenta al pagar
            para atribución de ingresos. Si aceptas las cookies de marketing,
            además usamos el Meta Pixel y la API de Conversiones de Meta para
            medición publicitaria (compartiendo un correo electrónico cifrado,
            dirección IP y eventos de conversión con Meta), PostHog para
            analítica de producto (eventos de embudo y de uso, grabaciones de
            sesión enmascaradas, procesados en la UE) y Google Analytics (GA4)
            para medir el tráfico del sitio. Consulta la{" "}
            <Link href="/cookies" className="underline underline-offset-2 hover:text-white">
              Política de cookies
            </Link>
            .
          </li>
          <li>
            <strong>Comunicaciones</strong>: los correos que nos envías,
            conversaciones de soporte y correos transaccionales (recibos,
            avisos de seguridad) cuando estén activados.
          </li>
          <li>
            <strong>Datos técnicos</strong>: dirección IP, agente del navegador
            y registros de petición necesarios para operar, asegurar y depurar
            el servicio. Se conservan hasta 30 días.
          </li>
        </ul>
      </Section>

      <Section id="finalidades" title="3. Para qué los usamos (bases jurídicas)">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Para prestarte el servicio</strong> (cuenta, reproducción,
            facturación). Base jurídica: <em>ejecución del contrato</em> que
            celebras al suscribirte.
          </li>
          <li>
            <strong>Para cumplir obligaciones legales</strong> (registros
            fiscales/IVA, derechos del consumidor, prevención del fraude,
            respuesta a requerimientos de autoridades). Base jurídica:{" "}
            <em>obligación legal</em>.
          </li>
          <li>
            <strong>Para mantener el servicio seguro</strong> (limitar abusos,
            detectar fraude, depurar). Base jurídica: <em>interés legítimo</em>{" "}
            de operar un servicio estable y seguro.
          </li>
          <li>
            <strong>Para mejorar el servicio</strong> (analítica agregada,
            monitorización de calidad de reproducción con Mux Data). Base
            jurídica: <em>interés legítimo</em>.
          </li>
          <li>
            <strong>Marketing y medición publicitaria</strong> mediante las
            cookies{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_first</code>{" "}
            y{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">attribution_last</code>{" "}
            y, cuando está activado, el Meta Pixel, la API de Conversiones de
            Meta, PostHog (analítica de embudo de producto) y Google Analytics
            (medición del tráfico del sitio).
            Base jurídica: <em>consentimiento</em>: solo se ejecutan tras
            aceptar las cookies de marketing en el banner y se detienen si
            retiras el consentimiento.
          </li>
        </ul>
      </Section>

      <Section id="encargados" title="4. Con quién compartimos datos">
        <p>
          Nos apoyamos en encargados del tratamiento que procesan datos
          siguiendo nuestras instrucciones:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Clerk Inc.</strong> (EE. UU.) — autenticación.
            Transferencias UE/UK amparadas por las Cláusulas Contractuales Tipo
            (CCT).
          </li>
          <li>
            <strong>Stripe Payments Europe Ltd</strong> (Irlanda) — pagos y
            facturación. Puede transferir datos a sus filiales en EE. UU. bajo
            CCT.
          </li>
          <li>
            <strong>Mux Inc.</strong> (EE. UU.) — transcodificación,
            almacenamiento y reproducción firmada de vídeo. CCT.
          </li>
          <li>
            <strong>Vercel Inc.</strong> (EE. UU., regiones europeas para
            cómputo) — hosting. Las funciones de la aplicación se ejecutan en
            Fráncfort (eu-central-1); la CDN es global. CCT.
          </li>
          <li>
            <strong>Neon Inc.</strong> (EE. UU., región europea para nuestra
            base de datos) — Postgres alojado en AWS Fráncfort (eu-central-1).
            CCT.
          </li>
          <li>
            <strong>Meta Platforms Ireland Ltd</strong> (Irlanda, con
            transferencias a Meta Platforms Inc. en EE. UU.) — medición
            publicitaria mediante el Meta Pixel y la API de Conversiones. Solo
            se utiliza tras aceptar las cookies de marketing. Compartimos un
            correo electrónico cifrado (hash SHA-256), la dirección IP y eventos
            de conversión para que Meta pueda atribuir y optimizar nuestras
            campañas. Transferencias a EE. UU. amparadas por CCT.
          </li>
          <li>
            <strong>PostHog Inc.</strong> (EE. UU., región EU Cloud para
            nuestro proyecto) — analítica de producto. Nuestro proyecto de
            PostHog está alojado en PostHog Cloud EU (servidores en la Unión
            Europea), por lo que los datos de comportamiento y uso permanecen
            en la UE. Solo se utiliza tras aceptar las cookies de marketing.
            Enviamos eventos de embudo (visitas de página, interacciones,
            pasos del registro) y grabaciones de sesión enmascaradas.
            Las CCT cubren cualquier transferencia posterior a la infraestructura
            de EE. UU. de PostHog.
          </li>
          <li>
            <strong>Google Ireland Ltd</strong> (Irlanda, con transferencias a
            Google LLC en EE. UU.) — analítica del sitio mediante Google
            Analytics 4. Solo se utiliza tras aceptar las cookies de marketing.
            Compartimos datos de uso y de dispositivo (visitas de página,
            ubicación aproximada por IP, detalles de navegador/dispositivo) para
            medir el tráfico del sitio. Transferencias a EE. UU. amparadas por CCT.
          </li>
        </ul>
        <p>
          No vendemos tus datos personales. Podemos divulgarlos cuando la ley
          lo exija, para hacer cumplir estos términos o para proteger
          derechos, seguridad o bienes.
        </p>
      </Section>

      <Section id="transferencias" title="5. Transferencias internacionales">
        <p>
          Algunos encargados están establecidos en EE. UU. Cuando los datos
          salen del EEE / Reino Unido, nos apoyamos en las Cláusulas
          Contractuales Tipo de la Comisión Europea y, cuando proceda, en el
          Adenda Internacional de Transferencia de Datos del Reino Unido.
          Stripe está establecido en Irlanda y procesa la mayor parte de los
          datos de facturación en la UE.
        </p>
      </Section>

      <Section id="conservacion" title="6. Cuánto los conservamos">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Cuenta</strong>: mientras tu cuenta exista, más un breve
            periodo de gracia tras su eliminación.
          </li>
          <li>
            <strong>Registros de pago y fiscales</strong>: durante el tiempo
            que exija la normativa fiscal y contable (habitualmente 6–10 años
            según la jurisdicción).
          </li>
          <li>
            <strong>Progreso de reproducción</strong>: mientras la cuenta
            exista.
          </li>
          <li>
            <strong>Sesiones de prueba</strong>: 30 días para analítica de
            abuso, luego se eliminan o anonimizan por completo.
          </li>
          <li>
            <strong>Registros de petición y seguridad</strong>: 30 días.
          </li>
        </ul>
      </Section>

      <Section id="derechos" title="7. Tus derechos">
        <p>
          Tienes derecho de acceso, rectificación, supresión, limitación,
          portabilidad y oposición al tratamiento de tus datos personales, así
          como a retirar el consentimiento que hubieras prestado (por ejemplo
          rechazando las cookies de marketing en el banner). Para ejercerlos,
          escríbenos a <strong>hello@matio.tv</strong>. Responderemos en un
          plazo de 30 días.
        </p>
        <p>
          Si consideras que no hemos tratado tus datos correctamente, puedes
          presentar una reclamación ante tu autoridad de control. En España es
          la Agencia Española de Protección de Datos (AEPD,{" "}
          <a href="https://www.aepd.es" className="underline underline-offset-2 hover:text-white">
            aepd.es
          </a>
          ). En Reino Unido es la Information Commissioner&rsquo;s Office
          (ICO,{" "}
          <a href="https://ico.org.uk" className="underline underline-offset-2 hover:text-white">
            ico.org.uk
          </a>
          ). En el resto del EEE, tu autoridad local es igualmente competente.
        </p>
      </Section>

      <Section id="menores" title="8. Menores">
        <p>
          El servicio está destinado a usuarios de 16 años o más. No recogemos
          conscientemente datos personales de menores. Si tenemos conocimiento
          de ello, los eliminaremos.
        </p>
      </Section>

      <Section id="seguridad" title="9. Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas apropiadas: TLS en todas
          las conexiones, cifrado en reposo, credenciales acotadas, tokens de
          reproducción firmados, verificación de firma en los webhooks y
          control de acceso de mínimo privilegio. Ningún sistema es totalmente
          seguro; si una violación de datos personales pudiera afectarte, te
          lo notificaremos junto con la autoridad competente, conforme exige
          la ley.
        </p>
      </Section>

      <Section id="cambios" title="10. Cambios en esta política">
        <p>
          Podemos actualizar esta Política de privacidad. Si un cambio es
          sustancial te avisaremos con un plazo razonable (normalmente por
          correo electrónico y mediante un aviso en el servicio).
        </p>
      </Section>

      <Section id="contacto" title="11. Contacto">
        <p>
          Consultas de privacidad: <strong>hello@matio.tv</strong>. Consulta
          también nuestros{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-white">
            Términos del servicio
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
