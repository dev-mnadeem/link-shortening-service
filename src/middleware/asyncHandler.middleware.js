/**
 * Forwards rejected promises from an async handler to Express's error chain.
 *
 * Express 5 does this for async handlers on its own, but keeping the wrapper
 * makes the intent explicit at every route and keeps the routes readable if
 * the app is ever pinned back to Express 4.
 */
export const asyncHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};
