import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-barlow)", "sans-serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
      },
      colors: {
        brand: {
          50:  "#fff0f0",
          100: "#ffd6d6",
          200: "#ffadad",
          300: "#ff7070",
          400: "#ee2222",
          500: "#CC0000",
          600: "#aa0000",
          700: "#880000",
          800: "#660000",
          900: "#440000",
        },
        navy: {
          50:  "#f0f4ff",
          100: "#e0e9ff",
          200: "#c7d6fe",
          300: "#a5b8fd",
          400: "#4a6080",
          500: "#2a3f60",
          600: "#1F3260",
          700: "#1A2744",
          800: "#141C2E",
          900: "#0D1220",
          950: "#0A0A0A",
        },
        silver: {
          100: "#F4F4F4",
          200: "#D4D4D4",
          300: "#C0C0C0",
          400: "#A8A8A8",
          500: "#8C8C8C",
        },
        slate: {
          750: "#2a3548",
          850: "#1a2335",
          950: "#0f1724",
        },
      },
      backgroundImage: {
        "diamond-pattern": "url('/diamond-bg.svg')",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "slide-in-right": "slideInRight 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
