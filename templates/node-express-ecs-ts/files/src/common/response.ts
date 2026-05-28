export type SuccessResponse<T> = {
  data: T;
  status: 'success';
  message: string;
};

export type ErrorResponse = {
  code: string;
  message: string;
  timestamp: string;
};

export function successResponse<T>(data: T, message = 'OK'): SuccessResponse<T> {
  return {
    data,
    status: 'success',
    message,
  };
}

export function errorResponse(code: string, message: string): ErrorResponse {
  return {
    code,
    message,
    timestamp: new Date().toISOString(),
  };
}
