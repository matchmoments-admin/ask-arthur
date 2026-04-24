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
    // PWA shortcuts — surfaced in the long-press menu on Android home
    // screens and the right-click menu on Windows/Chrome OS taskbars.
    // Two entries: the headline check action and Phone Footprint's
    // saved-numbers dashboard. Both deep-link straight into the app.
    shortcuts: [
      {
        name: "Check a message",
        short_name: "Check",
        description: "Paste suspicious text or a URL for instant analysis.",
        url: "/?utm_source=pwa_shortcut",
      },
      {
        name: "Phone Footprint — saved numbers",
        short_name: "Footprint",
        description: "View your saved numbers and recent alerts.",
        url: "/app/phone-footprint/monitors?utm_source=pwa_shortcut",
      },
    ],
    // Android Web Share Target — receive shared text/URLs from other apps
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  } as MetadataRoute.Manifest & {
    share_target: {
      action: string;
      method: string;
      enctype: string;
      params: { title: string; text: string; url: string };
    };
  };
}
