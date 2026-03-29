export interface ApiResponse<T> {
  data: T;
  message: string;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
