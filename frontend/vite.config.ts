import { defineConfig } from "vite";

// base: './' so the built assets work under a GitHub Pages project path
// (https://user.github.io/repo/) without hardcoding the repo name.
export default defineConfig({
  base: "./",
});
