/**
 * Удаляет все объекты из `properties`, кроме трёх по точному имени (после TRIM),
 * и связанные с удаляемыми объектами чаты / треды / сообщения.
 *
 * Оставляемые имена (как в БД):
 *   - zodomus 1test
 *   - K22 Large Family Apart Komputerowa
 *   - K22 Komputerowa 7 Chopin Airport
 *
 * По умолчанию только dry-run (список к удалению). Реальное удаление:
 *   pnpm cleanup:properties-keep-three -- --execute
 *
 * Запуск из каталога backend (нужен DATABASE_URL в .env).
 */
import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';

const KEEP_NAMES = [
  'zodomus 1test',
  'K22 Large Family Apart Komputerowa',
  'K22 Komputerowa 7 Chopin Airport',
] as const;

const EXECUTE = process.argv.includes('--execute');

async function runOptional(qr: ReturnType<typeof AppDataSource.createQueryRunner>, sql: string, params: unknown[]) {
  try {
    return await qr.query(sql, params);
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : '';
    if (code === '42P01') {
      // eslint-disable-next-line no-console
      console.warn(`[skip] таблица отсутствует: ${sql.slice(0, 72)}…`);
      return;
    }
    throw e;
  }
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();

  const keepRows = (await qr.query(
    `SELECT id, name FROM properties WHERE TRIM(name) = ANY($1::text[]) ORDER BY name`,
    [KEEP_NAMES],
  )) as { id: string; name: string }[];

  if (keepRows.length !== KEEP_NAMES.length) {
    const all = (await qr.query(`SELECT id, name FROM properties ORDER BY name`)) as { id: string; name: string }[];
    // eslint-disable-next-line no-console
    console.error(
      `Ожидалось ровно ${KEEP_NAMES.length} объекта с указанными именами, найдено ${keepRows.length}.`,
    );
    // eslint-disable-next-line no-console
    console.error('Найденные совпадения:', keepRows);
    // eslint-disable-next-line no-console
    console.error('Все объекты в БД:', all);
    await qr.release();
    await AppDataSource.destroy();
    process.exit(1);
  }

  const keepIds = keepRows.map((r) => r.id);

  const delRows = (await qr.query(`SELECT id, name FROM properties WHERE id != ALL($1::uuid[]) ORDER BY name`, [
    keepIds,
  ])) as { id: string; name: string }[];

  // eslint-disable-next-line no-console
  console.log(`Оставляем (${keepRows.length}):`, keepRows.map((r) => `${r.name} [${r.id}]`).join('\n  '));
  // eslint-disable-next-line no-console
  console.log(`К удалению (${delRows.length}):`, delRows.map((r) => `${r.name} [${r.id}]`).join('\n  '));

  if (delRows.length === 0) {
    // eslint-disable-next-line no-console
    console.log('Нечего удалять.');
    await qr.release();
    await AppDataSource.destroy();
    return;
  }

  if (!EXECUTE) {
    // eslint-disable-next-line no-console
    console.log('\nDry-run. Для удаления добавьте флаг: --execute');
    await qr.release();
    await AppDataSource.destroy();
    return;
  }

  const del = delRows.map((r) => r.id);

  await qr.startTransaction();
  try {
    const p = [del];

    // ── Voice / calls (если таблицы есть) ─────────────────────────────
    // Правила каскадно убирают связанные алерты; затем — «висячие» алерты по propertyId.
    await runOptional(qr, `DELETE FROM voice_alert_rules WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM voice_alerts WHERE "propertyId" = ANY($1::uuid[])`, p);
    // Дочерние строки сессии обычно ON DELETE CASCADE — одного DELETE достаточно.
    await runOptional(qr, `DELETE FROM call_sessions WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM voice_audit_logs WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM property_voice_rollout WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM property_voice_policies WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Billing / KB / staff interp / automations ─────────────────────
    await runOptional(qr, `DELETE FROM token_usage WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM knowledge_base_entries WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM staff_interpretation_events WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM automation_rules WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Operations ────────────────────────────────────────────────────
    await runOptional(qr, `DELETE FROM inventory_items WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM property_listing_translations WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Incidents (ссылаются на tasks — раньше tasks) ─────────────────
    await runOptional(qr, `DELETE FROM incidents WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Tasks (notes → tasks) ─────────────────────────────────────────
    await runOptional(
      qr,
      `DELETE FROM task_checklist_items WHERE "taskId" IN (SELECT id FROM tasks WHERE "propertyId" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(
      qr,
      `DELETE FROM task_notes WHERE "taskId" IN (SELECT id FROM tasks WHERE "propertyId" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(qr, `DELETE FROM tasks WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Checklists (пункты каскадом с шаблонов) ─────────────────────────
    await runOptional(qr, `DELETE FROM checklist_templates WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Bookings ──────────────────────────────────────────────────────
    await runOptional(qr, `DELETE FROM bookings WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Escalations (до chat_messages / conversations) ───────────────
    await runOptional(
      qr,
      `DELETE FROM escalations WHERE "guestMessageId" IN (SELECT id FROM chat_messages WHERE "propertyId" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(
      qr,
      `DELETE FROM escalations WHERE "conversationId" IN (SELECT id FROM conversations WHERE "propertyId" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(
      qr,
      `DELETE FROM escalations WHERE "messagingThreadId" IN (SELECT id FROM messaging_threads WHERE "property_id" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(qr, `DELETE FROM escalations WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Messaging (email threads) ─────────────────────────────────────
    await runOptional(
      qr,
      `DELETE FROM messaging_attachments WHERE message_id IN (SELECT id FROM messaging_messages WHERE thread_id IN (SELECT id FROM messaging_threads WHERE "property_id" = ANY($1::uuid[])))`,
      p,
    );
    await runOptional(
      qr,
      `DELETE FROM messaging_messages WHERE thread_id IN (SELECT id FROM messaging_threads WHERE "property_id" = ANY($1::uuid[]))`,
      p,
    );
    await runOptional(qr, `DELETE FROM messaging_threads WHERE "property_id" = ANY($1::uuid[])`, p);

    // ── Inbox chat UI ─────────────────────────────────────────────────
    await runOptional(qr, `DELETE FROM chat_messages WHERE "propertyId" = ANY($1::uuid[])`, p);
    await runOptional(qr, `DELETE FROM conversations WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Channel listings (на случай если нет ON DELETE CASCADE) ───────
    await runOptional(qr, `DELETE FROM property_channel_listings WHERE "propertyId" = ANY($1::uuid[])`, p);

    // ── Свойства ─────────────────────────────────────────────────────
    await qr.query(`DELETE FROM properties WHERE id = ANY($1::uuid[])`, p);

    await qr.commitTransaction();
    // eslint-disable-next-line no-console
    console.log(`Удалено объектов: ${delRows.length}. Транзакция зафиксирована.`);
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
