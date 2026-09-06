import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  return {
    base: "./",
    server: {
      port: 5173,
      open: false,
    },
    plugins: [
      {
        name: "html-dev-title-prefix",
        transformIndexHtml(html) {
          if (command === "serve") {
            return html.replace(
              /<title>(.*?)<\/title>/i,
              "<title>[DEV] $1</title>",
            );
          }
          return html;
        },
      },
    ],
  };
});
