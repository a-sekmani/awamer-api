export class CategoryResponseDto {
  id!: string;
  name!: string;
  slug!: string;
  description!: string | null;
  icon!: string | null;
  order!: number;
  pathCount!: number;
  courseCount!: number;
}
