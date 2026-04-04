import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboundSenderFilterSettingsEntity } from './entities/inbound-sender-filter-settings.entity';

const DEFAULT_ID = 'default';

const DEFAULT_HOSTS = ['guest.booking.com', 'mchat.booking.com'];

@Injectable()
export class InboundSenderFilterService {
  private readonly logger = new Logger(InboundSenderFilterService.name);
  private cache: { expires: number; allowedHosts: Set<string>; allowGmailGooglemail: boolean } | null =
    null;
  private readonly cacheTtlMs = 10_000;

  constructor(
    @InjectRepository(InboundSenderFilterSettingsEntity)
    private readonly repo: Repository<InboundSenderFilterSettingsEntity>,
  ) {}

  async getSettings(): Promise<{ allowedHosts: string[]; allowGmailGooglemail: boolean; updatedAt: string }> {
    const row = await this.ensureRow();
    return {
      allowedHosts: [...row.allowedHosts],
      allowGmailGooglemail: row.allowGmailGooglemail,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateSettings(patch: {
    allowedHosts?: string[];
    allowGmailGooglemail?: boolean;
  }): Promise<{ allowedHosts: string[]; allowGmailGooglemail: boolean; updatedAt: string }> {
    const row = await this.ensureRow();
    let dirty = false;
    if (patch.allowedHosts !== undefined) {
      row.allowedHosts = normalizeHostList(patch.allowedHosts);
      dirty = true;
    }
    if (patch.allowGmailGooglemail !== undefined) {
      row.allowGmailGooglemail = patch.allowGmailGooglemail;
      dirty = true;
    }
    if (dirty) {
      await this.repo.save(row);
      this.cache = null;
      this.logger.log(
        `Inbound sender filter updated: hosts=[${row.allowedHosts.join(', ')}] allowGmail=${row.allowGmailGooglemail}`,
      );
    }
    return this.getSettings();
  }

  /** Used by Resend webhook — short-lived cache to limit DB reads. */
  async isSenderHostAllowed(host: string): Promise<boolean> {
    const h = host.trim().toLowerCase();
    if (!h) return false;

    const now = Date.now();
    if (this.cache && this.cache.expires > now) {
      return this.matchHost(h, this.cache.allowedHosts, this.cache.allowGmailGooglemail);
    }

    const row = await this.ensureRow();
    const allowedHosts = new Set(row.allowedHosts.map((x) => x.trim().toLowerCase()).filter(Boolean));
    this.cache = {
      expires: now + this.cacheTtlMs,
      allowedHosts,
      allowGmailGooglemail: row.allowGmailGooglemail,
    };
    return this.matchHost(h, allowedHosts, row.allowGmailGooglemail);
  }

  private matchHost(
    host: string,
    allowedHosts: Set<string>,
    allowGmailGooglemail: boolean,
  ): boolean {
    if (allowedHosts.has(host)) return true;
    if (
      allowGmailGooglemail &&
      (host === 'gmail.com' || host === 'googlemail.com' || host.endsWith('.gmail.com') || host.endsWith('.googlemail.com'))
    ) {
      return true;
    }
    return false;
  }

  private async ensureRow(): Promise<InboundSenderFilterSettingsEntity> {
    let row = await this.repo.findOne({ where: { id: DEFAULT_ID } });
    if (!row) {
      row = this.repo.create({
        id: DEFAULT_ID,
        allowedHosts: [...DEFAULT_HOSTS],
        allowGmailGooglemail: false,
      });
      await this.repo.save(row);
    }
    return row;
  }
}

function normalizeHostList(hosts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hosts) {
    const h = raw.trim().toLowerCase();
    if (!h || h.length > 253 || /[\s<>]/.test(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  if (out.length === 0) {
    return [...DEFAULT_HOSTS];
  }
  return out;
}
