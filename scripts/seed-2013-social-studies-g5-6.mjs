/**
 * Seed the 2013 (OBC) Social Studies syllabus Grades 5 & 6 into
 * curriculum-data-2013.json (both public/ and functions/ copies).
 *
 * Why: the Social Studies (Grades 1–7, 2013) data only had Grade 1 and Grade
 * 7 sheets, so SBA Social Studies at Grades 5 and 6 returned 0 topics. This
 * adds clean Grade 5 and Grade 6 sheets transcribed from the official syllabus
 * PDF (a scanned document — Grade 5 pp. 24–28, Grade 6 pp. 29–32). The granular
 * topic (the syllabus's SUB-TOPIC, e.g. "5.1.1 District") sits in the detected
 * topic column, with the parent area in TOPIC and content as KNOWLEDGE bullets.
 *
 * Idempotent. Run: node scripts/seed-2013-social-studies-g5-6.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const SUBJECT = 'Social Studies Syllabus (Grades 1-7, 2013)'
const FILES = [
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data-2013.json',
]

const DATA = {
  'Grade 5': [
    { topic: '5.1.1 District', area: '5.1 Living Together in the Community', outcomes: '5.1.1.1 Locate on the map of Zambia the position of the district. 5.1.1.2 Identify the main physical features on a map of the district. 5.1.1.3 Describe social, economic, cultural and political structures of the district in the past. 5.1.1.4 Mention the cultural composition of the people in the district. 5.1.1.5 Describe the economic activities in the district. 5.1.1.6 List names of historical and cultural sites in the district. 5.1.1.7 State the significance of each historical/cultural site.', knowledge: ['Location of the district', 'Physical features: hills/mountains, rivers, plains, valleys', 'Social, economic, cultural and political structures', 'Races, ethnic groups, chiefdoms', 'Economic activities: farming, construction, trading, manufacturing, mining', 'Historical and cultural sites; identity, tourist attraction'] },
    { topic: '5.2.1 Sex and Gender Roles', area: '5.2 Governance', outcomes: '5.2.1.1 Explain sex and gender roles. 5.2.1.2 Explain gender discrimination. 5.2.1.3 Discuss effects of gender discrimination. 5.2.1.4 Promote gender equality.', knowledge: ['Sex roles: women getting pregnant, breast-feeding', 'Gender roles: cooking, watering, teaching, washing, sweeping', 'Disadvantaging someone on the basis of sex', 'Conflict, gender based violence', 'Institutions that promote gender equality'] },
    { topic: '5.2.3 Threats to Human Rights', area: '5.2 Governance', outcomes: '5.2.3.1 State factors that hinder citizens from enjoying their rights. 5.2.3.2 Identify organisations that protect and promote human rights.', knowledge: ['Corruption, poverty, poor governance, conflicts, ignorance', 'Human rights violations such as child abuse', 'Police Service, Human Rights Commission and other organisations'] },
    { topic: '5.3.1 Discipline and Punishment', area: '5.3 Christian Living', outcomes: '5.3.1.1 Describe the importance of child discipline. 5.3.1.2 Identify ways of discipline. 5.3.1.3 Describe punishment. 5.3.1.4 Identify different types of punishment.', knowledge: ['Ways of discipline: counselling, confessing, scolding', 'Denying privileges', 'Types of punishment: physical, emotional, economic, social'] },
    { topic: '5.4.1 Rural-urban Migration', area: '5.4 Environment', outcomes: '5.4.1.1 Describe migration. 5.4.1.2 Explain rural-urban migration and its effects. 5.4.1.3 Suggest possible solutions to rural-urban migration.', knowledge: ['Movement from one place to another', 'Movement of people from rural to urban areas', 'Reasons: search for employment, social amenities, disputes', 'Effects on rural areas: depopulation, underdevelopment', 'Effects on urban areas: overpopulation, crime, prostitution, poor sanitation', 'Solutions: improving social and economic amenities in rural areas'] },
    { topic: '5.5.1 Personal financial goal setting', area: '5.5 Learning About Money', outcomes: '5.5.1.1 Describe basic personal financial goals. 5.5.1.2 Describe the links between earning, spending and saving. 5.5.1.3 Explain the importance of financial security.', knowledge: ['Goals people have: education, buying property, food', 'Links between earning, spending and saving', 'Financial security: employment, savings, income covering expenditure'] },
    { topic: '5.6.1 Wealth Generation', area: '5.6 Entrepreneurship', outcomes: '5.6.1.1 Explain entrepreneurship. 5.6.1.2 Explain how wealth can be generated.', knowledge: ['Small scale business ventures (legal), government ventures, national and multi-national corporations'] },
    { topic: '5.7.1 Transport and Communication in the District', area: '5.7 Transport and Communication', outcomes: '5.7.1.1 Describe the development of transport and communication services.', knowledge: ['Transport: from walking to scotch-carts to cycling to riding motor vehicles', 'Communication: from messenger to drum to letter to telex to land phone to cell-phone'] },
  ],
  'Grade 6': [
    { topic: '6.1.1 Province', area: '6.1 Living Together in the Community', outcomes: '6.1.1.1 Locate on the map of Zambia the position of the province. 6.1.1.2 Identify the main physical features on a map of the province. 6.1.1.3 Describe social, economic, cultural and political structures of the province in the past. 6.1.1.4 Mention the cultural composition of the people in the province. 6.1.1.5 Describe the economic activities in the province.', knowledge: ['Location of the province', 'Hills/mountains, rivers, plains, valleys', 'Social, economic, cultural and political structures', 'Races, ethnic groups, villages, chiefdoms', 'Farming, construction, trading, manufacturing, mining'] },
    { topic: '6.2.1 Leadership', area: '6.2 Governance', outcomes: '6.2.1.1 Identify leadership qualities that promote development.', knowledge: ['Leadership qualities: openness, integrity, honesty, accountability'] },
    { topic: '6.2.2 Local Government', area: '6.2 Governance', outcomes: '6.2.2.1 Describe the functions of local government.', knowledge: ['Functions: street lighting, water supply, waste management, housing, land administration'] },
    { topic: '6.3.1 Keeping money safe', area: '6.3 Learning About Money', outcomes: '6.3.1.1 Identify the different ways of saving. 6.3.1.2 Explain the benefits of keeping money safe. 6.3.1.3 Identify the main features of saving and borrowing. 6.3.1.4 Identify the relationship between risk and reward in different financial contexts.', knowledge: ['Different ways of saving: bank, cell phone (mobile money), community accounts', 'Features of saving and borrowing: interest rates, paying back what you borrow, terms and conditions', 'Risks and rewards in savings, borrowing and gambling/betting'] },
    { topic: '6.4.1 Religious Faith (Martyrdom)', area: '6.4 Religion', outcomes: '6.4.1.1 Identify Africans killed for their religious faith. 6.4.1.2 Describe the encounter between David and Goliath. 6.4.1.3 State the role of faith in helping people to be brave.', knowledge: ['Charles Lwanga and Kizito', '1 Samuel 17', 'Faith promotes courage to face situations'] },
    { topic: '6.5.1 Elements of Weather and Climate', area: '6.5 Weather and Climate', outcomes: '6.5.1.1 Outline elements of weather and climate.', knowledge: ['Elements: temperature, rainfall, pressure, sunshine, humidity'] },
    { topic: '6.6.1 Protection of the Environment', area: '6.6 Environment', outcomes: '6.6.1.1 Identify ways of disposing waste. 6.6.1.2 Identify communal places that need protection from waste. 6.6.1.3 Describe the role of the community in environmental protection and waste management.', knowledge: ['Ways of disposing waste: recycling, burying', 'Communal places: markets, schools, clinics, churches, bus stations, drainages', 'Community participation, sensitisation and advocacy'] },
    { topic: '6.7.1 Road Safety', area: '6.7 Transport and Communication', outcomes: '6.7.1.1 Explain factors that influence road safety.', knowledge: ['Factors: visibility of road signs, state of the road, availability of road signs, vandalism, corruption'] },
  ],
}

function buildSheet(gradeLabel, entries) {
  const topicCol = entries[0].topic
  return {
    title: gradeLabel.toUpperCase(),
    columns: [topicCol, 'TOPIC', 'SPECIFIC OUTCOMES', 'KNOWLEDGE', 'SKILLS', 'VALUES'],
    rows: entries.map((e) => ({
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
}

for (const file of FILES) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  if (!data[SUBJECT]) throw new Error(`Subject not found in ${file}: ${SUBJECT}`)
  for (const [gradeLabel, entries] of Object.entries(DATA)) {
    data[SUBJECT][gradeLabel] = buildSheet(gradeLabel, entries)
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`Updated ${file}: Social Studies ${Object.keys(DATA).join(', ')}`)
}
