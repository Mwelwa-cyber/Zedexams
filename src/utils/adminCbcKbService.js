/**
 * Admin CBC Knowledge Base service.
 *
 * Reads/writes Firestore `cbcKnowledgeBase/{KB_VERSION}/topics/*`.
 * Firestore rules allow admin-only writes (already in firestore.rules).
 */

import {
  collection, deleteDoc, doc, getDocs, query, orderBy,
  serverTimestamp, setDoc,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const importBuiltInCbcTopicsCallable = httpsCallable(functions, 'importBuiltInCbcTopics', {
  timeout: 60_000,
})

/**
 * One-click admin action: copy the 90 built-in G1-9 topics into Firestore so
 * they become editable through the admin UI. Returns { ok, written, totalInCode }.
 */
export async function importBuiltInTopics() {
  try {
    const result = await importBuiltInCbcTopicsCallable({})
    return { ok: true, ...result.data }
  } catch (err) {
    console.error('importBuiltInTopics failed', err)
    return {
      ok: false,
      error: err?.code === 'permission-denied' ?
        'Admin only.' :
        (err?.message || 'Import failed'),
    }
  }
}

// Must match the server-side KB_VERSION in functions/teacherTools/cbcKnowledge.js
export const KB_VERSION = 'cbc-kb-2026-04-seed'

/** List all Firestore-stored topics. Returns empty array on error. */
export async function listCbcTopics() {
  try {
    const snap = await getDocs(query(
      collection(db, 'cbcKnowledgeBase', KB_VERSION, 'topics'),
      orderBy('grade'),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listCbcTopics failed', err)
    return []
  }
}

/** Create or replace a topic. `id` is generated from grade+subject+topic. */
export async function saveCbcTopic(topic) {
  const id = buildTopicId(topic)
  if (!id) throw new Error('Grade, subject and topic are required.')

  const payload = {
    id,
    grade: String(topic.grade || '').toUpperCase().slice(0, 10),
    subject: String(topic.subject || '').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 40),
    term: Number(topic.term) || 1,
    topic: String(topic.topic || '').trim().slice(0, 200),
    subtopics: Array.isArray(topic.subtopics) ?
      topic.subtopics.filter(Boolean).map((s) => String(s).slice(0, 200)) : [],
    specificOutcomes: Array.isArray(topic.specificOutcomes) ?
      topic.specificOutcomes.filter(Boolean).map((s) => String(s).slice(0, 500)) : [],
    keyCompetencies: Array.isArray(topic.keyCompetencies) ?
      topic.keyCompetencies.filter(Boolean).map((s) => String(s).slice(0, 200)) : [],
    values: Array.isArray(topic.values) ?
      topic.values.filter(Boolean).map((s) => String(s).slice(0, 100)) : [],
    suggestedMaterials: Array.isArray(topic.suggestedMaterials) ?
      topic.suggestedMaterials.filter(Boolean).map((s) => String(s).slice(0, 300)) : [],
    updatedAt: serverTimestamp(),
  }
  if (!payload.topic) throw new Error('Topic name is required.')

  await setDoc(doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', id), payload)
  return id
}

/** Delete a topic. */
export async function deleteCbcTopic(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, 'cbcKnowledgeBase', KB_VERSION, 'topics', id))
    return true
  } catch (err) {
    console.error('deleteCbcTopic failed', err)
    return false
  }
}

/** Summary count for the dashboard. */
export async function getCbcKbSummary() {
  try {
    const rows = await listCbcTopics()
    const byGrade = rows.reduce((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1
      return acc
    }, {})
    return { total: rows.length, byGrade }
  } catch {
    return { total: 0, byGrade: {} }
  }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function buildTopicId(t) {
  const g = slug(t.grade)
  const s = slug(t.subject)
  const topic = slug(t.topic)
  if (!g || !s || !topic) return null
  return `${g}-${s}-${topic}`
}
