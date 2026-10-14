import { createFileRoute } from "@tanstack/react-router";
import { KeepApp } from "@/components/keep/KeepApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Keeply — Notes & Checklists" },
      { name: "description", content: "A fast, mobile-first notes app for ideas, checklists, labels, colors, and rich text styling." },
      { property: "og:title", content: "Keeply — Notes & Checklists" },
      { property: "og:description", content: "Capture ideas and keep your checklists organized from any phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KeepApp,
});
