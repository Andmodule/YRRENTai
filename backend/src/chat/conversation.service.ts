import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from './entities/conversation.entity';
import {
  type ConversationStatus,
  type ConversationChannel,
  type ConversationPublicDto,
} from '@rentai/shared';

/** Strip `email:` prefix and optional `|reservation:…` from inbox external key. */
function guestEmailFromExternalGuestKey(key: string | null | undefined): string | null {
  const raw = key?.trim();
  if (!raw?.startsWith('email:')) return null;
  let s = raw.slice('email:'.length);
  const pipeIdx = s.indexOf('|reservation:');
  if (pipeIdx >= 0) s = s.slice(0, pipeIdx);
  const email = s.trim().toLowerCase();
  return email || null;
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly repo: Repository<ConversationEntity>,
  ) {}

  /**
   * Inbox key for email mirroring: one conversation per (property, email) or per
   * (property, email, reservation) when OTA reservation id is known — same email, different booking → different row.
   */
  buildEmailExternalGuestKey(guestEmail: string, reservationId: string | null | undefined): string {
    const email = guestEmail.trim().toLowerCase();
    const rid = reservationId?.trim();
    if (rid) {
      return `email:${email}|reservation:${rid}`;
    }
    return `email:${email}`;
  }

  async findOrCreate(
    propertyId: string,
    channel: ConversationChannel = 'web_app',
    externalGuestKey?: string,
  ): Promise<ConversationEntity> {
    const existing = await this.repo.findOne({
      where: { propertyId, channel, ...(externalGuestKey ? { externalGuestKey } : {}) },
      order: { lastActivityAt: 'DESC' },
    });

    // One thread per guest (property + channel + key). Reuse even if previously resolved;
    // callers (e.g. chat gateway) reopen the conversation when the guest writes again.
    if (existing) {
      return existing;
    }

    const conv = this.repo.create({
      propertyId,
      channel,
      externalGuestKey,
      status: 'ai_handling',
    });
    return this.repo.save(conv);
  }

  /**
   * Inbox row for this guest — same key rules as {@link buildEmailExternalGuestKey}.
   * Channel is not filtered — legacy or edge rows may differ from `email` while keeping the same key.
   */
  async findEmailConversationIdByGuestEmail(
    propertyId: string,
    guestEmailLower: string,
    reservationId?: string | null,
  ): Promise<string | null> {
    const key = this.buildEmailExternalGuestKey(guestEmailLower, reservationId ?? null);
    const row = await this.repo.findOne({
      where: {
        propertyId,
        externalGuestKey: key,
      },
      order: { lastActivityAt: 'DESC' },
    });
    return row?.id ?? null;
  }

  async findById(id: string): Promise<ConversationEntity> {
    const conv = await this.repo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async setStatus(id: string, status: ConversationStatus): Promise<ConversationEntity> {
    const conv = await this.findById(id);
    conv.status = status;
    conv.updatedAt = new Date();
    return this.repo.save(conv);
  }

  async touch(id: string, preview?: string): Promise<void> {
    const upd: Partial<ConversationEntity> = { lastActivityAt: new Date() };
    if (preview !== undefined) {
      upd.lastMessagePreview = preview.slice(0, 200);
    }
    await this.repo.update(id, upd);
  }

  /** Имя гостя из OTA (Booking и т.д.) для заголовка инбокса; ключ в `externalGuestKey` не меняем. */
  async setGuestDisplayName(id: string, displayName: string | null | undefined): Promise<void> {
    const t = displayName?.trim();
    if (!t) return;
    await this.repo.update(id, { guestDisplayName: t, updatedAt: new Date() });
  }

  async listForOwner(
    ownerId: string,
    filters: { propertyId?: string; status?: ConversationStatus; page: number; limit: number },
  ) {
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c."propertyId" IN (SELECT id FROM properties WHERE "ownerId" = :ownerId)', {
        ownerId,
      });

    if (filters.propertyId) {
      qb.andWhere('c."propertyId" = :pid', { pid: filters.propertyId });
    }
    if (filters.status) {
      qb.andWhere('c.status = :status', { status: filters.status });
    }

    qb.orderBy('c."lastActivityAt"', 'DESC');
    qb.skip((filters.page - 1) * filters.limit).take(filters.limit);

    const [items, total] = await qb.getManyAndCount();

    const displayNameFallbacks = await this.resolveMissingGuestDisplayNames(items);

    const propertyNames = await this.resolvePropertyNames(
      items.map((i) => i.propertyId),
    );

    const data: ConversationPublicDto[] = items.map((c) => ({
      id: c.id,
      propertyId: c.propertyId,
      propertyName: propertyNames.get(c.propertyId) ?? '',
      channel: c.channel,
      status: c.status,
      externalGuestKey: c.externalGuestKey ?? null,
      guestDisplayName:
        c.guestDisplayName?.trim() ||
        displayNameFallbacks.get(c.id) ||
        null,
      lastMessagePreview: c.lastMessagePreview ?? null,
      lastActivityAt: c.lastActivityAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    }));

    return {
      data,
      meta: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  private async resolvePropertyNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const unique = [...new Set(ids)];
    const rows: { id: string; name: string }[] = await this.repo.query(
      `SELECT id, name FROM properties WHERE id = ANY($1)`,
      [unique],
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * Inbox list: show OTA guest name even when `guestDisplayName` was never backfilled
   * (legacy rows before inbound parse fix).
   */
  private async resolveMissingGuestDisplayNames(
    conversations: ConversationEntity[],
  ): Promise<Map<string, string>> {
    const missing = conversations.filter((c) => !c.guestDisplayName?.trim());
    if (missing.length === 0) return new Map();

    const ids = missing.map((c) => c.id);
    const out = new Map<string, string>();

    const threadRows: { conversation_id: string; guest_name: string }[] = await this.repo.query(
      `
      SELECT DISTINCT ON (conversation_id) conversation_id, trim(guest_name) AS guest_name
      FROM messaging_threads
      WHERE conversation_id = ANY($1)
        AND guest_name IS NOT NULL
        AND trim(guest_name) <> ''
      ORDER BY conversation_id, updated_at DESC NULLS LAST
      `,
      [ids],
    );
    for (const row of threadRows) {
      if (row.guest_name) out.set(row.conversation_id, row.guest_name);
    }

    const metaRows: { conversation_id: string; guest_name: string }[] = await this.repo.query(
      `
      SELECT DISTINCT ON ("conversationId")
        "conversationId" AS conversation_id,
        trim(coalesce(metadata->>'guestName', metadata->'bookingCom'->>'guestName')) AS guest_name
      FROM chat_messages
      WHERE "conversationId" = ANY($1)
        AND role = 'user'
        AND metadata IS NOT NULL
        AND trim(coalesce(metadata->>'guestName', metadata->'bookingCom'->>'guestName', '')) <> ''
      ORDER BY "conversationId", "createdAt" ASC
      `,
      [ids],
    );
    for (const row of metaRows) {
      if (row.guest_name && !out.has(row.conversation_id)) {
        out.set(row.conversation_id, row.guest_name);
      }
    }

    const emailsByConv = new Map<string, string>();
    const emails: string[] = [];
    for (const c of missing) {
      if (out.has(c.id)) continue;
      const email = guestEmailFromExternalGuestKey(c.externalGuestKey);
      if (!email || email.includes('noreply@')) continue;
      emailsByConv.set(c.id, email);
      emails.push(email);
    }

    if (emails.length > 0) {
      const bookingRows: { guest_email_alias: string; guest_name: string }[] = await this.repo.query(
        `
        SELECT DISTINCT ON (lower(trim(guest_email_alias)))
          lower(trim(guest_email_alias)) AS guest_email_alias,
          trim("guestName") AS guest_name
        FROM bookings
        WHERE guest_email_alias IS NOT NULL
          AND trim(guest_email_alias) <> ''
          AND trim("guestName") <> ''
          AND lower(trim(guest_email_alias)) = ANY($1)
        ORDER BY lower(trim(guest_email_alias)), "checkIn" DESC NULLS LAST
        `,
        [[...new Set(emails)]],
      );
      const nameByEmail = new Map(
        bookingRows.map((r) => [r.guest_email_alias, r.guest_name]),
      );
      for (const [convId, email] of emailsByConv) {
        const name = nameByEmail.get(email);
        if (name) out.set(convId, name);
      }
    }

    return out;
  }
}
