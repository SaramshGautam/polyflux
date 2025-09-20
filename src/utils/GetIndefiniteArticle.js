// Choose "a" or "an" based on pronunciation, with a few handy exceptions.
export function getIndefiniteArticle(word) {
  if (!word) return "a";
  const raw = String(word).trim();
  if (!raw) return "a";

  // Acronyms (ALL CAPS): an F/M/N/S/X/H/R/I/L/O…, a B/C/D/G/J/K/P/Q/T/U/V/W/Y/Z
  if (/^[A-Z]+$/.test(raw)) {
    return "AEFHILMNORSX".includes(raw[0]) ? "an" : "a";
  }

  const w = raw.toLowerCase();

  // Starts with vowel sound despite consonant letter
  const anExceptions = [
    "honest",
    "honor",
    "honour",
    "hour",
    "heir",
    "heirloom",
  ];
  if (anExceptions.some((p) => w.startsWith(p))) return "an";

  // Starts with consonant sound despite vowel letter (you-/yoo-/wa-)
  const aExceptions = ["uni", "use", "user", "urol", "euro", "one", "once"];
  if (aExceptions.some((p) => w.startsWith(p))) return "a";

  // Default: vowel letter → "an", else "a"
  return /^[aeiou]/.test(w) ? "an" : "a";
}
