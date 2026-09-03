import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./legacy-screens.css";

const geist = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prospera",
  description:
    "Funding opportunities, investigator matching, and research community intelligence at UCSF.",
  icons: {
    icon: [
      { url: "/brand/prospera-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/prospera-app-icon.png", type: "image/png" },
    ],
    apple: [{ url: "/brand/prospera-app-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geist.variable} ${geistMono.variable} min-h-screen bg-canvas font-sans text-body text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
