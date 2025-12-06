#!/usr/bin/env node
/**
 * Fix Expired Recordings Script
 * 
 * This script makes all existing recordings in Firebase Storage publicly readable
 * and updates their URLs in Firebase Realtime Database to permanent public URLs.
 * 
 * Usage:
 *   node fix-expired-recordings.js
 * 
 * Required environment variables (same as controller.js):
 *   - FIREBASE_PROJECT_ID
 *   - FIREBASE_CLIENT_EMAIL
 *   - FIREBASE_PRIVATE_KEY
 *   - FIREBASE_STORAGE_BUCKET
 *   - FIREBASE_DATABASE_URL
 *   OR
 *   - FIREBASE_SERVICE_ACCOUNT_JSON (path to service account file)
 */

const fs = require('fs');
const admin = require('firebase-admin');

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_STORAGE_BUCKET,
  FIREBASE_DATABASE_URL,
  FIREBASE_SERVICE_ACCOUNT_JSON,
} = process.env;

// Initialize Firebase
let firebaseCredential = null;

if (FIREBASE_SERVICE_ACCOUNT_JSON && fs.existsSync(FIREBASE_SERVICE_ACCOUNT_JSON)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_SERVICE_ACCOUNT_JSON, 'utf8'));
    firebaseCredential = admin.credential.cert(serviceAccount);
    console.log('✅ Loaded Firebase credentials from service account JSON');
  } catch (error) {
    console.error('❌ Failed to load Firebase service account JSON:', error);
    process.exit(1);
  }
} else if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  firebaseCredential = admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  console.log('✅ Loaded Firebase credentials from environment variables');
} else {
  console.error('❌ Firebase credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY');
  process.exit(1);
}

if (!FIREBASE_STORAGE_BUCKET) {
  console.error('❌ FIREBASE_STORAGE_BUCKET is required');
  process.exit(1);
}

admin.initializeApp({
  credential: firebaseCredential,
  storageBucket: FIREBASE_STORAGE_BUCKET,
  databaseURL: FIREBASE_DATABASE_URL || undefined,
});

const storageBucket = admin.storage().bucket();
const realtimeDb = FIREBASE_DATABASE_URL ? admin.database() : null;

async function fixAllRecordings() {
  console.log('\n🔧 Starting recording URL fix...\n');
  
  // Step 1: Get all files in the recordings folder
  console.log('📂 Listing all recording files in Firebase Storage...');
  const [files] = await storageBucket.getFiles({ prefix: 'recordings/' });
  
  if (files.length === 0) {
    console.log('ℹ️  No recording files found in storage.');
    return;
  }
  
  console.log(`📹 Found ${files.length} recording file(s)\n`);
  
  const bucketName = storageBucket.name;
  const fixedFiles = [];
  const failedFiles = [];
  
  // Step 2: Make each file public
  for (const file of files) {
    const fileName = file.name;
    console.log(`Processing: ${fileName}`);
    
    try {
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
      fixedFiles.push({ fileName, publicUrl });
      console.log(`  ✅ Made public: ${publicUrl}`);
    } catch (error) {
      console.log(`  ❌ Failed to make public: ${error.message}`);
      failedFiles.push({ fileName, error: error.message });
    }
  }
  
  console.log(`\n📊 Storage Results: ${fixedFiles.length} fixed, ${failedFiles.length} failed\n`);
  
  // Step 3: Update Firebase Realtime Database
  if (!realtimeDb) {
    console.log('⚠️  FIREBASE_DATABASE_URL not set - skipping database updates');
    console.log('   URLs are fixed in storage, but database records still have old URLs.');
    console.log('   Set FIREBASE_DATABASE_URL and run again to update database.\n');
    return;
  }
  
  console.log('💾 Updating recording URLs in Firebase Realtime Database...\n');
  
  const recordingsRef = realtimeDb.ref('recordings');
  const snapshot = await recordingsRef.once('value');
  const recordingsData = snapshot.val();
  
  if (!recordingsData) {
    console.log('ℹ️  No recordings found in database.');
    return;
  }
  
  let dbUpdated = 0;
  let dbFailed = 0;
  
  // Iterate through all room keys and their recordings
  for (const [roomKey, roomRecordings] of Object.entries(recordingsData)) {
    if (!roomRecordings || typeof roomRecordings !== 'object') continue;
    
    for (const [recordingId, recording] of Object.entries(roomRecordings)) {
      if (!recording || !recording.downloadUrl) continue;
      
      // Check if URL is a signed URL (contains token/signature params)
      const currentUrl = recording.downloadUrl;
      if (currentUrl.includes('storage.googleapis.com') && !currentUrl.includes('?')) {
        // Already a public URL, skip
        continue;
      }
      
      // Try to extract the file path from the signed URL or construct it
      let filePath = null;
      
      // Try to match the file in our fixed files list
      for (const fixed of fixedFiles) {
        // Check if the filename matches
        const fileName = fixed.fileName.split('/').pop();
        if (currentUrl.includes(fileName)) {
          filePath = fixed.fileName;
          break;
        }
      }
      
      if (!filePath) {
        // Try to extract from URL pattern
        const urlMatch = currentUrl.match(/recordings%2F([^?]+)|recordings\/([^?]+)/);
        if (urlMatch) {
          const extractedName = decodeURIComponent(urlMatch[1] || urlMatch[2]);
          filePath = `recordings/${extractedName}`;
        }
      }
      
      if (filePath) {
        const newUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
        
        try {
          await realtimeDb.ref(`recordings/${roomKey}/${recordingId}`).update({
            downloadUrl: newUrl,
            linkStatus: 'ready',
            urlFixedAt: admin.database.ServerValue.TIMESTAMP,
          });
          console.log(`  ✅ Updated: ${recordingId.substring(0, 20)}...`);
          dbUpdated++;
        } catch (error) {
          console.log(`  ❌ Failed to update ${recordingId}: ${error.message}`);
          dbFailed++;
        }
      }
    }
  }
  
  console.log(`\n📊 Database Results: ${dbUpdated} updated, ${dbFailed} failed\n`);
  
  // Summary
  console.log('═══════════════════════════════════════════');
  console.log('                  SUMMARY                   ');
  console.log('═══════════════════════════════════════════');
  console.log(`Storage files made public: ${fixedFiles.length}`);
  console.log(`Storage files failed:      ${failedFiles.length}`);
  console.log(`Database records updated:  ${dbUpdated}`);
  console.log(`Database records failed:   ${dbFailed}`);
  console.log('═══════════════════════════════════════════\n');
  
  if (failedFiles.length > 0) {
    console.log('⚠️  Some files could not be made public. This usually means:');
    console.log('   - Uniform bucket-level access is enabled on your bucket');
    console.log('   - You need to enable public access at the bucket level');
    console.log('\n   To fix, run this command in Google Cloud Console or on the VM:');
    console.log(`   gsutil iam ch allUsers:objectViewer gs://${bucketName}`);
    console.log('\n   Or go to Firebase Console → Storage → Rules and add:');
    console.log('   allow read: if true;');
  }
  
  console.log('✅ Done! New recordings will automatically use permanent public URLs.\n');
}

// Run the fix
fixAllRecordings()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
