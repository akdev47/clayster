import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // Forward API calls to Django (python manage.py runserver).
      "/api": "http://127.0.0.1:8000",
    },
  },
});
