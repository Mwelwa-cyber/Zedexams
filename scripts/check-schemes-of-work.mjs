/**
 * Check if schemes of work documents exist in Firestore
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import * as path from 'path'

let db
try {
  // Try to use application default credentials or service account key
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
    initializeApp({ credential: cert(serviceAccount) })
    console.log('Using service account credentials')
  } else {
    // Try application default credentials
    initializeApp()
    console.log('Using application default credentials')
  }
  db = getFirestore()
  db.settings({ projectId: 'examsprepzambia' })
} catch (err) {
  console.error('Firebase init error:', err.message)
  console.log('\nNote: You need Firebase credentials to query the database.')
  console.log('Options:')
  console.log('1. Set GOOGLE_APPLICATION_CREDENTIALS env var to point to a service account key')
  console.log('2. Or use: firebase emulators:start (for local testing)')
  process.exit(1)
}

async function checkSchemesOfWork() {
  try {
    console.log('\n📊 Checking Firestore for schemes of work documents...\n')

    // Query aiGenerations collection for scheme_of_work items
    const snap = await db.collection('aiGenerations')
      .where('tool', '==', 'scheme_of_work')
      .limit(100)
      .get()

    if (snap.empty) {
      console.log('❌ No schemes of work found in Firestore')
      return
    }

    console.log(`✅ Found ${snap.size} scheme(s) of work:\n`)

    const bySubject = {}
    const byGrade = {}

    snap.forEach(doc => {
      const data = doc.data()
      const title = data.output?.header?.title || 'Untitled'
      const grade = data.inputs?.grade || data.output?.header?.class || 'Unknown'
      const subject = data.inputs?.subject || data.output?.header?.subject || 'Unknown'
      const term = data.inputs?.term || data.output?.header?.term || 'Unknown'
      const createdAt = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString() : 'Unknown'

      console.log(`📋 ${title}`)
      console.log(`   Grade: ${grade} | Subject: ${subject} | Term: ${term}`)
      console.log(`   Created: ${createdAt} | Owner: ${data.ownerUid}`)
      console.log(`   ID: ${doc.id}\n`)

      // Group by subject and grade
      bySubject[subject] = (bySubject[subject] || 0) + 1
      byGrade[grade] = (byGrade[grade] || 0) + 1
    })

    console.log('\n📈 Summary:')
    console.log('By Grade:', byGrade)
    console.log('By Subject:', bySubject)

  } catch (err) {
    console.error('Error querying Firestore:', err.message)
    process.exit(1)
  }
}

checkSchemesOfWork().then(() => {
  console.log('\n✅ Check complete')
  process.exit(0)
})
