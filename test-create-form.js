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
    console.log('Login response:', loginData);

    if (!loginData.success) {
      console.error('Login failed');
      return;
    }

    const token = loginData.data.token;
    console.log('Got token:', token.substring(0, 20) + '...');

    // Create form with specific ID
    console.log('Creating form...');
    const createRes = await fetch('http://localhost:5000/api/forms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        id: 'test-form-with-location',
        title: 'Student Registration Form',
        description: 'Register for our program',
        isVisible: true,
        sections: [{
          id: 'section-1',
          title: 'Personal Information',
          description: 'Enter your details',
          questions: [
            {
              id: 'name',
              text: 'What is your full name?',
              type: 'text',
              required: true
            },
            {
              id: 'email',
              text: 'What is your email address?',
              type: 'email',
              required: true
            },
            {
              id: 'student-type',
              text: 'Are you a new student or returning student?',
              type: 'radio',
              required: true,
              options: ['New Student', 'Returning Student']
            },
            {
              id: 'program',
              text: 'Which program are you interested in?',
              type: 'radio',
              required: true,
              options: ['Business Administration', 'Computer Science', 'Engineering', 'Arts & Humanities']
            },
            {
              id: 'high-school',
              text: 'Have you completed high school?',
              type: 'radio',
              required: true,
              options: ['Yes', 'No']
            },
            {
              id: 'graduation-year',
              text: 'What was your graduation year?',
              type: 'number',
              required: false
            },
            {
              id: 'english-proficiency',
              text: 'Rate your proficiency in English',
              type: 'radio',
              required: true,
              options: ['1', '2', '3', '4', '5']
            },
            {
              id: 'location',
              text: 'What is your location/address?',
              type: 'location',
              required: true
            }
          ]
        }],
        followUpQuestions: []
      })
    });

    const createData = await createRes.json();
    console.log('Create form response:', createData);

    if (!createData.success) {
      console.error('Create form failed');
      return;
    }

    // Get the form
    console.log('Getting form...');
    const getRes = await fetch('http://localhost:5000/api/forms/fbdc9708-be34-446b-a5b7-b47aa538a42d', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const getData = await getRes.json();
    console.log('Get form response:', getData);

  } catch (error) {
    console.error('Error:', error);
  }
}

test();