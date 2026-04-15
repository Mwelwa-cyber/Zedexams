import { collection, doc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

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

export async function seedFirestore(db, uid) {
  // Quiz 1
  const q1Ref = doc(collection(db, 'quizzes'))
  const batch1 = writeBatch(db)
  batch1.set(q1Ref, { ...grade5Math, createdBy: uid, createdAt: serverTimestamp() })
  grade5MathQs.forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q1Ref.id, 'questions'))
    batch1.set(qRef, { ...q, order: i + 1 })
  })
  await batch1.commit()

  // Quiz 2
  const q2Ref = doc(collection(db, 'quizzes'))
  const batch2 = writeBatch(db)
  batch2.set(q2Ref, { ...grade6English, createdBy: uid, createdAt: serverTimestamp() })
  grade6EnglishQs.forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q2Ref.id, 'questions'))
    batch2.set(qRef, { ...q, order: i + 1 })
  })
  await batch2.commit()

  // Quiz 3 — Grade 6 English Grammar
  const q3Ref = doc(collection(db, 'quizzes'))
  const batch3 = writeBatch(db)
  batch3.set(q3Ref, { ...grade6EnglishGrammar, createdBy: uid, createdAt: serverTimestamp() })
  grade6EnglishGrammarQs.forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q3Ref.id, 'questions'))
    batch3.set(qRef, { ...q, order: i + 1 })
  })
  await batch3.commit()

  // Quiz 4 — Grade 6 English 2023 Paper 1 (60 questions, split across 2 batches)
  const q4Ref = doc(collection(db, 'quizzes'))
  const batch4a = writeBatch(db)
  batch4a.set(q4Ref, { ...grade6English2023, createdBy: uid, createdAt: serverTimestamp() })
  grade6English2023Qs.slice(0, 40).forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q4Ref.id, 'questions'))
    batch4a.set(qRef, { ...q, order: i + 1 })
  })
  await batch4a.commit()

  const batch4b = writeBatch(db)
  grade6English2023Qs.slice(40).forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q4Ref.id, 'questions'))
    batch4b.set(qRef, { ...q, order: i + 41 })
  })
  await batch4b.commit()

  // Quiz 5 — Grade 6 Integrated Science Past Paper (50 questions, split across 2 batches)
  const q5Ref = doc(collection(db, 'quizzes'))
  const batch5a = writeBatch(db)
  batch5a.set(q5Ref, { ...grade6Science, createdBy: uid, createdAt: serverTimestamp() })
  grade6ScienceQs.slice(0, 25).forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q5Ref.id, 'questions'))
    batch5a.set(qRef, { ...q, order: i + 1 })
  })
  await batch5a.commit()

  const batch5b = writeBatch(db)
  grade6ScienceQs.slice(25).forEach((q, i) => {
    const qRef = doc(collection(db, 'quizzes', q5Ref.id, 'questions'))
    batch5b.set(qRef, { ...q, order: i + 26 })
  })
  await batch5b.commit()
}
