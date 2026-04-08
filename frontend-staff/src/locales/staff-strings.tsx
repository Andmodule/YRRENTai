'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type StaffLocale = 'ru' | 'en';

export interface StaffStrings {
  tasks: {
    checklist: {
      title: string;
      progress: (done: number, total: number) => string;
      requiredBadge: string;
      completeRequired: string;
      taskIncidentNeedsManagerAria: string;
    };
    incident: {
      fabLabel: string;
      lostItem: string;
      damage: string;
      submit: string;
      success: string;
      successDescription: string;
      drawerTitle: string;
      describeDamage: string;
      describeFind: string;
      sendFailed: string;
      photosOptional: string;
      whatFound: string;
      thingPlaceholder: string;
      guestName: string;
      whatDamaged: string;
      where: string;
    };
    taskIssue: {
      quickActionLabel: string;
      drawerTitle: string;
      describeRequired: string;
      success: string;
      errorGeneric: string;
      descriptionLabel: string;
      descriptionPlaceholder: string;
      photosOptional: string;
      photoPicker: string;
      cancel: string;
      submit: string;
    };
    /** Task workflow status `issue` — same word as in manager UI («Инцидент», not «Проблема»). */
    taskStatusIssue: string;
    taskIssueReportHeading: string;
  };
}

const MESSAGES: Record<StaffLocale, StaffStrings> = {
  ru: {
    tasks: {
      checklist: {
        title: 'Чеклист',
        progress: (done: number, total: number) => `${done} из ${total} пунктов`,
        requiredBadge: 'Обязательно',
        completeRequired: 'Отметьте обязательные пункты чеклиста',
        taskIncidentNeedsManagerAria: 'Инцидент по задаче — нужен менеджер',
      },
      incident: {
        fabLabel: 'Сообщить об инциденте',
        lostItem: 'Забытая вещь',
        damage: 'Повреждение',
        submit: 'Отправить отчёт',
        success: 'Инцидент отправлен менеджеру',
        successDescription:
          'У менеджера он появится на странице «Задачи» в блоке «Инциденты» вверху. При Telegram — ещё уведомление там.',
        drawerTitle: 'Инцидент',
        describeDamage: 'Опишите повреждение',
        describeFind: 'Опишите находку',
        sendFailed: 'Не удалось отправить',
        photosOptional: 'Фото (необязательно, до 5)',
        whatFound: 'Что нашли',
        thingPlaceholder: 'Опишите вещь',
        guestName: 'Имя гостя (если знаете)',
        whatDamaged: 'Что повреждено',
        where: 'Где',
      },
      taskIssue: {
        quickActionLabel: 'Инцидент',
        drawerTitle: 'Сообщить об инциденте по задаче',
        describeRequired: 'Опишите инцидент',
        success: 'Инцидент по задаче зафиксирован',
        errorGeneric: 'Ошибка. Попробуйте ещё раз',
        descriptionLabel: 'Описание инцидента',
        descriptionPlaceholder: 'Опишите, что произошло…',
        photosOptional: 'Фото (необязательно)',
        photoPicker: '📷 Сфотографировать / выбрать из галереи',
        cancel: 'Отмена',
        submit: 'Сообщить',
      },
      taskStatusIssue: 'Инцидент',
      taskIssueReportHeading: 'Сообщение об инциденте',
    },
  },
  en: {
    tasks: {
      checklist: {
        title: 'Checklist',
        progress: (done: number, total: number) => `${done} of ${total} items`,
        requiredBadge: 'Required',
        completeRequired: 'Complete all required checklist items',
        taskIncidentNeedsManagerAria: 'Task incident — manager attention needed',
      },
      incident: {
        fabLabel: 'Report an incident',
        lostItem: 'Lost item',
        damage: 'Damage',
        submit: 'Send report',
        success: 'Incident sent to the manager',
        successDescription:
          'The manager will see it on Tasks in the Incidents block at the top. Telegram notifies too if linked.',
        drawerTitle: 'Incident',
        describeDamage: 'Describe the damage',
        describeFind: 'Describe what was found',
        sendFailed: 'Could not send',
        photosOptional: 'Photos (optional, up to 5)',
        whatFound: 'What was found',
        thingPlaceholder: 'Describe the item',
        guestName: 'Guest name (if known)',
        whatDamaged: 'What is damaged',
        where: 'Where',
      },
      taskIssue: {
        quickActionLabel: 'Incident',
        drawerTitle: 'Report a task-related incident',
        describeRequired: 'Describe the incident',
        success: 'Task incident recorded',
        errorGeneric: 'Something went wrong. Try again.',
        descriptionLabel: 'Incident description',
        descriptionPlaceholder: 'Describe what happened…',
        photosOptional: 'Photo (optional)',
        photoPicker: '📷 Take or choose from gallery',
        cancel: 'Cancel',
        submit: 'Send',
      },
      taskStatusIssue: 'Incident',
      taskIssueReportHeading: 'Incident report',
    },
  },
};

const StaffStringsContext = createContext<StaffStrings>(MESSAGES.ru);

function detectLocale(): StaffLocale {
  if (typeof window === 'undefined') return 'ru';
  return window.navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

export function StaffStringsProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<StaffLocale>('ru');
  useEffect(() => {
    setLocale(detectLocale());
  }, []);
  const value = useMemo(() => MESSAGES[locale], [locale]);
  return <StaffStringsContext.Provider value={value}>{children}</StaffStringsContext.Provider>;
}

export function useStaffStrings(): StaffStrings {
  return useContext(StaffStringsContext);
}
