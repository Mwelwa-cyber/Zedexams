/**
 * Seed the 2013 (OBC) Integrated Science syllabus Grade 5 sheet into
 * curriculum-data-2013.json (both public/ and functions/ copies).
 *
 * Why: the Integrated Science (Grades 1–7, 2013) data had no Grade 5 sheet
 * (only G1, G2, G4, G6, G7), so SBA Integrated Science at Grade 5 returned 0
 * topics. This adds a clean Grade 5 sheet transcribed from the official
 * syllabus PDF (pp. 44–53). The granular topic (the syllabus's SUB-TOPIC, e.g.
 * "5.1.1 The Heart") sits in the topic column the 2013 parser detects, with
 * the parent area kept in TOPIC and the content as KNOWLEDGE bullets.
 *
 * Idempotent. Run: node scripts/seed-2013-science-g5.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const SUBJECT = 'Integrated Science Syllabus (Grades 1-7, 2013)'
const GRADE = 'Grade 5'
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

// Transcribed from the syllabus PDF (Grade 5, pp. 44–53). `topic` is the
// granular sub-topic; `area` is the parent topic area.
const ENTRIES = [
  { topic: '5.1.1 The Heart', area: '5.1.0 The human body', outcomes: '5.1.1.1 State the function of the heart. 5.1.1.2 Describe the structure of the heart. 5.1.1.3 Demonstrate how to take the pulse.', knowledge: ['Function of the heart: pumping blood', 'Structure of the heart', 'How to take the pulse'] },
  { topic: '5.1.2 Puberty', area: '5.1.0 The human body', outcomes: '5.1.2.1 Identify male and female parts of the body. 5.1.2.2 Describe changes that occur at puberty in human beings.', knowledge: ['Male and female parts of the body (private and non-private parts)', 'Changes at puberty — Physical: pubic hair, beards, breaking of voice, pimples, pelvic girdle, enlargement of breasts', 'Emotional: moods, sexual feelings'] },
  { topic: '5.2.1 Fresh Air', area: '5.2.0 Health', outcomes: '5.2.1.1 Explain the importance of good ventilation. 5.2.1.2 Explain ways of providing good ventilation in buildings. 5.2.1.3 Demonstrate ways of treating a suffocated person.', knowledge: ['Ventilation is good for health', 'Ways of providing good ventilation: air conditioners, air vents, windows, fans', 'Treating a suffocated person: removing the source of suffocation, artificial breathing, First Aid'] },
  { topic: '5.2.2 Air and water borne diseases', area: '5.2.0 Health', outcomes: '5.2.2.1 Name common airborne and water borne diseases in Zambia. 5.2.2.2 Describe symptoms of common airborne and water borne diseases. 5.2.2.3 Describe how to prevent air and water borne diseases.', knowledge: ['Common airborne and waterborne diseases: Tuberculosis, pneumonia, cholera, typhoid, dysentery, measles, bilharzia', 'Symptoms (TB: prolonged cough, sweating at night, fever, loss of weight and appetite; Dysentery: bloody stool)', 'Ways of preventing airborne and waterborne diseases'] },
  { topic: '5.2.3 Malaria', area: '5.2.0 Health', outcomes: '5.2.3.1 Identify causes of malaria. 5.2.3.2 State the symptoms of malaria. 5.2.3.3 Describe ways of preventing and treating malaria.', knowledge: ['Causes of malaria: Anopheles mosquito bite (plasmodium)', 'Symptoms: fever, vomiting, headache, body pains, loss of appetite', 'Ways of preventing malaria: sleeping under Insecticide Treated Nets, spraying and clearing mosquito breeding places'] },
  { topic: '5.2.6 HIV and AIDS and STIs', area: '5.2.0 Health', outcomes: '5.2.6.1 Describe ways in which STIs and HIV are transmitted. 5.2.6.2 Identify ways of preventing the spread of HIV and STIs. 5.2.6.3 Describe the care and treatment for AIDS patients.', knowledge: ['Ways of STIs and HIV transmission: unprotected sexual activities, contaminated blood, breast milk, sharp instruments', 'Ways of prevention: abstinence, use of condoms', 'Care and treatment of AIDS patients: good nutrition, good hygiene, love and support, ART'] },
  { topic: '5.2.7 Harmful Substances', area: '5.2.0 Health', outcomes: '5.2.7.1 Mention the substances which are harmful to the human body. 5.2.7.2 State the harmful effects of substance abuse on the body. 5.2.7.3 Explain the effects of drinking alcohol.', knowledge: ['Harmful substances: cocaine, mandrax, heroin, petrol, alcohol, dagga', 'Harmful effects: aggressiveness, brain damage, unconsciousness, restlessness, nausea, addiction', 'Effects of alcohol: poor health, violence, accidents'] },
  { topic: '5.3.1 Soil', area: '5.3.0 The Environment', outcomes: '5.3.1.1 Explain the importance of water in the soil. 5.3.1.2 Mention ways in which water can be retained in the soil. 5.3.1.3 Demonstrate the drainage rates of soils.', knowledge: ['Importance of water: seed germination and photosynthesis', 'Retention of water in soil: mulching, shading, terracing, weeding and intercropping', 'Drainage rates of clay, loamy and sandy soils'] },
  { topic: '5.3.2 Fertilizers', area: '5.3.0 The Environment', outcomes: '5.3.2.1 Explain what organic and inorganic fertilizers are. 5.3.2.2 Demonstrate how to prepare compost manure. 5.3.2.3 Explain the importance of maintaining a supply of compost materials. 5.3.2.4 Explain the advantages and disadvantages of chemical fertilizers in agriculture.', knowledge: ['Organic (natural) and inorganic (man-made) fertilizers', 'Preparing compost manure: layers under the shade', 'Advantages: required plant nutrients, quick absorption', 'Disadvantages: spoil soil, leaching, cost'] },
  { topic: '5.4.1 Non Flowering Plants', area: '5.4.0 Plants and Animals', outcomes: '5.4.1.1 Identify different types of non-flowering plants. 5.4.1.2 Identify the use of ferns and fungi.', knowledge: ['Types of non-flowering plants: algae, ferns, moss, fungi (e.g. mushroom)', 'Uses of fungi: baking, beer brewing, food, medicine (e.g. penicillin)'] },
  { topic: '5.4.2 Invertebrate Animals', area: '5.4.0 Plants and Animals', outcomes: '5.4.2.1 Identify the different types of invertebrate animals. 5.4.2.2 Investigate the basic structure of insects. 5.4.2.3 Explain the difference between insects and spiders. 5.4.2.4 State ways in which insects are useful.', knowledge: ['Invertebrate animals: insects (bees, ants, grasshoppers, beetles, butterflies), worms, spiders, crabs, lobsters, snails', 'Basic structure of insects: head, thorax, abdomen, antennae, six legs, wings; spider: eight legs, two body sections', 'Usefulness of insects: source of food, assist in pollination'] },
  { topic: '5.4.3 Pest and Parasites', area: '5.4.0 Plants and Animals', outcomes: '5.4.3.1 Identify common pests and parasites in the local environment. 5.4.3.2 Describe the harm caused by pests and parasites on plants and animals. 5.4.3.3 Explain how pests and parasites can be controlled using local plant materials and commercial chemicals. 5.4.3.4 Explain how chemical pesticides can cause harm to the environment.', knowledge: ['Common pests and parasites: aphids, locusts, caterpillars, ticks, beetles, worms, weevils, termites, tsetse fly, lice', 'Harm caused: suck nutrients, cause diseases, affect growth of the host', 'Control: local (garlic, red pepper, ash); commercial (Doom, Boom, Rogor)', 'Harm to the environment from chemical pesticides: contamination, killing beneficial living things'] },
  { topic: '5.5.1 Electricity', area: '5.5.0 Materials and energy', outcomes: '5.5.1.1 State what electricity can do. 5.5.1.2 Identify sources of electricity. 5.5.1.3 Identify electrical appliances used at home, school and in the community. 5.5.1.4 Identify good and bad conductors of electricity. 5.5.1.5 Describe the uses of good and bad conductors. 5.5.1.6 Explain methods of conserving electricity in homes and schools.', knowledge: ['What electricity does: powers up appliances and lights', 'Sources of electricity: battery, hydroelectric and thermal power stations, generator, solar cells', 'Electrical appliances: heater, stove, iron, fridge, fan', 'Good conductors: copper wire, iron sheets, carbon; Bad conductors: wood, plastic, rubber', 'Conserving electricity: energy saver bulbs, switch off and save, alternative sources of energy'] },
  { topic: '5.5.2 Heat Conductors', area: '5.5.0 Materials and energy', outcomes: '5.5.2.1 Describe what heat is. 5.5.2.2 Determine the temperature of the human body, boiling water and air inside and outside the classroom. 5.5.2.3 Distinguish good and bad conductors of heat. 5.5.2.4 Identify materials which are good insulators.', knowledge: ['Heat: the flow of thermal energy from warm to cooler objects', 'Temperature measurement of human body, boiling water and air', 'Good conductors: metals; Bad conductors / insulators: wood, rubber, wool, plastic', 'Uses: good conductors for cooking utensils; bad conductors for handles'] },
  { topic: '5.5.3 Measuring Matter', area: '5.5.0 Materials and energy', outcomes: '5.5.3.1 Identify instruments used to compare how heavy objects are. 5.5.3.2 Demonstrate the effect of gravity on objects. 5.5.3.3 Distinguish between mass and weight.', knowledge: ['Measuring mass and weight: beam balance, spring balance', 'Effect of gravity: pulling objects towards the centre of the earth', 'Difference between mass (amount of matter) and weight (pull of gravity, measured in newtons)'] },
  { topic: '5.5.4 Volume', area: '5.5.0 Materials and energy', outcomes: '5.5.4.1 Identify various instruments and apparatus used to measure volume. 5.5.4.2 Measure the volume of liquids. 5.5.4.3 Measure the volume of various regular and irregular solid objects.', knowledge: ['Instruments for measuring volume: beaker, measuring cylinder', 'Measuring volume of given liquids', 'Measuring volume of regular (l × b × h) and irregular (displacement method) solid objects'] },
  { topic: '5.5.5 Simple Machines', area: '5.5.0 Materials and energy', outcomes: '5.5.5.1 Explain what a simple machine is. 5.5.5.2 Identify six kinds of simple machines used in the home and school. 5.5.5.3 Demonstrate the use of simple machines in doing work.', knowledge: ['A simple machine makes work easier by allowing us to push or pull over increased distances', 'Six kinds of simple machines: Lever, Wheel and Axle, Inclined Plane, Wedge, Screw', 'Application: pulling, cutting, transportation, watering, digging'] },
]

const topicCol = ENTRIES[0].topic
const sheet = {
  title: GRADE.toUpperCase(),
  columns: [topicCol, 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'],
  rows: ENTRIES.map((e) => ({
    type: 'data',
    cells: {
      [topicCol]: e.topic,
      'TOPIC': e.area,
      'SPECIFIC OUTCOMES': e.outcomes,
      'KNOWLEDGE': e.knowledge.map((k) => `• ${k}`).join(' '),
      'SKILLS': 'Application of knowledge',
      'VALUES': 'Awareness and appreciation',
    },
  })),
}

for (const file of FILES) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data[SUBJECT]) throw new Error(`Subject not found in ${file}: ${SUBJECT}`)
  data[SUBJECT][GRADE] = sheet
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`Updated ${file}: Integrated Science ${GRADE} (${ENTRIES.length} topics)`)
}
