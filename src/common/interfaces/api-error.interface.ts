export interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[] | Record<string, string[]>[];
}
