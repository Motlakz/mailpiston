import { FaqSection } from "@/components/landing/faq-section";
import { FinalCta } from "@/components/landing/final-cta";
import { FlowSection } from "@/components/landing/flow-section";
import { HeroSection } from "@/components/landing/hero-section";
import { OwnershipSection } from "@/components/landing/ownership-section";
import { PrivacySection } from "@/components/landing/privacy-section";
import { ProductSection } from "@/components/landing/product-section";
import { PricingSection } from "@/components/landing/pricing-section";
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
        <SiteHeader />
        <main id="top">
          <HeroSection />
          <TrustRail />
          <ProductSection />
          <FlowSection />
          <OwnershipSection />
          <PrivacySection />
          <PricingSection />
          <FaqSection />
          <FinalCta />
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
