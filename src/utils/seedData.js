import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore'
import { deleteQuizWithQuestions } from './deleteQuizWithQuestions.js'

const SEED_BATCH_ID = 'admin-sample-quizzes-v1'

const grade5Math = {
  title: 'Grade 5 Mathematics - Term 1',
  subject: 'Mathematics', grade: '5', term: '1', year: '2024',
  type: 'quiz', duration: 30, totalMarks: 10, isPublished: true, questionCount: 10,
}

const grade5MathQs = [
  { text: 'What is 247 + 385?', options: ['622','632','612','642'], correctAnswer: 1, topic: 'Addition', marks: 1 },
  { text: 'What is 503 - 178?', options: ['325','315','335','305'], correctAnswer: 0, topic: 'Subtraction', marks: 1 },
  { text: 'What is 6 × 8?', options: ['42','46','48','54'], correctAnswer: 2, topic: 'Multiplication', marks: 1 },
  { text: 'What is 9 × 7?', options: ['54','63','72','56'], correctAnswer: 1, topic: 'Multiplication', marks: 1 },
  { text: 'A farmer has 456 chickens. He sells 129. How many are left?', options: ['327','337','317','347'], correctAnswer: 0, topic: 'Subtraction', marks: 1 },
  { text: 'What is 1000 - 375?', options: ['615','635','625','645'], correctAnswer: 2, topic: 'Subtraction', marks: 1 },
  { text: 'What is 12 × 5?', options: ['50','55','60','65'], correctAnswer: 2, topic: 'Multiplication', marks: 1 },
  { text: 'Bupe has 234 mangoes. Chanda gives her 189 more. How many in total?', options: ['413','423','433','403'], correctAnswer: 1, topic: 'Addition', marks: 1 },
  { text: 'What is 72 ÷ 8?', options: ['8','9','7','6'], correctAnswer: 1, topic: 'Division', marks: 1 },
  { text: 'What is 156 + 244?', options: ['390','400','410','380'], correctAnswer: 1, topic: 'Addition', marks: 1 },
]

const grade6English = {
  title: 'Grade 6 English - Term 1',
  subject: 'English', grade: '6', term: '1', year: '2024',
  type: 'quiz', duration: 25, totalMarks: 10, isPublished: true, questionCount: 10,
}

const grade6EnglishQs = [
  { text: 'Which word is a noun?', options: ['Run','Beautiful','Table','Quickly'], correctAnswer: 2, topic: 'Grammar', marks: 1 },
  { text: 'Choose the correct past tense: "She ___ to school yesterday."', options: ['go','went','goed','going'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'What is the plural of "child"?', options: ['Childs','Children','Childes','Childrens'], correctAnswer: 1, topic: 'Vocabulary', marks: 1 },
  { text: 'Which sentence is correct?', options: ['She don\'t like it.','She doesn\'t like it.','She not like it.','She no like it.'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'What does "enormous" mean?', options: ['Tiny','Colourful','Very big','Fast'], correctAnswer: 2, topic: 'Vocabulary', marks: 1 },
  { text: 'Choose the correct spelling:', options: ['Beautifull','Beutiful','Beautiful','Beautful'], correctAnswer: 2, topic: 'Spelling', marks: 1 },
  { text: 'Which is an adjective?', options: ['Walk','Bright','Slowly','Above'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: '"The cat sat on the mat." What is the subject?', options: ['Sat','Mat','On','Cat'], correctAnswer: 3, topic: 'Comprehension', marks: 1 },
  { text: 'Which word means the opposite of "happy"?', options: ['Glad','Sad','Angry','Excited'], correctAnswer: 1, topic: 'Vocabulary', marks: 1 },
  { text: 'Fill in: "I have ___ seen that movie."', options: ['ever','never','all','good'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
]

const grade6EnglishGrammar = {
  title: 'Grade 6 English — Grammar Practice',
  subject: 'English', grade: '6', term: '1', year: '2024',
  type: 'quiz', duration: 15, totalMarks: 5, isPublished: true, questionCount: 5,
}

const grade6EnglishGrammarQs = [
  {
    text: 'Zacchaeus climbed a tree to see Jesus ___ he was short.',
    options: ['and', 'because', 'but', 'yet'],
    correctAnswer: 1, topic: 'Grammar', marks: 1,
  },
  {
    text: 'The children are now old enough to look after ___.',
    options: ['himself', 'itself', 'ourselves', 'themselves'],
    correctAnswer: 3, topic: 'Grammar', marks: 1,
  },
  {
    text: 'The new learner ___ came yesterday is in Grade 6.',
    options: ['which', 'who', 'whom', 'whose'],
    correctAnswer: 1, topic: 'Grammar', marks: 1,
  },
  {
    text: 'Sibeso is not only pretty ___ kind and friendly too.',
    options: ['yet', 'so', 'but', 'and'],
    correctAnswer: 2, topic: 'Grammar', marks: 1,
  },
  {
    text: 'I will be helping my parents ___ household chores during the holiday.',
    options: ['at', 'of', 'in', 'with'],
    correctAnswer: 3, topic: 'Grammar', marks: 1,
  },
]

// ── Grade 6 English 2023 — Paper 1 (60 questions) ─────────────────────────
const grade6English2023 = {
  title: 'Grade 6 English 2023 — Paper 1',
  subject: 'English', grade: '6', term: '1', year: '2023',
  type: 'quiz', duration: 60, totalMarks: 60, isPublished: true, questionCount: 60,
}

const grade6English2023Qs = [
  // ── Grammar (1–20) ───────────────────────────────────────────────────────
  { text: 'Zacchaeus climbed a tree to see Jesus ___ he was short.', options: ['and','because','but','yet'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'The children are now old enough to look after ___.', options: ['himself','itself','ourselves','themselves'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'The new learner ___ came yesterday is in Grade 6.', options: ['which','who','whom','whose'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'Sibeso is not only pretty ___ kind and friendly too.', options: ['yet','so','but','and'], correctAnswer: 2, topic: 'Grammar', marks: 1 },
  { text: 'I will be helping my parents ___ household chores during the holiday.', options: ['at','of','in','with'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'Mrs Kasasu has formed a kitchen party ___ for her daughter who will be getting married in the next three months.', options: ['board','committee','crowd','mob'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'Moono is never late for classes. He is ___ on time.', options: ['always','rarely','sometimes','usually'], correctAnswer: 0, topic: 'Grammar', marks: 1 },
  { text: 'I am sure that ___ have a lot of fresh vegetables in the garden.', options: ['he','it','she','we'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'Amongst the three patients, Zuba has the ___ eyes.', options: ['paler','palest','more paler','most palest'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'They are walking too fast and I cannot keep ___ with them.', options: ['up','on','in','by'], correctAnswer: 0, topic: 'Grammar', marks: 1 },
  { text: 'Kateya and Kofya ___ cattle last year.', options: ['are herding','is herding','was herding','were herding'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'Kawang\'u was ___ than the other boys in class.', options: ['more smarter','most smart','smarter','smartest'], correctAnswer: 2, topic: 'Grammar', marks: 1 },
  { text: 'One of the table manners is not to ___ with food in the mouth.', options: ['talks','talking','talked','talk'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'The choir sang ___ at the concert.', options: ['smooth','smoother','smoothest','smoothly'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'By the time the wildlife officers got to the river, the boy who almost ___ had been rescued.', options: ['drown','drowned','drowning','drowns'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: '___ you like it or not, I will go to visit my friends.', options: ['If','Unless','Until','Whether'], correctAnswer: 3, topic: 'Grammar', marks: 1 },
  { text: 'I sat ___ the head boy during assembly.', options: ['among','beside','besides','between'], correctAnswer: 1, topic: 'Grammar', marks: 1 },
  { text: 'Mr Mwale was attacked by a ___ of thieves.', options: ['bunch','crowd','gang','team'], correctAnswer: 2, topic: 'Grammar', marks: 1 },
  { text: 'We should work together like ___ of ants.', options: ['an army','a flock','a pride','a swarm'], correctAnswer: 0, topic: 'Grammar', marks: 1 },
  { text: 'It was a ___ game. Kamwala Secondary School beat Sioma Secondary School by two goals to nil.', options: ['oneals to nil','one side','one sided','one sides'], correctAnswer: 2, topic: 'Grammar', marks: 1 },
  // ── Spelling (21–25) ─────────────────────────────────────────────────────
  { text: '"That snake is very ___!" exclaimed Peter.', options: ['dangerous','danjerous','dengerous','denjerous'], correctAnswer: 0, topic: 'Spelling', marks: 1 },
  { text: 'That pregnant women should not eat eggs is a ___.', options: ['misconception','misconseption','misconsension','misconsception'], correctAnswer: 0, topic: 'Spelling', marks: 1 },
  { text: 'Have you ever ___ why some people wake up late in the morning?', options: ['wandered','wondered','wonderd','wondeered'], correctAnswer: 1, topic: 'Spelling', marks: 1 },
  { text: 'The police officers were given ___ information on the expected robbery.', options: ['adequate','adequte','adequati','adiquate'], correctAnswer: 0, topic: 'Spelling', marks: 1 },
  { text: 'My parents often advise me not to ___ with my friends.', options: ['quarel','quarell','quarrel','quarrell'], correctAnswer: 2, topic: 'Spelling', marks: 1 },
  // ── Punctuation (26–30) ──────────────────────────────────────────────────
  { text: 'Choose the correctly punctuated sentence.', options: ['The Bible was translated into Chitonga Cinyanja Luvale and Icibemba.','The Bible was translated into Chitonga, Cinyanja, Luvale and Icibemba.','The Bible was translated into, Chitonga Cinyanja Luvale and Icibemba.','The Bible was translated, into Chitonga Cinyanja Luvale and Icibemba.'], correctAnswer: 1, topic: 'Punctuation', marks: 1 },
  { text: 'Choose the correctly punctuated sentence.', options: ["The First Lady's Independence Day attire was nice.",'The First Ladys Independence Day attire was nice.',"The First Lady's, Independence Day attire was nice.",'The First Ladys\' Independence Day attire was nice.'], correctAnswer: 0, topic: 'Punctuation', marks: 1 },
  { text: 'Choose the correctly punctuated sentence.', options: ['Take this map incase you lose your way.','Take this map in case you lose your way?','Take this map in case you lose your way.','take this map in case you lose your way!'], correctAnswer: 2, topic: 'Punctuation', marks: 1 },
  { text: 'Choose the correctly punctuated sentence.', options: ['Your mother is very dear to you, isn\'t she','Your mother is very dear, to you isn\'t she?','Your mother is very dear to you isn\'t she?','Your mother is very dear to you, isn\'t she?'], correctAnswer: 3, topic: 'Punctuation', marks: 1 },
  { text: 'Choose the correctly punctuated sentence.', options: ['"Aha! There comes our teacher" said Patra.','Aha! There comes our teacher," said Patra.','Aha! "There comes our teacher," said Patra.','"Aha! There comes our teacher," said Patra.'], correctAnswer: 3, topic: 'Punctuation', marks: 1 },
  // ── Meaning (31–38) ──────────────────────────────────────────────────────
  { text: 'Mary managed to attend the interview despite being late. The sentence means that Mary ... interview.', options: ['attended the','did not attend the','missed the','was not late for the'], correctAnswer: 0, topic: 'Meaning', marks: 1 },
  { text: 'Commercial farming is growing crops and raising livestock mainly for sale. The word livestock means animals that are ...', options: ['kept on a farm','producers of milk','ready for sale','resistant to diseases'], correctAnswer: 0, topic: 'Meaning', marks: 1 },
  { text: 'The soldiers demolished some illegal structures built near the railway line. To demolish is to ...', options: ['modernise','improve','destroy','build'], correctAnswer: 2, topic: 'Meaning', marks: 1 },
  { text: 'John was not certain whether Susan was telling the truth. This sentence means ...', options: ['John doubted if Susan was telling the truth.','John was sure that Susan was telling the truth.','Susan was lying.','Susan was telling the truth.'], correctAnswer: 0, topic: 'Meaning', marks: 1 },
  { text: 'If it had not been for our goalkeeper\'s carelessness, we would have won the match. This sentence means ...', options: ['the goalkeeper helped us.','the goalkeeper left the match.','we lost the match.','we won the match.'], correctAnswer: 2, topic: 'Meaning', marks: 1 },
  { text: 'Scientists and engineers invent machines to make our work easier. To invent is to ...', options: ['change parts of the machines.','design something new.','improve on something.','repair old machines.'], correctAnswer: 1, topic: 'Meaning', marks: 1 },
  { text: 'The criminals were spotted at the river. The word spotted means ...', options: ['arrested','attacked','seen','shot'], correctAnswer: 2, topic: 'Meaning', marks: 1 },
  { text: '"I would rather starve than steal," said Chiyembekezo. The sentence means Chiyembekezo would prefer ...', options: ['both starving and stealing.','neither starving nor stealing.','starving to stealing.','stealing to starving.'], correctAnswer: 2, topic: 'Meaning', marks: 1 },
  // ── Paragraph Order (39–45) ──────────────────────────────────────────────
  { text: 'Choose the paragraph with sentences in the correct order. (Chikumbi / coin / biscuits)', options: ['Immediately, she ran out of the house to buy some biscuits. Yesterday, mother told Chikumbi to clean the house. Unfortunately, she lost the money on her way to the shop. While she was cleaning, she found a one kwacha coin under the table. This made her unhappy.','While she was cleaning, she found a one kwacha coin under the table. Unfortunately, she lost the money on her way to the shop. This made her unhappy. Immediately, mother told Chikumbi to clean the house.','Yesterday, mother told Chikumbi to clean the house. Unfortunately, she lost the money on her way to the shop. This made her unhappy. Immediately, she ran out of the house to buy some biscuits. While she was cleaning, she found a one kwacha coin under the table.','Yesterday, mother told Chikumbi to clean the house. While she was cleaning, she found a one kwacha coin under the table. Immediately, she ran out of the house to buy some biscuits. Unfortunately, she lost the money on her way to the shop. This made her unhappy.'], correctAnswer: 3, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (Taizya / family of six)', options: ['Of the six, four are females while two are males. Taizya is the last born in a family of six. As for the females, only one is married while the other one is still at school. All the males are married and employment.','Taizya is the last born in a family of six. All the males are married and are in employment. Of the six, four are females while two are males. As for the females, only one is married while the other one is still at school.','Taizya is the last born in a family of six. All the males are married and are in employment. As for the females, only one is married while the other one is still at school. Of the six, four are females while two are males.','Taizya is the last born in a family of six. Of the six, four are females while two are males. All the males are married and are in employment. As for the females, only one is married while the other one is still at school.'], correctAnswer: 3, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (Shuko / cook rice)', options: ['One day, Shuko was very hungry. He went to the kitchen, cooked rice and ate. He sat outside waiting for his mother to come and cook for him. He then realised he could cook rice.','One day, Shuko was very hungry. He sat outside waiting for his mother to come and cook for him. He went to the kitchen, cooked rice and ate. He then realised he could cook rice.','One day, Shuko was very hungry. He sat outside waiting for his mother to come and cook for him. He then realised he could cook rice. He went to the kitchen, cooked rice and ate.','He sat outside waiting for his mother to come and cook for him. One day, Shuko was very hungry. He went to the kitchen, cooked rice and ate. He then realised he could cook rice.'], correctAnswer: 2, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (Poor people / exploited)', options: ['At times, they are forced to sell their property such as land cheaply to rich people. Poor people are easily exploited. This denies them the right to own property. They are usually made to do jobs which endanger their health.','Poor people are forced to sell their property such as land cheaply to rich people. They are usually made to do jobs which endanger their health. This denies them the right to own property. Poor people are easily exploited.','Poor people are easily exploited. At times, they are forced to sell their property such as land cheaply to rich people. This denies them the right to own property. They are usually made to do jobs which endanger their health.','Poor people are easily exploited. This denies them the right to own property. At times, they are forced to sell their property such as land cheaply to rich people. They are usually made to do jobs which endanger their health.'], correctAnswer: 2, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (Agriculture / oldest occupation)', options: ['Agriculture is one of the oldest occupations on earth. It is also a source of income for the majority of people. It is concerned with growing of crops and rearing of livestock. It provides food for many industries.','Agriculture is one of the oldest occupations on earth. It is concerned with growing of crops and rearing of livestock. It provides food and raw materials for many industries. It is also a source of income for the majority of people.','It is concerned with growing of crops and rearing of livestock. It provides food and raw materials for many industries. It is also a source of income for the majority of people. Agriculture is one of the oldest occupations on earth.','It provides food and raw materials for many industries. Agriculture is one of the oldest occupations on earth. It is also a source of income for the majority of people. It is concerned with growing of crops and rearing of livestock.'], correctAnswer: 1, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (War canoe / paddlers)', options: ['As the canoe moved quickly over the water, we could hear the warriors singing their war-song. The paddlers put their paddles in the water and the great war canoe began to move towards us. Between the paddlers sat the great war canoe, each one holding a spear. We could see the points of spears shining as they were shaken by the approaching war boys.','Between the paddlers sat the warriors, each one holding a spear. The paddlers put their paddles in the water and the great war canoe began to move towards us. As the canoe moved quickly over the water, we could hear the warriors singing their war-song. We could see the points of spears shining as they were shaken by the approaching war boys.','The paddlers put their paddles in the water and the great war canoe began to move towards us. Between the paddlers sat the warriors, each one holding a spear. As the canoe moved quickly over the water, we could hear the warriors singing their war-song. We could see the points of spears shining as they were shaken by the approaching war boys.','The paddlers put their paddles in the water and the great war canoe began to move towards us. We could see the points of spears shining as they were shaken by the approaching war boys. Between the paddlers sat the warriors, each one holding a spear. As the canoe moved quickly over the water, we could hear the warriors singing their war-song.'], correctAnswer: 2, topic: 'Paragraph Order', marks: 1 },
  { text: 'Choose the paragraph with sentences in the correct order. (Football / FIFA)', options: ['Football is played all over the world. The organisation that runs it is the Federation Internationale de Football Association (FIFA) and it is based in Switzerland. The Football Association of Zambia (FAZ) has members in all the provinces of Zambia.','Football is played all over the world. The organisation that runs it is the Federation Internationale de Football Association (FIFA) and it is based in Switzerland. In Zambia, football is run by the Football Association of Zambia (FAZ). The Football Association of Zambia (FAZ) has members in all the provinces of Zambia.','In Zambia, football is run by the Football Association of Zambia (FAZ). The Football Association of Zambia (FAZ) has members in all the provinces of Zambia. Football is played all over the world. The organisation that runs it is the Federation Internationale de Football Association (FIFA) and it is based in Switzerland.','In Zambia, football is run by the Football Association of Zambia (FAZ). Football is played all over the world. The organisation that runs it is the Federation Internationale de Football Association (FIFA) and it is based in Switzerland. The Football Association of Zambia (FAZ) has members in all the provinces of Zambia.'], correctAnswer: 1, topic: 'Paragraph Order', marks: 1 },
  // ── Reading Comprehension 1 (46–50) — Ancestor Kaulu ────────────────────
  { text: 'According to the text, why was ancestor Kaulu angry with the villagers?', options: ['bewitched the boy.','did not give him some beer.','did not understand what the calabash said.','offered him some beer.'], correctAnswer: 1, topic: 'Reading Comprehension', marks: 1 },
  { text: 'Which of the following was not done by the witchdoctor in the process of helping the boy?', options: ['Carrying him outside.','Dancing around him.','Giving him medicine.','Spitting on his face.'], correctAnswer: 2, topic: 'Reading Comprehension', marks: 1 },
  { text: 'According to the text, it can be concluded that the boy was sick because ...', options: ['he was bewitched.','the ancestor was angry.','the witchdoctor danced around him.','they did not give him beer.'], correctAnswer: 1, topic: 'Reading Comprehension', marks: 1 },
  { text: 'According to the text, the word "quivering" means ...', options: ['dancing fast.','dancing slowly.','shaking slightly.','shaking very fast.'], correctAnswer: 2, topic: 'Reading Comprehension', marks: 1 },
  { text: 'Traditionally, calabashes are often used as ...', options: ['containers.','drums.','plates.','pots.'], correctAnswer: 0, topic: 'Reading Comprehension', marks: 1 },
  // ── Reading Comprehension 2 (51–55) — Crocodile ─────────────────────────
  { text: 'According to the passage, the word "hatchlings" means young animals that have recently emerged from the ...', options: ['womb.','water.','leaves.','eggs.'], correctAnswer: 3, topic: 'Reading Comprehension', marks: 1 },
  { text: 'The crocodile\'s jaw has a high sense of ...', options: ['touch.','taste.','smell.','sight.'], correctAnswer: 0, topic: 'Reading Comprehension', marks: 1 },
  { text: 'To which group of animals does the crocodile belong?', options: ['Amphibians','Fish','Mammals','Reptiles'], correctAnswer: 3, topic: 'Reading Comprehension', marks: 1 },
  { text: 'The text is about the crocodile\'s ...', options: ['jaw.','mouth.','power.','teeth.'], correctAnswer: 0, topic: 'Reading Comprehension', marks: 1 },
  { text: 'The prefix "semi" in the word "semi-aquatic" means ...', options: ['whole.','two.','one.','half.'], correctAnswer: 3, topic: 'Reading Comprehension', marks: 1 },
  // ── Reading Comprehension 3 (56–60) — Class games table ─────────────────
  { text: 'How many members are in this class?', options: ['Eight','Nineteen','Twelve','Twenty'], correctAnswer: 1, topic: 'Reading Comprehension', marks: 1 },
  { text: 'Which game is the most played by the members of this class?', options: ['Basketball','Football','Netball','Volleyball'], correctAnswer: 3, topic: 'Reading Comprehension', marks: 1 },
  { text: 'Which members of this class play all the three games?', options: ['Brenda and Bweupe','Chola and Elizabeth','Linda and Lengwe','Natasha and Kelly'], correctAnswer: 3, topic: 'Reading Comprehension', marks: 1 },
  { text: 'What is the difference between members who play netball only and those who play volleyball only?', options: ['Two','One','Nine','Eleven'], correctAnswer: 1, topic: 'Reading Comprehension', marks: 1 },
  { text: 'Which members play volleyball as well as netball for extra-curricular activities?', options: ['Chola, Elizabeth, Linda, Lengwe, Natasha and Kelly.','Esther, Busisiwe, Sarah, Natasha, Kelly, Linda and Lengwe.','Linda, Lengwe, Natasha and Kelly.','Natasha, Kelly, Lisa, Mapenzi, Chanda and Kapiji.'], correctAnswer: 0, topic: 'Reading Comprehension', marks: 1 },
]

// ── Grade 6 Integrated Science Past Paper (50 questions) ─────────────────
const grade6Science = {
  title: 'Grade 6 Integrated Science — Past Paper',
  subject: 'Integrated Science', grade: '6', term: '1', year: '2024',
  type: 'quiz', duration: 60, totalMarks: 50, isPublished: true, questionCount: 50,
}

const grade6ScienceQs = [
  { text: 'What is the function of the heart?', options: ['Pumping food','Pumping air','Pumping water','Pumping blood'], correctAnswer: 3, topic: 'Human Body', marks: 1 },
  { text: 'Opening doors, windows and having cooling fans is very important because they', options: ['protect people from germs.','allow fresh air to move around.','let germs to move freely.','let in different types of gases.'], correctAnswer: 1, topic: 'Air and Ventilation', marks: 1 },
  { text: 'People conserve electricity in homes by using', options: ['energy saving bulbs for lighting.','ordinary bulbs for lighting.','ordinary pots for heating water.','geysers for heating water.'], correctAnswer: 0, topic: 'Energy Conservation', marks: 1 },
  { text: 'What is the use of a copper wire with one end buried in the earth in a house and the other extending higher than the house?', options: ['To transmit messages.','Act as an aerial for a television.','Act as an aerial for a radio.','To protect the house from lightning.'], correctAnswer: 3, topic: 'Electricity and Safety', marks: 1 },
  { text: 'What is the process by which plants make food?', options: ['Evaporation','Transpiration','Photosynthesis','Pollination'], correctAnswer: 2, topic: 'Plants', marks: 1 },
  { text: 'A given disease can be prevented as follows: 1. Drink clean water and eat clean food. 2. Wash hands with soap after using the toilet. 3. Always defaecate in a toilet. What disease is this?', options: ['AIDS','Cancer','Cholera','Malaria'], correctAnswer: 2, topic: 'Disease Prevention', marks: 1 },
  { text: 'Which of the following minerals is not mined in Zambia?', options: ['Cobalt','Diamond','Lead','Zinc'], correctAnswer: 1, topic: 'Natural Resources', marks: 1 },
  { text: 'What electrical appliance can convert electrical energy into light energy?', options: ['Radio','Bulb','Speaker','Stove'], correctAnswer: 1, topic: 'Energy Transformation', marks: 1 },
  { text: 'Choose a source of vitamins and minerals from the following:', options: ['Bread','Cassava','Maize','Fruits'], correctAnswer: 3, topic: 'Nutrition', marks: 1 },
  { text: 'Study the following diagram. The process X is ...', options: ['cross pollination.','fertilisation.','germination.','self pollination.'], correctAnswer: 0, topic: 'Pollination', marks: 1, diagramText: '[Diagram: Two flowers are shown. A bee is flying from the flower on the left towards the flower on the right. The path of the bee between the two flowers is labeled X.]' },
  { text: 'The fish ban is practised in Zambia from 1st December to 31st March every year. This is done to ensure that fish is ...', options: ['given chance to breed.','protected from being eaten.','not sold on the market.','preferred to meat.'], correctAnswer: 0, topic: 'Environmental Conservation', marks: 1 },
  { text: 'Study the diagram of the flower below. Which of the parts numbered is female?', options: ['1','2','3','4'], correctAnswer: 1, topic: 'Parts of a Flower', marks: 1, diagramText: '[Diagram: A cross-section of a flower with four numbered parts. 1 points to the filament, 2 points to the style/pistil, 3 points to the anther, and 4 points to the petal.]' },
  { text: 'Grade 6 learners recorded rainfall for four districts as shown below. Which district could have had its crops damaged due to floods?', options: ['Chinsali','Kitwe','Livingstone','Mwinilunga'], correctAnswer: 3, topic: 'Weather and Climate', marks: 1, diagramText: '[Diagram: A table showing District vs Rainfall (ml): Livingstone 20ml, Mwinilunga 56ml, Kitwe 41ml, Chinsali 29ml.]' },
  { text: 'Syphilis and gonorrhea are all diseases which are transmitted through ...', options: ['eating together with an infected person.','unprotected sex with an infected person.','shaking hands with an infected person.','sleeping on the same bed with an infected person.'], correctAnswer: 1, topic: 'Sexually Transmitted Infections', marks: 1 },
  { text: 'Dissolved substances in the body are transported by the', options: ['blood.','heart.','intestines.','stomach.'], correctAnswer: 0, topic: 'Human Body', marks: 1 },
  { text: 'Which of the following is not an agent of pollination?', options: ['Fungus','Insect','Water','Wind'], correctAnswer: 0, topic: 'Pollination', marks: 1 },
  { text: 'Below is a simple electric circuit diagram. What components are X and Y in this circuit?', options: ['Bulb, Switch','Cell, Wire','Switch, Bulb','Cell, Switch'], correctAnswer: 3, topic: 'Electric Circuits', marks: 1, diagramText: '[Diagram: A rectangular circuit diagram. At the top is a battery symbol labeled X. On the right side is an open switch symbol labeled Y. At the bottom is a light bulb symbol.]' },
  { text: 'Which of the following are not basic needs of livestock?', options: ['Firewood and medicine','Shelter and air','Care when sick and food','Protection from danger and water'], correctAnswer: 0, topic: 'Animal Husbandry', marks: 1 },
  { text: 'Which of the following lists represents the agents of pollination?', options: ['Wind, insects, water','Animals, wind, air','Insects, water, heat','Water, animals, smoke'], correctAnswer: 0, topic: 'Pollination', marks: 1 },
  { text: 'Which of the following diseases is prevented by drinking clean safe water?', options: ['Measles','Malaria','Tuberculosis','Typhoid'], correctAnswer: 3, topic: 'Disease Prevention', marks: 1 },
  { text: 'Which of the following are common diseases of the skin?', options: ['Tuberculosis, Scurvy, Rabies, Measles','Ringworm, Warts, Chicken pox, Scabies','Chicken pox, Ringworm, Malaria, Small pox','Small pox, Ringworm, Malaria, Warts'], correctAnswer: 1, topic: 'Skin Diseases', marks: 1 },
  { text: 'A person must read the labels on a container of food before buying it because this helps to', options: ['eat food which is balanced.','learn how to cook the food properly.','process food easily for storage.','know the manufacturing and expiry dates.'], correctAnswer: 3, topic: 'Food Safety', marks: 1 },
  { text: 'Bean seeds are usually dispersed by', options: ['wind.','explosion.','water.','animal.'], correctAnswer: 1, topic: 'Seed Dispersal', marks: 1 },
  { text: 'The solar system consists of the', options: ['earth and moon.','earth and eight planets.','Saturn and the moon.','sun and the planets.'], correctAnswer: 3, topic: 'Solar System', marks: 1 },
  { text: 'The diagrams below show different musical instruments. Which of the above instruments produces sound by hitting?', options: ['1','2','3','4'], correctAnswer: 1, topic: 'Musical Instruments', marks: 1, diagramText: '[Diagram: Four instruments pictured and numbered. 1 is an electric guitar. 2 is a xylophone with mallets. 3 is a trumpet. 4 is a flute/recorder.]' },
  { text: 'When a ball is thrown into the air, it falls back again because of the force called', options: ['gravity.','magnet.','pressure.','resistance.'], correctAnswer: 0, topic: 'Forces', marks: 1 },
  { text: 'A person experienced the following signs and symptoms: 1. Blood in urine. 2. Feeling pain in lower abdomen. 3. Fever. Which of the following diseases was the person suffering from?', options: ['Typhoid','Tuberculosis','Dysentery','Bilharzia'], correctAnswer: 3, topic: 'Diseases', marks: 1 },
  { text: 'Study the list of body changes: 1. Voice breaking. 2. Widening of hips. 3. Growth of pubic hair. 4. Growth of hair under the arms. At what stage of human development do these changes take place?', options: ['Puberty','Childhood','Toddler','Adulthood'], correctAnswer: 0, topic: 'Human Development', marks: 1 },
  { text: 'Study the diagram below. What is the name of the instrument above?', options: ['Spring balance','Beam balance','Voltmeter','Bathroom scale'], correctAnswer: 0, topic: 'Measurement', marks: 1, diagramText: '[Diagram: A picture of a hanging spring balance scale with a hook at the bottom.]' },
  { text: 'The use of a switch in a circuit is to ...', options: ['produce electric energy in a circuit.','light the bulb in the circuit.','reverse the flow of electricity in a circuit.','open and close the circuit.'], correctAnswer: 3, topic: 'Electric Circuits', marks: 1 },
  { text: 'People in villages mostly depend on lakes and rivers for water which ...', options: ["they don't normally purify.",'they always purify.','is not polluted.','is clean and safe.'], correctAnswer: 0, topic: 'Water and Health', marks: 1 },
  { text: 'Three of the following are uses of good conductors of electricity: 1. Making electric wire and cables. 2. Transmitting signals in communication devices. 3. Heating elements in cookers. 4. Making the handles of pots. Which of the above is not a use of good conductors of electricity?', options: ['1','2','3','4'], correctAnswer: 3, topic: 'Conductors and Insulators', marks: 1 },
  { text: 'Which of the following best explains the effect of substance abuse in people\'s lives? Substance abuse may...', options: ['lead to one contracting tuberculosis.','lead to one becoming intelligent.','cause one to commit crime.','cause stunted growth.'], correctAnswer: 2, topic: 'Substance Abuse', marks: 1 },
  { text: 'Study the diagram of the flower below. Which letters represent the anther and style?', options: ['P and S','Q and T','Q and R','T and S'], correctAnswer: 0, topic: 'Parts of a Flower', marks: 1, diagramText: '[Diagram: A flower with parts labeled P (anther), Q (filament), R (petal), S (style), T (ovary).]' },
  { text: 'Which of the following changes are observed in females at puberty?', options: ['Breaking of the voice.','Enlargement of breasts.','Growth of beards and pubic hair.','Enlargement of shoulders.'], correctAnswer: 1, topic: 'Human Development', marks: 1 },
  { text: 'Which of the components of air in the diagram below are not correct?', options: ['Carbon dioxide and oxygen.','Inert gases and carbon dioxide.','Nitrogen and oxygen.','Nitrogen and inert gases.'], correctAnswer: 2, topic: 'Composition of Air', marks: 1, diagramText: '[Diagram: A chart showing Nitrogen 21%, Oxygen 78%, Carbon dioxide 0.03%, and Inert gases 0.97%.]' },
  { text: 'A learner set up the experiment below. The learner concluded from the experiment that air', options: ['exerts pressure.','occupies space.','has weight.','is colourless.'], correctAnswer: 1, topic: 'Properties of Air', marks: 1, diagramText: '[Diagram: A ruler measuring balloons. The first is a deflated balloon measuring less than 10cm. The next two are inflated balloons taking up more space on the ruler.]' },
  { text: 'In a hydro-electric power station, the energy transformations that take place are', options: ['potential → kinetic → electrical','potential → electrical → kinetic','chemical → kinetic → electrical','chemical → electrical → kinetic'], correctAnswer: 0, topic: 'Energy Transformation', marks: 1 },
  { text: 'Study the pie chart below. It shows the composition of air in the atmosphere. The gas with the highest percentage represents...', options: ['carbon dioxide.','nitrogen.','oxygen.','water vapour.'], correctAnswer: 1, topic: 'Composition of Air', marks: 1, diagramText: '[Diagram: A pie chart divided into 78%, 21%, 0.97%, and 0.03%.]' },
  { text: 'A learner was asked to blow over the mouth of an empty bottle. This was to demonstrate how sound', options: ['travels.','is produced.','volume is increased.','makes music.'], correctAnswer: 1, topic: 'Sound', marks: 1 },
  { text: 'Which of the following activities is not an effect of mining on the environment?', options: ['Dust is released to the surrounding communities.','Dangerous solids are dumped in the surrounding.','Poisonous gases are released to the atmosphere.','Minerals are produced for the country.'], correctAnswer: 3, topic: 'Mining and Environment', marks: 1 },
  { text: 'Which of the following is a property of copper?', options: ['Mixture of gases','Colourless liquid','Resistant to rust','Exerts pressure'], correctAnswer: 2, topic: 'Properties of Materials', marks: 1 },
  { text: 'The best method of communicating with a large number of people that are in different places at the same time is by using a...', options: ['phone.','drum.','letter.','radio.'], correctAnswer: 3, topic: 'Communication', marks: 1 },
  { text: 'Study the water cycle below. What will be the result of not having water at X?', options: ['Floods','Drought','Evaporation','Condensation'], correctAnswer: 1, topic: 'Water Cycle', marks: 1, diagramText: '[Diagram: A water cycle diagram showing a body of water with an arrow pointing up labeled X (evaporation), moving to clouds, and raining back down.]' },
  { text: 'In a certain community most of the children were found to be suffering from a disease which has the following signs: 1. Soft and weak bones. 2. Bow-shaped legs. 3. Poor teeth formation. Which of these diseases were the children suffering from?', options: ['Rickets','Marasmus','Kwashiorkor','Goitre'], correctAnswer: 0, topic: 'Nutritional Deficiency Diseases', marks: 1 },
  { text: 'What type of substances does the following technique separate?', options: ['A soluble substance from water.','An insoluble substance from water.','Two soluble substances mixed together.','Insoluble substance from another insoluble one.'], correctAnswer: 1, topic: 'Separation Techniques', marks: 1, diagramText: '[Diagram: A filtration setup showing a funnel lined with filter paper, pouring into a measuring cylinder containing water.]' },
  { text: 'Which of the following is an insect?', options: ['1','2','3','4'], correctAnswer: 1, topic: 'Animal Classification', marks: 1, diagramText: '[Diagram: Four animals pictured and numbered. 1 is a spider. 2 is a grasshopper/insect. 3 is a scorpion. 4 is a centipede.]' },
  { text: 'What is the importance of improving varieties of seeds?', options: ['Improve the harvest, increase resistance to diseases.','Increase resistance to drought, reduce resistance to diseases.','Reduce the harvest, reduce resistance to diseases.','Improve the harvest, reduce resistance to drought.'], correctAnswer: 0, topic: 'Agriculture', marks: 1 },
  { text: 'Study the diagram of the heart below. The parts shown by the letters P and Q in the diagram are', options: ['Right ventricle, Left ventricle','Left ventricle, Right ventricle','Right atrium, Right ventricle','Left atrium, Left ventricle'], correctAnswer: 0, topic: 'Human Body', marks: 1, diagramText: '[Diagram: A cross-section of a human heart. P points to the right ventricle and Q points to the left ventricle.]' },
  { text: 'The absence of starch in a leaf is shown when iodine solution turns ...', options: ['black.','purple.','brown.','colourless.'], correctAnswer: 2, topic: 'Plants', marks: 1 },
]

// ── Grade 7 Integrated Science ECZ Exam 2 (50 questions) ─────────────────
const grade7ScienceExam2 = {
  title: 'Grade 7 Integrated Science — ECZ Exam 2',
  subject: 'Integrated Science', grade: '7', term: '1', year: '2024',
  type: 'quiz', duration: 60, totalMarks: 50, isPublished: true, questionCount: 50,
}

const grade7ScienceExam2Qs = [
  { text: 'Diarrhoea, dysentery, typhoid and cholera are all caused by eating ________ food.', options: ['contaminated','overcooked','preserved','warm'], correctAnswer: 0, topic: 'Disease Prevention', marks: 1 },
  { text: 'Which of the following is the CORRECT order of parts of the alimentary canal that come after the stomach?', options: ['Anus, small intestine, colon','Colon, anus, small intestine','Small intestine, colon, anus','Gullet, small intestine, anus'], correctAnswer: 2, topic: 'Digestive System', marks: 1 },
  { text: 'Chanda ate nsima and beans for lunch. The organ that FIRST begins to digest the protein in the beans is the ________.', options: ['Mouth','Small intestine','Stomach','Large intestine'], correctAnswer: 2, topic: 'Digestive System', marks: 1 },
  { text: 'A learner removed one organ from a diagram of the human digestive system. The removed organ produces bile juice used in the digestion of fats. Which organ was removed?', options: ['Pancreas','Gall bladder','Stomach','Liver'], correctAnswer: 3, topic: 'Digestive System', marks: 1 },
  { text: 'The chemicals in the stomach that help break down food are ________.', options: ['acids','alkaline solutions','gastric juices (enzymes)','mucus'], correctAnswer: 2, topic: 'Digestive System', marks: 1 },
  { text: 'A boy ate contaminated food. Before the germs reached his small intestine, they were destroyed. In which organ were the germs killed?', options: ['Mouth','Oesophagus','Stomach','Large intestine'], correctAnswer: 2, topic: 'Digestive System', marks: 1 },
  { text: 'Study the diagram of the human digestive system below. The organ labelled B is the ________.', options: ['Large intestine','Small intestine','Stomach','Pancreas'], correctAnswer: 1, topic: 'Digestive System', marks: 1, diagramText: '[Diagram: A human digestive system with various organs labelled. The organ labelled B is the small intestine.]' },
  { text: 'Which of the following processes occur ONLY in the small intestine?', options: ['Digestion of proteins and absorption of water','Completion of digestion and absorption of digested food into the bloodstream','Storage of faeces and absorption of mineral salts','Production of bile and digestion of starch'], correctAnswer: 1, topic: 'Digestive System', marks: 1 },
  { text: 'The main function of the large intestine is to ________.', options: ['digest proteins and fats','produce digestive enzymes','absorb water and mineral salts','produce bile juice'], correctAnswer: 2, topic: 'Digestive System', marks: 1 },
  { text: 'The process of removing undigested food from the body through the anus is called ________.', options: ['digestion','absorption','ingestion','egestion'], correctAnswer: 3, topic: 'Digestive System', marks: 1 },
  { text: 'A patient has a continuous cough, is spitting blood and has lost a lot of weight. What disease is this patient most likely suffering from?', options: ['Bronchitis','Tuberculosis','Asthma','Pneumonia'], correctAnswer: 1, topic: 'Diseases', marks: 1 },
  { text: 'The table below shows the causes of three diseases. Which row (A, B, C or D) shows the CORRECT causes?', options: ['HIV: Bacteria | Tuberculosis: Parasite | Cholera: Virus','HIV: Virus | Tuberculosis: Parasite | Cholera: Bacteria','HIV: Bacteria | Tuberculosis: Virus | Cholera: Protozoa','HIV: Virus | Tuberculosis: Bacteria | Cholera: Bacteria'], correctAnswer: 3, topic: 'Diseases', marks: 1, diagramText: '[Table: Each row shows causes for HIV, Tuberculosis and Cholera. Row A: Bacteria / Parasite / Virus. Row B: Virus / Parasite / Bacteria. Row C: Bacteria / Virus / Protozoa. Row D: Virus / Bacteria / Bacteria.]' },
  { text: 'A child develops a rash that FIRST appears behind the ears and then spreads rapidly all over the body, accompanied by high fever and runny nose. Which disease is this child suffering from?', options: ['Scabies','Ringworm','Measles','Chicken pox'], correctAnswer: 2, topic: 'Diseases', marks: 1 },
  { text: 'Which of the following correctly distinguishes a VIRUS from a BACTERIUM?', options: ['Viruses are living things; bacteria are non-living','Viruses cannot exist on their own; bacteria can live and survive on their own','Viruses are larger than bacteria','Viruses can be treated with antibiotics; bacteria cannot'], correctAnswer: 1, topic: 'Diseases', marks: 1 },
  { text: 'Mutale has swollen and bleeding gums, loose teeth and feels very weak and tired. She is most likely suffering from ________.', options: ['Typhoid','Scurvy','Ringworm','Tuberculosis'], correctAnswer: 1, topic: 'Nutritional Deficiency Diseases', marks: 1 },
  { text: 'Which one of the following is NOT a disease of the skin?', options: ['Ringworm','Tapeworm','Scabies','Measles'], correctAnswer: 1, topic: 'Skin Diseases', marks: 1 },
  { text: 'Waterborne diseases can BEST be prevented by ________.', options: ['bathing with soap and water daily','not fetching water from rivers','washing hands with soap after using the toilet','wearing clean clothes every day'], correctAnswer: 2, topic: 'Disease Prevention', marks: 1 },
  { text: 'HIV and AIDS can enter the bloodstream in the following ways EXCEPT ________.', options: ['having unprotected sex with an infected person','sharing food with an infected person','receiving a blood transfusion with infected blood','an infected mother breastfeeding her child'], correctAnswer: 1, topic: 'HIV and AIDS', marks: 1 },
  { text: 'There is currently no CURE for HIV and AIDS. However, patients are given drugs to control the disease. These drugs are called ________.', options: ['antibiotics','antiretrovirals (ARVs)','antimalarials','antifungals'], correctAnswer: 1, topic: 'HIV and AIDS', marks: 1 },
  { text: 'Oranges, lemons and guavas are recommended for the PREVENTION and treatment of scurvy. This is because these fruits are rich in ________.', options: ['Vitamin A','Vitamin B','Vitamin C','Vitamin D'], correctAnswer: 2, topic: 'Nutrition', marks: 1 },
  { text: 'Why is water FILTERED before other processes are carried out at the water treatment plant?', options: ['To kill bacteria in the water','To remove solid particles and visible impurities','To remove dissolved chemicals','To aerate the water'], correctAnswer: 1, topic: 'Water Treatment', marks: 1 },
  { text: 'Which of the following is the CORRECT order of the stages of the water treatment process?', options: ['Pumping, screening, filtration, disinfection, distribution','Screening, pumping, sedimentation, coagulation, distribution','Filtration, pumping, disinfection, coagulation, distribution','Pumping, disinfection, filtration, screening, distribution'], correctAnswer: 0, topic: 'Water Treatment', marks: 1 },
  { text: 'After filtering a mixture of sand and water through a piece of cloth, the sand that remains on the cloth is called the ________.', options: ['filtrate','solution','residue','solvent'], correctAnswer: 2, topic: 'Separation Techniques', marks: 1 },
  { text: 'A learner wants to separate salt from a salt-water solution. Which method should the learner use?', options: ['Filtration','Sieving','Decantation','Evaporation'], correctAnswer: 3, topic: 'Separation Techniques', marks: 1 },
  { text: 'Which of the following methods of water treatment removes germs from water but does NOT remove dissolved chemicals?', options: ['Distillation','Boiling','Ultra-violet radiation','Carbon filtration'], correctAnswer: 1, topic: 'Water Treatment', marks: 1 },
  { text: 'Mulching is an agricultural practice used to ________.', options: ['add fertiliser to the soil','reduce moisture loss from the soil through evaporation','remove weeds from around plants','protect crops from insects and pests'], correctAnswer: 1, topic: 'Agriculture', marks: 1 },
  { text: 'Which one of the following is NOT a source of water in a village?', options: ['Wells and boreholes','Rivers and streams','Upland lakes and dams','Swimming pools'], correctAnswer: 3, topic: 'Water Sources', marks: 1 },
  { text: 'Distillation is considered the most thorough method of water purification because it ________.', options: ['kills germs only','removes only suspended particles','removes chemicals, germs and even some useful minerals','adds fluoride and chlorine to the water'], correctAnswer: 2, topic: 'Water Treatment', marks: 1 },
  { text: 'A mixture of stones and sand is BEST separated by ________.', options: ['filtration','evaporation','sieving','decantation'], correctAnswer: 2, topic: 'Separation Techniques', marks: 1 },
  { text: 'Fluoride is added to water during which stage of the water treatment process?', options: ['Screening','Pre-chlorination','Neutralising the water','Sedimentation'], correctAnswer: 2, topic: 'Water Treatment', marks: 1 },
  { text: 'A learner observed a bee visiting flowers as shown in the diagram below. Which conclusion can the learner CORRECTLY draw from the movement of the bee?', options: ['Pollen is being carried from one flower to another','A bee is transferring nectar from one flower to another','A bee enjoys eating flowers','The flower is being destroyed by the bee'], correctAnswer: 0, topic: 'Pollination', marks: 1, diagramText: '[Diagram: A bee is shown flying from one flower to another, landing briefly on each to collect nectar.]' },
  { text: 'Which of the following is the CORRECT definition of pollination?', options: ['The fertilisation of the ovule by a pollen grain','The transfer of pollen from the anther to the stigma of a flower','The development of a fruit from the ovary wall','The dispersal of seeds away from the parent plant'], correctAnswer: 1, topic: 'Pollination', marks: 1 },
  { text: 'The diagram below shows a fruit pod that has split open, scattering its seeds forcefully. By what method are these seeds dispersed?', options: ['Wind','Animal','Explosion (self-dispersal)','Water'], correctAnswer: 2, topic: 'Seed Dispersal', marks: 1, diagramText: '[Diagram: A dry fruit pod has split open along its seam, throwing its seeds outwards in several directions.]' },
  { text: 'A paw paw tree has only female flowers but produces NO fruit. What is the MOST likely reason for this?', options: ['The plant does not have petals','There is no male paw paw plant nearby for pollination','The fruit has already fallen off','The flowers are wind-pollinated'], correctAnswer: 1, topic: 'Pollination', marks: 1 },
  { text: 'Which of the following is NOT an importance of seed dispersal?', options: ['It prevents overcrowding of plants around the parent plant','It allows plants to grow in new areas where there was no vegetation','It reduces competition for sunlight, water and nutrients','It helps seeds to germinate faster in the same soil as the parent plant'], correctAnswer: 3, topic: 'Seed Dispersal', marks: 1 },
  { text: 'The following are examples of food crops: beans, maize, groundnuts, sorghum, cowpeas, rice. Which of the following CORRECTLY classifies these crops into legumes and cereals?', options: ['Legumes: beans, groundnuts, cowpeas | Cereals: maize, sorghum, rice','Legumes: maize, sorghum, rice | Cereals: beans, groundnuts, cowpeas','Legumes: beans, maize, groundnuts | Cereals: sorghum, cowpeas, rice','Legumes: maize, rice, cowpeas | Cereals: beans, sorghum, groundnuts'], correctAnswer: 0, topic: 'Agriculture', marks: 1 },
  { text: 'Study the diagram of a flower below. Which part labelled X is responsible for RECEIVING pollen grains during pollination?', options: ['Anther','Filament','Stigma','Ovary'], correctAnswer: 2, topic: 'Parts of a Flower', marks: 1, diagramText: '[Diagram: A cross-section of a flower. The label X points to the stigma at the tip of the pistil.]' },
  { text: 'A farmer wants to grow more sugar cane plants quickly without using seeds. Which method of propagation should the farmer use?', options: ['Cross-pollination','Use of stem cuttings','Seed germination','Fertilisation'], correctAnswer: 1, topic: 'Plant Propagation', marks: 1 },
  { text: 'After fertilisation in a flower, the CORRECT outcome is ________.', options: ['The petal develops into a fruit; the sepal becomes a seed','The ovary develops into a fruit; the ovule develops into a seed','The anther develops into a seed; the stigma becomes a fruit','The style develops into a seed; the filament becomes a fruit'], correctAnswer: 1, topic: 'Reproduction in Plants', marks: 1 },
  { text: 'Which of the following CORRECTLY describes a wind-pollinated flower?', options: ['Large, brightly coloured petals with a strong scent and nectar','Small, dull petals, no nectar, large quantities of light pollen','Large, sticky pollen grains with brightly coloured petals','Small flowers with sweet nectar to attract bees and butterflies'], correctAnswer: 1, topic: 'Pollination', marks: 1 },
  { text: 'When food is digested in the body, the chemical energy stored in food is changed to ________.', options: ['heat energy','light energy','sound energy','electrical energy'], correctAnswer: 0, topic: 'Energy Transformation', marks: 1 },
  { text: 'The set-up below shows three bulbs and two dry cells connected together. The set-up represents ________.', options: ['bulbs in series','bulbs in parallel','batteries in parallel','an incomplete circuit'], correctAnswer: 0, topic: 'Electric Circuits', marks: 1, diagramText: '[Diagram: Two dry cells and three bulbs are connected in a single loop so the current passes through each bulb one after the other.]' },
  { text: 'Grade 7 learners set up a circuit with dry cells, wires and a bulb holder. After connecting the circuit, the bulb did NOT light. What component did the learners MOST LIKELY forget?', options: ['Insulated wire','Bulb','Good conductor','Switch'], correctAnswer: 1, topic: 'Electric Circuits', marks: 1 },
  { text: 'Two inflated balloons are rubbed on a woollen cloth and then brought close together. What will happen?', options: ['They will attract each other','They will repel each other','Nothing will happen','They will develop different charges'], correctAnswer: 1, topic: 'Static Electricity', marks: 1 },
  { text: 'Lightning always strikes the ________ objects on its path.', options: ['tallest','shortest','metallic','heaviest'], correctAnswer: 0, topic: 'Lightning', marks: 1 },
  { text: 'One agricultural importance of lightning is that it ________.', options: ['produces rain for crops','kills harmful insects in the soil','fixes nitrogen from the atmosphere into nitrates in the soil','removes harmful gases from the atmosphere'], correctAnswer: 2, topic: 'Lightning', marks: 1 },
  { text: 'A metal has the following properties: (i) Reddish in colour (ii) High melting point (iii) Very good conductor of heat and electricity (iv) Malleable and ductile. Identify this metal.', options: ['Zinc','Iron','Copper','Aluminium'], correctAnswer: 2, topic: 'Properties of Materials', marks: 1 },
  { text: 'Which one of the following minerals is NOT mined in Zambia?', options: ['Cobalt','Diamond','Coal','Zinc'], correctAnswer: 1, topic: 'Natural Resources', marks: 1 },
  { text: 'Neptune is the COLDEST planet in the Solar System. The MAIN reason for this is that ________.', options: ['it does not produce its own light','it has a lot of ice and water on its surface','its orbit is the farthest from the Sun','it rotates very slowly on its axis'], correctAnswer: 2, topic: 'Solar System', marks: 1 },
  { text: 'Which one of the following is NOT part of the copper extraction process?', options: ['Electrolysis (refining)','Crushing','Smelting','Floatation'], correctAnswer: 0, topic: 'Mining and Minerals', marks: 1 },
]

// ── Grade 7 Social Studies PRISCA Mock 2023 (60 questions) ──────────────
const grade7SocialStudies2023 = {
  title: 'Grade 7 Social Studies — PRISCA Mock 2023',
  subject: 'Social Studies', grade: '7', term: '1', year: '2023',
  type: 'quiz', duration: 75, totalMarks: 60, isPublished: true, questionCount: 60,
}

const grade7SocialStudies2023Qs = [
  { text: 'Which of the following is the staple food for most Zambians?', options: ['Bread','Nshima','Potatoes','Rice'], correctAnswer: 1, topic: 'Culture and Food', marks: 1 },
  { text: 'Nkolola initiation ceremony is performed in ________ Province.', options: ['Eastern','North-Western','Southern','Western'], correctAnswer: 2, topic: 'Traditional Ceremonies', marks: 1 },
  { text: 'The Bible text "If a person will not work, let him starve" (2 Thessalonians 3:10) teaches us to ________.', options: ['be lazy.','be very greedy.','work hard.','be wise.'], correctAnswer: 2, topic: 'Religious Education', marks: 1 },
  { text: 'Which country among these has the highest population?', options: ['China','Japan','Pakistan','India'], correctAnswer: 0, topic: 'World Geography', marks: 1 },
  { text: 'Bribery and corruption cases should be reported to ________.', options: ['Human Rights Commission.','Zambia Police.','Public Service Commission.','Anti-Corruption Commission.'], correctAnswer: 3, topic: 'Governance', marks: 1 },
  { text: 'The place of worship for Hindus is known as ________.', options: ['church','mosque','temple','synagogue'], correctAnswer: 2, topic: 'Religious Education', marks: 1 },
  { text: 'The official counting of people in the country is known as ________.', options: ['census','voting','statistics','population'], correctAnswer: 0, topic: 'Civics', marks: 1 },
  { text: 'A Zambian citizen is eligible to get a National Registration Card at the age of ________.', options: ['18 years.','16 years.','14 years.','12 years.'], correctAnswer: 1, topic: 'Civics', marks: 1 },
  { text: 'Food security means ________.', options: ['providing food to households.','guarding food crops.','having enough food for the nation.','selling food.'], correctAnswer: 2, topic: 'Economics', marks: 1 },
  { text: 'Who is the head of the Judiciary?', options: ['Chief Justice','Judge','Speaker','President'], correctAnswer: 0, topic: 'Governance', marks: 1 },
  { text: 'Money collected by the government in form of taxes is called ________.', options: ['cash','forex','profit','revenue'], correctAnswer: 3, topic: 'Economics', marks: 1 },
  { text: 'Which of the following is NOT a natural disaster?', options: ['Bomb explosion','Earthquake','Famine','Floods'], correctAnswer: 0, topic: 'Environment', marks: 1 },
  { text: 'The Lunda people of Mwansabombwe celebrate a traditional ceremony known as ________.', options: ["Nc'wala",'Umutomboko','Kalela','Kuomboka'], correctAnswer: 1, topic: 'Traditional Ceremonies', marks: 1 },
  { text: 'Nyasaland is the old name for which country?', options: ['Botswana','Malawi','Zambia','Zimbabwe'], correctAnswer: 1, topic: 'African History', marks: 1 },
  { text: 'Which of these lakes is man-made?', options: ['Kariba','Bangweulu','Tanganyika','Mweru'], correctAnswer: 0, topic: 'Geography of Zambia', marks: 1 },
  { text: 'If charcoal burning is not controlled, it will result in ________.', options: ['afforestation','deforestation','employment','profit'], correctAnswer: 1, topic: 'Environment', marks: 1 },
  { text: 'The Nakambala Sugar Estate draws its water from ________ river.', options: ['Zambezi','Kabompo','Kafue','Luangwa'], correctAnswer: 2, topic: 'Economic Activities', marks: 1 },
  { text: 'The Batoka gorge is found in ________ Province.', options: ['Central','Southern','Eastern','Western'], correctAnswer: 1, topic: 'Geography of Zambia', marks: 1 },
  { text: 'Latitude 23½°S is called ________.', options: ['Tropic of Capricorn','Tropic of Cancer','equator','Arctic Circle'], correctAnswer: 0, topic: 'World Geography', marks: 1 },
  { text: 'The Atlas Mountains are found in which continent?', options: ['Asia','Australia','Europe','Africa'], correctAnswer: 3, topic: 'World Geography', marks: 1 },
  { text: 'Which one is the quickest and most expensive means of transport?', options: ['Road transport','Water transport','Air transport','Railway transport'], correctAnswer: 2, topic: 'Transport', marks: 1 },
  { text: 'Christians believe in life after death because Jesus ________.', options: ['came to live on earth.','died for his wrong deeds.','rose from the dead.','went to heaven.'], correctAnswer: 2, topic: 'Religious Education', marks: 1 },
  { text: 'Who is the head of government business in the National Assembly?', options: ['Speaker','Clerk','Vice President','Members of Parliament'], correctAnswer: 2, topic: 'Governance', marks: 1 },
  { text: 'Name the highest waterfalls in Zambia.', options: ['Victoria Falls','Kalambo Falls','Ngonye Falls','Mambilima Falls'], correctAnswer: 1, topic: 'Geography of Zambia', marks: 1 },
  { text: '________ is the deepest lake in Zambia.', options: ['Kariba','Bangweulu','Tanganyika','Mweru'], correctAnswer: 2, topic: 'Geography of Zambia', marks: 1 },
  { text: 'The spread of HIV/AIDS can be prevented by ________.', options: ['going to the hospital.','sharing needles.','taking drugs.','using condoms and abstaining from sex.'], correctAnswer: 3, topic: 'Health Education', marks: 1 },
  { text: 'Cooking and gardening are examples of ________ roles.', options: ['gender','girls','house','sex'], correctAnswer: 0, topic: 'Gender Studies', marks: 1 },
  { text: 'Which of the following is an element of weather?', options: ['Altitude','Clouds','Land','Water'], correctAnswer: 1, topic: 'Weather and Climate', marks: 1 },
  { text: 'The provincial capital of Southern Province is ________.', options: ['Monze','Kalomo','Mazabuka','Choma'], correctAnswer: 3, topic: 'Geography of Zambia', marks: 1 },
  { text: 'According to the Bible, sex before marriage is a ________.', options: ['blessing','miracle','right','sin'], correctAnswer: 3, topic: 'Religious Education', marks: 1 },
  { text: 'When income is lower than expenditure, an entrepreneur makes ________.', options: ['loss','profit','capital','savings'], correctAnswer: 0, topic: 'Entrepreneurship', marks: 1 },
  { text: 'The hills where the Zambezi River has its source are called ________.', options: ['Kalene','Mafinga','Mbala','Mwinilunga'], correctAnswer: 0, topic: 'Geography of Zambia', marks: 1 },
  { text: 'The debates in the National Assembly are controlled by the ________.', options: ['Sergeant At Arms','Members of Parliament','Speaker','Vice President'], correctAnswer: 2, topic: 'Governance', marks: 1 },
  { text: "Zambia's only port is found on lake ________.", options: ['Bangweulu','Tanganyika','Kariba','Mweru'], correctAnswer: 1, topic: 'Transport', marks: 1 },
  { text: 'A long time ago people used to communicate using ________.', options: ['drums and smoke.','radio and phones.','faxes and cells.','letters and television.'], correctAnswer: 0, topic: 'Communication', marks: 1 },
  { text: 'The term used to describe goods sold to other countries is ________.', options: ['profit','exports','loss','imports'], correctAnswer: 1, topic: 'Economics', marks: 1 },
  { text: 'How many constituencies are there in Zambia?', options: ['156','150','158','166'], correctAnswer: 0, topic: 'Governance', marks: 1 },
  { text: 'Elections in Zambia are held every after ________ years.', options: ['2','4','5','3'], correctAnswer: 2, topic: 'Governance', marks: 1 },
  { text: 'Zambia Police falls under which ministry?', options: ['Ministry of Justice','Ministry of Education','Ministry of Home Affairs','Ministry of Defence'], correctAnswer: 2, topic: 'Governance', marks: 1 },
  { text: 'In a democratic country, people choose their leaders by ________.', options: ['appointing','voting','replacing','selecting'], correctAnswer: 1, topic: 'Governance', marks: 1 },
  { text: 'During industrial activities, a nearby river was contaminated with some chemicals. What type of pollution is this?', options: ['Air pollution','Land pollution','Noise pollution','Water pollution'], correctAnswer: 3, topic: 'Environment', marks: 1 },
  { text: 'Crop rotation is important because it ________.', options: ['improves soil fertility.','reduces soil fertility.','reduces soil structure.','strengthens crops.'], correctAnswer: 0, topic: 'Agriculture', marks: 1 },
  { text: 'Many people in Zambia move from rural areas to urban areas looking for ________.', options: ['land','food','jobs','clothes'], correctAnswer: 2, topic: 'Population and Migration', marks: 1 },
  { text: 'Food preservation is an important practice in a community because it improves ________.', options: ['food security.','production of food.','insecurity of food.','shortage of food.'], correctAnswer: 0, topic: 'Food Security', marks: 1 },
  { text: '________ is an example of basic human right.', options: ['Freedom of movement','Clean the community','Care for public property','Help the aged'], correctAnswer: 0, topic: 'Human Rights', marks: 1 },
  { text: 'When there is little or no rain in a region, we say the region has ________.', options: ['famine','drought','food','humidity'], correctAnswer: 1, topic: 'Weather and Climate', marks: 1 },
  { text: 'The specialised departments of the government are called ________.', options: ['companies','headquarters','towns','ministries'], correctAnswer: 3, topic: 'Governance', marks: 1 },
  { text: 'The rotation of the Earth causes ________.', options: ['seasons','day and night','years','months'], correctAnswer: 1, topic: 'Earth Science', marks: 1 },
  { text: 'There are few cattle in the Luangwa Valley. This is because of ________.', options: ['tsetse flies','floods','lions','mosquitoes'], correctAnswer: 0, topic: 'Agriculture', marks: 1 },
  { text: 'The supreme law of a country is referred to as the ________.', options: ['judiciary','constitution','parliament','Hansard'], correctAnswer: 1, topic: 'Governance', marks: 1 },
  { text: 'How many continents are there in the world?', options: ['7','9','10','6'], correctAnswer: 0, topic: 'World Geography', marks: 1 },
  { text: 'Which country below is ruled by a king?', options: ['Egypt','Malawi','Eswatini','Mozambique'], correctAnswer: 2, topic: 'African Politics', marks: 1 },
  { text: 'The man and woman on the Coat of Arms represent ________.', options: ['a country','freedom','family','gender'], correctAnswer: 2, topic: 'National Symbols', marks: 1 },
  { text: 'Study the map of Zambia. Name the river marked 1.', options: ['Kabompo','Zambezi','Kafue','Luangwa'], correctAnswer: 1, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. River labelled 1.]' },
  { text: 'Study the map of Zambia. What is the physical feature marked 4?', options: ['Zambezi River','Itezhi-tezhi Dam','Lake Kariba','Lake Mweru-wantipa'], correctAnswer: 2, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. Feature labelled 4.]' },
  { text: 'Study the map of Zambia. Name the lake marked 5.', options: ['Bangweulu','Tanganyika','Mweru','Kariba'], correctAnswer: 1, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. Lake labelled 5.]' },
  { text: 'Study the map of Zambia. What waterfall is marked 7?', options: ['Kalambo','Mambilima','Victoria','Chishimba'], correctAnswer: 2, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. Waterfall labelled 7.]' },
  { text: 'Study the map of Zambia. Which river is marked 9?', options: ['Kafue','Zambezi','Luangwa','Luapula'], correctAnswer: 2, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. River labelled 9.]' },
  { text: 'Study the map of Zambia. Name the escarpment marked 6.', options: ['Muchinga','Tonga','Maamba','Zambezi'], correctAnswer: 0, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. Escarpment labelled 6.]' },
  { text: 'Study the map of Zambia. Lukanga swamp is marked ________ on the map.', options: ['8','10','2','3'], correctAnswer: 0, topic: 'Map of Zambia', marks: 1, diagramText: '[Map of Zambia with numbered physical features to be inserted. Identify which number marks Lukanga swamp.]' },
]

const SEEDED_QUIZZES = [
  { id: 'grade5-mathematics-term1', meta: grade5Math, questions: grade5MathQs },
  { id: 'grade6-english-term1', meta: grade6English, questions: grade6EnglishQs },
  { id: 'grade6-english-grammar-practice', meta: grade6EnglishGrammar, questions: grade6EnglishGrammarQs },
  { id: 'grade6-english-2023-paper1', meta: grade6English2023, questions: grade6English2023Qs },
  { id: 'grade6-integrated-science-past-paper', meta: grade6Science, questions: grade6ScienceQs },
  { id: 'grade7-integrated-science-ecz-exam2', meta: grade7ScienceExam2, questions: grade7ScienceExam2Qs },
  { id: 'grade7-social-studies-prisca-mock-2023', meta: grade7SocialStudies2023, questions: grade7SocialStudies2023Qs },
]

function seedSignature(quiz = {}) {
  return [
    String(quiz.title ?? '').trim(),
    String(quiz.subject ?? '').trim(),
    String(quiz.grade ?? '').trim(),
    String(quiz.term ?? '').trim(),
    String(quiz.year ?? '').trim(),
    Number(quiz.totalMarks) || 0,
    Number(quiz.questionCount) || 0,
    String(quiz.type ?? '').trim(),
  ].join('||')
}

const SEEDED_SIGNATURES = new Set(SEEDED_QUIZZES.map(item => seedSignature(item.meta)))

function isSeededQuiz(data = {}) {
  if (data.seedBatch === SEED_BATCH_ID) return true
  return SEEDED_SIGNATURES.has(seedSignature(data))
}

export async function seedFirestore(db, uid) {
  for (const item of SEEDED_QUIZZES) {
    const quizRef = doc(collection(db, 'quizzes'))
    const questionChunks = item.questions.length > 40
      ? [item.questions.slice(0, 40), item.questions.slice(40)]
      : [item.questions]

    for (const [chunkIndex, questionChunk] of questionChunks.entries()) {
      const batch = writeBatch(db)

      if (chunkIndex === 0) {
        batch.set(quizRef, {
          ...item.meta,
          createdBy: uid,
          createdAt: serverTimestamp(),
          seedBatch: SEED_BATCH_ID,
          seedSampleId: item.id,
        })
      }

      questionChunk.forEach((question, offset) => {
        const questionRef = doc(collection(db, 'quizzes', quizRef.id, 'questions'))
        batch.set(questionRef, { ...question, order: chunkIndex * 40 + offset + 1 })
      })

      await batch.commit()
    }
  }
}

export async function clearSeedFirestore(db, uid) {
  const quizzesSnap = await getDocs(query(collection(db, 'quizzes'), where('createdBy', '==', uid)))
  const seededQuizzes = quizzesSnap.docs.filter(quizDoc => isSeededQuiz(quizDoc.data()))

  for (const quizDoc of seededQuizzes) {
    await deleteQuizWithQuestions(db, quizDoc.id)
  }

  return {
    quizzesDeleted: seededQuizzes.length,
  }
}
