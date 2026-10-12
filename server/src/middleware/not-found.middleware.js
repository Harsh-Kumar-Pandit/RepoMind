export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    error: {
      message: `Not Found - ${req.originalUrl}`,
      status: 404,
    },
  });
};
