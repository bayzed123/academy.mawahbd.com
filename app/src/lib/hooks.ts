import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface SiteConfig {
  contact: { whatsapp: string; phone: string; email: string; facebook: string };
  announcement: { bn: string; en: string };
  /** the owner's shop (an external site), or null when the link is switched off */
  shop: { url: string; label_bn: string; label_en: string } | null;
  chat_enabled: boolean;
  turnstile_site_key: string;
  environment: string;
}

/** Non-secret site settings (contact channels, Turnstile site key). Cached for the session. */
export function useSite() {
  return useQuery({
    queryKey: ["site"],
    queryFn: async () => (await api<{ site: SiteConfig }>("/site")).site,
    staleTime: 10 * 60_000,
  });
}
