/**
 * Voice AI evaluation fixtures.
 * 35 rental scenarios covering all major intent categories.
 *
 * Each fixture defines:
 *   - input: guest query + context
 *   - expected: policy decision, intent label, shouldEscalate, shouldTransfer
 *
 * Run via: GET /api/v1/voice/eval/run  (dev/test only)
 */

export type ExpectedDecision =
  | 'confident_answer'
  | 'clarify'
  | 'escalate'
  | 'emergency'
  | 'complaint_escalate'
  | 'handoff_request'
  | 'quiet_hours'
  | 'feature_disabled'
  | 'max_turns_exceeded';

export interface EvalFixture {
  id: string;
  category: string;
  guestQuery: string;
  language: 'ru' | 'en';
  /** Whether the fixture simulates quiet hours */
  quietHours?: boolean;
  /** Turn index (0 = first turn) */
  turnIndex?: number;
  expected: {
    policyDecision: ExpectedDecision;
    intent?: string;
    shouldEscalate: boolean;
    shouldTransferNow: boolean;
    /** If true, LLM should be bypassed (pre-LLM guard) */
    preEmpted?: boolean;
  };
}

export const EVAL_FIXTURES: EvalFixture[] = [
  // ── Check-in / Access ─────────────────────────────────────────────────────
  {
    id: 'checkin-01',
    category: 'checkin',
    guestQuery: 'Как заселиться? Когда можно приехать?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'checkin-02',
    category: 'checkin',
    guestQuery: 'What time is check-in?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'checkin-03',
    category: 'checkin',
    guestQuery: 'Где ключи? Я уже у двери.',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'checkout-01',
    category: 'checkout',
    guestQuery: 'До какого времени нужно выехать?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkout',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'checkout-02',
    category: 'checkout',
    guestQuery: 'What is the late checkout policy?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'late_checkout',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Property info ─────────────────────────────────────────────────────────
  {
    id: 'address-01',
    category: 'address',
    guestQuery: 'Какой адрес объекта?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'address',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'wifi-01',
    category: 'wifi',
    guestQuery: 'Какой пароль от WiFi?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'wifi',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'wifi-02',
    category: 'wifi',
    guestQuery: 'What is the WiFi password?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'wifi',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'parking-01',
    category: 'parking',
    guestQuery: 'Где можно припарковать машину?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'parking',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'parking-02',
    category: 'parking',
    guestQuery: 'Is there free parking nearby?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'parking',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Deposit / payments ────────────────────────────────────────────────────
  {
    id: 'deposit-01',
    category: 'deposit',
    guestQuery: 'Когда вернут залог?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'deposit',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'deposit-02',
    category: 'deposit',
    guestQuery: 'How do I get my security deposit back?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'deposit',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Early/late requests ───────────────────────────────────────────────────
  {
    id: 'early-checkin-01',
    category: 'early_checkin',
    guestQuery: 'Можно ли заехать раньше в 10 утра?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'early_checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'late-checkout-01',
    category: 'late_checkout',
    guestQuery: 'Can I stay until 2pm?',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'late_checkout',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Emergency guard (pre-LLM, expect bypass) ──────────────────────────────
  {
    id: 'emergency-01',
    category: 'emergency',
    guestQuery: 'Пожар! В квартире пожар!',
    language: 'ru',
    expected: {
      policyDecision: 'emergency',
      shouldEscalate: true,
      shouldTransferNow: true,
      preEmpted: true,
    },
  },
  {
    id: 'emergency-02',
    category: 'emergency',
    guestQuery: 'There is a gas leak! I smell gas!',
    language: 'en',
    expected: {
      policyDecision: 'emergency',
      shouldEscalate: true,
      shouldTransferNow: true,
      preEmpted: true,
    },
  },
  {
    id: 'emergency-03',
    category: 'emergency',
    guestQuery: 'Вызовите скорую, человеку плохо',
    language: 'ru',
    expected: {
      policyDecision: 'emergency',
      shouldEscalate: true,
      shouldTransferNow: true,
      preEmpted: true,
    },
  },
  // ── Handoff requests (pre-LLM bypass) ────────────────────────────────────
  {
    id: 'handoff-01',
    category: 'transfer_request',
    guestQuery: 'Соедините меня с менеджером',
    language: 'ru',
    expected: {
      policyDecision: 'handoff_request',
      shouldEscalate: true,
      shouldTransferNow: true,
      preEmpted: true,
    },
  },
  {
    id: 'handoff-02',
    category: 'transfer_request',
    guestQuery: 'I want to speak to a real person',
    language: 'en',
    expected: {
      policyDecision: 'handoff_request',
      shouldEscalate: true,
      shouldTransferNow: true,
      preEmpted: true,
    },
  },
  // ── Complaints ────────────────────────────────────────────────────────────
  {
    id: 'complaint-01',
    category: 'complaint',
    guestQuery: 'Хочу написать жалобу на ваш сервис',
    language: 'ru',
    expected: {
      policyDecision: 'complaint_escalate',
      shouldEscalate: true,
      shouldTransferNow: false,
    },
  },
  {
    id: 'complaint-02',
    category: 'complaint',
    guestQuery: 'I want a refund, this is unacceptable',
    language: 'en',
    expected: {
      policyDecision: 'complaint_escalate',
      shouldEscalate: true,
      shouldTransferNow: false,
    },
  },
  {
    id: 'complaint-03',
    category: 'complaint',
    guestQuery: 'Требую возврат денег',
    language: 'ru',
    expected: {
      policyDecision: 'complaint_escalate',
      shouldEscalate: true,
      shouldTransferNow: false,
    },
  },
  // ── Quiet hours ───────────────────────────────────────────────────────────
  {
    id: 'quiet-01',
    category: 'quiet_hours',
    guestQuery: 'Нужна помощь с замком',
    language: 'ru',
    quietHours: true,
    expected: {
      policyDecision: 'quiet_hours',
      shouldEscalate: true,
      shouldTransferNow: false,
      preEmpted: true,
    },
  },
  // ── Max turns ─────────────────────────────────────────────────────────────
  {
    id: 'max-turns-01',
    category: 'max_turns',
    guestQuery: 'Ещё один вопрос — про Wi-Fi',
    language: 'ru',
    turnIndex: 13,
    expected: {
      policyDecision: 'max_turns_exceeded',
      shouldEscalate: true,
      shouldTransferNow: false,
      preEmpted: true,
    },
  },
  // ── Appliances / issues ───────────────────────────────────────────────────
  {
    id: 'appliance-01',
    category: 'broken_appliance',
    guestQuery: 'Не работает стиральная машина',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'appliance-02',
    category: 'broken_appliance',
    guestQuery: 'The air conditioner is broken',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Noise complaint (borderline — should escalate if policy set) ──────────
  {
    id: 'noise-01',
    category: 'noise',
    guestQuery: 'Соседи шумят, невозможно спать',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Late arrival ──────────────────────────────────────────────────────────
  {
    id: 'late-arrival-01',
    category: 'late_arrival',
    guestQuery: 'Приеду поздно ночью около 2, можно?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'late-arrival-02',
    category: 'late_arrival',
    guestQuery: 'My flight is delayed, I will arrive at 3am',
    language: 'en',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'checkin',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Legal / privacy ───────────────────────────────────────────────────────
  {
    id: 'legal-01',
    category: 'legal',
    guestQuery: 'Вы нарушаете мои персональные данные, GDPR',
    language: 'ru',
    expected: {
      policyDecision: 'escalate',
      shouldEscalate: true,
      shouldTransferNow: false,
      preEmpted: true,
    },
  },
  // ── Unclear / ambiguous ───────────────────────────────────────────────────
  {
    id: 'ambiguous-01',
    category: 'other',
    guestQuery: 'Там такое дело...',
    language: 'ru',
    expected: {
      policyDecision: 'clarify',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'ambiguous-02',
    category: 'other',
    guestQuery: 'Um, I had a question about... things',
    language: 'en',
    expected: {
      policyDecision: 'clarify',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  // ── Info / general ────────────────────────────────────────────────────────
  {
    id: 'pets-01',
    category: 'pets',
    guestQuery: 'Можно ли приехать с собакой?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'transport-01',
    category: 'transport',
    guestQuery: 'Как добраться от аэропорта?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
  {
    id: 'inventory-01',
    category: 'inventory',
    guestQuery: 'Есть ли в апартаментах кофемашина?',
    language: 'ru',
    expected: {
      policyDecision: 'confident_answer',
      intent: 'other',
      shouldEscalate: false,
      shouldTransferNow: false,
    },
  },
];
