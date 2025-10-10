import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import connectDB from './config/database.js';

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const resetTeacher = async () => {
  try {
    console.log('Resetting teacher user...');

    // Delete existing teacher
    await User.findOneAndDelete({ email: 'teacher@littleflowerschool.com' });
    console.log('✅ Deleted existing teacher user');

    // Get admin user for createdBy reference
    const adminUser = await User.findOne({ email: 'admin@littleflowerschool.com' });

    // Create new teacher
    const teacherUser = new User({
      username: 'teacher1',
      email: 'teacher@littleflowerschool.com',
      password: 'teacher123',
      firstName: 'John',
      lastName: 'Doe',
      role: 'teacher',
      isActive: true,
      mobile: '+1234567891',
      department: 'Academic',
      position: 'Mathematics Teacher',
      createdBy: adminUser._id
    });

    await teacherUser.save();
    console.log('✅ Created new teacher user');
    console.log('📧 Email: teacher@littleflowerschool.com');
    console.log('🔐 Password: teacher123');

  } catch (error) {
    console.error('❌ Reset failed:', error);
  } finally {
    process.exit(0);
  }
};

resetTeacher();