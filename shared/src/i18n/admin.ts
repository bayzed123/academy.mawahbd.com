/** Admin dashboard strings — filled in with the React admin. */
const en = {
  "admin.placeholder": "MAWAH Academy Admin",
} as const;
const bn: Record<keyof typeof en, string> = {
  "admin.placeholder": "মাওয়াহ একাডেমি অ্যাডমিন",
};
export const adminDict = { en, bn };
export type AdminKey = keyof typeof en;
