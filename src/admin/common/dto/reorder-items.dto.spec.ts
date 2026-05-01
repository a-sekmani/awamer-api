import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ReorderItemsDto } from './reorder-items.dto';

const UUID_A = '0a8b1f7e-1f5c-4a9b-8d1d-1a2b3c4d5e6f';
const UUID_B = '1b9c2e3d-2e6d-4a0c-9e2e-2b3c4d5e6f70';

async function check(payload: unknown): Promise<ValidationError[]> {
  const dto = plainToInstance(ReorderItemsDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function flattenMessages(errs: ValidationError[]): string[] {
  const out: string[] = [];
  function walk(e: ValidationError) {
    if (e.constraints) out.push(...Object.values(e.constraints));
    (e.children ?? []).forEach(walk);
  }
  errs.forEach(walk);
  return out;
}

describe('ReorderItemsDto', () => {
  it('DTO-T01 — valid single item passes', async () => {
    const errs = await check({ items: [{ id: UUID_A, sortOrder: 0 }] });
    expect(errs).toEqual([]);
  });

  it('DTO-T02 — valid multi item with all-unique ids passes', async () => {
    const errs = await check({
      items: [
        { id: UUID_A, sortOrder: 0 },
        { id: UUID_B, sortOrder: 1 },
      ],
    });
    expect(errs).toEqual([]);
  });

  it('DTO-T03 — duplicate sortOrder across different ids is allowed', async () => {
    const errs = await check({
      items: [
        { id: UUID_A, sortOrder: 5 },
        { id: UUID_B, sortOrder: 5 },
      ],
    });
    expect(errs).toEqual([]);
  });

  it('DTO-T04 — empty items array is rejected', async () => {
    const errs = await check({ items: [] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ')).toMatch(/items/);
  });

  it('DTO-T05 — items missing entirely is rejected', async () => {
    const errs = await check({});
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/items|array/);
  });

  it('DTO-T06 — non-UUID id is rejected', async () => {
    const errs = await check({ items: [{ id: 'not-a-uuid', sortOrder: 0 }] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/uuid/);
  });

  it('DTO-T07 — negative sortOrder is rejected', async () => {
    const errs = await check({ items: [{ id: UUID_A, sortOrder: -1 }] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/sortorder|min|less than/);
  });

  it('DTO-T08 — non-integer sortOrder (1.5) is rejected', async () => {
    const errs = await check({ items: [{ id: UUID_A, sortOrder: 1.5 }] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/sortorder|integer/);
  });

  it('DTO-T09 — duplicate ids is rejected with the custom duplicate-ids message', async () => {
    const errs = await check({
      items: [
        { id: UUID_A, sortOrder: 0 },
        { id: UUID_A, sortOrder: 1 },
      ],
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ')).toMatch(/duplicate ids/);
  });

  it('DTO-T10 — missing id field on an item is rejected', async () => {
    const errs = await check({ items: [{ sortOrder: 0 }] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/id/);
  });

  it('DTO-T11 — missing sortOrder field on an item is rejected', async () => {
    const errs = await check({ items: [{ id: UUID_A }] });
    expect(errs.length).toBeGreaterThan(0);
    expect(flattenMessages(errs).join(' ').toLowerCase()).toMatch(/sortorder/);
  });
});
