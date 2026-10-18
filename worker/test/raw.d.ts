/** Vite's `?raw` imports (a file's text), used by tests that read a migration. */
declare module "*?raw" {
  const content: string;
  export default content;
}
