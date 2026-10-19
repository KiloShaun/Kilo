import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError, ConflictDomainError } from '../common/errors/domain-error';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findUnique({
      where: { registrationNumber: dto.registrationNumber },
    });
    if (existing) {
      throw new ConflictDomainError(
        'VEHICLE_ALREADY_REGISTERED',
        'A vehicle with this registration number already exists.',
      );
    }

    return this.prisma.vehicle.create({ data: dto });
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!vehicle) {
      throw new NotFoundDomainError('Vehicle');
    }
    return vehicle;
  }
}
