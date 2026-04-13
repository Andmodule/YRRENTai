import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, DataSource, In } from 'typeorm';
import { SupplyItemEntity } from './entities/supply-item.entity';
import { SupplyItemAliasEntity } from './entities/supply-item-alias.entity';
import { SupplyRequestItemEntity } from './entities/supply-request-item.entity';
import { StaffInterpretationEventEntity } from './entities/staff-interpretation-event.entity';
import { TaskEntity } from './entities/task.entity';
import { DeliveryRouteStopEntity } from './entities/delivery-route-stop.entity';
import { UserEntity } from '../user/entities/user.entity';
import { TasksGateway } from './tasks.gateway';
import { includeLineInSupplyMatrix } from './supply-matrix.util';
import { levenshteinDistance, maxFuzzyDistanceForLength } from './supply-catalog-fuzzy.util';

const DEFAULT_SEED: Array<{
  name: string;
  category: string;
  defaultUnit: string | null;
  aliases: string[];
}> = [
  {
    name: 'Туалетная бумага',
    category: 'consumables',
    defaultUnit: 'рулон',
    aliases: ['туалетная бумага', 'туал бумага', 'бумага', 'рулоны', 'рулон', 'тп', 'toilet paper', 'tp'],
  },
  {
    name: 'Полотенца',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: [
      'полотенца',
      'полотенце',
      'полоценце',
      'банные полотенца',
      'towels',
      'towel',
    ],
  },
  {
    name: 'Жидкое мыло / шампунь',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: ['мыло', 'шампунь', 'гель для душа', 'soap', 'shampoo'],
  },
  {
    name: 'Комплект расходников',
    category: 'consumables',
    defaultUnit: null,
    aliases: ['расходники', 'комплект расходников', 'набор расходников'],
  },
  {
    name: 'Постельное бельё',
    category: 'consumables',
    defaultUnit: 'комплект',
    aliases: ['бельё', 'белье', 'постельное', 'постель', 'смена белья', 'bed linen', 'linens', 'sheets'],
  },
  {
    name: 'Мешки для мусора',
    category: 'consumables',
    defaultUnit: 'рулон',
    aliases: ['мешки', 'пакеты для мусора', 'garbage bags', 'trash bags'],
  },
  {
    name: 'Стиральный порошок / капсулы',
    category: 'consumables',
    defaultUnit: 'упак.',
    aliases: ['порошок', 'капсулы для стирки', 'стирка', 'washing powder', 'laundry pods'],
  },
  {
    name: 'Чай / кофе / сахар',
    category: 'consumables',
    defaultUnit: 'набор',
    aliases: ['чай', 'кофе', 'сахар', 'tea', 'coffee', 'sugar'],
  },
  {
    name: 'Вода питьевая',
    category: 'consumables',
    defaultUnit: 'бут.',
    aliases: ['вода', 'бутилированная вода', 'water bottles', 'drinking water'],
  },
  {
    name: 'Губки / средство для посуды',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: ['губки', 'для посуды', 'моющее для посуды', 'sponges', 'dish soap'],
  },
  {
    name: 'Универсальное моющее средство',
    category: 'consumables',
    defaultUnit: 'фл.',
    aliases: ['моющее', 'средство для уборки', 'cleaning spray', 'all-purpose cleaner'],
  },
  {
    name: 'Туалетный ершик / щётка',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: ['ершик', 'щётка для унитаза', 'toilet brush'],
  },
  {
    name: 'Бумажные салфетки',
    category: 'consumables',
    defaultUnit: 'упак.',
    aliases: ['салфетки', 'салфетка', 'tissues', 'paper napkins'],
  },
  {
    name: 'Одноразовые зубные наборы',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: ['зубная щётка', 'паста', 'зубные наборы', 'dental kit', 'toothbrush'],
  },
  {
    name: 'Дрова / растопка',
    category: 'specificity',
    defaultUnit: 'охапка',
    aliases: ['дрова', 'поленья', 'растопка', 'firewood', 'kindling'],
  },
  {
    name: 'Вывоз мусора',
    category: 'logistics',
    defaultUnit: null,
    aliases: ['мусор', 'вывоз мусора', 'контейнер', 'garbage pickup', 'trash removal'],
  },
  {
    name: 'Передача ключей / доступ',
    category: 'logistics',
    defaultUnit: null,
    aliases: ['ключи', 'ключ', 'передать ключи', 'keys', 'key handover'],
  },
  {
    name: 'Средство для стёкол и зеркал',
    category: 'consumables',
    defaultUnit: 'фл.',
    aliases: ['для стёкол', 'для зеркал', 'glass cleaner', 'window cleaner'],
  },
  {
    name: 'Пакеты для стирки',
    category: 'consumables',
    defaultUnit: 'шт',
    aliases: ['мешочки для стирки', 'laundry bags', 'wash bags'],
  },
  {
    name: 'Ковёр',
    category: 'specificity',
    defaultUnit: 'шт',
    aliases: ['ковер', 'ковёр', 'ковры', 'коврик', 'carpet', 'rug'],
  },
];

/** Нормализованные канонические имена из сида — при равном скоре выбираем их, а не дубликаты. */
const SEED_CANONICAL_NAME_NORM = new Set(
  DEFAULT_SEED.map((r) => r.name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')),
);

@Injectable()
export class SupplyCatalogService {
  constructor(
    @InjectRepository(SupplyItemEntity)
    private readonly itemRepo: Repository<SupplyItemEntity>,
    @InjectRepository(SupplyItemAliasEntity)
    private readonly aliasRepo: Repository<SupplyItemAliasEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly tasksGateway: TasksGateway,
  ) {}

  static normalizeAlias(s: string): string {
    return s
      .trim()
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ');
  }

  /**
   * Идемпотентно дополняет справочник типовыми позициями: новые компании получают полный набор,
   * существующие — только отсутствующие по нормализованному названию.
   */
  async ensureDefaultCatalogForCompany(companyId: string): Promise<void> {
    const existing = await this.itemRepo.find({
      where: { companyId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const haveName = new Set(existing.map((it) => SupplyCatalogService.normalizeAlias(it.name)));
    const toInsert = DEFAULT_SEED.filter((row) => !haveName.has(SupplyCatalogService.normalizeAlias(row.name)));
    if (toInsert.length) {
      await this.dataSource.transaction(async (m) => {
        let order = existing.length;
        for (const row of toInsert) {
          const item = m.create(SupplyItemEntity, {
            companyId,
            name: row.name,
            category: row.category,
            defaultUnit: row.defaultUnit,
            sortOrder: order++,
            createdByUserId: null,
          });
          const saved = await m.save(item);
          const aliases = new Set<string>([
            SupplyCatalogService.normalizeAlias(row.name),
            ...row.aliases.map((a) => SupplyCatalogService.normalizeAlias(a)),
          ]);
          for (const a of aliases) {
            if (a.length < 2) continue;
            await m.save(
              m.create(SupplyItemAliasEntity, {
                supplyItemId: saved.id,
                aliasNormalized: a,
              }),
            );
          }
        }
      });
    }
    await this.patchExtraAliasesForCompany(companyId);
    await this.mergeTypoCatalogDuplicates(companyId);
  }

  /**
   * Доп. алиасы к уже созданным позициям (опечатки вроде «полоценце» → Полотенца).
   */
  private async patchExtraAliasesForCompany(companyId: string): Promise<void> {
    const rules: Array<{ targetNorm: string; extra: string[] }> = [
      { targetNorm: 'полотенца', extra: ['полоценце', 'полотенцо'] },
      { targetNorm: 'ковёр', extra: ['ковер', 'ковёр'] },
    ];
    const items = await this.itemRepo.find({ where: { companyId }, relations: ['aliases'] });
    for (const { targetNorm, extra } of rules) {
      const item = items.find((it) => SupplyCatalogService.normalizeAlias(it.name) === targetNorm);
      if (!item) continue;
      const have = new Set((item.aliases ?? []).map((a) => a.aliasNormalized));
      for (const ex of extra) {
        const n = SupplyCatalogService.normalizeAlias(ex);
        if (n.length < 2 || have.has(n)) continue;
        await this.aliasRepo.save(
          this.aliasRepo.create({
            supplyItemId: item.id,
            aliasNormalized: n,
          }),
        );
        have.add(n);
      }
    }
  }

  /**
   * Если в справочнике завели отдельную строку с опечаткой (дубликат), переносим строки на канон.
   */
  private async mergeTypoCatalogDuplicates(companyId: string): Promise<void> {
    const pairs: Array<{ wrongNorm: string; keepNorm: string }> = [
      { wrongNorm: 'полоценце', keepNorm: 'полотенца' },
    ];
    const items = await this.itemRepo.find({ where: { companyId } });
    for (const { wrongNorm, keepNorm } of pairs) {
      const keep = items.find((it) => SupplyCatalogService.normalizeAlias(it.name) === keepNorm);
      const wrong = items.find((it) => SupplyCatalogService.normalizeAlias(it.name) === wrongNorm);
      if (!keep || !wrong || keep.id === wrong.id) continue;
      await this.dataSource.transaction(async (m) => {
        await m.query(`UPDATE supply_request_items SET "supplyItemId" = $1 WHERE "supplyItemId" = $2`, [
          keep.id,
          wrong.id,
        ]);
        await m.delete(SupplyItemAliasEntity, { supplyItemId: wrong.id });
        await m.delete(SupplyItemEntity, { id: wrong.id });
      });
      this.tasksGateway.emitSupplyInterpretationsChanged();
    }
  }

  /** Повторно сопоставить строки без каталога (после улучшения алиасов / нечёткого матча). */
  async reresolveUnmappedSupplyLines(companyId: string, limit = 120): Promise<number> {
    const rows = (await this.dataSource.query(
      `
      SELECT sri.id
      FROM supply_request_items sri
      INNER JOIN staff_interpretation_events e ON e.id = sri."interpretationEventId"
      WHERE e."companyId" = $1
        AND sri."supplyItemId" IS NULL
      ORDER BY sri."createdAt" DESC
      LIMIT $2
    `,
      [companyId, limit],
    )) as { id: string }[];
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (!ids.length) return 0;
    await this.applyResolutionToRequestLines(companyId, ids);
    return ids.length;
  }

  async listItemsForCompany(companyId: string): Promise<
    Array<{
      id: string;
      name: string;
      category: string;
      defaultUnit: string | null;
      aliases: string[];
    }>
  > {
    await this.ensureDefaultCatalogForCompany(companyId);
    const items = await this.itemRepo.find({
      where: { companyId },
      order: { sortOrder: 'ASC', name: 'ASC' },
      relations: ['aliases'],
    });
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      category: it.category,
      defaultUnit: it.defaultUnit,
      aliases: (it.aliases ?? []).map((a) => a.aliasNormalized),
    }));
  }

  /** Строки для system prompt LLM */
  async getCatalogPromptFragment(companyId: string): Promise<string> {
    await this.ensureDefaultCatalogForCompany(companyId);
    const items = await this.itemRepo.find({
      where: { companyId },
      relations: ['aliases'],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    if (!items.length) return '';
    const lines = items.map((it) => {
      const als = [...new Set((it.aliases ?? []).map((a) => a.aliasNormalized))].filter(Boolean);
      return `- "${it.name}" (synonyms: ${als.slice(0, 12).join(', ')})`;
    });
    return `\nCompany catalog items (map extracted "items[].name" to the closest catalog name when possible):\n${lines.join('\n')}\n`;
  }

  /**
   * Подбор номенклатуры: подстрока/равенство, затем нечёткое совпадение (опечатки).
   * При равном скоре предпочитаем позиции из типового сида, а не дубликаты вручную.
   */
  async resolveRawNameToCatalogItem(
    companyId: string,
    rawName: string,
  ): Promise<{ supplyItemId: string; canonicalName: string; defaultUnit: string | null } | null> {
    await this.ensureDefaultCatalogForCompany(companyId);
    const normFull = SupplyCatalogService.normalizeAlias(rawName);
    if (normFull.length < 2) return null;

    const items = await this.itemRepo.find({
      where: { companyId },
      relations: ['aliases'],
    });

    type HitBase = {
      supplyItemId: string;
      canonicalName: string;
      defaultUnit: string | null;
      score: number;
      nameNorm: string;
    };
    const exactHits: HitBase[] = [];

    for (const it of items) {
      const candidates: string[] = [
        SupplyCatalogService.normalizeAlias(it.name),
        ...(it.aliases ?? []).map((a) => a.aliasNormalized),
      ];
      const nameNorm = SupplyCatalogService.normalizeAlias(it.name);
      for (const cand of candidates) {
        if (cand.length < 2) continue;
        if (normFull === cand || normFull.includes(cand) || cand.includes(normFull)) {
          exactHits.push({
            supplyItemId: it.id,
            canonicalName: it.name,
            defaultUnit: it.defaultUnit,
            score: cand.length,
            nameNorm,
          });
        }
      }
    }

    const pickBySeedTie = (a: HitBase, b: HitBase): HitBase => {
      if (b.score !== a.score) return b.score > a.score ? b : a;
      const ap = SEED_CANONICAL_NAME_NORM.has(a.nameNorm) ? 1 : 0;
      const bp = SEED_CANONICAL_NAME_NORM.has(b.nameNorm) ? 1 : 0;
      if (bp !== ap) return bp > ap ? b : a;
      return a.canonicalName.localeCompare(b.canonicalName, 'ru') <= 0 ? a : b;
    };

    if (exactHits.length) {
      const best = exactHits.reduce(pickBySeedTie);
      return {
        supplyItemId: best.supplyItemId,
        canonicalName: best.canonicalName,
        defaultUnit: best.defaultUnit,
      };
    }

    const maxD = maxFuzzyDistanceForLength(normFull.length);
    type FHit = HitBase & { dist: number };
    const fuzzyHits: FHit[] = [];

    for (const it of items) {
      const candidates: string[] = [
        SupplyCatalogService.normalizeAlias(it.name),
        ...(it.aliases ?? []).map((a) => a.aliasNormalized),
      ];
      const nameNorm = SupplyCatalogService.normalizeAlias(it.name);
      for (const cand of candidates) {
        if (cand.length < 3) continue;
        const d = levenshteinDistance(normFull, cand);
        if (d < 1 || d > maxD) continue;
        fuzzyHits.push({
          supplyItemId: it.id,
          canonicalName: it.name,
          defaultUnit: it.defaultUnit,
          dist: d,
          score: cand.length,
          nameNorm,
        });
      }
    }

    if (!fuzzyHits.length) return null;

    const fuzzyPick = fuzzyHits.reduce((a, b) => {
      if (a.dist !== b.dist) return a.dist < b.dist ? a : b;
      if (a.score !== b.score) return a.score > b.score ? a : b;
      const ap = SEED_CANONICAL_NAME_NORM.has(a.nameNorm) ? 1 : 0;
      const bp = SEED_CANONICAL_NAME_NORM.has(b.nameNorm) ? 1 : 0;
      if (bp !== ap) return bp > ap ? b : a;
      return a.canonicalName.localeCompare(b.canonicalName, 'ru') <= 0 ? a : b;
    });

    return {
      supplyItemId: fuzzyPick.supplyItemId,
      canonicalName: fuzzyPick.canonicalName,
      defaultUnit: fuzzyPick.defaultUnit,
    };
  }

  async createCustomItem(
    companyId: string,
    createdByUserId: string,
    body: { name: string; category?: string; defaultUnit?: string | null; synonyms: string },
  ): Promise<SupplyItemEntity> {
    const name = body.name.trim().slice(0, 255);
    if (name.length < 2) throw new BadRequestException('name too short');

    const item = this.itemRepo.create({
      companyId,
      name,
      category: (body.category ?? 'specificity').trim().slice(0, 64) || 'specificity',
      defaultUnit: body.defaultUnit?.trim()?.slice(0, 64) || null,
      sortOrder: 9000,
      createdByUserId,
    });
    const saved = await this.itemRepo.save(item);

    const synonymParts = body.synonyms
      .split(/[,;]+/)
      .map((s) => SupplyCatalogService.normalizeAlias(s))
      .filter((s) => s.length >= 2);

    const aliasSet = new Set<string>([SupplyCatalogService.normalizeAlias(name), ...synonymParts]);
    for (const a of aliasSet) {
      const exists = await this.aliasRepo.findOne({
        where: { supplyItemId: saved.id, aliasNormalized: a },
      });
      if (!exists) {
        await this.aliasRepo.save(
          this.aliasRepo.create({
            supplyItemId: saved.id,
            aliasNormalized: a,
          }),
        );
      }
    }
    return saved;
  }

  /** После вставки строк supply_request_items — проставить supplyItemId и каноническое имя */
  async applyResolutionToRequestLines(companyId: string, lineIds: string[]): Promise<void> {
    if (!lineIds.length) return;
    const lines = await this.dataSource.getRepository(SupplyRequestItemEntity).find({
      where: { id: In(lineIds) },
    });
    for (const line of lines) {
      const raw = line.name?.trim() ?? '';
      line.llmRawName = line.llmRawName ?? raw;
      const hit = await this.resolveRawNameToCatalogItem(companyId, raw);
      if (hit) {
        line.supplyItemId = hit.supplyItemId;
        line.name = hit.canonicalName;
        if (!line.unit && hit.defaultUnit) {
          line.unit = hit.defaultUnit;
        }
      }
      line.lineStatus = line.lineStatus || 'pending';
      await this.dataSource.getRepository(SupplyRequestItemEntity).save(line);
    }
  }

  private static parseQuantity(q: string | null): number | null {
    if (q == null || q === '') return null;
    const n = Number(String(q).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /** Агрегат по строкам группы: всё доставлено → delivered; есть pending → pending; иначе в пути. */
  static aggregateFulfillment(lineStatuses: string[]): 'pending' | 'in_delivery' | 'delivered' {
    const norm = lineStatuses.map((x) => (x?.trim() ? x.trim() : 'pending'));
    if (norm.length === 0) return 'pending';
    if (norm.every((s) => s === 'delivered')) return 'delivered';
    if (norm.some((s) => s === 'pending')) return 'pending';
    return 'in_delivery';
  }

  /**
   * Сводная матрица: строки — номенклатура (или сырой текст), столбцы — объекты.
   */
  async getMatrixForOwner(ownerId: string): Promise<{
    rows: Array<{
      groupKey: string;
      supplyItemId: string | null;
      displayName: string;
      defaultUnit: string | null;
      totalQuantity: number;
      quantityIsPartial: boolean;
      fulfillmentStatus: 'pending' | 'in_delivery' | 'delivered';
      sourceEventCount: number;
      /** Все строки этой строки матрицы на одном маршруте — переназначение водителя; null = пул. */
      deliveryRouteIdForHandoff: string | null;
      /** Резерв: раньше бывало при смешении пула и маршрута; строки матрицы теперь разделены по слоям — обычно false. */
      deliveryRouteHandoffMixed: boolean;
      byProperty: Array<{
        propertyId: string;
        propertyTitle: string;
        propertyAddress: string | null;
        quantitySum: number;
        quantityIsPartial: boolean;
        requestLineIds: string[];
        /** По строкам этой ячейки (объект × слой маршрута): доставлено / в пути / в пуле. */
        fulfillmentStatus: 'pending' | 'in_delivery' | 'delivered';
      }>;
    }>;
  }> {
    const owner = await this.userRepo.findOne({ where: { id: ownerId }, select: ['companyId'] });
    if (owner?.companyId) {
      await this.ensureDefaultCatalogForCompany(owner.companyId);
      const updated = await this.reresolveUnmappedSupplyLines(owner.companyId);
      if (updated > 0) {
        this.tasksGateway.emitSupplyInterpretationsChanged();
      }
    }

    const lines = await this.dataSource
      .getRepository(SupplyRequestItemEntity)
      .createQueryBuilder('sri')
      .leftJoinAndSelect('sri.supplyItem', 'cat')
      .innerJoinAndSelect('sri.interpretationEvent', 'e')
      .innerJoinAndSelect('e.property', 'p')
      .leftJoin(TaskEntity, 'task', 'task.id = e.targetId AND e.targetType = :taskT', { taskT: 'task' })
      .where('p.ownerId = :oid', { oid: ownerId })
      .andWhere('sri.lineStatus IN (:...lss)', { lss: ['pending', 'handed_to_driver', 'delivered'] })
      .andWhere('e.workflowState IN (:...ws)', {
        ws: ['pending_manager', 'manual_review', 'manager_acknowledged'],
      })
      .andWhere(
        new Brackets((qb) => {
          qb.where('e.targetType != :tt', { tt: 'task' })
            .orWhere('task.id IS NULL')
            .orWhere('task.status != :done', { done: 'done' })
            /** Задача уже done, но доставка/снабжение по строкам ещё нет — строки должны оставаться в сводке. */
            .orWhere('sri.lineStatus IN (:...activeLs)', { activeLs: ['pending', 'handed_to_driver'] });
        }),
      )
      .getMany();

    const filtered = lines.filter((sri) => {
      const ev = sri.interpretationEvent as StaffInterpretationEventEntity;
      const intent =
        ev.llmPayload && typeof ev.llmPayload['intent'] === 'string'
          ? String(ev.llmPayload['intent']).trim()
          : '';
      return includeLineInSupplyMatrix({
        textRaw: ev.textRaw,
        intentFromPayload: intent,
        supplyItemId: sri.supplyItemId,
      });
    });

    /** Сводка согласована с маршрутным листом: закрытая остановка объекта = доставлено для строк на этом маршруте. */
    const routeIdsForDoneLookup = [
      ...new Set(
        filtered.map((s) => s.deliveryRouteId).filter((id): id is string => Boolean(id?.trim())),
      ),
    ];
    const stopsDoneByRouteProperty = new Set<string>();
    if (routeIdsForDoneLookup.length > 0) {
      const doneStops = await this.dataSource.getRepository(DeliveryRouteStopEntity).find({
        where: {
          kind: 'property',
          status: 'done',
          routeId: In(routeIdsForDoneLookup),
        },
        select: ['routeId', 'propertyId'],
      });
      for (const st of doneStops) {
        if (st.propertyId) stopsDoneByRouteProperty.add(`${st.routeId}|${st.propertyId}`);
      }
    }

    /**
     * Одна строка матрицы = одна номенклатура × один «слой» логистики:
     * только пул (ещё не на маршруте) или только один маршрут.
     * Так не смешиваются «ещё в очереди» и «уже уехали на доставке» в одной ячейке.
     */
    type Agg = {
      groupKey: string;
      supplyItemId: string | null;
      displayName: string;
      defaultUnit: string | null;
      byProp: Map<
        string,
        {
          propertyTitle: string;
          propertyAddress: string | null;
          sum: number;
          partial: boolean;
          lineIds: string[];
          lineStatuses: string[];
        }
      >;
      eventIds: Set<string>;
      lineStatuses: string[];
      /** Строки этой группы: null = пул; иначе все привязаны к этому маршруту */
      deliveryRouteIdForHandoff: string | null;
    };
    const map = new Map<string, Agg>();

    for (const sri of filtered) {
      const ev = sri.interpretationEvent as StaffInterpretationEventEntity;
      const prop = ev.property;
      const ridForDone = sri.deliveryRouteId?.trim();
      const ls =
        ridForDone && stopsDoneByRouteProperty.has(`${ridForDone}|${prop.id}`)
          ? 'delivered'
          : sri.lineStatus || 'pending';

      const gid = sri.supplyItemId ?? `raw:${SupplyCatalogService.normalizeAlias(sri.name).slice(0, 120)}`;
      const routeId = sri.deliveryRouteId?.trim() || null;
      const bucketSuffix = routeId ? `route:${routeId}` : 'pool';
      const compositeKey = `${gid}@@${bucketSuffix}`;

      if (!map.has(compositeKey)) {
        map.set(compositeKey, {
          groupKey: compositeKey,
          supplyItemId: sri.supplyItemId,
          displayName: sri.supplyItem?.name ?? sri.name,
          defaultUnit: sri.supplyItem?.defaultUnit ?? sri.unit,
          byProp: new Map(),
          eventIds: new Set(),
          lineStatuses: [],
          deliveryRouteIdForHandoff: routeId,
        });
      }
      const agg = map.get(compositeKey)!;
      agg.eventIds.add(ev.id);
      agg.lineStatuses.push(ls);
      const pq = SupplyCatalogService.parseQuantity(sri.quantity);
      const partial = pq == null;
      const qty = partial ? 0 : pq;
      const pid = prop.id;
      if (!agg.byProp.has(pid)) {
        const addr = (prop.address ?? '').trim();
        agg.byProp.set(pid, {
          propertyTitle: prop.name ?? '',
          propertyAddress: addr && addr !== '-' ? addr : null,
          sum: 0,
          partial: false,
          lineIds: [],
          lineStatuses: [],
        });
      }
      const cell = agg.byProp.get(pid)!;
      cell.lineIds.push(sri.id);
      cell.lineStatuses.push(ls);
      if (ls === 'delivered') {
        continue;
      }
      if (partial) {
        cell.partial = true;
        cell.sum += 1;
      } else {
        cell.sum += qty;
      }
    }

    const rows = [...map.values()].map((agg) => {
      let total = 0;
      let anyPartial = false;
      const byProperty = [...agg.byProp.entries()]
        .sort((a, b) =>
          (a[1].propertyTitle || '').localeCompare(b[1].propertyTitle || '', 'ru', { sensitivity: 'base' }),
        )
        .map(([propertyId, c]) => {
          total += c.sum;
          if (c.partial) anyPartial = true;
          return {
            propertyId,
            propertyTitle: c.propertyTitle,
            propertyAddress: c.propertyAddress,
            quantitySum: c.sum,
            quantityIsPartial: c.partial,
            requestLineIds: c.lineIds,
            fulfillmentStatus: SupplyCatalogService.aggregateFulfillment(c.lineStatuses),
          };
        });

      return {
        groupKey: agg.groupKey,
        supplyItemId: agg.supplyItemId,
        displayName: agg.displayName,
        defaultUnit: agg.defaultUnit,
        totalQuantity: total,
        quantityIsPartial: anyPartial,
        fulfillmentStatus: SupplyCatalogService.aggregateFulfillment(agg.lineStatuses),
        sourceEventCount: agg.eventIds.size,
        deliveryRouteIdForHandoff: agg.deliveryRouteIdForHandoff,
        deliveryRouteHandoffMixed: false,
        byProperty,
      };
    });

    const visible = rows.filter((r) => r.fulfillmentStatus !== 'delivered');

    visible.sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, 'ru');
      if (byName !== 0) return byName;
      return a.groupKey.localeCompare(b.groupKey, 'ru');
    });
    return { rows: visible };
  }

  /** Детали ячейки матрицы по id строк запросов (с проверкой owner). */
  async getRequestLinesDetail(
    ownerId: string,
    requestLineIds: string[],
  ): Promise<
    Array<{
      requestLineId: string;
      propertyId: string;
      propertyTitle: string;
      eventId: string;
      textRaw: string;
      createdAt: string;
      authorName: string;
      quantity: string | null;
      unit: string | null;
      llmRawName: string | null;
    }>
  > {
    const ids = [...new Set(requestLineIds.filter(Boolean))];
    if (!ids.length) return [];

    const lines = await this.dataSource
      .getRepository(SupplyRequestItemEntity)
      .createQueryBuilder('sri')
      .innerJoinAndSelect('sri.interpretationEvent', 'e')
      .innerJoinAndSelect('e.property', 'p')
      .leftJoinAndSelect('e.author', 'a')
      .where('sri.id IN (:...ids)', { ids })
      .andWhere('p.ownerId = :oid', { oid: ownerId })
      .orderBy('e.createdAt', 'DESC')
      .getMany();

    return lines.map((sri) => {
      const ev = sri.interpretationEvent as StaffInterpretationEventEntity;
      const prop = ev.property;
      const a = ev.author;
      return {
        requestLineId: sri.id,
        propertyId: prop.id,
        propertyTitle: prop.name ?? '',
        eventId: ev.id,
        textRaw: ev.textRaw,
        createdAt: ev.createdAt.toISOString(),
        authorName: a ? `${a.firstName} ${a.lastName}`.trim() : '',
        quantity: sri.quantity,
        unit: sri.unit,
        llmRawName: sri.llmRawName,
      };
    });
  }

  /**
   * Передача водителю: по позициям справочника (все pending-строки по SKU) и/или по id строк запроса
   * (строки без сопоставления со справочником — только через requestLineIds).
   */
  async handoffForOwner(
    ownerId: string,
    body: { supplyItemIds?: string[]; requestLineIds?: string[] },
  ): Promise<{ updated: number }> {
    const supplyItemIds = [...new Set((body.supplyItemIds ?? []).map((x) => x.trim()).filter(Boolean))];
    const requestLineIds = [...new Set((body.requestLineIds ?? []).map((x) => x.trim()).filter(Boolean))];
    if (!supplyItemIds.length && !requestLineIds.length) {
      throw new BadRequestException('supplyItemIds or requestLineIds required');
    }

    let updated = 0;

    if (supplyItemIds.length) {
      const res = await this.dataSource.query(
        `
        UPDATE supply_request_items sri
        SET "lineStatus" = 'handed_to_driver'
        FROM staff_interpretation_events e
        INNER JOIN properties p ON p.id = e."propertyId"
        WHERE sri."interpretationEventId" = e.id
          AND p."ownerId" = $1
          AND sri."supplyItemId" = ANY($2::uuid[])
          AND sri."lineStatus" = 'pending'
        RETURNING sri.id
        `,
        [ownerId, supplyItemIds],
      );
      updated += Array.isArray(res) ? res.length : 0;
    }

    if (requestLineIds.length) {
      const res2 = await this.dataSource.query(
        `
        UPDATE supply_request_items sri
        SET "lineStatus" = 'handed_to_driver'
        FROM staff_interpretation_events e
        INNER JOIN properties p ON p.id = e."propertyId"
        WHERE sri."interpretationEventId" = e.id
          AND p."ownerId" = $1
          AND sri.id = ANY($2::uuid[])
          AND sri."lineStatus" = 'pending'
        RETURNING sri.id
        `,
        [ownerId, requestLineIds],
      );
      updated += Array.isArray(res2) ? res2.length : 0;
    }

    if (updated > 0) {
      this.tasksGateway.emitSupplyInterpretationsChanged();
    }
    return { updated };
  }

  /** Строки в статусе «у водителя» → «доставлено» (пока связанная задача не закрыта — строка видна в сводке). */
  async markDeliveredForOwner(ownerId: string, requestLineIds: string[]): Promise<{ updated: number }> {
    const ids = [...new Set(requestLineIds.map((x) => x.trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('requestLineIds required');

    const res = await this.dataSource.query(
      `
      UPDATE supply_request_items sri
      SET "lineStatus" = 'delivered'
      FROM staff_interpretation_events e
      INNER JOIN properties p ON p.id = e."propertyId"
      WHERE sri."interpretationEventId" = e.id
        AND p."ownerId" = $1
        AND sri.id = ANY($2::uuid[])
        AND sri."lineStatus" = 'handed_to_driver'
      RETURNING sri.id
      `,
      [ownerId, ids],
    );
    const updated = Array.isArray(res) ? res.length : 0;
    if (updated > 0) {
      this.tasksGateway.emitSupplyInterpretationsChanged();
    }
    return { updated };
  }

  /**
   * Закрытие остановки-объекта водителем: всё, что ещё числится на этом маршруте для этого объекта,
   * считается доставленным (в т.ч. если строка не попала в junction или осталась в pending из-за гонки данных).
   */
  async markDeliveredForRoutePropertyStop(
    ownerId: string,
    routeId: string,
    propertyId: string,
  ): Promise<{ updated: number }> {
    const rid = routeId.trim();
    const pid = propertyId.trim();
    if (!rid || !pid) throw new BadRequestException('routeId and propertyId required');

    const res = await this.dataSource.query(
      `
      UPDATE supply_request_items sri
      SET "lineStatus" = 'delivered'
      FROM staff_interpretation_events e
      INNER JOIN properties p ON p.id = e."propertyId"
      WHERE sri."interpretationEventId" = e.id
        AND p."ownerId" = $1
        AND sri."deliveryRouteId" = $2::uuid
        AND e."propertyId" = $3::uuid
        AND sri."lineStatus" IN ('pending', 'handed_to_driver')
      RETURNING sri.id
      `,
      [ownerId, rid, pid],
    );
    const updated = Array.isArray(res) ? res.length : 0;
    if (updated > 0) {
      this.tasksGateway.emitSupplyInterpretationsChanged();
    }
    return { updated };
  }

  async resolveActorCompanyId(actorUserId: string): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: actorUserId } });
    if (!u?.companyId) {
      throw new BadRequestException('User has no company');
    }
    return u.companyId;
  }
}
