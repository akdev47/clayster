import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // Forward API calls to Django (python manage.py runserver).
      // changeOrigin must stay false: Django's CSRF check compares the
      // request's host with the page's origin (localhost:5173).
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
});
