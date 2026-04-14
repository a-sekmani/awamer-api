import { ArrayMinSize, IsArray, IsString, IsUUID } from 'class-validator';

export class ReorderItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsUUID('4', { each: true })
  itemIds!: string[];
}
