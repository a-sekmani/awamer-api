import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = exception.message;
    let errors: unknown[] = [];

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resp = exceptionResponse as Record<string, unknown>;
      if (Array.isArray(resp.message)) {
        errors = resp.message;
        message = 'Validation failed';
      } else if (typeof resp.message === 'string') {
        message = resp.message;
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
    });
  }
}
