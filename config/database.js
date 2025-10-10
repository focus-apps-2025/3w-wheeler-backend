import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    // Check if MONGODB_URI is available
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set. Please check your .env file.');
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Create default admin if none exists
    await createDefaultAdmin();
    
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const createDefaultAdmin = async () => {
  try {
    const User = (await import('../models/User.js')).default;
    
    // Check if superadmin exists
    const superAdminExists = await User.findOne({ role: 'superadmin' });
    
    if (!superAdminExists) {
      const defaultSuperAdmin = new User({
        username: 'superadmin',
        email: 'superadmin@focus.com',
        password: 'superadmin123#', // This will be hashed by the pre-save middleware
        firstName: 'Super',
        lastName: 'Admin',
        role: 'superadmin'
      });
      
      await defaultSuperAdmin.save();
      console.log('Default superadmin created successfully');
      console.log('Username: superadmin');
      console.log('Email: superadmin@focus.com');
      console.log('Password: superadmin123#');
      console.log('Please change the default password after first login!');
      console.log('Use this account to onboard company admins via /api/tenants endpoint');
    }
  } catch (error) {
    console.error('Error creating default superadmin:', error);
  }
};

export default connectDB;