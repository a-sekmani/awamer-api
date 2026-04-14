import { Module, forwardRef } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ProgressService } from './progress.service';

@Module({
  imports: [forwardRef(() => CertificatesModule)],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
