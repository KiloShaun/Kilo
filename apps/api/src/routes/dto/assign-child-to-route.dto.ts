import { IsOptional, IsUUID } from 'class-validator';

export class AssignChildToRouteDto {
  @IsUUID()
  childId: string;

  @IsOptional()
  @IsUUID()
  pickupStopId?: string;
}
