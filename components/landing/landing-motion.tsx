"use client";

import { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

export function LandingMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) return;

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from(".site-header", { autoAlpha: 0, y: -24, duration: 0.75 })
        .from(".hero-title__line", { yPercent: 112, rotate: 1.5, duration: 1.05, stagger: 0.11 }, "-=0.42")
        .from(".hero-reveal", { autoAlpha: 0, y: 18, duration: 0.72, stagger: 0.09 }, "-=0.72")
        .from(".hero-visual", { autoAlpha: 0, x: 65, rotateY: -7, scale: 0.94, duration: 1.25 }, "-=1.02")
        .from(".hero-title__packet", { scaleX: 0, transformOrigin: "center", duration: 0.65 }, "-=0.88");

      gsap.to(".hero-visual", {
        yPercent: -7,
        ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1.1 },
      });

      gsap.to(".hero-thread--one", {
        xPercent: 36,
        yPercent: -18,
        rotate: 12,
        ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 1.3 },
      });

      gsap.fromTo(
        ".scroll-word",
        { opacity: 0.12, y: 12 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.08,
          ease: "none",
          scrollTrigger: { trigger: ".scroll-statement", start: "top 82%", end: "bottom 48%", scrub: 0.7 },
        },
      );

      gsap.utils.toArray<HTMLElement>("[data-motion-section] .section-heading, [data-motion-section] .section-kicker, [data-motion-section] .privacy-copy, [data-motion-section] .faq-intro").forEach((heading) => {
        gsap.from(heading, {
          autoAlpha: 0,
          y: 44,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: heading, start: "top 84%", once: true },
        });
      });

      ScrollTrigger.batch(".benefit-card", {
        start: "top 86%",
        once: true,
        onEnter: (cards) => gsap.from(cards, {
          autoAlpha: 0,
          y: 64,
          rotate: (index) => (index % 2 === 0 ? -1.5 : 1.5),
          scale: 0.96,
          duration: 0.85,
          stagger: 0.11,
          ease: "power3.out",
        }),
      });

      const desktop = gsap.matchMedia();
      desktop.add("(min-width: 901px)", () => {
        gsap.from(".boundary-column", {
          y: (index) => 55 + index * 45,
          autoAlpha: 0,
          duration: 0.95,
          stagger: 0.18,
          ease: "power3.out",
          scrollTrigger: { trigger: ".boundary-board", start: "top 76%", once: true },
        });
      });

      const hashFrame = window.requestAnimationFrame(() => {
        ScrollTrigger.refresh();
        if (window.location.hash) {
          document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "auto" });
        }
      });

      return () => {
        window.cancelAnimationFrame(hashFrame);
        desktop.revert();
      };
    },
    { scope: root },
  );

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const onPointerMove = (event: PointerEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(".spotlight-card");
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      target.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
      target.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
    };

    const hero = scope.querySelector<HTMLElement>(".hero");
    const visual = scope.querySelector<HTMLElement>(".hero-visual");
    const onHeroMove = (event: PointerEvent) => {
      if (!hero || !visual || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const bounds = hero.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      gsap.to(visual, { rotateY: x * 3.5, rotateX: y * -2.5, duration: 0.8, ease: "power3.out" });
    };

    scope.addEventListener("pointermove", onPointerMove);
    hero?.addEventListener("pointermove", onHeroMove);
    return () => {
      scope.removeEventListener("pointermove", onPointerMove);
      hero?.removeEventListener("pointermove", onHeroMove);
    };
  }, []);

  return <div className="site-shell landing-v2" ref={root}>{children}</div>;
}
