/*
 * The site's own texts for the policy and help pages, in Markdown (lib/markdown.ts): shown until the owner writes their own in
 * Admin → Settings → Policies (and About). Written for the academy from the owner's MAWAH shop policies (effective 18 October 2026).
 * No phone number, e-mail or address is written in them: every one of these pages prints the current ones from Settings → Contact.
 */

export const PAGE_TEXTS = {
  refund: {
    bn: "Stub refund bn\n\n## Section\n\nText.\n",
    en: "Stub refund en\n\n## Section\n\nText.\n",
  },
  privacy: {
    bn: "Stub privacy bn\n\n## Section\n\nText.\n",
    en: "Stub privacy en\n\n## Section\n\nText.\n",
  },
  terms: {
    bn: "Stub terms bn\n\n## Section\n\nText.\n",
    en: "Stub terms en\n\n## Section\n\nText.\n",
  },
  guide: {
    bn: "Stub guide bn\n\n## Section\n\nText.\n",
    en: "Stub guide en\n\n## Section\n\nText.\n",
  },
  order: {
    bn: "Stub order bn\n\n## Section\n\nText.\n",
    en: "Stub order en\n\n## Section\n\nText.\n",
  },
  hotline: {
    bn: "Stub hotline bn\n\n## Section\n\nText.\n",
    en: "Stub hotline en\n\n## Section\n\nText.\n",
  },
} as const;

export type PageKind = keyof typeof PAGE_TEXTS;

/** Who we are: the About page's text until the owner writes their own (Admin → Settings → About). */
export const ABOUT_TEXT = { bn: "Stub about bn\n\n## Section\n\nText.\n", en: "Stub about en\n\n## Section\n\nText.\n" } as const;
