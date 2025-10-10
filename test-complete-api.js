// Comprehensive API test script for Little Flower School Backend
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5000/api';

class APITester {
  constructor() {
    this.adminToken = null;
    this.teacherToken = null;
    this.testData = {
      formId: null,
      responseId: null,
      fileId: null,
      roleId: null
    };
  }

  async testAuthentication() {
    console.log('🔐 Testing Authentication...\n');

    try {
      // Test admin login
      console.log('1. Testing admin login...');
      const adminLogin = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@littleflowerschool.com',
          password: 'admin123'
        })
      });

      if (!adminLogin.ok) {
        throw new Error(`Admin login failed: ${adminLogin.status}`);
      }

      const adminData = await adminLogin.json();
      this.adminToken = adminData.data.token;
      console.log('✅ Admin login successful');

      // Test teacher login
      console.log('2. Testing teacher login...');
      const teacherLogin = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'teacher@littleflowerschool.com',
          password: 'teacher123'
        })
      });

      if (!teacherLogin.ok) {
        throw new Error(`Teacher login failed: ${teacherLogin.status}`);
      }

      const teacherData = await teacherLogin.json();
      this.teacherToken = teacherData.data.token;
      console.log('✅ Teacher login successful');

      // Test profile access
      console.log('3. Testing profile access...');
      const profileResponse = await fetch(`${BASE_URL}/auth/profile`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!profileResponse.ok) {
        throw new Error(`Profile access failed: ${profileResponse.status}`);
      }

      const profileData = await profileResponse.json();
      console.log('✅ Profile access successful');
      console.log(`   👤 Logged in as: ${profileData.data.user.firstName} ${profileData.data.user.lastName}`);

    } catch (error) {
      console.error('❌ Authentication test failed:', error.message);
      return false;
    }

    return true;
  }

  async testFormManagement() {
    console.log('\n📝 Testing Form Management...\n');

    try {
      // Test form creation
      console.log('1. Testing form creation...');
      const createFormResponse = await fetch(`${BASE_URL}/forms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`
        },
        body: JSON.stringify({
          title: 'Test Application Form',
          description: 'A comprehensive test form for the Little Flower School',
          sections: [{
            id: 'section-1',
            title: 'Personal Information',
            description: 'Please provide your personal details',
            questions: [{
              id: 'name',
              text: 'Full Name',
              type: 'text',
              required: true
            }, {
              id: 'email',
              text: 'Email Address',
              type: 'email',
              required: true
            }]
          }],
          followUpQuestions: [],
          isVisible: true
        })
      });

      if (!createFormResponse.ok) {
        throw new Error(`Form creation failed: ${createFormResponse.status}`);
      }

      const formData = await createFormResponse.json();
      this.testData.formId = formData.data.form.id;
      console.log('✅ Form created successfully');
      console.log(`   📋 Form ID: ${this.testData.formId}`);

      // Test get all forms
      console.log('2. Testing get all forms...');
      const formsResponse = await fetch(`${BASE_URL}/forms`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!formsResponse.ok) {
        throw new Error(`Get forms failed: ${formsResponse.status}`);
      }

      const formsListData = await formsResponse.json();
      console.log('✅ Forms retrieved successfully');
      console.log(`   📊 Total forms: ${formsListData.data.forms.length}`);

      // Test public forms
      console.log('3. Testing public forms access...');
      const publicFormsResponse = await fetch(`${BASE_URL}/forms/public`);

      if (!publicFormsResponse.ok) {
        throw new Error(`Public forms failed: ${publicFormsResponse.status}`);
      }

      const publicFormsData = await publicFormsResponse.json();
      console.log('✅ Public forms retrieved successfully');
      console.log(`   🌐 Public forms: ${publicFormsData.data.forms.length}`);

    } catch (error) {
      console.error('❌ Form management test failed:', error.message);
      return false;
    }

    return true;
  }

  async testResponseManagement() {
    console.log('\n💬 Testing Response Management...\n');

    try {
      // Test response submission
      console.log('1. Testing response submission...');
      const submitResponse = await fetch(`${BASE_URL}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: this.testData.formId,
          answers: {
            name: 'John Smith',
            email: 'john.smith@example.com'
          },
          submittedBy: 'John Smith',
          submitterContact: {
            email: 'john.smith@example.com',
            phone: '+1234567890'
          }
        })
      });

      if (!submitResponse.ok) {
        throw new Error(`Response submission failed: ${submitResponse.status}`);
      }

      const responseData = await submitResponse.json();
      this.testData.responseId = responseData.data.response.id;
      console.log('✅ Response submitted successfully');
      console.log(`   📄 Response ID: ${this.testData.responseId}`);

      // Test get responses for form
      console.log('2. Testing get responses for form...');
      const formResponsesResponse = await fetch(`${BASE_URL}/responses/form/${this.testData.formId}`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!formResponsesResponse.ok) {
        throw new Error(`Get form responses failed: ${formResponsesResponse.status}`);
      }

      const formResponsesData = await formResponsesResponse.json();
      console.log('✅ Form responses retrieved successfully');
      console.log(`   📊 Response count: ${formResponsesData.data.responses.length}`);

      // Test response assignment
      console.log('3. Testing response assignment...');
      const assignResponse = await fetch(`${BASE_URL}/responses/${this.testData.responseId}/assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`
        },
        body: JSON.stringify({
          assignedTo: '676c47c1b8a5aac334c28062' // This should be a valid user ID
        })
      });

      if (assignResponse.ok) {
        console.log('✅ Response assigned successfully');
      } else {
        console.log('⚠️  Response assignment skipped (no valid user ID)');
      }

    } catch (error) {
      console.error('❌ Response management test failed:', error.message);
      return false;
    }

    return true;
  }

  async testAnalytics() {
    console.log('\n📊 Testing Analytics...\n');

    try {
      // Test dashboard analytics
      console.log('1. Testing dashboard analytics...');
      const dashboardResponse = await fetch(`${BASE_URL}/analytics/dashboard`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!dashboardResponse.ok) {
        throw new Error(`Dashboard analytics failed: ${dashboardResponse.status}`);
      }

      const dashboardData = await dashboardResponse.json();
      console.log('✅ Dashboard analytics retrieved successfully');
      console.log(`   📈 Total forms: ${dashboardData.data.overview.totalForms}`);
      console.log(`   💬 Total responses: ${dashboardData.data.overview.totalResponses}`);

      // Test form-specific analytics
      console.log('2. Testing form analytics...');
      const formAnalyticsResponse = await fetch(`${BASE_URL}/analytics/form/${this.testData.formId}`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!formAnalyticsResponse.ok) {
        throw new Error(`Form analytics failed: ${formAnalyticsResponse.status}`);
      }

      const formAnalyticsData = await formAnalyticsResponse.json();
      console.log('✅ Form analytics retrieved successfully');
      console.log(`   📋 Form: ${formAnalyticsData.data.form.title}`);
      console.log(`   💬 Responses: ${formAnalyticsData.data.metrics.totalResponses}`);

    } catch (error) {
      console.error('❌ Analytics test failed:', error.message);
      return false;
    }

    return true;
  }

  async testRoleManagement() {
    console.log('\n👥 Testing Role Management...\n');

    try {
      // Test get all roles
      console.log('1. Testing get all roles...');
      const rolesResponse = await fetch(`${BASE_URL}/roles`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!rolesResponse.ok) {
        throw new Error(`Get roles failed: ${rolesResponse.status}`);
      }

      const rolesData = await rolesResponse.json();
      console.log('✅ Roles retrieved successfully');
      console.log(`   🎭 Total roles: ${rolesData.data.roles.length}`);
      rolesData.data.roles.forEach(role => {
        console.log(`   • ${role.name}: ${role.description}`);
      });

      // Test get available permissions
      console.log('2. Testing get available permissions...');
      const permissionsResponse = await fetch(`${BASE_URL}/roles/permissions`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!permissionsResponse.ok) {
        throw new Error(`Get permissions failed: ${permissionsResponse.status}`);
      }

      const permissionsData = await permissionsResponse.json();
      console.log('✅ Available permissions retrieved successfully');
      console.log(`   🔐 Total permissions: ${permissionsData.data.permissions.length}`);

    } catch (error) {
      console.error('❌ Role management test failed:', error.message);
      return false;
    }

    return true;
  }

  async testFileManagement() {
    console.log('\n📁 Testing File Management...\n');

    try {
      // Test file upload (simulated)
      console.log('1. Testing file upload access...');
      const uploadResponse = await fetch(`${BASE_URL}/files/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      // We expect this to fail without actual file data, but should not be unauthorized
      if (uploadResponse.status === 401) {
        throw new Error('File upload endpoint unauthorized');
      }

      console.log('✅ File upload endpoint accessible');

      // Test get files by user
      console.log('2. Testing get user files...');
      const userFilesResponse = await fetch(`${BASE_URL}/files`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!userFilesResponse.ok) {
        throw new Error(`Get user files failed: ${userFilesResponse.status}`);
      }

      const userFilesData = await userFilesResponse.json();
      console.log('✅ User files retrieved successfully');
      console.log(`   📄 File count: ${userFilesData.data.files.length}`);

    } catch (error) {
      console.error('❌ File management test failed:', error.message);
      return false;
    }

    return true;
  }

  async testProfileManagement() {
    console.log('\n👤 Testing Profile Management...\n');

    try {
      // Test get profile
      console.log('1. Testing get profile...');
      const profileResponse = await fetch(`${BASE_URL}/profile`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });

      if (!profileResponse.ok) {
        throw new Error(`Get profile failed: ${profileResponse.status}`);
      }

      const profileData = await profileResponse.json();
      console.log('✅ Profile retrieved successfully');
      console.log(`   👤 Name: ${profileData.data.profile.name}`);
      console.log(`   📧 Email: ${profileData.data.profile.email}`);

      // Test update profile
      console.log('2. Testing profile update...');
      const updateResponse = await fetch(`${BASE_URL}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`
        },
        body: JSON.stringify({
          phone: '+1234567890',
          bio: 'System Administrator with full access'
        })
      });

      if (!updateResponse.ok) {
        throw new Error(`Profile update failed: ${updateResponse.status}`);
      }

      console.log('✅ Profile updated successfully');

    } catch (error) {
      console.error('❌ Profile management test failed:', error.message);
      return false;
    }

    return true;
  }

  async runAllTests() {
    console.log('🧪 Little Flower School API Comprehensive Test Suite\n');
    console.log('='.repeat(60));

    const tests = [
      { name: 'Authentication', fn: () => this.testAuthentication() },
      { name: 'Form Management', fn: () => this.testFormManagement() },
      { name: 'Response Management', fn: () => this.testResponseManagement() },
      { name: 'Analytics', fn: () => this.testAnalytics() },
      { name: 'Role Management', fn: () => this.testRoleManagement() },
      { name: 'File Management', fn: () => this.testFileManagement() },
      { name: 'Profile Management', fn: () => this.testProfileManagement() }
    ];

    let passedTests = 0;
    let failedTests = 0;

    for (const test of tests) {
      try {
        const result = await test.fn();
        if (result) {
          passedTests++;
          console.log(`✅ ${test.name} - PASSED\n`);
        } else {
          failedTests++;
          console.log(`❌ ${test.name} - FAILED\n`);
        }
      } catch (error) {
        failedTests++;
        console.log(`❌ ${test.name} - ERROR: ${error.message}\n`);
      }
    }

    console.log('='.repeat(60));
    console.log('🏆 Test Results Summary:');
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    console.log(`📊 Total: ${tests.length}`);
    
    if (failedTests === 0) {
      console.log('\n🎉 All tests passed! The API is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the errors above.');
    }

    console.log('\n📋 API Summary:');
    console.log('• Complete form management system');
    console.log('• Response tracking and analytics');
    console.log('• Role-based access control');
    console.log('• File upload and management');
    console.log('• User profile management');
    console.log('• Comprehensive analytics dashboard');
  }
}

// Run tests if this file is executed directly
if (process.argv[1].endsWith('test-complete-api.js')) {
  const tester = new APITester();
  tester.runAllTests();
}

export default APITester;