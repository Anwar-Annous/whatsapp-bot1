const express = require('express');
const multer = require('multer');
const path = require('path');
const mediaController = require('../controllers/mediaController');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const type = file.mimetype.startsWith('image/') ? 'uploads/images' : 'uploads/audio';
      cb(null, path.join(__dirname, '..', '..', type));
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const router = express.Router();
router.post('/upload', upload.single('media'), mediaController.uploadMedia);
router.delete('/:id', mediaController.deleteMedia);

module.exports = router;
