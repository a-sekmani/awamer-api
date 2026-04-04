import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode } from '../error-codes.enum';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message = exception.message;
      let errorCode: string | undefined;
      let errors: unknown[] = [];

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;

        if (resp.errorCode) {
          errorCode = resp.errorCode as string;
        }

        if (resp.retryAfter != null) {
          response.setHeader('Retry-After', String(resp.retryAfter));
        }

        if (Array.isArray(resp.message)) {
          errors = resp.message;
          message = 'Validation failed';
          errorCode = errorCode ?? ErrorCode.VALIDATION_FAILED;
        } else if (typeof resp.message === 'string') {
          message = resp.message;
        }
      }

      const body: Record<string, unknown> = {
        statusCode: status,
        message,
      };

      if (errorCode) {
        body.errorCode = errorCode;
      }

      if (errors.length > 0) {
        body.errors = errors;
      }

      response.status(status).json(body);
    } else {
      // Non-HTTP exceptions: log the real error, return generic response
      const errorMessage =
        exception instanceof Error ? exception.message : String(exception);
      const stack =
        exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled exception: ${errorMessage}`, stack);

      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      });
    }
  }
}
