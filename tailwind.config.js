/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.jsx", "./src/**/*.js", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        "texas-red": "#BF0A30", // Example red shade
        "texas-blue": "#002868", // Example blue shade
        "texas-silver": "#C0C0C0", // Example silver shade
      },
    },
  },
  plugins: [],
};
