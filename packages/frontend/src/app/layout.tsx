import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

/**
 * Align metadataBase with the actual request URL (Host / forwarded headers).
 * A fixed NEXT_PUBLIC_SITE_URL port or host (e.g. localhost:3000 vs 127.0.0.1:3000 vs another dev port)
 * can make Next's metadata URL resolution throw on some versions — surfacing as a 500 on every page
 * including /login. Request-derived origin avoids that class of failure.
 */
function originFromHeaders(h: Headers): URL | undefined {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return undefined;
  try {
    const protoHeader = h.get("x-forwarded-proto");
    const proto =
      protoHeader?.split(",")[0]?.trim() === "https"
        ? "https"
        : protoHeader?.split(",")[0]?.trim() === "http"
          ? "http"
          : host.startsWith("localhost") || host.startsWith("127.")
            ? "http"
            : "https";
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}

function originFromEnv(): URL | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const metadataBase =
    originFromHeaders(h) ?? originFromEnv() ?? new URL("http://localhost:3000");

  return {
    metadataBase,
    title: "RoboRebut Coach",
    description: "Real-time live call coaching",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  console.log("[ROOT_LAYOUT_START]");
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
