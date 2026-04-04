import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { ErrorCode } from '../error-codes.enum';

function createMockHost(mockResponse: any) {
  return {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => ({ url: '/test' }),
    }),
  } as any;
}

function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  // ===========================================================================
  // Standard HTTP Exceptions
  // ===========================================================================
  describe('standard HTTP exceptions', () => {
    it('should handle BadRequestException with correct status and message', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException('Bad input');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Bad input',
        }),
      );
    });

    it('should handle UnauthorizedException with 401', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new UnauthorizedException('Not authorized');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Not authorized',
        }),
      );
    });

    it('should handle ForbiddenException with 403', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new ForbiddenException('Forbidden');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should handle NotFoundException with 404', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new NotFoundException('Not found');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ===========================================================================
  // Custom errorCode in response
  // ===========================================================================
  describe('errorCode handling', () => {
    it('should include errorCode when present in exception response', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException({
        message: 'Invalid credentials',
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });

      filter.catch(exception, host);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Invalid credentials',
          errorCode: ErrorCode.INVALID_CREDENTIALS,
        }),
      );
    });

    it('should not include errorCode when not present in exception', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException('Simple error');

      filter.catch(exception, host);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall).not.toHaveProperty('errorCode');
    });
  });

  // ===========================================================================
  // Validation errors (class-validator array messages)
  // ===========================================================================
  describe('validation errors', () => {
    it('should format class-validator errors with errors array', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException({
        message: ['email must be an email', 'password is too short'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(exception, host);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Validation failed',
          errorCode: ErrorCode.VALIDATION_FAILED,
          errors: ['email must be an email', 'password is too short'],
        }),
      );
    });

    it('should set errorCode to VALIDATION_FAILED for array messages', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException({
        message: ['name should not be empty'],
      });

      filter.catch(exception, host);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
      expect(jsonCall.message).toBe('Validation failed');
    });

    it('should not include errors array when message is a string', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new BadRequestException('Single error');

      filter.catch(exception, host);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall).not.toHaveProperty('errors');
    });
  });

  // ===========================================================================
  // Non-HTTP (unhandled) exceptions
  // ===========================================================================
  describe('non-HTTP exceptions', () => {
    it('should return 500 for plain Error', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new Error('Something broke');

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          errorCode: ErrorCode.INTERNAL_ERROR,
          message: 'An unexpected error occurred',
        }),
      );
    });

    it('should return 500 for non-Error thrown values', () => {
      const res = createMockResponse();
      const host = createMockHost(res);

      filter.catch('string error', host);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'An unexpected error occurred',
        }),
      );
    });

    it('should hide internal error details from the response', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new Error('Database connection refused at 192.168.1.1:5432');

      filter.catch(exception, host);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.message).toBe('An unexpected error occurred');
      expect(jsonCall.message).not.toContain('192.168.1.1');
      expect(jsonCall.message).not.toContain('Database');
    });

    it('should return INTERNAL_ERROR errorCode for unhandled exceptions', () => {
      const res = createMockResponse();
      const host = createMockHost(res);

      filter.catch(new TypeError('Cannot read property'), host);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });

  // ===========================================================================
  // Custom HttpException with errorCode
  // ===========================================================================
  describe('custom HttpException with errorCode', () => {
    it('should preserve custom errorCode from service layer', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new HttpException(
        {
          message: 'Invalid or expired reset token',
          errorCode: ErrorCode.INVALID_RESET_TOKEN,
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Invalid or expired reset token',
          errorCode: ErrorCode.INVALID_RESET_TOKEN,
        }),
      );
    });

    it('should handle 429 Too Many Requests with RATE_LIMIT_EXCEEDED', () => {
      const res = createMockResponse();
      const host = createMockHost(res);
      const exception = new HttpException(
        {
          message: 'Too many verification requests',
          errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
        }),
      );
    });
  });
});
