import express from 'express';
import {
  uploadFile,
  getFile,
  deleteFile,
  getFilesByUser,
  getFileInfo
} from '../controllers/fileController.js';
import { authenticate } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

// Public file access
router.get('/:filename', getFile);

// Protected routes
router.use(authenticate);

// File management
router.post('/upload', upload.single('file'), uploadFile);
router.get('/', getFilesByUser);
router.get('/info/:id', getFileInfo);
router.delete('/:id', deleteFile);

export default router;