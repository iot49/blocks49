import { google } from 'googleapis';
import readline from 'readline';
import * as dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.BLOCKS49_EXPORT_CLIENT_ID || process.argv[2];
const CLIENT_SECRET = process.env.BLOCKS49_EXPORT_CLIENT_SECRET || process.argv[3];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log('Error: Could not find BLOCKS49_EXPORT_CLIENT_ID/SECRET in .env or arguments.');
  console.log('Usage: npx tsx scripts/get-refresh-token.ts <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost' // We will catch the code from the URL manually
);

// Generate the url that will be used for authorization
const authorizeUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Crucial: gets the Refresh Token
  scope: [
    'https://www.googleapis.com/auth/drive.file' // Only access files created by this app
    // OR use 'https://www.googleapis.com/auth/drive' for full access if you want to use existing folders created outside
  ], 
});

console.log('---------------------------------------------------------');
console.log('1. Go to this URL in your browser:');
console.log(authorizeUrl);
console.log('---------------------------------------------------------');
console.log('2. Sign in with the account that has the 2TB quota.');
console.log('3. If you get a "This app is not verified" warning, click Advanced -> Go to ... (unsafe).');
console.log('4. You will be redirected to "http://localhost/?code=..."');
console.log('   (The page might fail to load - that is expected!)');
console.log('5. COPY the value of the "code" parameter from the address bar.');
console.log('   It starts with "4/..." or similar.');
console.log('---------------------------------------------------------');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Paste the code here: ', async (code) => {
  rl.close();
  // Clean up code just in case - the code is before any query parameters
  const cleanCode = decodeURIComponent(code).split('&')[0].trim();
  
  try {
    const { tokens } = await oauth2Client.getToken(cleanCode);
    console.log('\n✅ SUCCESS! Add this line to server/.env:');
    console.log('---------------------------------------------------------');
    console.log(`BLOCKS49_EXPORT_REFRESH_TOKEN='${tokens.refresh_token}'`);
    console.log('---------------------------------------------------------');
  } catch (err: any) {
    console.error('❌ Error retrieving access token:', err.response?.data || err.message);
  }
});
