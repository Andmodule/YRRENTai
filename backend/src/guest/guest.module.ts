import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuestEntity } from './entities/guest.entity';
import { GuestService } from './guest.service';

@Module({
  imports: [TypeOrmModule.forFeature([GuestEntity])],
  providers: [GuestService],
  exports: [GuestService],
})
export class GuestModule {}
