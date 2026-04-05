import { Injectable } from '@nestjs/common';
import * as geoip from 'geoip-lite';

@Injectable()
export class GeoipService {
  getCountryFromIp(ip: string): string | null {
    const lookup = geoip.lookup(ip);
    return lookup?.country ?? null;
  }
}
