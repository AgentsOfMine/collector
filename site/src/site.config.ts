/** Facts used in more than one place. */
export const SITE = {
  name: "AgentsOfMine collector docs",
  origin: "https://agentsofmine.github.io",
  base: "/collector",
  product: "https://agentsofmine.io",
  repo: "https://github.com/AgentsOfMine/collector",
  /**
   * Bing Webmaster Tools ownership code (the content of <meta name="msvalidate.01">). It proves ownership only;
   * it sets no cookie and loads nothing. It is written on the home page only, which is the address registered in
   * Bing, and scripts/check.mjs accepts this one tag in exactly this shape (rule "verification-tag").
   */
  bingVerification: "ACCB16504198D624E3BA7AC67F124245",
  blog: "https://blog.agentsofmine.io",
  /**
   * The Content-Security-Policy, as a <meta> tag: GitHub Pages cannot send response headers.
   * A meta policy cannot carry frame-ancestors, so it cannot stop the site being framed.
   */
  csp: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'",
} as const;

/** "/x/" -> "/collector/x/". The one way pages build an internal address. */
export const url = (path: string): string => (path === "/" ? `${SITE.base}/` : `${SITE.base}${path}`);
