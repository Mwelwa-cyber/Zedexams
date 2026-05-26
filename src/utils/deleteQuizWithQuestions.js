import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'

const DELETE_BATCH_LIMIT = 450

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export async function deleteQuizWithQuestions(db, quizId) {
  // If this quiz is the linked authoring surface for a past paper
  // (PastPaperStudio sets `linkedPaperId`), clear the paper's `quizId`
  // back-reference first. Otherwise the paper keeps pointing at a
  // soon-to-be-dead doc and the Studio sends admins to a "Quiz not
  // found" screen the next time they reopen it.
  try {
    const quizSnap = await getDoc(doc(db, 'quizzes', quizId))
    const linkedPaperId = quizSnap.exists() ? quizSnap.data()?.linkedPaperId : null
    if (linkedPaperId) {
      const paperRef = doc(db, 'pastPapers', linkedPaperId)
      const paperSnap = await getDoc(paperRef)
      if (paperSnap.exists() && paperSnap.data()?.quizId === quizId) {
        await updateDoc(paperRef, { quizId: null })
      }
    }
  } catch (err) {
    console.warn('[deleteQuizWithQuestions] paper back-reference cleanup failed', err)
  }

  const questionsSnap = await getDocs(collection(db, 'quizzes', quizId, 'questions'))

  for (const docsChunk of chunk(questionsSnap.docs, DELETE_BATCH_LIMIT)) {
    const batch = writeBatch(db)
    docsChunk.forEach(questionDoc => batch.delete(questionDoc.ref))
    await batch.commit()
  }

  await deleteDoc(doc(db, 'quizzes', quizId))

  return {
    quizId,
    questionsDeleted: questionsSnap.size,
  }
}
