import type { ChecklistTemplateFormData } from '@/components/checklist/checklist-template.schema';
import type { TaskType } from '@/modules/tasks/types';

type LocaleKey = 'ru' | 'en';

function items(
  rows: { text: { ru: string; en: string }; required: boolean }[],
  locale: string,
): ChecklistTemplateFormData['items'] {
  const loc: LocaleKey = locale.startsWith('ru') ? 'ru' : 'en';
  return rows.map((r, i) => ({
    text: r.text[loc],
    required: r.required,
    sortOrder: i * 10,
  }));
}

const checkoutCleaning: { ru: string; en: string }[] = [
  { ru: 'Собрать мусор из всех комнат, кухни и санузлов', en: 'Collect trash from all rooms, kitchen, and bathrooms' },
  { ru: 'Кухня: протереть столешницу, плиту, фасады; вымыть раковину', en: 'Kitchen: wipe counters, stove, fronts; clean sink' },
  { ru: 'Кухня: проверить холодильник и микроволновку, протереть изнутри', en: 'Kitchen: check fridge and microwave, wipe inside' },
  { ru: 'Посуда: сложить чистую, грязную загрузить в ПММ или вымыть', en: 'Dishes: store clean; load dirty in dishwasher or wash' },
  { ru: 'Санузел: унитаз, раковина, душевая/ванна — дезинфекция и кафель', en: 'Bathroom: toilet, sink, shower/tub — disinfect and tiles' },
  { ru: 'Санузел: зеркала, смесители, полки без разводов', en: 'Bathroom: mirrors, taps, shelves streak-free' },
  { ru: 'Пополнить туалетную бумагу, мыло, при необходимости гель для душа', en: 'Restock toilet paper, soap, shower gel if needed' },
  { ru: 'Спальни: заправить кровати по стандарту объекта', en: 'Bedrooms: make beds per property standard' },
  { ru: 'Сменить или поправить текстиль по регламенту (постель, полотенца)', en: 'Change or adjust linens per policy (bedding, towels)' },
  { ru: 'Гостиная: диван, стол, ТВ-пульт, пульт кондиционера — пыль', en: 'Living room: sofa, table, TV and AC remotes — dust' },
  { ru: 'Полы: пылесос и влажная уборка по всем зонам', en: 'Floors: vacuum and mop all areas' },
  { ru: 'Плинтусы и углы: пыль и волосы', en: 'Baseboards and corners: dust and hair' },
  { ru: 'Окна и подоконники с внутренней стороны (без следов)', en: 'Windows and sills inside (streak-free)' },
  { ru: 'Балкон/лоджия: подметание, мусор', en: 'Balcony: sweep, remove debris' },
  { ru: 'Проверить запах в квартире, при необходимости проветрить', en: 'Check odor; air out if needed' },
  { ru: 'Мусорные ведра с новыми пакетами', en: 'Trash bins with fresh liners' },
  { ru: 'Ключи / кейбокс / сейф — по инструкции объекта', en: 'Keys / lockbox / safe — per property instructions' },
  { ru: 'Свет, вытяжка, вода — выключить лишнее', en: 'Lights, hood, water — turn off extras' },
  { ru: 'Финальная проверка: ничего не забыто, дверь закрыта', en: 'Final check: nothing left behind, door closed' },
];

const checkinPrep: { ru: string; en: string }[] = [
  { ru: 'Ключи и доступ: кейбокс, коды, дубликаты по регламенту', en: 'Keys and access: lockbox, codes, duplicates per policy' },
  { ru: 'Wi‑Fi: пароль актуален, стикер/карточка для гостя', en: 'Wi‑Fi: password current, sticker/card for guest' },
  { ru: 'Температура: отопление/кондиционер к заезду', en: 'Temperature: heating/AC set for arrival' },
  { ru: 'Освещение: лампы рабочие, тёплый свет в зоне входа', en: 'Lighting: working bulbs, warm light at entry' },
  { ru: 'Санузел: туалетная бумага, мыло, полотенца по норме', en: 'Bathroom: toilet paper, soap, towels per standard' },
  { ru: 'Кухня: базовые расходники (губка, моющее, мусорные пакеты)', en: 'Kitchen: basics (sponge, detergent, trash bags)' },
  { ru: 'Холодильник включён, чистый, без посторонних продуктов', en: 'Fridge on, clean, no foreign items' },
  { ru: 'Постель и полотенца по количеству гостей из брони', en: 'Bedding and towels for guest count on booking' },
  { ru: 'Диван/кровать: заправка и подушки', en: 'Sofa/bed: made and pillows arranged' },
  { ru: 'Проверить запах, проветрить при необходимости', en: 'Check odor; ventilate if needed' },
  { ru: 'Инструкции для гостя на видном месте (если предусмотрены)', en: 'Guest instructions visible if applicable' },
  { ru: 'Парковка / домофон — актуальные данные в заметках задачи', en: 'Parking / intercom — current info in task notes' },
];

const midStay: { ru: string; en: string }[] = [
  { ru: 'Вынести мусор и заменить пакет', en: 'Take out trash and replace liner' },
  { ru: 'Кухня: посуда, раковина, столешница', en: 'Kitchen: dishes, sink, counters' },
  { ru: 'Санузел: раковина, зеркало, унитаз (лёгкая уборка)', en: 'Bathroom: sink, mirror, toilet (light clean)' },
  { ru: 'Полы в зонах трафика: пылесос / влажно', en: 'High-traffic floors: vacuum / damp mop' },
  { ru: 'Смена полотенец по политике объекта', en: 'Towel change per property policy' },
  { ru: 'Пополнить расходники (мыло, ТБ)', en: 'Restock consumables (soap, TP)' },
  { ru: 'Проверить запах и проветривание', en: 'Check odor and ventilation' },
  { ru: 'Короткая проверка кровати и дивана', en: 'Quick check of bed and sofa' },
];

const otherTask: { ru: string; en: string }[] = [
  { ru: 'Прочитать название задачи и заметки менеджера', en: 'Read task title and manager notes' },
  { ru: 'Фото «до» — если требуется по задаче', en: 'Before photos — if required by task' },
  { ru: 'Выполнить работу по согласованному объёму', en: 'Complete work per agreed scope' },
  { ru: 'Фото «после» — если требуется', en: 'After photos — if required' },
  { ru: 'Кратко описать результат в комментарии при необходимости', en: 'Brief result in comment if needed' },
];

/** Required flags: critical for reviews / safety */
const requiredCheckout = [
  true, true, true, true, true, true, true, true, true, true,
  true, true, true, false, true, true, true, true, true, true,
];

const requiredCheckin = [true, true, true, true, true, true, true, true, true, true, true, true];
const requiredMid = [true, true, true, true, false, true, true, false];
const requiredOther = [true, false, true, false, false];

const maintenanceLines: { ru: string; en: string }[] = [
  { ru: 'Оценить объём работ и безопасность доступа', en: 'Assess scope and safe access' },
  { ru: 'Отключить питание/воду при необходимости по регламенту', en: 'Shut off power/water per policy if needed' },
  { ru: 'Выполнить ремонт / замену по заданию', en: 'Complete repair / replacement per task' },
  { ru: 'Проверить работоспособность после работ', en: 'Verify operation after work' },
  { ru: 'Убрать инструменты и мусор', en: 'Remove tools and debris' },
];
const requiredMaintenance = [true, true, true, true, true];

function buildRows(
  lines: { ru: string; en: string }[],
  req: boolean[],
): { text: { ru: string; en: string }; required: boolean }[] {
  return lines.map((text, i) => ({
    text,
    required: req[i] ?? false,
  }));
}

export type PresetChoice = TaskType | 'blank';

export function getProfessionalPresetForm(
  locale: string,
  choice: PresetChoice,
): ChecklistTemplateFormData {
  if (choice === 'blank') {
    return {
      name: '',
      autoApplyToType: null,
      propertyId: null,
      items: [{ text: '', required: false, sortOrder: 0 }],
    };
  }

  const loc: LocaleKey = locale.startsWith('ru') ? 'ru' : 'en';
  const names: Record<TaskType, { ru: string; en: string }> = {
    checkout_cleaning: {
      ru: 'Выездная уборка — стандарт 2026',
      en: 'Checkout cleaning — 2026 standard',
    },
    checkin_prep: {
      ru: 'Подготовка к заезду — стандарт 2026',
      en: 'Check-in prep — 2026 standard',
    },
    mid_stay_cleaning: {
      ru: 'Промежуточная уборка — стандарт 2026',
      en: 'Mid-stay cleaning — 2026 standard',
    },
    other: {
      ru: 'Прочая задача — чеклист 2026',
      en: 'Other task — 2026 checklist',
    },
    maintenance: {
      ru: 'Техобслуживание — чеклист 2026',
      en: 'Maintenance — 2026 checklist',
    },
  };

  const bundles: Record<
    TaskType,
    { rows: ReturnType<typeof buildRows>; type: TaskType }
  > = {
    checkout_cleaning: {
      type: 'checkout_cleaning',
      rows: buildRows(checkoutCleaning, requiredCheckout),
    },
    checkin_prep: {
      type: 'checkin_prep',
      rows: buildRows(checkinPrep, requiredCheckin),
    },
    mid_stay_cleaning: {
      type: 'mid_stay_cleaning',
      rows: buildRows(midStay, requiredMid),
    },
    maintenance: {
      type: 'maintenance',
      rows: buildRows(maintenanceLines, requiredMaintenance),
    },
    other: {
      type: 'other',
      rows: buildRows(otherTask, requiredOther),
    },
  };

  const b = bundles[choice];
  return {
    name: names[choice][loc],
    autoApplyToType: choice,
    propertyId: null,
    items: items(b.rows, locale),
  };
}
