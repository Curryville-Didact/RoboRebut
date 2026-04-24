/**
 * Auth route group — inherits global styles from src/app/layout.tsx (globals.css).
 * No extra wrappers needed; pass children through for the root layout’s <html>/<body>.
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
