import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, "overlay.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
