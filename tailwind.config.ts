import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        violet: "#6C4CF1",
        "violet-deep": "#5334D6",
        violet2: "#8B6CF7",
        navy: "#15123A",
        navy2: "#1E1A4D",
        ink: "#151429",
        sub: "#6B6B85",
        line: "#EAE9F4",
        lav: "#F6F5FC",
        green: "#1BA672",
        amber: "#F5A524",
      },
    },
  },
  plugins: [],
};
export default config;
