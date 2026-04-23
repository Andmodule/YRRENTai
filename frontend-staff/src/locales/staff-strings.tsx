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
      /** Кнопка в быстрой шторке: закрыть задачу (уборка по объекту). */
      quickActionMarkDone: string;
      /** Сводка в профиле: блок статистики по списку назначений. */
      profileTaskStatsLabel: string;
      /** Заголовок блока невыполненных задач в чеклисте. */
      activeListHeading: (count: number) => string;
      /** Заголовок сворачиваемого блока выполненных задач. */
      completedTasksHeading: (count: number) => string;
      /** Смена фиксируется на сервере автоматически — строка в процессе. */
      shiftRecording: string;
      /** Смена: ошибка сети / сервера. */
      shiftRecordError: string;
      /** Повторить фиксацию смены после ошибки. */
      shiftRecordRetry: string;
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
      /** Вкладка водителя — завершённые маршруты (аналог «Задачи» у уборщицы). */
      tabRoutes: string;
      /** Подсказка под заголовком для режима водителя. */
      hintDriver: string;
      emptyRoutes: string;
      /** @deprecated Вкладка «Маршруты» вместо подзаголовка. */
      sectionCompletedRoutes: string;
      completedRouteLink: string;
      completedRouteStops: (done: number, total: number) => string;
      emptyTasks: string;
      emptyIncidents: string;
      /** Когда в «Истории» нет задач за прошлые дни (сегодняшние — на главном экране). */
      emptyTasksPast: string;
      emptyIncidentsPast: string;
      viewMedia: string;
      detailCompleted: string;
      detailDue: string;
      detailAddress: string;
      detailNotes: string;
      detailAttachments: string;
      detailDescription: string;
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
    /** Фото/видео к завершённой задаче (верификация). */
    verification: {
      titleDefault: string;
      titleSupplement: string;
      descDefault: string;
      descSupplement: string;
      addFromGallery: string;
      stripHint: string;
      preparing: string;
      send: string;
      skip: string;
      skipSupplement: string;
      successDefault: string;
      successSupplement: string;
      tooMany: (max: number) => string;
      videoTooBig: (mb: number) => string;
      quickActionTitle: string;
      quickActionHint: string;
      closeSheet: string;
      /** Сжатие/обработка файлов */
      prepareFailed: string;
      noTaskBinding: string;
      emptyAfterPrepare: string;
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
      dueBy: (time: string) => string;
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
        /** Подсказка на кнопке «Точка выполнена», пока есть невыполненные задачи на объекте */
        completeStopBlockedHint: string;
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
      /** Задачи на карточке остановки (property) */
      propertyTasksSectionTitle: string;
      propertyTasksDoneToggle: (n: number) => string;
      propertyTasksReopen: string;
      propertyTasksReopenError: string;
      /** После закрытия всех остановок */
      completion: {
        thankTitle: string;
        thankBody: string;
        backOverview: string;
        tomorrowCta: string;
        stopsDetails: string;
        offRouteTasksTitle: string;
        stopExpandHint: string;
      };
    };
    /** Главный экран водителя (не только маршрут) */
    dashboard: {
      pageTitle: string;
      routeAssignedTitle: string;
      routeInProgressTitle: string;
      /** Маршрут за сегодня закрыт (подписи на детальном экране и т.п.). */
      routeCompletedTitle: string;
      routeLine: (stops: number, date: string) => string;
      progressShort: (done: number, total: number) => string;
      ctaStart: string;
      ctaStarting: string;
      ctaContinue: string;
      ctaOpenRoute: string;
      emptyTitle: string;
      emptyBody: string;
      /** Нет активных маршрутов, но есть завершённые за сегодня — уводим их в «Историю». */
      emptyActiveCompletedTitle: string;
      emptyActiveCompletedBody: string;
      refresh: string;
      /** Подзаголовок группы: маршруты с запланированной датой = сегодня. */
      sectionToday: string;
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
  staffShell: {
    themeToggle: {
      switchToDarkAria: string;
      switchToLightAria: string;
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
        quickActionMarkDone: 'Завершить объект',
        profileTaskStatsLabel: 'По списку назначений',
        activeListHeading: (count: number) => `Список (${count})`,
        completedTasksHeading: (count: number) => `Завершенные за сегодня (${count})`,
        shiftRecording: 'Фиксируем смену…',
        shiftRecordError: 'Не удалось зафиксировать смену',
        shiftRecordRetry: 'Повторить',
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
        hint: 'Прошлые дни: задачи с датой завершения до сегодня. Только просмотр — без правок, комментариев и новых вложений.',
        tabTasks: 'Задачи',
        tabIncidents: 'Инциденты',
        tabRoutes: 'Маршруты',
        hintDriver:
          'Маршруты за сегодня; инциденты за прошлые дни — только просмотр (без правок). Откройте маршрут для остановок.',
        emptyRoutes: 'Нет завершённых маршрутов в списке.',
        sectionCompletedRoutes: 'Завершённые маршруты',
        completedRouteLink: 'Детали',
        completedRouteStops: (done: number, total: number) => `Выполнено ${done} из ${total} остановок`,
        emptyTasks: 'Нет завершённых задач в списке.',
        emptyIncidents: 'Вы ещё не отправляли инциденты.',
        emptyTasksPast: 'Нет задач за прошлые дни. Сегодняшние завершённые — в списке на главной.',
        emptyIncidentsPast: 'Нет инцидентов за прошлые дни.',
        viewMedia: 'Смотреть',
        detailCompleted: 'Завершено',
        detailDue: 'Срок',
        detailAddress: 'Адрес',
        detailNotes: 'Примечания',
        detailAttachments: 'Фото и видео',
        detailDescription: 'Описание',
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
      verification: {
        titleDefault: 'Проверка: фото или видео',
        titleSupplement: 'Добавить к задаче',
        descDefault: 'Снимок или ролик по объекту — у менеджера в одном месте. Можно выбрать несколько за раз (до 10).',
        descSupplement: 'Прикрепите до 10 файлов — менеджер увидит в карточке задачи.',
        addFromGallery: 'Снять / из галереи',
        stripHint: 'Свайпните, чтобы увидеть все',
        preparing: 'Подготовка…',
        send: 'Отправить',
        skip: 'Пропустить',
        skipSupplement: 'Позже',
        successDefault: 'Материалы прикреплены',
        successSupplement: 'Добавлено к задаче',
        tooMany: (max: number) => `Максимум ${max} файлов — выберите меньше`,
        videoTooBig: (mb: number) => `Видео больше ${mb} МБ сожмите или выберите короче`,
        quickActionTitle: 'Фото или видео',
        quickActionHint: 'Один или несколько — для проверки у менеджера',
        closeSheet: 'Закрыть',
        prepareFailed: 'Не удалось подготовить вложения. Попробуйте другой файл.',
        noTaskBinding: 'Нет привязки к задаче. Закройте окно и откройте снова.',
        emptyAfterPrepare: 'Файлы не обработались. Попробуйте другое фото или видео.',
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
        dueBy: (time: string) => `до ${time}`,
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
          completeStopBlockedHint:
            'Сначала отметьте ваши задачи на объекте галочкой «выполнено», затем закройте остановку.',
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
        propertyTasksSectionTitle: 'Задачи на объекте',
        propertyTasksDoneToggle: (n: number) => `Завершённые (${n})`,
        propertyTasksReopen: 'Вернуть в работу',
        propertyTasksReopenError: 'Не удалось вернуть задачу в работу',
        completion: {
          thankTitle: 'Спасибо, маршрут закрыт',
          thankBody: 'Все остановки отмечены выполненными. Отдыхайте — до следующей смены.',
          backOverview: 'На сводку',
          tomorrowCta: 'План на завтра',
          stopsDetails: 'Остановки маршрута',
          offRouteTasksTitle: 'Дела вне маршрута',
          stopExpandHint: 'Нажмите чтобы развернуть',
        },
      },
      dashboard: {
        pageTitle: 'Сводка',
        routeAssignedTitle: 'Вам назначен маршрут',
        routeInProgressTitle: 'Маршрут в работе',
        routeCompletedTitle: 'Маршрут завершён',
        routeLine: (stops: number, date: string) => `${stops} остановок · ${date}`,
        progressShort: (done: number, total: number) => `Выполнено ${done} из ${total}`,
        ctaStart: 'Начать маршрут',
        ctaStarting: 'Запуск…',
        ctaContinue: 'Продолжить маршрут',
        ctaOpenRoute: 'Открыть маршрут',
        emptyTitle: 'Сейчас нет активного маршрута',
        emptyBody:
          'Когда менеджер назначит маршрут, появится карточка выше. Обновите список или откройте задачи — там могут быть поручения вне маршрута.',
        emptyActiveCompletedTitle: 'На сегодня маршруты закрыты',
        emptyActiveCompletedBody:
          'Завершённые маршруты и остановки — в разделе «История» (иконка часов справа вверху).',
        refresh: 'Обновить',
        sectionToday: 'Сегодня',
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
    staffShell: {
      themeToggle: {
        switchToDarkAria: 'Включить тёмную тему',
        switchToLightAria: 'Включить светлую тему',
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
        quickActionMarkDone: 'Complete property',
        profileTaskStatsLabel: 'All assigned',
        activeListHeading: (count: number) => `List (${count})`,
        completedTasksHeading: (count: number) => `Completed today (${count})`,
        shiftRecording: 'Recording your shift…',
        shiftRecordError: 'Could not record shift',
        shiftRecordRetry: 'Retry',
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
        hint: 'Past days: tasks completed before today, read-only — no edits or new attachments.',
        tabTasks: 'Tasks',
        tabIncidents: 'Incidents',
        tabRoutes: 'Routes',
        hintDriver:
          'Today’s routes; past-day incidents are read-only. Open a route for stop details.',
        emptyRoutes: 'No completed routes in the list.',
        sectionCompletedRoutes: 'Completed routes',
        completedRouteLink: 'Details',
        completedRouteStops: (done: number, total: number) => `${done} of ${total} stops done`,
        emptyTasks: 'No completed tasks in the list.',
        emptyIncidents: 'You have not submitted any incidents yet.',
        emptyTasksPast: 'No tasks from past days. Today’s completed tasks are on the home list.',
        emptyIncidentsPast: 'No incidents from past days.',
        viewMedia: 'View',
        detailCompleted: 'Completed',
        detailDue: 'Due',
        detailAddress: 'Address',
        detailNotes: 'Notes',
        detailAttachments: 'Photos and video',
        detailDescription: 'Description',
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
      verification: {
        titleDefault: 'Photo or video proof',
        titleSupplement: 'Add to task',
        descDefault: 'Add photos or short videos from the job — the manager sees them in one place. Up to 10 at once.',
        descSupplement: 'Attach up to 10 files; they will appear on the task card for your manager.',
        addFromGallery: 'Camera or gallery',
        stripHint: 'Swipe the row to see all',
        preparing: 'Preparing…',
        send: 'Send',
        skip: 'Skip',
        skipSupplement: 'Later',
        successDefault: 'Media attached',
        successSupplement: 'Added to the task',
        tooMany: (max: number) => `Up to ${max} files — pick fewer`,
        videoTooBig: (mb: number) => `Video is over ${mb} MB — try a shorter clip or compress it`,
        quickActionTitle: 'Photo or video',
        quickActionHint: 'One or more for manager review',
        closeSheet: 'Close',
        prepareFailed: 'Could not process attachments. Try another file.',
        noTaskBinding: 'No task context. Close and try again.',
        emptyAfterPrepare: 'Files were not processed. Try another photo or video.',
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
        dueBy: (time: string) => `by ${time}`,
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
          completeStopBlockedHint:
            'Mark your tasks at this property as done first, then complete the stop.',
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
        propertyTasksSectionTitle: 'Tasks at the property',
        propertyTasksDoneToggle: (n: number) => `Completed (${n})`,
        propertyTasksReopen: 'Reopen',
        propertyTasksReopenError: 'Could not put the task back in progress',
        completion: {
          thankTitle: 'Thank you — route finished',
          thankBody: 'All stops are marked complete. Have a good break until the next shift.',
          backOverview: 'Back to overview',
          tomorrowCta: 'Tomorrow’s plan',
          stopsDetails: 'Route stops',
          offRouteTasksTitle: 'Off-route tasks',
          stopExpandHint: 'Tap to expand',
        },
      },
      dashboard: {
        pageTitle: 'Overview',
        routeAssignedTitle: 'You have an assigned route',
        routeInProgressTitle: 'Route in progress',
        routeCompletedTitle: 'Route completed',
        routeLine: (stops: number, date: string) => `${stops} stops · ${date}`,
        progressShort: (done: number, total: number) => `${done} of ${total} done`,
        ctaStart: 'Start route',
        ctaStarting: 'Starting…',
        ctaContinue: 'Continue route',
        ctaOpenRoute: 'Open route',
        emptyTitle: 'No active route right now',
        emptyBody:
          'When a manager assigns a route, a card will appear here. Refresh or open Tasks — there may be work outside the route.',
        emptyActiveCompletedTitle: 'All today’s routes are finished',
        emptyActiveCompletedBody:
          'Completed routes and stops are in History (clock icon, top right).',
        refresh: 'Refresh',
        sectionToday: 'Today',
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
    staffShell: {
      themeToggle: {
        switchToDarkAria: 'Use dark theme',
        switchToLightAria: 'Use light theme',
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
