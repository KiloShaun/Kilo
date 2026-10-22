import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotFoundDomainError, ConflictDomainError } from '../common/errors/domain-error';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const where = { deletedAt: null };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

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
