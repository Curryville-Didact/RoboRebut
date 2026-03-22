import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoboRebut Coach",
  description: "Real-time live call coaching",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
