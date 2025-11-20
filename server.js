import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import connectDB from "./config/database.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import formRoutes from "./routes/formRoutes.js";
import responseRoutes from "./routes/responseRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import mailRoutes from "./routes/mailRoutes.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import parameterRoutes from "./routes/parameterRoutes.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { handleUploadError } from "./middleware/upload.js";
import { initializeSocket } from "./socket/socketHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the correct location
dotenv.config({ path: path.join(__dirname, '.env') });

// Connect to database
connectDB();

const app = express();

// Set server timeout for file uploads (10 minutes)
app.timeout = 10 * 60 * 1000; // 10 minutes

// Parse FRONTEND_URL to handle multiple origins
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ["http://localhost:3000"];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Little Flower School Backend API is running 🚀",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Files are now served through GridFS via /api/files/:id endpoint

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/responses", responseRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/mail", mailRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/parameters", parameterRoutes);

// API info route
app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Little Flower School API - Complete Form Management System",
    version: "1.0.0",
    endpoints: {
      auth: {
        login: "POST /api/auth/login",
        profile: "GET /api/auth/profile",
        changePassword: "PUT /api/auth/change-password"
      },
      users: {
        create: "POST /api/users",
        getAll: "GET /api/users",
        getById: "GET /api/users/:id",
        update: "PUT /api/users/:id",
        delete: "DELETE /api/users/:id",
        resetPassword: "PUT /api/users/:id/reset-password"
      },
      forms: {
        create: "POST /api/forms",
        getAll: "GET /api/forms",
        getPublic: "GET /api/forms/public",
        getById: "GET /api/forms/:id",
        update: "PUT /api/forms/:id",
        delete: "DELETE /api/forms/:id",
        updateVisibility: "PATCH /api/forms/:id/visibility",
        duplicate: "POST /api/forms/:id/duplicate",
        analytics: "GET /api/forms/:id/analytics"
      },
      responses: {
        create: "POST /api/responses",
        getAll: "GET /api/responses",
        getById: "GET /api/responses/:id",
        update: "PUT /api/responses/:id",
        assign: "PATCH /api/responses/:id/assign",
        delete: "DELETE /api/responses/:id",
        deleteMultiple: "DELETE /api/responses",
        byForm: "GET /api/responses/form/:formId",
        export: "GET /api/responses/form/:formId/export"
      },
      profile: {
        get: "GET /api/profile",
        update: "PUT /api/profile",
        updateSettings: "PATCH /api/profile/settings",
        uploadAvatar: "POST /api/profile/avatar"
      },
      files: {
        upload: "POST /api/files/upload",
        get: "GET /api/files/:filename",
        delete: "DELETE /api/files/:id",
        getByUser: "GET /api/files",
        getInfo: "GET /api/files/info/:id"
      },
      analytics: {
        dashboard: "GET /api/analytics/dashboard",
        form: "GET /api/analytics/form/:formId",
        users: "GET /api/analytics/users",
        export: "GET /api/analytics/export"
      },
      roles: {
        create: "POST /api/roles",
        getAll: "GET /api/roles",
        getById: "GET /api/roles/:id",
        update: "PUT /api/roles/:id",
        delete: "DELETE /api/roles/:id",
        assign: "POST /api/roles/assign",
        getUsersByRole: "GET /api/roles/:roleId/users",
        permissions: "GET /api/roles/permissions"
      },
      mail: {
        testConnection: "GET /api/mail/test-connection",
        sendTestEmail: "POST /api/mail/test-email",
        serviceRequestNotification: "POST /api/mail/service-request-notification",
        statusUpdate: "POST /api/mail/status-update"
      },
      parameters: {
        create: "POST /api/parameters",
        getAll: "GET /api/parameters",
        getById: "GET /api/parameters/:id",
        update: "PUT /api/parameters/:id",
        delete: "DELETE /api/parameters/:id"
      }
    }
  });
});

// Catch all handler: send back index.html for client-side routing
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/dist/index.html"));
});

// Handle upload errors
app.use(handleUploadError);

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
initializeSocket(httpServer);

export default app;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server initialized for real-time updates`);
});
