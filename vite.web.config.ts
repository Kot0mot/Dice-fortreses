import { defineConfig } from "vite";

export default defineConfig({
    root: "web",
    server: {
        fs: {
            allow: [".."],
        },
    },
    build: {
        outDir: "../dist-web",
        emptyOutDir: true,
    },
});
