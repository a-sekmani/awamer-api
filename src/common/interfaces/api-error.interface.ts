export interface ApiError {
  statusCode: number;
  errorCode?: string;
  message: string;
  errors?: string[] | Record<string, string[]>[];
}
