import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeGuestEmail, normalizeGuestPhone } from '@rentai/shared';
import { GuestEntity } from './entities/guest.entity';

@Injectable()
export class GuestService {
  constructor(
    @InjectRepository(GuestEntity)
    private readonly guestRepository: Repository<GuestEntity>,
  ) {}

  /**
   * Find or create guest for owner: match phone first, then email; else insert.
   */
  async resolveOrCreate(
    ownerId: string,
    displayName: string,
    guestPhone: string | undefined,
    guestEmail: string | undefined,
  ): Promise<GuestEntity> {
    const phone = normalizeGuestPhone(guestPhone);
    const email = normalizeGuestEmail(guestEmail);

    if (!phone && !email) {
      throw new BadRequestException('CONTACT_REQUIRED');
    }

    if (phone) {
      const byPhone = await this.guestRepository.findOne({
        where: { ownerId, phoneNormalized: phone },
      });
      if (byPhone) {
        if (byPhone.displayName !== displayName) {
          byPhone.displayName = displayName;
          await this.guestRepository.save(byPhone);
        }
        return byPhone;
      }
    }

    if (email) {
      const byEmail = await this.guestRepository.findOne({
        where: { ownerId, emailNormalized: email },
      });
      if (byEmail) {
        if (byEmail.displayName !== displayName) {
          byEmail.displayName = displayName;
          await this.guestRepository.save(byEmail);
        }
        return byEmail;
      }
    }

    if (phone && email) {
      const row = this.guestRepository.create({
        ownerId,
        displayName,
        phoneNormalized: phone,
        emailNormalized: email,
      });
      return this.guestRepository.save(row);
    }

    if (phone) {
      const row = this.guestRepository.create({
        ownerId,
        displayName,
        phoneNormalized: phone,
        emailNormalized: null,
      });
      return this.guestRepository.save(row);
    }

    const row = this.guestRepository.create({
      ownerId,
      displayName,
      phoneNormalized: null,
      emailNormalized: email!,
    });
    return this.guestRepository.save(row);
  }
}
