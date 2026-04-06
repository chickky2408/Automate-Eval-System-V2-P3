import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        // Quick tunnels get a new *.trycloudflare.com host each run; leading dot allows the whole suffix.
        allowedHosts: [".trycloudflare.com"],
    },
});
