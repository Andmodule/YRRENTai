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

export function buildImportPrompt(rawText: string): string {
  return `
You are a data extraction assistant for a rental property management system.

Extract structured knowledge base entries from the FAQ/document text below.
Return ONLY a valid JSON array — no markdown, no code fences, no explanation.

Each item in the array must have exactly these fields:
{
  "title": "short descriptive title (max 80 characters)",
  "content": "full answer or information text",
  "category": one of exactly: ${CATEGORY_ENUM_STRING}
}

Rules:
- Split by topic, not by paragraph
- Group related info into one entry if it makes sense
- Titles should be specific and searchable
- Content should be complete and self-contained
- Respond in the same language as the source text

--- TEXT TO PARSE ---
${rawText.slice(0, 40000)}
`.trim();
}

export { VALID_CATEGORIES };
