/**
 * Wraps the reader-value paragraphs of a page in <div class="takeaway" role="note"> (DESIGN.md "Takeaway block").
 * The Markdown stays plain: a paragraph that starts with a bold "Why this matters.", "What you get.", "Scenario" or "A real session"
 * label is boxed. "Why this matters" and "What you get" that follow each other share one box; a scenario has its own.
 * Only top-level paragraphs are looked at. No dependencies.
 * @returns {(tree: any) => void}
 */
const GROUPS = [
  { name: "value", labels: [/^why this matters\b/i, /^what you get\b/i] },
  { name: "scenario", labels: [/^scenario\b/i, /^a real session\b/i] },
];

const text = (node) => (node.type === "text" ? node.value : (node.children ?? []).map(text).join(""));
const isBlank = (node) => node.type === "text" && node.value.trim() === "";

function groupOf(node) {
  if (node.type !== "element" || node.tagName !== "p") return null;
  const first = (node.children ?? []).find((c) => !isBlank(c));
  if (!first || first.type !== "element" || first.tagName !== "strong") return null;
  const label = text(first).trim();
  return GROUPS.find((g) => g.labels.some((re) => re.test(label)))?.name ?? null;
}

export default function rehypeTakeaway() {
  return (tree) => {
    const out = [];
    let open = null;
    for (const node of tree.children ?? []) {
      const group = groupOf(node);
      if (group && open && open.group === group) {
        open.box.children.push(node);
      } else if (group) {
        open = {
          group,
          box: { type: "element", tagName: "div", properties: { className: ["takeaway"], role: "note" }, children: [node] },
        };
        out.push(open.box);
      } else if (isBlank(node) && open) {
        continue;
      } else {
        open = null;
        out.push(node);
      }
    }
    tree.children = out;
  };
}
