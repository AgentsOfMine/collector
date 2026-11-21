/**
 * Puts a page's picture (DESIGN.md "Post image (the card)") after its first top-level paragraph that is not a
 * value box, or right after the bold "The short answer." paragraph where a page has one (the blog), so the answer
 * stays in the first screen. The same file runs on the blog and on the docs site and the drift guard keeps the two
 * copies byte-identical: CARD_BASE in card-specs.mjs is "" on the blog and "/collector" on the docs.
 * It runs after rehype-takeaway.mjs, which has already wrapped the value boxes, so they are not paragraphs here.
 *
 * The slug comes from the page's front matter (Astro passes it as file.data.astro.frontmatter); the spec, with
 * the alt text, from src/lib/card-specs.mjs. No style attribute is written (the CSP blocks it). No dependencies.
 * @returns {(tree: any, file: any) => void}
 */
import { CARDS, CARD_BASE } from "./card-specs.mjs";

const text = (node) => (node.type === "text" ? node.value : (node.children ?? []).map(text).join(""));

export default function rehypeCard() {
  return (tree, file) => {
    const slug = file?.data?.astro?.frontmatter?.slug;
    const spec = slug ? CARDS[slug] : undefined;
    if (!spec || !Array.isArray(tree.children)) return;
    const paragraphs = tree.children.map((n, i) => [n, i]).filter(([n]) => n.type === "element" && n.tagName === "p");
    const answer = paragraphs.find(([n]) => /^the short answer\b/i.test(text(n).trim())) ?? paragraphs[0];
    if (!answer) return;
    const figure = {
      type: "element",
      tagName: "figure",
      properties: { className: ["post-card"] },
      children: [
        {
          type: "element",
          tagName: "img",
          properties: {
            src: `${CARD_BASE}/cards/${slug}.png`,
            alt: spec.alt,
            width: 1200,
            height: 676,
            loading: "lazy",
            className: ["w-full", "h-auto", "rounded-md", "border", "border-border-default"],
          },
          children: [],
        },
      ],
    };
    tree.children.splice(answer[1] + 1, 0, figure);
  };
}
