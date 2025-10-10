import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the correct location
dotenv.config({ path: path.join(__dirname, '.env') });

const resetAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected for reset');

    // Delete all existing users
    await User.deleteMany({});
    console.log('All users deleted');

    // Create new admin user for car shop
    const adminUser = new User({
      username: 'admin',
      email: 'admin@focus.com',
      password: 'admin123#', // This will be hashed by the pre-save middleware
      firstName: 'Shop',
      lastName: 'Manager',
      role: 'admin',
      isActive: true
    });

    await adminUser.save();
    console.log('New admin created successfully!');
    console.log('Email: admin@focus.com');
    console.log('Password: admin123#');

  } catch (error) {
    console.error('Error resetting admin:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

resetAdmin();