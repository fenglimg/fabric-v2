// ISS-20260713-054: pure frontmatter helpers extracted from doctor.ts.
function synthesizeMustReadIfStub(source: string, filename: string): string {
  const h1Match = /^#\s+(.+?)\s*$/mu.exec(source);
  let raw = h1Match !== null ? h1Match[1] : filename.replace(/^K[PT]-[A-Z]+-\d+--/, "").replace(/\.md$/u, "").replace(/-/g, " ");
  raw = raw.trim();
  if (raw.length === 0) {
    raw = "describes a knowledge invariant for this project";
  }
  if (raw.length > 120) {
    raw = `${raw.slice(0, 117)}...`;
  }
  return raw;
}

function yamlQuoteIfNeeded(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  // ISS-001: also force-quote on ANY control char (newline/CR/tab). An internal
  // newline with no other special char would otherwise emit bare and break the
  // single-line frontmatter structure (injection surface). When quoting, escape
  // backslash first, then quote, then collapse control chars to YAML escapes.
  if (
    /[:#"'\\[\]{},&*!|>%@`]/.test(value) ||
    /^[\s-?]/.test(value) ||
    /\s$/.test(value) ||
    /[\n\r\t]/.test(value)
  ) {
    return `"${value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")}"`;
  }
  return value;
}

export { synthesizeMustReadIfStub, yamlQuoteIfNeeded };
