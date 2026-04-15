import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { UPLOADS_DIR } from './config.js';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) =>
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
