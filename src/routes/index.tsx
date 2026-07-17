import { createFileRoute } from "@tanstack/react-router";
import { GlitchApp } from "@/components/glitch/App";

export const Route = createFileRoute("/")({
  component: GlitchApp,
  head: () => ({
    meta: [
      { title: "GLITCH Lounge Manager" },
      { name: "description", content: "Premium PlayStation gaming lounge management console for GLITCH — rooms, billing, inventory, and reconciliation." },
      { property: "og:title", content: "GLITCH Lounge Manager" },
      { property: "og:description", content: "Premium PlayStation gaming lounge management console for GLITCH — rooms, billing, inventory, and reconciliation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
