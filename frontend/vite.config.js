import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev: set `VITE_API_BASE_URL=/api` so the browser calls same origin (localhost:5173/api/...).
 * Vite forwards /api → FastAPI on 127.0.0.1:8000 (avoids "Load failed" when .env pointed at LAN IP
 * while Uvicorn only listened on localhost, and avoids CORS quirks).
 */
export default defineConfig({
    plugins: [react()],
    server: {
        // Quick tunnels get a new *.trycloudflare.com host each run; leading dot allows the whole suffix.
        allowedHosts: [".trycloudflare.com"],
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
                secure: false,
                ws: true,
            },
            // FastAPI serves /ws/* outside the /api prefix (see backend/routers/ws.py)
            "/ws": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
                ws: true,
            },
        },
    },
});
