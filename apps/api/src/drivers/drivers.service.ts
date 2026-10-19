import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { CreateDriverDto } from './dto/create-driver.dto';

@Injectable()
export class DriversService {
  constructor(private readonly accountsService: AccountsService) {}

  /** Drivers are provisioned by an admin, never self-registered — see docs/security.md. */
  async create(dto: CreateDriverDto) {
    const { user, inviteToken } = await this.accountsService.createInvitedAccount({
      email: dto.email,
      role: UserRole.DRIVER,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
      driver: { create: { licenseNumber: dto.licenseNumber } },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      licenseNumber: dto.licenseNumber,
      inviteToken,
    };
  }
}
