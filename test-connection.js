import axios from 'axios';

const testAPI = async () => {
  try {
    console.log('Testing backend API...');
    
    // Test login
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'admin@focus.com',
      password: 'admin123#'
    });
    
    console.log('✅ Login successful!');
    console.log('Token received:', !!loginResponse.data.data?.token);
    
    // Test protected route
    const token = loginResponse.data.data?.token;
    const profileResponse = await axios.get('http://localhost:5000/api/auth/profile', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Protected route accessible!');
    console.log('User:', profileResponse.data.data?.user?.email || profileResponse.data.user?.email);
    
    console.log('\n🎉 Backend is working properly!');
    
  } catch (error) {
    console.error('❌ API Test Failed:', error.response?.data || error.message);
  }
};

testAPI();