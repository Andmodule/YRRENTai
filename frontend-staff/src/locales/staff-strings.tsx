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
      /** Голосовой отчёт с привязкой к этой задаче (кнопка на карточке). */
      cardVoiceAria: string;
      /** Короткая подпись под микрофоном: довоз / инцидент — не обязательная запись. */
      cardVoiceHint: string;
      /** Текстовый отчёт по задаче (карандаш) — тот же поток, что дополнение в истории. */
      cardTextAria: string;
      /** Доступность чекбокса: подтвердить факт уборки без голоса. */
      markDoneCheckboxAria: string;
      /** Тост после отметки «готово» (до отправки на сервер можно отменить). */
      taskMarkedDoneToast: string;
      undoMarkDone: string;
      markDoneError: string;
      /** Задача без привязки к объекту (`isGeneralTask`). */
      generalTaskLabel: string;
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
    assigneeLabel: string;
    assigneeUnassigned: string;
    /** Explains that reassignment is done in the manager web app (API allows OWNER/MANAGER only). */
    assigneeReassignHint: string;
    history: {
      fabAria: string;
      drawerTitle: string;
      hint: string;
      tabTasks: string;
      tabIncidents: string;
      emptyTasks: string;
      emptyIncidents: string;
      addPhoto: string;
      photosCount: (n: number) => string;
      incidentUploadSuccess: string;
      incidentUploadFail: string;
      incidentPhotoTitle: string;
      incidentPhotoHint: string;
      incidentPhotoPrimary: string;
      incidentPhotoCancel: string;
      photosUploading: string;
      taskHasPhotoBadge: string;
      taskNoPhotoBadge: string;
      supplementTitle: string;
      supplementHint: string;
      supplementPlaceholder: string;
      supplementSubmit: string;
      supplementSuccess: string;
      supplementError: string;
      supplementChipRefill: string;
      supplementChipIncident: string;
      /** Подсказка под строкой «Пополнение:» / «Инцидент:» (не входит в отправляемый текст). */
      supplementAfterColonHint: string;
      typeLabels: Record<string, string>;
    };
  };
  /** Оболочка для сотрудников с типом «Водитель» (`staffJobType === driver`). */
  driver: {
    title: string;
    badge: string;
    placeholder: string;
    logout: string;
    route: {
      headerTitle: string;
      progress: (done: number, total: number) => string;
      scheduled: (date: string) => string;
      warehouseTitle: string;
      propertyFallback: string;
      warehouseAddressHint: string;
      statusActive: string;
      statusArrived: string;
      /** Активная карточка объекта — следующая по плану / выбору водителя */
      statusNextStop: string;
      viewList: string;
      viewMap: string;
      mapHint: string;
      makeNextStop: string;
      makingNext: string;
      sections: {
        warehousePick: string;
        deliver: string;
      };
      actions: {
        completeStop: string;
        completing: string;
        startRoute: string;
        starting: string;
        arrive: string;
        arriving: string;
        warehouseComplete: string;
        warehouseCompleting: string;
        refresh: string;
      };
      a11y: {
        timelineList: string;
        reportEmergency: string;
        navigate: string;
      };
      empty: {
        title: string;
        description: string;
      };
      error: {
        message: string;
        retry: string;
      };
      issueToast: string;
      /** Голос / текст как на чеклисте — привязка к задаче по объекту маршрута */
      report: {
        voiceAria: string;
        textAria: string;
        noTaskHint: string;
        /** Голос требует невыполненную задачу; текст может идти по якорю даже если всё закрыто */
        voiceNoOpenTaskHint: string;
        /** Список задач пуст — не к чему привязать отчёт */
        noTasksInListHint: string;
      };
    };
    /** Главный экран водителя (не только маршрут) */
    dashboard: {
      pageTitle: string;
      routeAssignedTitle: string;
      routeInProgressTitle: string;
      routeLine: (stops: number, date: string) => string;
      progressShort: (done: number, total: number) => string;
      ctaStart: string;
      ctaContinue: string;
      ctaOpenRoute: string;
      emptyTitle: string;
      emptyBody: string;
      refresh: string;
      sectionTomorrow: string;
      tomorrowPlaceholder: string;
      sectionStats: string;
      statsFromRoute: (done: number, total: number) => string;
      statsIdle: string;
      sectionTasks: string;
      tasksOpenCount: (n: number) => string;
      tasksLink: string;
      sectionIssues: string;
      issuesCount: (n: number) => string;
      issuesClear: string;
      sectionHistory: string;
      historyPlaceholder: string;
      backToOverview: string;
    };
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
        cardVoiceAria: 'Голосовой отчёт: довоз, нехватка или инцидент',
        cardVoiceHint: 'Довоз · инцидент',
        cardTextAria: 'Текстовый отчёт или уточнение для менеджера',
        markDoneCheckboxAria: 'Подтвердить уборку — галочка. Голос не обязателен, если всё в порядке',
        taskMarkedDoneToast: 'Задача отмечена выполненной',
        undoMarkDone: 'Отмена',
        markDoneError: 'Не удалось обновить статус',
        generalTaskLabel: 'Общая задача',
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
      assigneeLabel: 'Исполнитель',
      assigneeUnassigned: 'Не назначено',
      assigneeReassignHint:
        'Сменить исполнителя может менеджер в веб-панели. После смены список задач обновится у всех.',
      history: {
        fabAria: 'История задач и инцидентов',
        drawerTitle: 'История',
        hint: 'Завершённые задачи и ваши инциденты. Можно добавить фото, если забыли при закрытии.',
        tabTasks: 'Задачи',
        tabIncidents: 'Инциденты',
        emptyTasks: 'Нет завершённых задач в списке.',
        emptyIncidents: 'Вы ещё не отправляли инциденты.',
        addPhoto: 'Добавить фото',
        photosCount: (n: number) => (n === 1 ? '1 фото' : `${n} фото`),
        incidentUploadSuccess: 'Фото добавлены к инциденту',
        incidentUploadFail: 'Не удалось загрузить фото',
        incidentPhotoTitle: 'Фото к инциденту',
        incidentPhotoHint: 'Добавьте снимки — они появятся у менеджера в карточке инцидента.',
        incidentPhotoPrimary: 'Сделать фото / выбрать',
        incidentPhotoCancel: 'Отмена',
        photosUploading: 'Загрузка…',
        taskHasPhotoBadge: 'фото есть',
        taskNoPhotoBadge: 'без фото',
        supplementTitle: 'Дополнение к задаче',
        supplementHint:
          'Коротко опишите нехватку, довоз, поломку или другое важное для менеджера — в том числе повреждения и инциденты.',
        supplementPlaceholder: 'Например: не хватило чистого белья, закончилась бумага…',
        supplementSubmit: 'Отправить',
        supplementSuccess: 'Сохранено. Менеджер увидит дополнение.',
        supplementError: 'Не удалось отправить',
        supplementChipRefill: 'Пополнение',
        supplementChipIncident: 'Инцидент',
        supplementAfterColonHint: 'Опишите детали после двоеточия…',
        typeLabels: {
          lost_item: 'Забытая вещь',
          damage: 'Повреждение',
          rule_violation: 'Нарушение',
          emergency: 'Чрезвычайная ситуация',
          task_report: 'По задаче',
        },
      },
    },
    driver: {
      title: 'Логистика',
      badge: 'Режим водителя',
      placeholder:
        'Здесь будет отдельный интерфейс маршрутов и доставок. Пока используйте веб-панель менеджера для статусов.',
      logout: 'Выйти',
      route: {
        headerTitle: 'Текущий маршрут',
        progress: (done: number, total: number) => `Выполнено ${done} из ${total} остановок`,
        scheduled: (date: string) => `Дата: ${date}`,
        warehouseTitle: 'Склад',
        propertyFallback: 'Объект',
        warehouseAddressHint: 'Погрузка на складе',
        statusActive: 'Сейчас',
        statusArrived: 'На месте',
        statusNextStop: 'Следующая остановка',
        viewList: 'Список',
        viewMap: 'Карта',
        mapHint: 'Откройте точку в навигаторе. Список ниже — все остановки дня.',
        makeNextStop: 'Сделать следующей',
        makingNext: 'Сохранение…',
        sections: {
          warehousePick: 'Забрать на складе',
          deliver: 'Отвезти на объект',
        },
        actions: {
          completeStop: 'Точка выполнена',
          completing: 'Сохранение…',
          startRoute: 'Начать маршрут',
          starting: 'Запуск…',
          arrive: 'На месте',
          arriving: 'Отмечаем…',
          warehouseComplete: 'Погрузка завершена',
          warehouseCompleting: 'Сохранение…',
          refresh: 'Обновить',
        },
        a11y: {
          timelineList: 'Остановки маршрута',
          reportEmergency: 'Сообщить о проблеме',
          navigate: 'Открыть маршрут в картах',
        },
        empty: {
          title: 'Нет активного маршрута',
          description:
            'Когда менеджер назначит маршрут на сегодня, он появится здесь. Если вы уже завершили доставку, список обновится после синхронизации.',
        },
        error: {
          message: 'Не удалось загрузить маршрут.',
          retry: 'Повторить',
        },
        issueToast: 'Сообщите менеджеру в чате или по телефону, если срочно.',
        report: {
          voiceAria: 'Голосовой отчёт по маршруту (инцидент, довоз)',
          textAria: 'Текстовое сообщение менеджеру по маршруту',
          noTaskHint: 'Нет задачи для привязки — отчёт недоступен (обратитесь к менеджеру).',
          voiceNoOpenTaskHint:
            'Нет невыполненной задачи на сегодня — голос привязывается к активной задаче. Можно отправить текст.',
          noTasksInListHint:
            'Нет задач, назначенных вам — отчёты привязаны к задаче. Попросите менеджера назначить задачи по объектам маршрута.',
        },
      },
      dashboard: {
        pageTitle: 'Сводка',
        routeAssignedTitle: 'Вам назначен маршрут',
        routeInProgressTitle: 'Маршрут в работе',
        routeLine: (stops: number, date: string) => `${stops} остановок · ${date}`,
        progressShort: (done: number, total: number) => `Выполнено ${done} из ${total}`,
        ctaStart: 'Начать маршрут',
        ctaContinue: 'Продолжить маршрут',
        ctaOpenRoute: 'Открыть маршрут',
        emptyTitle: 'Сейчас нет активного маршрута',
        emptyBody:
          'Когда менеджер назначит маршрут, появится карточка выше. Обновите список или откройте задачи — там могут быть поручения вне маршрута.',
        refresh: 'Обновить',
        sectionTomorrow: 'План на завтра',
        tomorrowPlaceholder:
          'Предварительный план на следующий день появится здесь, когда менеджер сформирует маршрут. Пока ориентируйтесь на сообщения в чате.',
        sectionStats: 'Сегодня по маршруту',
        statsFromRoute: (done: number, total: number) => `Остановок закрыто: ${done} из ${total}`,
        statsIdle: 'Нет данных по сегодняшнему маршруту — начните смену, когда появится назначение.',
        sectionTasks: 'Задачи',
        tasksOpenCount: (n: number) => `Открыто задач: ${n}`,
        tasksLink: 'Открыть чеклист задач',
        sectionIssues: 'Внимание',
        issuesCount: (n: number) => `Задач с инцидентом: ${n}`,
        issuesClear: 'Активных инцидентов по задачам нет',
        sectionHistory: 'История и отчёты',
        historyPlaceholder: 'Детальная история доставок и метрики появятся здесь позже. Сейчас отчёты и заметки доступны в разделе задач.',
        backToOverview: 'К сводке',
      },
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
        cardVoiceAria: 'Voice report: restock, shortage, or incident',
        cardVoiceHint: 'Restock · incident',
        cardTextAria: 'Text note or clarification for the manager',
        markDoneCheckboxAria: 'Confirm cleaning done — checkmark. No voice needed if everything is fine',
        taskMarkedDoneToast: 'Task marked as done',
        undoMarkDone: 'Undo',
        markDoneError: 'Could not update status',
        generalTaskLabel: 'General task',
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
      assigneeLabel: 'Assignee',
      assigneeUnassigned: 'Unassigned',
      assigneeReassignHint:
        'Only a manager can change the assignee in the web dashboard. Everyone’s task list updates after that.',
      history: {
        fabAria: 'Task and incident history',
        drawerTitle: 'History',
        hint: 'Completed tasks and incidents you reported. Add photos if you forgot when closing.',
        tabTasks: 'Tasks',
        tabIncidents: 'Incidents',
        emptyTasks: 'No completed tasks in the list.',
        emptyIncidents: 'You have not submitted any incidents yet.',
        addPhoto: 'Add photo',
        photosCount: (n: number) => (n === 1 ? '1 photo' : `${n} photos`),
        incidentUploadSuccess: 'Photos added to the incident',
        incidentUploadFail: 'Could not upload photos',
        incidentPhotoTitle: 'Photos for incident',
        incidentPhotoHint: 'Images will appear on the incident card for the manager.',
        incidentPhotoPrimary: 'Take or choose photos',
        incidentPhotoCancel: 'Cancel',
        photosUploading: 'Uploading…',
        taskHasPhotoBadge: 'photo attached',
        taskNoPhotoBadge: 'no photo',
        supplementTitle: 'Add to task',
        supplementHint:
          'Note shortages, delivery needs, damage, or anything the manager should know — including incidents.',
        supplementPlaceholder: 'e.g. no clean linens, out of toilet paper…',
        supplementSubmit: 'Send',
        supplementSuccess: 'Saved. Your manager will see this.',
        supplementError: 'Could not send',
        supplementChipRefill: 'Refill',
        supplementChipIncident: 'Incident',
        supplementAfterColonHint: 'Add details after the colon…',
        typeLabels: {
          lost_item: 'Lost item',
          damage: 'Damage',
          rule_violation: 'Rule violation',
          emergency: 'Emergency',
          task_report: 'Task-related',
        },
      },
    },
    driver: {
      title: 'Logistics',
      badge: 'Driver mode',
      placeholder:
        'A dedicated route and delivery UI will appear here. For now, managers update status in the web dashboard.',
      logout: 'Log out',
      route: {
        headerTitle: 'Current route',
        progress: (done: number, total: number) => `${done} of ${total} stops done`,
        scheduled: (date: string) => `Date: ${date}`,
        warehouseTitle: 'Warehouse',
        propertyFallback: 'Property',
        warehouseAddressHint: 'Loading at warehouse',
        statusActive: 'Now',
        statusArrived: 'Arrived',
        statusNextStop: 'Next stop',
        viewList: 'List',
        viewMap: 'Map',
        mapHint: 'Open a stop in maps. Below — all stops for today.',
        makeNextStop: 'Make this next',
        makingNext: 'Saving…',
        sections: {
          warehousePick: 'Pick at warehouse',
          deliver: 'Deliver to property',
        },
        actions: {
          completeStop: 'Stop completed',
          completing: 'Saving…',
          startRoute: 'Start route',
          starting: 'Starting…',
          arrive: "I'm here",
          arriving: 'Updating…',
          warehouseComplete: 'Loading finished',
          warehouseCompleting: 'Saving…',
          refresh: 'Refresh',
        },
        a11y: {
          timelineList: 'Route stops',
          reportEmergency: 'Report an issue',
          navigate: 'Open directions in maps',
        },
        empty: {
          title: 'No active route',
          description:
            'When a manager assigns today’s route, it will show up here. If you already finished, pull to refresh after sync.',
        },
        error: {
          message: 'Could not load the route.',
          retry: 'Retry',
        },
        issueToast: 'Contact your manager in chat or by phone if urgent.',
        report: {
          voiceAria: 'Voice report for route (incident, restock)',
          textAria: 'Text note to manager about the route',
          noTaskHint: 'No task to attach — report unavailable. Contact your manager.',
          voiceNoOpenTaskHint:
            'No open task for today — voice is tied to an active task. You can still send a text note.',
          noTasksInListHint:
            'No tasks assigned to you — reports are tied to a task. Ask your manager to assign tasks for route properties.',
        },
      },
      dashboard: {
        pageTitle: 'Overview',
        routeAssignedTitle: 'You have an assigned route',
        routeInProgressTitle: 'Route in progress',
        routeLine: (stops: number, date: string) => `${stops} stops · ${date}`,
        progressShort: (done: number, total: number) => `${done} of ${total} done`,
        ctaStart: 'Start route',
        ctaContinue: 'Continue route',
        ctaOpenRoute: 'Open route',
        emptyTitle: 'No active route right now',
        emptyBody:
          'When a manager assigns a route, a card will appear here. Refresh or open Tasks — there may be work outside the route.',
        refresh: 'Refresh',
        sectionTomorrow: 'Tomorrow',
        tomorrowPlaceholder:
          'A draft plan for the next day will show here once your manager builds a route. Until then, use chat updates.',
        sectionStats: 'Today’s route',
        statsFromRoute: (done: number, total: number) => `Stops completed: ${done} of ${total}`,
        statsIdle: 'No route data for today yet — wait for an assignment.',
        sectionTasks: 'Tasks',
        tasksOpenCount: (n: number) => `Open tasks: ${n}`,
        tasksLink: 'Open task checklist',
        sectionIssues: 'Attention',
        issuesCount: (n: number) => `Tasks with incident: ${n}`,
        issuesClear: 'No active task incidents',
        sectionHistory: 'History & reports',
        historyPlaceholder:
          'Delivery history and metrics will appear here later. Notes and reports are in Tasks for now.',
        backToOverview: 'Back to overview',
      },
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
