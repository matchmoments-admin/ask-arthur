/**
 * Serialise a JSON-LD object for a `<script type="application/ld+json">`
 * body. JSON.stringify leaves `<` as-is, so a string value containing
 * `</script>` would end the script element early; escaping `<` (and the two
 * JS line terminators) keeps the value inside the block. The output is still
 * valid JSON — `<` decodes back to `<`.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}
