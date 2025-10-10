import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import connectDB from './config/database.js';
import bcrypt from 'bcryptjs';

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const checkUsers = async () => {
  try {
    console.log('Checking users in database...\n');

    const users = await User.find({}).select('-password');
    console.log(`Found ${users.length} users:`);
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.firstName} ${user.lastName} (${user.username})`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Active: ${user.isActive}`);
      console.log('');
    });

    // Test password for teacher
    const teacher = await User.findOne({ email: 'teacher@littleflowerschool.com' });
    if (teacher) {
      console.log('Testing teacher password...');
      const hashedPassword = await bcrypt.hash('teacher123', 10);
      const isPasswordValid = await teacher.comparePassword('teacher123');
      console.log('Password validation result:', isPasswordValid);
      
      // Check if password hashing method exists
      console.log('Compare password method exists:', typeof teacher.comparePassword === 'function');
    } else {
      console.log('Teacher user not found!');
    }

  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    process.exit(0);
  }
};

checkUsers();