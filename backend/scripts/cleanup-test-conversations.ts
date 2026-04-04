/**
 * Удаляет тестовые диалоги инбокса и связанные сообщения (чат + email-тред + эскалации).
 * Каналы: web_app и email.
 *
 * Критерии — явные тестовые идентификаторы + гость Tsveiuk / превью эскалации (см. SQL).
 *
 * Запуск из каталога backend: pnpm cleanup:test-conversations
 */
import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';

/** Ключи вида email:... — в нижнем регистре, как в БД. */
const EXTRA_EMAIL_KEYS = ['email:compncc1@gmail.com'];

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    const rows = (await qr.query(
      `SELECT c.id FROM conversations c
       WHERE c."channel" IN ('web_app', 'email')
         AND (
           LOWER(TRIM(COALESCE(c."externalGuestKey", ''))) = ANY($1::text[])
           OR LOWER(TRIM(COALESCE(c."externalGuestKey", ''))) LIKE '%compncc1@gmail.com%'
           OR TRIM(COALESCE(c."externalGuestKey", '')) ILIKE 'John Smith'
           OR TRIM(COALESCE(c."guestDisplayName", '')) ILIKE 'John Smith'
           OR TRIM(COALESCE(c."guestDisplayName", '')) ILIKE '%compncc1@gmail.com%'
           OR TRIM(COALESCE(c."guestDisplayName", '')) ILIKE '%Tsveiuk%'
           OR TRIM(COALESCE(c."lastMessagePreview", '')) ILIKE '%уточню это у хозяина%'
           OR LOWER(TRIM(COALESCE(c."externalGuestKey", ''))) LIKE '%t_optima@mail.ru%'
           OR TRIM(COALESCE(c."guestDisplayName", '')) ILIKE '%t_optima@mail.ru%'
           OR TRIM(COALESCE(c."guestDisplayName", '')) ILIKE '%guest-a%'
           OR TRIM(COALESCE(c."externalGuestKey", '')) ILIKE '%guest-a%'
           OR EXISTS (
             SELECT 1 FROM properties p
             WHERE p.id = c."propertyId" AND p.name ILIKE '%zodomus 1test%'
           )
         )`,
      [EXTRA_EMAIL_KEYS],
    )) as { id: string }[];

    const convIds = rows.map((r) => r.id);

    const threadRows = (await (convIds.length > 0
      ? qr.query(
          `SELECT t.id FROM messaging_threads t
           WHERE t.conversation_id = ANY($1::uuid[])
              OR TRIM(COALESCE(t.guest_name, '')) ILIKE '%Tsveiuk%'
              OR LOWER(TRIM(COALESCE(t.guest_email, ''))) LIKE '%tsveiuk%'
              OR LOWER(TRIM(COALESCE(t.guest_email, ''))) LIKE '%t_optima@mail.ru%'
              OR TRIM(COALESCE(t.guest_name, '')) ILIKE '%guest-a%'
              OR EXISTS (
                SELECT 1 FROM properties p
                WHERE p.id = t.property_id AND p.name ILIKE '%zodomus 1test%'
              )`,
          [convIds],
        )
      : qr.query(
          `SELECT t.id FROM messaging_threads t
           WHERE TRIM(COALESCE(t.guest_name, '')) ILIKE '%Tsveiuk%'
              OR LOWER(TRIM(COALESCE(t.guest_email, ''))) LIKE '%tsveiuk%'
              OR LOWER(TRIM(COALESCE(t.guest_email, ''))) LIKE '%t_optima@mail.ru%'
              OR TRIM(COALESCE(t.guest_name, '')) ILIKE '%guest-a%'
              OR EXISTS (
                SELECT 1 FROM properties p
                WHERE p.id = t.property_id AND p.name ILIKE '%zodomus 1test%'
              )`,
        ))) as { id: string }[];

    const threadIds = threadRows.map((r) => r.id);

    if (convIds.length === 0 && threadIds.length === 0) {
      // eslint-disable-next-line no-console
      console.log('cleanup-test-conversations: совпадений нет.');
      await qr.commitTransaction();
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `cleanup-test-conversations: диалогов: ${convIds.length}, email-тредов: ${threadIds.length} — удаление…`,
    );

    if (convIds.length > 0) {
      await qr.query(
        `DELETE FROM escalations WHERE "conversationId" = ANY($1::uuid[])
           OR "guestMessageId" IN (
             SELECT id FROM chat_messages WHERE "conversationId" = ANY($1::uuid[])
           )`,
        [convIds],
      );
      await qr.query(`DELETE FROM chat_messages WHERE "conversationId" = ANY($1::uuid[])`, [convIds]);
      await qr.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [convIds]);
    }

    if (threadIds.length > 0) {
      await qr.query(`DELETE FROM messaging_messages WHERE thread_id = ANY($1::uuid[])`, [threadIds]);
      await qr.query(`DELETE FROM messaging_threads WHERE id = ANY($1::uuid[])`, [threadIds]);
    }

    await qr.commitTransaction();
    // eslint-disable-next-line no-console
    console.log('cleanup-test-conversations: готово.');
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
