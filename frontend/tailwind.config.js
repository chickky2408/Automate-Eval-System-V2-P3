/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}", // ตรวจสอบว่ามีบรรทัดนี้ เพื่อให้ Tailwind อ่านไฟล์ App.jsx และอื่นๆ ได้
    ],
    theme: {
      extend: {},
    },
    plugins: [],
  }