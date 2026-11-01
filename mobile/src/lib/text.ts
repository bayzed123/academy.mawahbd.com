/**
 * A product's description is written in the website's simple Markdown (headings, **bold**, lists, links). The app shows it as clean
 * text: list items keep a bullet, everything else loses its marks.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/^\s*>\s?/, "")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2")
        .replace(/`([^`]+)`/g, "$1")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
