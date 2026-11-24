import { Router } from 'express';
import {
  googleLogin,
  getCurrentUser,
  getSlackAuthUrl,
  slackOAuthCallback,
  disconnectSlack,
} from '../controllers/authController';
import { authenticateJWT } from '../middleware/authMiddleware';

const router = Router();

router.post('/google', googleLogin);
router.get('/me', authenticateJWT, getCurrentUser);
router.get('/slack/connect', authenticateJWT, getSlackAuthUrl);
router.get('/slack/callback', slackOAuthCallback);
router.post('/slack/disconnect', authenticateJWT, disconnectSlack);

export default router;