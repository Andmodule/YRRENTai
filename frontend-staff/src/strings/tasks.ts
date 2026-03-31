/** Keys for future i18n (next-intl). Use `strings.tasks.checklist.title` in components. */
export const strings = {
  tasks: {
    checklist: {
      title: 'Чеклист',
      progress: (done: number, total: number) => `${done} из ${total} пунктов`,
      requiredBadge: 'Обязательно',
      completeRequired: 'Отметьте обязательные пункты чеклиста',
    },
    incident: {
      fabLabel: 'Сообщить об инциденте',
      lostItem: 'Забытая вещь',
      damage: 'Повреждение',
      submit: 'Отправить отчёт',
      success: 'Менеджер уведомлён',
    },
  },
} as const;
