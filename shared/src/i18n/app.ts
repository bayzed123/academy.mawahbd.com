/** Student app strings — filled in with the React app. */
const en = {
  "app.placeholder": "MAWAH Academy",
} as const;
const bn: Record<keyof typeof en, string> = {
  "app.placeholder": "মাওয়াহ একাডেমি",
};
export const appDict = { en, bn };
export type AppKey = keyof typeof en;
