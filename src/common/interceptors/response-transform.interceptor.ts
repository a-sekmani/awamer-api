import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  { data: T; message: string }
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: T; message: string }> {
    return next.handle().pipe(
      map((data) => ({
        data,
        message: 'Success',
      })),
    );
  }
}
