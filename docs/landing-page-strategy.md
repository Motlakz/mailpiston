# Landing page strategy

Last updated: 2026-09-05

## Objective

Explain MailPiston's ownership boundary in one screen, make the receive/route/reply model tangible, and preserve optional commercial packaging without pretending the private build is already a public product.

## Core message

**Own the inbox. Offload the mail server.**

MailPiston owns the identities, routes, policies, messages, threads, and application experience. A specialist provider operates SMTP, MX receiving, deliverability, reputation, and abuse systems.

The page deliberately positions infrastructure providers as complements. It does not claim MailPiston replaces their networks or reproduce their licensed implementations.

## Conversion strategy

The current page has one primary journey: understand the system.

1. The hero names the category boundary and links to the interactive mail flow.
2. The benefits translate architecture into operator outcomes.
3. The receive/route/reply prototype makes the workflow concrete.
4. The ownership comparison resolves the build-versus-buy objection.
5. The privacy section answers the personal-inbox reply question.
6. The access model signals future packaging without presenting a live checkout.
7. The FAQ handles the remaining high-intent objections.

There is intentionally no fake waitlist, contact form, customer count, testimonial, or checkout. A real lead-capture CTA should be added only when a destination and follow-up workflow exist. When added, minimize the number of fields; Baymard's form research indicates field count has a stronger usability impact than the raw number of steps.

## SEO implementation

- A unique, descriptive title and meta description state the product category and primary value.
- The page uses one descriptive H1 and a semantic heading hierarchy.
- Important product language appears in visible copy instead of being hidden in metadata.
- `WebApplication` structured data describes the product and its self-hosted tier truthfully, with no fabricated rating or review.
- A generated social sharing image and SVG application icon establish a consistent search and share presentation.
- `metadataBase` defaults to `https://mailpiston.com`, the production origin today, and the page declares a canonical URL. `NEXT_PUBLIC_SITE_URL` overrides both so a preview deploy does not claim the production origin as its canonical.
- When `mailpiston.com` is registered it becomes the origin. Set `NEXT_PUBLIC_SITE_URL`, keep a 301 from the Vercel subdomain, and follow roadmap §5.9 — the app origin is also baked into every provider alias, so it is a migration rather than a DNS change.
- `sitemap.ts` and `robots.ts` are not written yet. One public page makes them close to a formality, but they should land before the domain is submitted anywhere.

Google's guidance favors helpful, people-first content and clear, concise titles. Search snippets are commonly drawn from page content or the meta description, so both were written to stand on their own.

## Performance and accessibility

- The page's main visual is HTML and CSS instead of a large hero image.
- Only the flow prototype and pricing-period preview are client components.
- Animation respects `prefers-reduced-motion` in CSS and Framer Motion.
- Tabs use tab roles and state; FAQs use native `details` and `summary` controls.
- Contrast is anchored by deep ink text on warm ivory, with pale colors used for surfaces and accents rather than body copy.

The performance target should be the current Core Web Vitals thresholds at the 75th percentile: LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1.

## Pricing hypothesis

The page labels pricing as indicative because public access and billing do not exist yet.

- **Owner build:** $0 MailPiston product fee; bring and pay the supported transport provider directly.
- **Hosted access:** planning anchor of $15 monthly or $12 monthly when billed annually ($144/year).
- **Managed setup:** optional and unpriced until there is evidence of demand.
- **High provider, storage, or volume costs:** transparent pass-through or disclosed usage pricing.

This is intentionally a learning hypothesis, not a final price. The $15 anchor puts a future managed control plane close to entry-level developer email infrastructure rather than in the ultra-low-price support trap. Current comparison points include Postmark's $15/month Basic entry point and Resend's $20/month Pro entry point; Forward Email remains a low-cost transport/input to the owner-operated model rather than something MailPiston tries to mark up invisibly.

Before enabling checkout, validate willingness to pay with 5–10 qualified operators and model provider, storage, support, and payment costs under realistic usage.

## Visual system

- **Ink:** `#10191c` - authority, contrast, infrastructure.
- **Warm ivory:** `#f8f4ea` / `#fffdf7` - editorial warmth and breathing room.
- **Coral orange:** `#f26b3a` - piston energy, action, and the primary brand accent.
- **Pale blue:** `#bfe1ee` - trust, transport, and calm technical surfaces.
- **Soft pink:** `#f1b5bb` - atmospheric warmth and private-identity accents.

Coral and pale blue form the recognizable primary pair. Soft pink is intentionally secondary so the page stays full but not cluttered. Editorial serif headings use Iowan Old Style/Palatino/Georgia fallbacks; interface text uses Arial Nova/Arial fallbacks.

## Research sources

- Google Search Central, [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- Google Search Central, [Software app structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- web.dev, [Core Web Vitals](https://web.dev/articles/vitals)
- web.dev, [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- W3C, [Using `prefers-reduced-motion`](https://www.w3.org/WAI/WCAG21/Techniques/css/C39.html)
- Baymard Institute, [Checkout flow and form fields](https://baymard.com/blog/checkout-flow-average-form-fields)
- Postmark, [Pricing](https://postmarkapp.com/pricing)
- Resend, [Pricing explanation](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
