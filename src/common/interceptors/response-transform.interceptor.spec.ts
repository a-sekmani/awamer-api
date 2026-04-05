import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

describe('ResponseTransformInterceptor', () => {
  let interceptor: ResponseTransformInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new ResponseTransformInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should wrap response data with { data, message: "Success" }', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockHandler: CallHandler = {
      handle: () => of({ id: 1, name: 'Test' }),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
      expect(result).toEqual({
        data: { id: 1, name: 'Test' },
        message: 'Success',
      });
      done();
    });
  });

  it('should wrap null data', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockHandler: CallHandler = {
      handle: () => of(null),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
      expect(result).toEqual({
        data: null,
        message: 'Success',
      });
      done();
    });
  });

  it('should wrap array data', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockHandler: CallHandler = {
      handle: () => of([1, 2, 3]),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
      expect(result).toEqual({
        data: [1, 2, 3],
        message: 'Success',
      });
      done();
    });
  });

  it('should wrap string data', (done) => {
    const mockContext = {} as ExecutionContext;
    const mockHandler: CallHandler = {
      handle: () => of('hello'),
    };

    interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
      expect(result).toEqual({
        data: 'hello',
        message: 'Success',
      });
      done();
    });
  });
});
