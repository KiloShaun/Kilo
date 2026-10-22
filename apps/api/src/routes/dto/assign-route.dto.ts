import { IsUUID } from 'class-validator';

export class AssignRouteDto {
  @IsUUID()
  driverId: string;

  @IsUUID()
  vehicleId: string;
}
