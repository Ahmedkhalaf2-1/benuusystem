import type { MetadataRoute } from "next";

/**
 * Installable PWA manifest. The app is online-only: there is deliberately no
 * service worker, no offline cache and no background sync.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Benuuprint ERP",
    short_name: "Benuuprint",
    description: "نظام إدارة Benuuprint للطباعة وتصنيع الملابس",
    lang: "ar",
    dir: "rtl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f4f1",
    theme_color: "#5730b8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
