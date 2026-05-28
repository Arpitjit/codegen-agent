import type { ErrorRequestHandler } from 'express';
import { AppError } from '../common/errors.js';
import { errorResponse } from '../common/response.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(errorResponse(error.code, error.message));
    return;
  }

  res.status(500).json(errorResponse('INTERNAL_ERROR', 'Internal server error'));
};
