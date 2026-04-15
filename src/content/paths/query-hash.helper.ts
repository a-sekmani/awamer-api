import { buildQueryHash } from '../../common/cache/cache-keys';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';
import { ListCoursesQueryDto } from '../courses/dto/list-courses.query.dto';

/**
 * Build the canonical sorted-key, default-omitting representation of a list
 * query and return the deterministic 16-char SHA-256 hash. Default values are
 * dropped so that `?page=1` and `?` collapse to the same canonical empty key.
 *
 * Per FR-017 / spec §5.3.
 */
export function computeQueryHash(
  query: ListPathsQueryDto | ListCoursesQueryDto,
): string {
  const obj: Record<string, unknown> = {};
  if (query.categoryId) obj.categoryId = query.categoryId;
  if (query.tagId) obj.tagId = query.tagId;
  if (query.level) obj.level = query.level;
  if (query.search) obj.search = query.search.toLowerCase().trim();
  if ((query as ListCoursesQueryDto).pathId) {
    obj.pathId = (query as ListCoursesQueryDto).pathId;
  }
  if ((query as ListCoursesQueryDto).standalone) {
    obj.standalone = true;
  }
  if (query.sort && query.sort !== 'order') obj.sort = query.sort;
  if (query.order && query.order !== 'asc') obj.order = query.order;
  if (query.page && query.page !== 1) obj.page = query.page;
  if (query.limit && query.limit !== 20) obj.limit = query.limit;
  return buildQueryHash(obj);
}
