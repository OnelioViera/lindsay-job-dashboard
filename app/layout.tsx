import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lindsay Precast — Dashboard",
  description:
    "Track approval, pour, completion, delivery and invoicing for every structure.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
