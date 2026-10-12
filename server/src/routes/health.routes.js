import { Router } from 'express';
import { getPrismaClient } from '../config/database.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const prisma = getPrismaClient();

    // Verify database connectivity with a harmless query
    await prisma.$queryRaw`SELECT 1 as result`;

    res.status(200).json({
      status: 'ok',
      message: 'Backend is running and connected to database',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
