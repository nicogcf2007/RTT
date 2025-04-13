/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Make sure this covers your App.tsx file
  ],
  theme: {
    extend: {
       // You can add custom theme extensions here if needed
       // e.g., specific colors, fonts, etc.
    },
  },
  plugins: [
    require('@tailwindcss/forms'), // Essential for better default form styling
    require('@tailwindcss/typography'), // For the 'prose' class used in analysis
  ],
}