import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { ZODOMUS_CLIENT } from '../zodomus.tokens';
import type { ZodomusClient } from '../zodomus.client';
import { ZodomusAirbnbHostEntity } from './airbnb-host.entity';
import {
  AIRBNB_PILOT_LISTING_IDS,
  airbnbAuthUrl,
  isAirbnbPilotListing,
  parseHostActivation,
  parseHostStatus,
  parseListings,
  type AirbnbListingView,
} from './airbnb-pilot.util';

/** GET /airbnb-listings gives up to 50 per page; a host with more than this many pages is not read further. */
const MAX_LISTING_PAGES = 3;

export interface AirbnbHostView {
  enabled: boolean;
  pilotListingIds: readonly string[];
  /** null — the host was never connected. */
  host: {
    statusCode: number | null;
    statusText: string | null;
    active: boolean;
    checkedAt: string | null;
    /** The page where the host allows Zodomus — while the host is not active yet. */
    authUrl: string | null;
  } | null;
}

export interface AirbnbListingsView {
  /** The pilot listing as Airbnb shows it, or null when the host does not have it. */
  pilot: AirbnbListingView | null;
  /** Other listings on the pages read: only counted, never shown or touched. */
  others: number;
  /** The host has more pages than were read (reading stops once the pilot listing is found). */
  truncated: boolean;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  return typeof v === 'string' && ['true', '1', 'yes'].includes(v.toLowerCase());
}

/**
 * Connecting the owner's Airbnb host through Zodomus. Nothing here writes to a listing: the host
 * activation only creates an authorization request that the host accepts on airbnb.com himself.
 */
@Injectable()
export class AirbnbConnectService {
  private readonly logger = new Logger(AirbnbConnectService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ZodomusAirbnbHostEntity) private readonly hosts: Repository<ZodomusAirbnbHostEntity>,
    @Optional() @Inject(ZODOMUS_CLIENT) private readonly client: ZodomusClient | null,
  ) {}

  get isEnabled(): boolean {
    return this.client != null && toBool(this.config.get('ZODOMUS_AIRBNB_ENABLED'));
  }

  private assertOn(): ZodomusClient {
    if (!this.client) throw new ServiceUnavailableException('Zodomus выключен (ZODOMUS_ENABLED=false)');
    if (!toBool(this.config.get('ZODOMUS_AIRBNB_ENABLED'))) {
      throw new ServiceUnavailableException('Airbnb выключен (ZODOMUS_AIRBNB_ENABLED=false)');
    }
    return this.client;
  }

  private async table<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof QueryFailedError && (e as { driverError?: { code?: string } }).driverError?.code === '42P01') {
        throw new ServiceUnavailableException(
          'Таблица Airbnb не создана: запустите миграцию 1778900000000-zodomus-airbnb-hosts',
        );
      }
      throw e;
    }
  }

  private view(row: ZodomusAirbnbHostEntity | null): AirbnbHostView {
    const active = row?.statusCode === 5;
    return {
      enabled: true,
      pilotListingIds: AIRBNB_PILOT_LISTING_IDS,
      host: row
        ? {
            statusCode: row.statusCode,
            statusText: row.statusText,
            active,
            checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
            authUrl: active ? null : airbnbAuthUrl(row.clientId, row.token),
          }
        : null,
    };
  }

  /** What is stored — no call to Zodomus. Off: `{ enabled: false }` (never 503, the UI uses it to hide the block). */
  async status(user: JwtPayload): Promise<AirbnbHostView> {
    if (!this.isEnabled) return { enabled: false, pilotListingIds: AIRBNB_PILOT_LISTING_IDS, host: null };
    const row = await this.table(() => this.hosts.findOne({ where: { ownerId: user.sub } }));
    return this.view(row);
  }

  /**
   * POST /airbnb-host-activation → a new token and the authorization page for the host. An active host is not
   * activated again (the stored one is returned as it is).
   */
  async activate(user: JwtPayload): Promise<AirbnbHostView> {
    const client = this.assertOn();
    const existing = await this.table(() => this.hosts.findOne({ where: { ownerId: user.sub } }));
    if (existing?.statusCode === 5) return this.view(existing);
    const body = await client.post<unknown>('/airbnb-host-activation', {});
    const parsed = parseHostActivation(body);
    if (!parsed) {
      this.logger.warn('Airbnb host-activation: no token / client_id in the answer');
      throw new BadGatewayException('Zodomus не вернул token / client_id для подключения Airbnb');
    }
    const row = this.hosts.create({
      ownerId: user.sub,
      token: parsed.token,
      clientId: parsed.clientId,
      statusCode: null,
      statusText: null,
      checkedAt: null,
    });
    await this.table(() => this.hosts.save(row));
    return this.view(row);
  }

  /** GET /airbnb-host-status for the stored token — after the host allowed access on Airbnb. */
  async refresh(user: JwtPayload): Promise<AirbnbHostView> {
    const client = this.assertOn();
    const row = await this.table(() => this.hosts.findOne({ where: { ownerId: user.sub } }));
    if (!row) return this.view(null);
    const s = parseHostStatus(await client.get<unknown>('/airbnb-host-status', { token: row.token }));
    row.statusCode = s.code;
    row.statusText = s.text;
    row.checkedAt = new Date();
    await this.table(() => this.hosts.save(row));
    return this.view(row);
  }

  /**
   * GET /airbnb-listings of the active host → only the pilot listing is returned; the others are counted.
   * Reads at most MAX_LISTING_PAGES pages and stops as soon as the pilot listing is found.
   */
  async listings(user: JwtPayload): Promise<AirbnbListingsView> {
    const client = this.assertOn();
    const row = await this.table(() => this.hosts.findOne({ where: { ownerId: user.sub } }));
    if (!row || row.statusCode !== 5) {
      throw new ServiceUnavailableException('Хозяин Airbnb не подключён: сначала «Подключить» и «Проверить статус»');
    }
    let pilot: AirbnbListingView | null = null;
    let others = 0;
    let cursor: string | null = null;
    let pages = 0;
    do {
      const params: Record<string, string> = { token: row.token };
      if (cursor) params._cursor = cursor;
      const page = parseListings(await client.get<unknown>('/airbnb-listings', params));
      pages++;
      for (const l of page.listings) {
        if (!pilot && isAirbnbPilotListing(l.id)) pilot = l;
        else others++;
      }
      cursor = page.nextCursor;
    } while (cursor && !pilot && pages < MAX_LISTING_PAGES);
    return { pilot, others, truncated: cursor != null };
  }
}
