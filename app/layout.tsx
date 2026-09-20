import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";

import { SIDEBAR_INIT_SCRIPT } from "@/components/layout/sidebar";
import { THEME_INIT_SCRIPT } from "@/components/site/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  // Production origin today is the Vercel subdomain; mailpiston.com replaces it
  // once the apex is registered. Override with NEXT_PUBLIC_SITE_URL rather than
  // editing this default, so a preview deploy resolves its own origin.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://mailpiston.com"),
  title: "MailPiston - Own Your Email Control Plane",
  description:
    "Receive, route, view, and reply across every domain you manage. Keep your email control plane while proven providers handle delivery.",
  applicationName: "MailPiston",
  keywords: [
    "email control plane",
    "programmable inbox",
    "inbound email routing",
    "private email relay",
    "multi-domain support inbox",
  ],
  openGraph: {
    title: "MailPiston - Own the inbox. Offload the mail server.",
    description:
      "A programmable, reply-ready inbox for every domain you manage - with proven email infrastructure underneath.",
    siteName: "MailPiston",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MailPiston - Own the inbox. Offload the mail server.",
    description:
      "A programmable, reply-ready inbox for every domain you manage - with proven email infrastructure underneath.",
  },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` because the script below edits this element
    // before React sees it — which is the entire point of it running there.
    <html lang="en" className={GeistSans.variable} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Blocking, in <head>, and inline: a theme applied from a component
            paints the wrong colours first and snaps after hydration. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body>
        {/* One provider for the whole app: tooltips coordinate their open delay
            with each other, so a shared provider is what stops the second
            tooltip in a row replaying the full delay. */}
        <TooltipProvider delay={250}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
