import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { Audited } from '../common/decorators/audited.decorator';
import { TransportOperatorsService } from './transport-operators.service';
import { CreateTransportOperatorDto } from './dto/create-transport-operator.dto';

@ApiTags('transport-operators')
@ApiBearerAuth()
@Controller('transport-operators')
export class TransportOperatorsController {
  constructor(private readonly transportOperatorsService: TransportOperatorsService) {}

  /** Only a SUPER_ADMIN provisions transport operators — see docs/security.md. */
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @Audited('TRANSPORT_OPERATOR_CREATED')
  create(@Body() dto: CreateTransportOperatorDto) {
    return this.transportOperatorsService.create(dto);
  }
}
