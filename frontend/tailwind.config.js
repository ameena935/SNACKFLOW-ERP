/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef9f0",
          100: "#fdf0d9",
          200: "#f9d9a3",
          300: "#f5bc62",
          400: "#f09d2e",
          500: "#e8820d",
          600: "#cc6407",
          700: "#a84a09",
          800: "#893b0f",
          900: "#713210",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
