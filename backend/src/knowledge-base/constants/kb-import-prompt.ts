const VALID_CATEGORIES = [
  'checkin',
  'wifi',
  'rules',
  'location',
  'neighborhood',
  'parking',
  'equipment',
  'services',
  'contacts',
  'safety',
  'waste',
  'pets',
  'family',
  'quiet',
  'other',
] as const;

export type KbImportCategory = (typeof VALID_CATEGORIES)[number];

const CATEGORY_ENUM_STRING = VALID_CATEGORIES.map((c) => `"${c}"`).join(' | ');

/**
 * Human-readable hints for the model (English; model maps source-language content to these codes).
 */
const CATEGORY_HINTS: Record<(typeof VALID_CATEGORIES)[number], string> = {
  checkin: 'Check-in/out times, keys, lockbox, late arrival',
  wifi: 'Wi‑Fi name/password, where the router is',
  rules: 'House rules: smoking, guests, shoes, common areas',
  location: 'Address, how to find the door, floor, intercom',
  neighborhood: 'Shops, pharmacy, walkability, area tips',
  parking: 'Where to park, permits, fees, EV charging',
  equipment: 'Appliances, TV, AC, washer, how to use',
  services: 'Cleaning, linen, breakfast, airport transfer',
  contacts: 'Host/emergency contacts, concierge',
  safety: 'Fire extinguisher, alarms, first aid, emergency numbers',
  waste: 'Trash sorting, bins, recycling',
  pets: 'Pet policy, fees, rules',
  family: 'Kids, cribs, extra beds, high chair',
  quiet: 'Quiet hours, parties, noise',
  other: 'Anything that fits nowhere above',
};

const CATEGORY_HINTS_BLOCK = VALID_CATEGORIES.map(
  (c) => `- "${c}": ${CATEGORY_HINTS[c]}`,
).join('\n');

/** Max characters sent to the model (matches slice in buildImportPrompt). */
export const KB_IMPORT_TEXT_MAX_CHARS = 40000;

/**
 * Builds the user message for the LLM. The model must return a JSON array only;
 * {@link KnowledgeBaseImportService.parseToEntries} strips code fences and validates categories.
 */
export function buildImportPrompt(rawText: string): string {
  const clipped = rawText.slice(0, KB_IMPORT_TEXT_MAX_CHARS);

  return `
You are a data extraction assistant for a short-term rental property knowledge base (used by a chatbot for guests).

## Input
Plain text: FAQ, house manual, OTA listing copy, email, or notes — possibly messy or multilingual.

## Task
Turn it into structured KB entries. Each entry is one topic a guest might search for.

## Output format (strict)
Return ONLY a valid JSON array. No markdown, no \`\`\` fences, no commentary before or after.

Each element must be an object with exactly these keys:
- "title": string, max 80 characters, specific and searchable (like a FAQ question or handbook heading).
- "content": string, the full factual answer for guests (complete sentences, self-contained).
- "category": exactly one of: ${CATEGORY_ENUM_STRING}

## Category meanings (pick the best fit; use "other" if unsure)
${CATEGORY_HINTS_BLOCK}

## Rules
- Split by topic, not by every paragraph. Merge related bullets into one entry when it reads better.
- Preserve numbers, times, prices, and names from the source. Do not invent amenities or policies not stated in the text.
- Write "title" and "content" in the same language as the source text (if mixed, use the dominant language).
- If the text has no usable facts, return [].
- Aim for roughly 5–25 entries for a rich document; fewer for a short note.

--- TEXT TO PARSE ---
${clipped}
`.trim();
}

export { VALID_CATEGORIES };
