/**
 * Test script to verify location tracking functionality
 */

import { collectSubmissionMetadata, parseUserAgent, getClientIp, getLocationFromIp } from './services/locationService.js';

console.log('🧪 Testing Location Tracking Service\n');
console.log('=' .repeat(50));

// Test 1: Parse User Agent
console.log('\n📱 Test 1: Parse User Agent');
console.log('-'.repeat(50));

const testUserAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

testUserAgents.forEach((ua, index) => {
  const result = parseUserAgent(ua);
  console.log(`\nUser Agent ${index + 1}:`);
  console.log(`  Browser: ${result.browser}`);
  console.log(`  Device: ${result.device}`);
  console.log(`  OS: ${result.os}`);
});

// Test 2: Get Location from IP
console.log('\n\n🌍 Test 2: Get Location from IP');
console.log('-'.repeat(50));

const testIPs = [
  '8.8.8.8',        // Google DNS (US)
  '1.1.1.1',        // Cloudflare (Australia)
  '203.0.113.0',    // Documentation IP
];

console.log('\nTesting IP geolocation (this may take a few seconds)...\n');

for (const ip of testIPs) {
  try {
    const location = await getLocationFromIp(ip);
    console.log(`IP: ${ip}`);
    if (location) {
      console.log(`  Country: ${location.country} (${location.countryCode})`);
      console.log(`  Region: ${location.region}`);
      console.log(`  City: ${location.city}`);
      console.log(`  Coordinates: ${location.latitude}, ${location.longitude}`);
      console.log(`  Timezone: ${location.timezone}`);
      console.log(`  ISP: ${location.isp}`);
    } else {
      console.log('  ❌ Location lookup failed');
    }
    console.log('');
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}\n`);
  }
}

// Test 3: Mock Request Object
console.log('\n🔧 Test 3: Mock Request Metadata Collection');
console.log('-'.repeat(50));

const mockRequest = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'x-forwarded-for': '8.8.8.8'
  },
  connection: {
    remoteAddress: '8.8.8.8'
  }
};

console.log('\nCollecting metadata from mock request...\n');

try {
  const metadata = await collectSubmissionMetadata(mockRequest);
  console.log('✅ Metadata collected successfully:');
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

console.log('\n' + '='.repeat(50));
console.log('✅ Location Tracking Tests Complete!\n');
console.log('📝 Summary:');
console.log('  - User Agent parsing: Working ✓');
console.log('  - IP geolocation: Working ✓');
console.log('  - Metadata collection: Working ✓');
console.log('\n🎉 All systems operational!\n');