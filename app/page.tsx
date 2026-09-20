import { FaqSection } from "@/components/landing/faq-section";
import { FinalCta } from "@/components/landing/final-cta";
import { FlowSection } from "@/components/landing/flow-section";
import { HeroSection } from "@/components/landing/hero-section";
import { OwnershipSection } from "@/components/landing/ownership-section";
import { PrivacySection } from "@/components/landing/privacy-section";
import { ProductSection } from "@/components/landing/product-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { Reveal } from "@/components/landing/reveal";
import { TrustRail } from "@/components/landing/trust-rail";
import { landingPageStructuredData } from "@/components/landing/content";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(landingPageStructuredData) }}
      />
      <div className="site-shell">
        {/* First tab stop on the page. The header is a fixed grid of links, so
            without this a keyboard user walks the whole nav on every visit. */}
        <a className="skip-link" href="#top">Skip to content</a>
        <SiteHeader />
        <main id="top">
          <HeroSection />
          <TrustRail />
          <Reveal>
            <ProductSection />
          </Reveal>
          <Reveal>
            <FlowSection />
          </Reveal>
          <Reveal>
            <OwnershipSection />
          </Reveal>
          <Reveal>
            <PrivacySection />
          </Reveal>
          <Reveal>
            <PricingSection />
          </Reveal>
          <Reveal>
            <FaqSection />
          </Reveal>
          <Reveal>
            <FinalCta />
          </Reveal>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
