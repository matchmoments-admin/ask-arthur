import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ask Arthur — Free AI Scam Checker",
    short_name: "Ask Arthur",
    description:
      "Paste a suspicious message, email, or URL and get an instant AI-powered verdict.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#001F3F",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
