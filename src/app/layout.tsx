import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { SightlineDefs } from "@/components/SightlineDefs";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Project ANPR — crowdsourced camera map",
  description:
    "Map camera locations from the street: a GPS fix, the bearing the camera looks along, and a photo.",
  applicationName: "Project ANPR",
  appleWebApp: { capable: true, title: "Project ANPR", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately not capping maximumScale: Leaflet claims touch gestures over
  // the map, so page zoom stays available everywhere else.
  // The capture sheet sits above the home indicator on iOS.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
  ],
};

/**
 * Applies the stored theme before first paint. Without this the app flashes
 * light before hydration, which is exactly the wrong thing to do to someone's
 * eyes at night.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('anpr:theme');
    var dark = stored ? stored === 'dark' : true;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${plexMono.variable} antialiased`}
      >
        <SightlineDefs />
        {children}
      </body>
    </html>
  );
}
