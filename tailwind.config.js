/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Roboto", "system-ui", "sans-serif"],
        display: ["Oswald", "Roboto", "sans-serif"], // condensed face used for big numbers, like the reference
      },
      colors: {
        // main accent: purple (same as the landing page)
        brand: {
          50: "#f4f1ff", 100: "#ebe5ff", 200: "#d9ceff", 300: "#bfaeff", 400: "#9d85ff",
          500: "#8566ff", 600: "#6c47ff", 700: "#5b38ee", 800: "#4a2cc7", 900: "#2f2078",
        },
        ink: { 950: "#0b1020", 900: "#111833", 800: "#1b2447", 700: "#2a3563" },
        chart: { DEFAULT: "#6c47ff", dark: "#5b38ee", soft: "#ebe5ff" },
        line: "#e8e4f7",
        page: "#f6f4ff",
      },
      borderRadius: { card: "16px" },
      boxShadow: {
        panel: "inset 0 1px 0 rgba(255,255,255,.95), 0 10px 34px -10px rgba(76,45,200,.22)",
        pop: "inset 0 1px 0 rgba(255,255,255,.95), 0 24px 60px -14px rgba(76,45,200,.40)",
      },
    },
  },
  plugins: [],
};