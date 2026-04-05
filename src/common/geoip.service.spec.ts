import { Test, TestingModule } from '@nestjs/testing';
import { GeoipService } from './geoip.service';

describe('GeoipService', () => {
  let service: GeoipService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeoipService],
    }).compile();

    service = module.get<GeoipService>(GeoipService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return a country code for a known IP', () => {
    // 188.53.0.1 is a known Saudi Arabia IP in the geoip-lite database
    const result = service.getCountryFromIp('188.53.0.1');
    expect(result).toBe('SA');
  });

  it('should return null for localhost/unknown IP', () => {
    const result = service.getCountryFromIp('127.0.0.1');
    expect(result).toBeNull();
  });

  it('should return null for invalid IP', () => {
    const result = service.getCountryFromIp('not-an-ip');
    expect(result).toBeNull();
  });
});
