import { TagStatus } from '@prisma/client';
import { TagResponseDto } from './tag-response.dto';

export class AdminTagResponseDto extends TagResponseDto {
  status!: TagStatus;
  createdAt!: string;
}
