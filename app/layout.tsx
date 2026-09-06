import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
