import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase, hyphenated");

/** A docs page. `verified` is the day its claims were last checked; `checkedAgainst` names what they were checked against. */
const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "*.md" }),
  schema: z.object({
    title: z.string().min(10).max(70),
    description: z.string().min(50).max(160),
    slug,
    order: z.number().int().min(1),
    verified: z.coerce.date(),
    checkedAgainst: z.string().min(10),
    kind: z.enum(["reference", "guide", "about"]).default("reference"),
  }),
});

export const collections = { docs };
