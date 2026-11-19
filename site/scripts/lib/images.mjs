// Metadata in published images. A bare JFIF header is fine; anything else that can carry
// text, a place, a camera, a date or a person is not (docs/plans/blog-launch.md section 2c).
import { readFileSync } from "node:fs";

const JPEG_BAD = (m) => (m >= 0xe1 && m <= 0xef) || m === 0xfe; // APP1-APP15 (EXIF, XMP, ICC, IPTC...), COM
const PNG_BAD = new Set(["eXIf", "iTXt", "tEXt", "zTXt", "iCCP", "tIME"]);

export function imageMetadata(file) {
  const d = readFileSync(file);
  const found = [];
  if (d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    while (i < d.length && d[i] === 0xff) {
      const m = d[i + 1];
      if (m === 0xda) break;
      const n = d.readUInt16BE(i + 2);
      if (JPEG_BAD(m)) found.push(`JPEG segment 0x${m.toString(16)}`);
      i += 2 + n;
    }
  } else if (d.slice(1, 4).toString() === "PNG") {
    let i = 8;
    while (i < d.length) {
      const n = d.readUInt32BE(i);
      const type = d.slice(i + 4, i + 8).toString();
      if (PNG_BAD.has(type)) found.push(`PNG chunk ${type}`);
      i += 12 + n;
    }
  } else if (/^\s*<(\?xml|svg)/i.test(d.slice(0, 200).toString())) {
    const t = d.toString();
    if (/<metadata[\s>]|<rdf:|sodipodi:|inkscape:|<dc:/i.test(t)) found.push("SVG metadata block");
  }
  return found;
}
