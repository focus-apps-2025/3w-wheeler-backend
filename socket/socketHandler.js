import { Server } from 'socket.io';

let io;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL 
        ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
        : ["http://localhost:3000", "http://localhost:5173"],
      credentials: true,
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);

    // Join a specific form analytics room
    socket.on('join-form-analytics', (formId) => {
      socket.join(`form-analytics-${formId}`);
      console.log(`📊 Client ${socket.id} joined analytics room for form: ${formId}`);
    });

    // Leave a specific form analytics room
    socket.on('leave-form-analytics', (formId) => {
      socket.leave(`form-analytics-${formId}`);
      console.log(`📊 Client ${socket.id} left analytics room for form: ${formId}`);
    });

    // Join dashboard analytics room
    socket.on('join-dashboard-analytics', () => {
      socket.join('dashboard-analytics');
      console.log(`📊 Client ${socket.id} joined dashboard analytics room`);
    });

    // Leave dashboard analytics room
    socket.on('leave-dashboard-analytics', () => {
      socket.leave('dashboard-analytics');
      console.log(`📊 Client ${socket.id} left dashboard analytics room`);
    });

    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

// Emit events for real-time updates
export const emitResponseCreated = (formId, response) => {
  if (io) {
    // Emit to specific form analytics room
    io.to(`form-analytics-${formId}`).emit('response-created', {
      formId,
      response,
      timestamp: new Date()
    });

    // Also emit to dashboard analytics
    io.to('dashboard-analytics').emit('response-created', {
      formId,
      response,
      timestamp: new Date()
    });

    console.log(`🔔 Emitted response-created event for form: ${formId}`);
  }
};

export const emitResponseUpdated = (formId, response) => {
  if (io) {
    // Emit to specific form analytics room
    io.to(`form-analytics-${formId}`).emit('response-updated', {
      formId,
      response,
      timestamp: new Date()
    });

    // Also emit to dashboard analytics
    io.to('dashboard-analytics').emit('response-updated', {
      formId,
      response,
      timestamp: new Date()
    });

    console.log(`🔔 Emitted response-updated event for form: ${formId}`);
  }
};

export const emitResponseDeleted = (formId, responseId) => {
  if (io) {
    // Emit to specific form analytics room
    io.to(`form-analytics-${formId}`).emit('response-deleted', {
      formId,
      responseId,
      timestamp: new Date()
    });

    // Also emit to dashboard analytics
    io.to('dashboard-analytics').emit('response-deleted', {
      formId,
      responseId,
      timestamp: new Date()
    });

    console.log(`🔔 Emitted response-deleted event for form: ${formId}`);
  }
};