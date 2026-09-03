import type { Config } from "tailwindcss";

/**
 * Prospera v2 theme.
 * Source of truth: design_handoff_prospera_v2/README.md ("Design tokens").
 * Raw values live here (and mirrored as CSS variables in globals.css) so both
 * `bg-navy` and `var(--navy)` resolve to the same colour.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f8fa",
        card: "#ffffff",
        "footer-bar": "#fafbfc",
        navy: {
          DEFAULT: "#0b1d3a",
          hover: "#132a52",
          tint: "#e8edf5",
          nav: "#e9edf3",
        },
        teal: {
          DEFAULT: "#0e6b78",
          tint: "#e3f4f6",
          light: "#7cc4cc",
          "on-navy": "#5fc2cc",
        },
        ink: {
          DEFAULT: "#0b1d3a",
          body: "#475569",
          muted: "#64748b",
          "on-tint": "#334155",
        },
        line: {
          DEFAULT: "#e2e8f0",
          control: "#cbd5e1",
          row: "#f1f5f9",
        },
        skeleton: "#f1f5f9",
        success: { DEFAULT: "#1e6b3a", tint: "#e6f4ea" },
        warning: {
          DEFAULT: "#8a4b0c",
          tint: "#fdf1dc",
          border: "#f0d6a8",
          dark: "#5c3106",
        },
        danger: {
          DEFAULT: "#b42318",
          tint: "#fdecea",
          border: "#f5c2bd",
          dark: "#7a1a10",
        },
        scrim: "rgba(11,29,58,0.24)",
        // Bridge for the pre-v2 call sites still in the tree.
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing }]
        h1: ["28px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        title: ["18px", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        body: ["14px", { lineHeight: "1.6" }],
        dense: ["13px", { lineHeight: "1.5" }],
        meta: ["12px", { lineHeight: "1.45" }],
        micro: ["11px", { lineHeight: "1.4" }],
        // Uppercase labels: 12/600/0.06em on card headers, 11/600/0.08em in panels.
        section: ["12px", { lineHeight: "1.2", letterSpacing: "0.06em" }],
        label: ["11px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
        stat: ["24px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "stat-lg": ["32px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        control: "6px",
        tile: "8px",
        card: "10px",
        app: "14px",
      },
      spacing: {
        sidebar: "240px",
        // Page frame: 32px top, 40px sides, 64px bottom.
        page: "40px",
      },
      minWidth: {
        page: "1366px",
      },
      boxShadow: {
        dialog: "0 12px 32px rgba(11,29,58,0.16)",
        menu: "0 12px 32px rgba(11,29,58,0.14)",
        slideover: "-12px 0 32px rgba(11,29,58,0.08)",
        toast: "0 8px 24px rgba(11,29,58,0.24)",
        focus: "0 0 0 2px #0e6b78",
      },
      keyframes: {
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        skeleton: "skeleton-shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
