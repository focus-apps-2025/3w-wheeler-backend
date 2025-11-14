import File from '../models/File.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { associatedType: bodyAssociatedType, associatedId: bodyAssociatedId } = req.body;
    const { associatedType: queryAssociatedType, associatedId: queryAssociatedId } = req.query;

    const normalizeValue = (value) => {
      if (!value) {
        return undefined;
      }
      return Array.isArray(value) ? value[0] : value;
    };

    const rawAssociatedType = (normalizeValue(bodyAssociatedType) || normalizeValue(queryAssociatedType) || 'form').toString().toLowerCase();
    const typeMap = {
      form: 'form',
      response: 'response',
      profile: 'profile',
      logo: 'logo',
      tenant_logo: 'logo',
      general: 'form'
    };
    const associatedType = typeMap[rawAssociatedType] || 'form';
    const associatedIdentifier = normalizeValue(bodyAssociatedId) || normalizeValue(queryAssociatedId);

    const destinationDir = req.file.destination || path.join(__dirname, '../uploads');
    const storedPath = req.file.path || path.join(destinationDir, req.file.filename);
    const relativePath = path.relative(path.join(__dirname, '..'), storedPath).replace(/\\/g, '/');
    const fileUrl = `/${relativePath}`;

    const associatedWith = { type: associatedType };
    if (associatedIdentifier) {
      associatedWith.id = associatedIdentifier;
    }

    const fileRecord = new File({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: storedPath,
      url: fileUrl,
      uploadedBy: req.user ? req.user._id : null,
      associatedWith,
      isPublic: true
    });

    await fileRecord.save();

    const fileData = fileRecord.toObject();

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        file: fileData,
        url: fileData.url
      }
    });

  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFile = async (req, res) => {
  try {
    const { filename } = req.params;

    const fileRecord = await File.findOne({ filename });

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check if file exists on disk
    if (!fs.existsSync(fileRecord.path)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on disk'
      });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', fileRecord.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${fileRecord.originalName}"`);

    // Send file
    res.sendFile(path.resolve(fileRecord.path));

  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteFile = async (req, res) => {
  try {
    const { id } = req.params;

    const fileRecord = await File.findById(id);

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check permissions
    const isOwner = fileRecord.uploadedBy && fileRecord.uploadedBy.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own files.'
      });
    }

    // Delete file from disk
    if (fs.existsSync(fileRecord.path)) {
      fs.unlinkSync(fileRecord.path);
    }

    // Delete record from database
    await File.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFilesByUser = async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    
    const query = { uploadedBy: req.user._id };
    
    if (type) {
      query['associatedWith.type'] = type;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const files = await File.find(query)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await File.countDocuments(query);

    res.json({
      success: true,
      data: {
        files,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalFiles: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get files by user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFileInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const fileRecord = await File.findById(id)
      .populate('uploadedBy', 'username firstName lastName email');

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.json({
      success: true,
      data: { file: fileRecord }
    });

  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};