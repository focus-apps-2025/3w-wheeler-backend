import fetch from 'node-fetch';

async function test() {
  try {
    // Login
    console.log('Logging in...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@focus.com', password: 'admin123#' })
    });

    const loginData = await loginRes.json();
    console.log('Login response:', loginData.success ? 'SUCCESS' : 'FAILED');

    if (!loginData.success) {
      console.error('Login failed');
      return;
    }

    const token = loginData.data.token;
    console.log('Got token');

    // Get the specific form
    console.log('Getting form fbdc9708-be34-446b-a5b7-b47aa538a42d...');
    const getRes = await fetch('http://localhost:5000/api/forms/fbdc9708-be34-446b-a5b7-b47aa538a42d', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const getData = await getRes.json();
    console.log('Get form status:', getRes.status);
    console.log('Get form response:', JSON.stringify(getData, null, 2));

  } catch (error) {
    console.error('Error:', error);
  }
}

test();