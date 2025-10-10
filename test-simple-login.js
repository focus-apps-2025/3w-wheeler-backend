import fetch from 'node-fetch';

const testLogin = async () => {
  try {
    console.log('Testing teacher login...');
    
    const response = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'teacher@littleflowerschool.com',
        password: 'teacher123'
      })
    });

    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Error:', error);
  }
};

testLogin();