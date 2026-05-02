import { CategoryStatus } from '@prisma/client';

export class CategoryAdminResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  order!: number;
  status!: CategoryStatus;
  createdAt!: string;
  updatedAt!: string;
  pathCount!: number;
  courseCount!: number;
}
