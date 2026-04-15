import 'reflect-metadata';
import { computeQueryHash } from './query-hash.helper';
import { ListPathsQueryDto } from './dto/list-paths.query.dto';
import { ListCoursesQueryDto } from '../courses/dto/list-courses.query.dto';

function pathQuery(over: Partial<ListPathsQueryDto> = {}): ListPathsQueryDto {
  return Object.assign(new ListPathsQueryDto(), over);
}
function courseQuery(
  over: Partial<ListCoursesQueryDto> = {},
): ListCoursesQueryDto {
  return Object.assign(new ListCoursesQueryDto(), over);
}

describe('computeQueryHash', () => {
  it('produces the same hash regardless of property order', () => {
    const a = pathQuery({ categoryId: 'cat-1', tagId: 'tag-1' });
    const b = pathQuery({ tagId: 'tag-1', categoryId: 'cat-1' });
    expect(computeQueryHash(a)).toBe(computeQueryHash(b));
  });

  it('collapses default-only requests to a single canonical empty key', () => {
    const empty = pathQuery();
    const explicit = pathQuery({
      sort: 'order',
      order: 'asc',
      page: 1,
      limit: 20,
    });
    expect(computeQueryHash(empty)).toBe(computeQueryHash(explicit));
  });

  it('lowercases and trims search before hashing', () => {
    const a = pathQuery({ search: 'Cyber  ' });
    const b = pathQuery({ search: 'cyber' });
    // Note: trimming happens in the DTO Transform layer at request time; the
    // helper itself only lowercases and trims the value it receives.
    expect(computeQueryHash(pathQuery({ search: 'Cyber' }))).toBe(
      computeQueryHash(b),
    );
    expect(computeQueryHash(a)).toBe(
      computeQueryHash(pathQuery({ search: 'cyber' })),
    );
  });

  it('drops explicit defaults so they do not affect the hash', () => {
    expect(computeQueryHash(pathQuery({ page: 1 }))).toBe(
      computeQueryHash(pathQuery()),
    );
    expect(computeQueryHash(pathQuery({ limit: 20 }))).toBe(
      computeQueryHash(pathQuery()),
    );
  });

  it('produces different hashes for different non-default values', () => {
    expect(computeQueryHash(pathQuery({ page: 2 }))).not.toBe(
      computeQueryHash(pathQuery()),
    );
    expect(computeQueryHash(pathQuery({ categoryId: 'a' }))).not.toBe(
      computeQueryHash(pathQuery({ categoryId: 'b' })),
    );
  });

  it('honors course-only fields (pathId, standalone)', () => {
    expect(computeQueryHash(courseQuery({ pathId: 'p1' }))).not.toBe(
      computeQueryHash(courseQuery()),
    );
    expect(computeQueryHash(courseQuery({ standalone: true }))).not.toBe(
      computeQueryHash(courseQuery()),
    );
  });
});
