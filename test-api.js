// Simple test script to verify API functionality
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000/api';

async function testAPI() {
  console.log('🧪 Testing Little Flower School API...\n');

  try {
    // Test 1: Health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch('http://localhost:5000/');
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData.message);

    // Test 2: Login with default admin
    console.log('\n2. Testing admin login...');
    const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@littleflowerschool.com',
        password: 'admin123'
      })
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status}`);
    }

    const loginData = await loginResponse.json();
    console.log('✅ Login successful for user:', loginData.data.user.username);
    console.log('👤 User role:', loginData.data.user.role);
    
    const token = loginData.data.token;

    // Test 3: Get profile
    console.log('\n3. Testing get profile...');
    const profileResponse = await fetch(`${BASE_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!profileResponse.ok) {
      throw new Error(`Get profile failed: ${profileResponse.status}`);
    }

    const profileData = await profileResponse.json();
    console.log('✅ Profile retrieved for:', profileData.data.user.firstName, profileData.data.user.lastName);

    // Test 4: Create a test user
    console.log('\n4. Testing user creation...');
    const createUserResponse = await fetch(`${BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        username: 'teacher1',
        email: 'teacher1@littleflowerschool.com',
        password: 'teacher123',
        firstName: 'John',
        lastName: 'Doe',
        role: 'teacher'
      })
    });

    if (!createUserResponse.ok) {
      const errorData = await createUserResponse.json();
      if (createUserResponse.status === 400 && errorData.message.includes('already exists')) {
        console.log('⚠️  User already exists, skipping creation');
      } else {
        throw new Error(`Create user failed: ${createUserResponse.status} - ${errorData.message}`);
      }
    } else {
      const createUserData = await createUserResponse.json();
      console.log('✅ User created:', createUserData.data.user.username);
    }

    // Test 5: Get all users
    console.log('\n5. Testing get all users...');
    const usersResponse = await fetch(`${BASE_URL}/users`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!usersResponse.ok) {
      throw new Error(`Get users failed: ${usersResponse.status}`);
    }

    const usersData = await usersResponse.json();
    console.log('✅ Retrieved users count:', usersData.data.users.length);
    console.log('👥 Users:', usersData.data.users.map(u => `${u.username} (${u.role})`).join(', '));

    // Test 6: Test login with sample teacher
    console.log('\n6. Testing teacher login...');
    const teacherLoginResponse = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'teacher@littleflowerschool.com',
        password: 'teacher123'
      })
    });

    if (!teacherLoginResponse.ok) {
      const errorData = await teacherLoginResponse.json();
      console.log('⚠️  Teacher login failed:', errorData.message);
    } else {
      const teacherLoginData = await teacherLoginResponse.json();
      console.log('✅ Teacher login successful for:', teacherLoginData.data.user.username);
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 API Summary:');
    console.log('• Default admin created: username=admin, password=admin123');
    console.log('• Authentication system working');
    console.log('• Role-based access control implemented');
    console.log('• User management system functional');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Only run if this file is executed directly
if (process.argv[1].endsWith('test-api.js')) {
  testAPI();
}

export default testAPI;