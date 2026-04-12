/** Общие правила: строка матрицы снабжения vs «инцидентная» лента (без циклических импортов сервисов). */

export const SUPPLY_INTENTS_MATRIX = new Set(['RESTOCK_REQUEST', 'SUPPLY_SHORTAGE', 'LOGISTICS_HANDOFF']);

const INCIDENT_LIKE_HINTS =
  /слом|полом|разбил|разбит|ущерб|краж|пожар|затоп|задымл|капает|течь|течёт|течет|протеч|инцидент|поврежд|damage|broken|shatter|flood|theft|emergency|leak|drip/i;

const SUPPLY_OR_LOGISTICS_HINTS =
  /бель|полотен|бумаг|шампун|мыл|расход|ершик|стирк|забрать|достав|довоз|замен|комплект|подмен|ввоз|вывоз|курьер|логистик|ключ|towel|toilet\s*paper|paper|replacement|replenish|supply|stock/i;

export function includeLineInSupplyMatrix(params: {
  textRaw: string;
  intentFromPayload: string;
  supplyItemId: string | null;
}): boolean {
  if (params.supplyItemId) return true;
  const intent = params.intentFromPayload.trim();
  if (SUPPLY_INTENTS_MATRIX.has(intent)) return true;
  const lower = params.textRaw.trim().toLowerCase();
  const textIncident = INCIDENT_LIKE_HINTS.test(lower);
  const textSupply = SUPPLY_OR_LOGISTICS_HINTS.test(lower);
  if (textIncident && !textSupply) return false;
  if (intent === 'INCIDENT_FOLLOWUP' || intent === 'NEEDS_CLARIFICATION') {
    return textSupply;
  }
  return true;
}
