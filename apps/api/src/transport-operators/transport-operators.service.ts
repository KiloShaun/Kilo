import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccountsService } from '../accounts/accounts.service';
import { CreateTransportOperatorDto } from './dto/create-transport-operator.dto';

@Injectable()
export class TransportOperatorsService {
  constructor(private readonly accountsService: AccountsService) {}

  async create(dto: CreateTransportOperatorDto) {
    const { user, inviteToken } = await this.accountsService.createInvitedAccount({
      email: dto.email,
      role: UserRole.TRANSPORT_OPERATOR,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      inviteToken,
    };
  }
}
