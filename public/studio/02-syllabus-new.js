// 2023 ZECF / Zambian CBC New Syllabus data
// Powers autocomplete dropdowns only — AI generation uses the system prompt's CBC knowledge.

let syllabusVersion = 'new';

const gradeLevel = {
  'Grade 1': 'lp', 'Grade 2': 'lp', 'Grade 3': 'lp',
  'Grade 4': 'up', 'Grade 5': 'up', 'Grade 6': 'up',
  'Form 1': 'js', 'Form 2': 'js', 'Form 3': 'ss', 'Form 4': 'ss', 'Form 5': 'al'
};

const oldGradeLevel = {
  'Grade 5': 'oup', 'Grade 6': 'oup', 'Grade 7': 'oup',
  'Grade 8': 'oss', 'Grade 9': 'oss',
  'Grade 10': 'oss', 'Grade 11': 'oss', 'Grade 12': 'oss'
};

const newClassOptions = [
  'Grade 1','Grade 2','Grade 3',
  'Grade 4','Grade 5','Grade 6',
  'Form 1','Form 2','Form 3','Form 4','Form 5'
];

const oldClassOptions = [
  'Grade 5','Grade 6','Grade 7',
  'Grade 8','Grade 9',
  'Grade 10','Grade 11','Grade 12'
];

const subjectsByLevel = {
  lp: ['Mathematics','English Language','Zambian Languages','Environmental Science','Religious Education','Creative and Technology Studies','Social Studies','Physical Education and Sport'],
  up: ['Mathematics','English Language','Zambian Languages','Integrated Science','Religious Education','Creative and Technology Studies','Social Studies','Physical Education and Sport'],
  js: ['Mathematics','English Language','Zambian Languages','Integrated Science','Religious Education','Creative and Technology Studies','Social Studies','Physical Education and Sport','Civic Education','Computer Studies'],
  ss: ['Mathematics','English Language','Zambian Languages','Biology','Chemistry','Physics','Geography','History','Civic Education','Religious Education','Computer Studies','Design and Technology','Home Management','Food and Nutrition','Fashion and Fabrics','Agricultural Science','Art and Design','Music','Physical Education','Commerce','Principles of Accounts','Literature in English'],
  al: ['Advanced Mathematics','Further Mathematics','Biology','Chemistry','Physics','Geography','History','Literature in English','Economics','Computer Science']
};

// ============================================================
// SYLLABUS TOPICS & SUBTOPICS
// ============================================================
const syllabus = {

  // ---- LOWER PRIMARY (Grades 1-3) ----
  lp: {
    Mathematics: {
      G1: {
        'Numbers and Counting': ['Counting 1-10','Counting 1-20','Writing numbers 1-10','Ordinal numbers','Comparing sets'],
        'Addition and Subtraction': ['Adding numbers up to 10','Subtracting numbers up to 10','Number stories'],
        'Measurement': ['Long and short','Heavy and light','Full and empty'],
        'Shapes': ['Circles','Squares','Triangles','Rectangles'],
        'Time': ['Days of the week','Morning and afternoon']
      },
      G2: {
        'Numbers': ['Place value (tens and ones)','Counting to 100','Comparing numbers','Even and odd numbers'],
        'Addition and Subtraction': ['Adding two-digit numbers','Subtracting two-digit numbers','Number bonds'],
        'Multiplication': ['Repeated addition','Multiplication as groups','2 and 5 times tables'],
        'Division': ['Sharing equally','Grouping'],
        'Money': ['Zambian coins','Simple prices','Making change'],
        'Measurement': ['Using a ruler','Units of length (cm, m)'],
        'Time': ['Telling the time (hour, half hour)','Calendar (months)']
      },
      G3: {
        'Numbers': ['Place value to 1000','Counting in 10s and 100s','Rounding to nearest 10'],
        'Addition and Subtraction': ['Adding three-digit numbers','Subtracting three-digit numbers','Word problems'],
        'Multiplication and Division': ['3, 4, 6 times tables','Division as inverse of multiplication','Remainders'],
        'Fractions': ['Half, quarter, third','Equivalent fractions (simple)','Fractions of shapes'],
        'Money': ['Adding and subtracting amounts','Word problems with money'],
        'Measurement': ['Perimeter of simple shapes','Volume (litres, millilitres)','Mass (kg, g)'],
        'Data Handling': ['Pictographs','Tally charts']
      }
    },
    'English Language': {
      G1: {
        'Listening and Speaking': ['Greetings','Following simple instructions','Nursery rhymes and songs'],
        'Phonics': ['Letter sounds (a-z)','CVC words','Blending sounds'],
        'Reading': ['Letter recognition','Simple words','Reading aloud'],
        'Writing': ['Holding a pencil','Tracing letters','Copying words']
      },
      G2: {
        'Phonics': ['Vowel digraphs','Consonant blends','Word families'],
        'Vocabulary': ['High-frequency words','Word meanings in context'],
        'Reading': ['Simple sentences','Short stories','Comprehension questions'],
        'Grammar': ['Capital letters','Full stops','Simple sentences'],
        'Writing': ['Sentences','Simple stories','Descriptions']
      },
      G3: {
        'Reading': ['Simple paragraphs','Inferencing','Finding the main idea'],
        'Grammar': ['Nouns and verbs','Adjectives','Pronouns','Question marks and exclamation marks'],
        'Writing': ['Short compositions','Letter writing','Diary entries'],
        'Vocabulary': ['Synonyms and antonyms','Using a dictionary']
      }
    },
    'Zambian Languages': {
      G1: { 'Oral Work': ['Greetings','Songs','Short stories'], 'Literacy': ['Letter sounds','Simple words'] },
      G2: { 'Oral Work': ['Rhymes','Descriptions'], 'Reading': ['Simple sentences'], 'Writing': ['Words and sentences'] },
      G3: { 'Reading': ['Short passages'], 'Writing': ['Compositions'], 'Grammar': ['Nouns','Verbs'] }
    },
    'Environmental Science': {
      G1: {
        'Living Things': ['Plants around us','Animals around us','Differences between living and non-living'],
        'My Body': ['Body parts','Senses','Personal hygiene'],
        'Weather': ['Sunny, rainy, windy','Seasons']
      },
      G2: {
        'Plants': ['Parts of a plant','What plants need to grow','Uses of plants'],
        'Animals': ['Domestic and wild animals','Animal habitats','Animal products'],
        'Health': ['Balanced diet','Diseases and prevention','Safe water']
      },
      G3: {
        'Soil': ['Types of soil','Importance of soil','Erosion'],
        'Water': ['Sources of water','Water cycle','Importance of clean water'],
        'Simple Machines': ['Lever','Wheel and axle','Inclined plane'],
        'Energy': ['Sources of energy','Uses of energy']
      }
    },
    'Religious Education': {
      G1: { 'Family and Community': ['My family','Helping at home','Caring for others'] },
      G2: { 'Values': ['Honesty','Respect','Sharing'] },
      G3: { 'Religion in Zambia': ['Christianity','Islam','Traditional beliefs'] }
    },
    'Social Studies': {
      G1: { 'My School': ['School rules','School community'] },
      G2: { 'My Community': ['Helpers in the community','Rules and laws'] },
      G3: { 'Zambia': ['Map of Zambia','Provinces','Our national symbols'] }
    },
    'Creative and Technology Studies': {
      G1: { 'Art': ['Colouring','Drawing shapes'] },
      G2: { 'Craft': ['Weaving','Clay modelling'] },
      G3: { 'Technology': ['Simple tools','Making simple objects'] }
    },
    'Physical Education and Sport': {
      G1: { 'Movement': ['Running','Jumping','Throwing'] },
      G2: { 'Games': ['Simple ball games','Relay races'] },
      G3: { 'Athletics': ['Sprint','Long jump'], 'Team Games': ['Football basics','Netball basics'] }
    }
  },

  // ---- UPPER PRIMARY (Grades 4-6) ----
  up: {
    Mathematics: {
      G4: {
        'Numbers and Place Value': ['Place value to 10000','Rounding to nearest 100','Comparing large numbers'],
        'Addition and Subtraction': ['Adding and subtracting 4-digit numbers','Estimation','Word problems'],
        'Multiplication and Division': ['7, 8, 9 times tables','Long multiplication','Short division','Remainders'],
        'Fractions': ['Proper and improper fractions','Mixed numbers','Adding and subtracting like fractions','Equivalent fractions'],
        'Decimals': ['Tenths and hundredths','Adding and subtracting decimals','Rounding decimals'],
        'Money': ['Calculating with kwacha and ngwee','Shopping problems'],
        'Measurement': ['Area of rectangles','Perimeter','Volume of cuboids'],
        'Time': ['24-hour clock','Calculating time intervals'],
        'Data Handling': ['Bar graphs','Line graphs','Mean']
      },
      G5: {
        'Numbers': ['Place value to 100000','Prime and composite numbers','Factors and multiples','HCF and LCM'],
        'Fractions': ['Adding and subtracting unlike fractions','Multiplying fractions','Dividing fractions','Fraction word problems'],
        'Decimals': ['Multiplying decimals','Dividing decimals','Converting fractions to decimals'],
        'Percentages': ['Finding a percentage of a quantity','Expressing as a percentage','Percentage increase and decrease'],
        'Ratio and Proportion': ['Writing ratios','Simplifying ratios','Direct proportion'],
        'Algebra': ['Using letters for unknowns','Simple equations','Substitution'],
        'Geometry': ['Properties of triangles','Properties of quadrilaterals','Angles on a straight line','Angles in a triangle'],
        'Statistics': ['Median and mode','Pie charts','Probability basics']
      },
      G6: {
        'Numbers': ['Integers','Negative numbers','Powers and square roots'],
        'Fractions, Decimals, Percentages': ['Converting between FDP','Percentage problems (profit, loss, discount)','Reverse percentage'],
        'Algebra': ['Expanding brackets','Simplifying expressions','Solving linear equations','Inequalities'],
        'Geometry': ['Construction using compass','Symmetry','Transformation (reflection, rotation, translation)'],
        'Mensuration': ['Area of circles','Circumference','Surface area of cuboids','Volume of cylinders'],
        'Statistics': ['Frequency tables','Cumulative frequency','Interpreting graphs']
      }
    },
    'Integrated Science': {
      G4: {
        'Living Things': ['Classification of plants','Classification of animals','Food chains and food webs'],
        'Human Body': ['Digestive system','Respiratory system','Circulatory system'],
        'Materials': ['Properties of materials','Separating mixtures','States of matter']
      },
      G5: {
        'Ecology': ['Habitats','Adaptation','Pollution and conservation'],
        'Energy': ['Light energy','Sound energy','Heat energy','Electricity basics'],
        'Earth Science': ['Rocks and minerals','Weathering and erosion','Water cycle']
      },
      G6: {
        'Cell Biology': ['Plant and animal cells','Microscopy','Cell functions'],
        'Reproduction': ['Plant reproduction','Human reproduction (puberty)'],
        'Forces': ['Types of forces','Friction','Simple machines and mechanical advantage'],
        'Chemistry Basics': ['Acids and bases','Chemical and physical changes','Mixtures and compounds']
      }
    },
    'English Language': {
      G4: {
        'Reading': ['Comprehension passages','Identifying themes','Skimming and scanning'],
        'Grammar': ['Tenses (simple present, past, future)','Subject-verb agreement','Punctuation'],
        'Writing': ['Descriptive writing','Narrative writing','Letter writing'],
        'Vocabulary': ['Compound words','Prefixes and suffixes']
      },
      G5: {
        'Reading': ['Inference','Summary writing','Reading for detail'],
        'Grammar': ['Perfect tenses','Passive voice','Relative clauses','Direct and indirect speech'],
        'Writing': ['Argumentative essays','Report writing','Diary writing'],
        'Oral Skills': ['Debate','Oral presentation']
      },
      G6: {
        'Literature': ['Poetry','Short stories','Drama'],
        'Grammar': ['Conjunctions','Modal verbs','Complex sentences'],
        'Writing': ['Formal and informal letters','Expository writing','Creative writing']
      }
    },
    'Social Studies': {
      G4: { 'Zambian Geography': ['Provinces and districts','Major rivers','Natural resources'] },
      G5: { 'Zambian History': ['Pre-colonial period','Colonialism','Independence 1964'] },
      G6: { 'Governance': ['Government structure','Constitution','Rights and responsibilities'] }
    },
    'Religious Education': {
      G4: { 'Sacred Texts': ['Bible stories','Quranic stories','Traditional teachings'] },
      G5: { 'Religious Practices': ['Prayer and worship','Festivals','Places of worship'] },
      G6: { 'Ethics': ['Honesty','Justice','Forgiveness','Stewardship'] }
    },
    'Civic Education': {
      G4: { 'Citizenship': ['Being a good citizen','Community service'] },
      G5: { 'Democracy': ['Elections','Voting','Human rights'] },
      G6: { 'National Identity': ['National symbols','Patriotism','Unity in diversity'] }
    },
    'Computer Studies': {
      G4: { 'ICT Basics': ['Parts of a computer','Input and output devices','Switching on and off'] },
      G5: { 'Software': ['Word processing basics','Spreadsheet basics','Internet safety'] },
      G6: { 'Applications': ['Presentations','Databases','Email'] }
    },
    'Creative and Technology Studies': {
      G4: { 'Design': ['Design process','Sketching ideas'] },
      G5: { 'Technology': ['Simple electronics','Making prototypes'] },
      G6: { 'Art': ['Colour theory','Textile design'] }
    },
    'Physical Education and Sport': {
      G4: { 'Athletics': ['Sprint technique','Long jump technique'] },
      G5: { 'Team Sports': ['Football rules','Netball rules'] },
      G6: { 'Health Fitness': ['Warm-up and cool-down','Fitness components'] }
    }
  },

  // ---- JUNIOR SECONDARY (Forms 1-2) ----
  js: {
    Mathematics: {
      F1: {
        'Sets': ['Set notation','Types of sets','Union and intersection','Venn diagrams (two sets)'],
        'Integers': ['Directed numbers','Number line','Operations with integers','Order of operations (BODMAS)'],
        'Fractions, Decimals, Percentages': ['Operations on fractions','Converting FDP','Percentage calculations','Ratio and proportion'],
        'Indices': ['Laws of indices','Negative indices','Zero index','Standard form'],
        'Algebraic Expressions': ['Collecting like terms','Expanding brackets','Factorising (common factor)','Substitution'],
        'Linear Equations': ['Solving equations','Word problems','Formulae'],
        'Geometry': ['Types of angles','Parallel lines and transversals','Properties of triangles','Properties of quadrilaterals','Constructions'],
        'Mensuration': ['Perimeter of polygons','Area of triangles, parallelograms, trapeziums','Volume of prisms'],
        'Statistics': ['Frequency distribution tables','Bar charts','Pie charts','Mean, median, mode']
      },
      F2: {
        'Number Bases': ['Binary, octal, hexadecimal','Converting between bases','Operations in other bases'],
        'Surds': ['Simplifying surds','Rationalising denominators','Operations on surds'],
        'Estimation and Approximation': ['Significant figures','Decimal places','Rounding errors','Estimation techniques'],
        'Algebraic Fractions': ['Simplifying','Adding and subtracting','Solving equations with fractions'],
        'Linear Inequalities': ['Solving inequalities','Graphing on number line','Compound inequalities'],
        'Simultaneous Equations': ['Substitution method','Elimination method','Word problems'],
        'Graphs': ['Cartesian plane','Plotting linear graphs','Gradient and y-intercept','Interpreting graphs'],
        'Transformation': ['Reflection','Rotation','Translation','Enlargement'],
        'Probability': ['Sample space','Theoretical probability','Experimental probability','Simple event probability']
      }
    },
    'Integrated Science': {
      F1: {
        'Cells and Organisation': ['Cell structure','Specialised cells','Tissues, organs, systems'],
        'Classification of Living Things': ['Five kingdoms','Vertebrates and invertebrates','Dichotomous keys'],
        'Nutrition': ['Nutrients and their functions','Balanced diet','Digestive system'],
        'Respiration': ['Aerobic and anaerobic respiration','Gaseous exchange','Breathing mechanism'],
        'Atomic Structure': ['Protons, neutrons, electrons','Atomic number and mass number','Electronic configuration'],
        'Bonding': ['Ionic bonding','Covalent bonding','Properties of ionic and covalent compounds'],
        'Motion': ['Distance, speed, velocity','Acceleration','Distance-time graphs','Speed-time graphs'],
        'Forces': ['Newton\'s laws','Weight and mass','Friction']
      },
      F2: {
        'Genetics and Heredity': ['DNA and genes','Chromosomes','Dominant and recessive traits','Punnett squares'],
        'Ecology': ['Ecosystems','Food chains and webs','Energy flow','Nitrogen cycle','Carbon cycle'],
        'Chemical Reactions': ['Types of reactions','Exothermic and endothermic','Rates of reaction','Equations'],
        'Acids, Bases and Salts': ['pH scale','Properties of acids and bases','Neutralisation','Preparing salts'],
        'Electricity': ['Static electricity','Current, voltage, resistance','Ohm\'s law','Series and parallel circuits'],
        'Waves': ['Types of waves','Wave properties','Sound waves','Light and reflection']
      }
    },
    'English Language': {
      F1: {
        'Reading and Comprehension': ['Comprehension strategies','Literary texts','Non-fiction texts'],
        'Grammar': ['Parts of speech','Sentence structure','Tense review','Punctuation'],
        'Writing': ['Narrative essays','Descriptive essays','Formal letter writing'],
        'Oral Communication': ['Listening skills','Public speaking','Debate']
      },
      F2: {
        'Literature': ['Poetry analysis','Novel study','Play reading'],
        'Grammar': ['Complex and compound sentences','Reported speech','Conditional sentences'],
        'Writing': ['Argumentative essays','Report writing','Creative writing'],
        'Language Study': ['Idioms and proverbs','Register and tone']
      }
    },
    'Zambian Languages': {
      F1: { 'Reading': ['Comprehension','Literary analysis'], 'Writing': ['Compositions','Letters'] },
      F2: { 'Grammar': ['Parts of speech','Sentence structures'], 'Literature': ['Poetry','Prose'] }
    },
    'Social Studies': {
      F1: { 'Zambian Geography': ['Physical features','Climate','Natural resources'] },
      F2: { 'Zambian History': ['Pre-colonial','Colonial period','Post-independence'] }
    },
    'Civic Education': {
      F1: { 'Democracy': ['Constitution','Bill of Rights','Elections'] },
      F2: { 'Governance': ['Three arms of government','Local government','International organisations'] }
    },
    'Religious Education': {
      F1: { 'World Religions': ['Christianity','Islam','Hinduism','Buddhism'] },
      F2: { 'Ethics': ['Moral decision making','Conflict resolution','Gender equality'] }
    },
    'Computer Studies': {
      F1: { 'Hardware': ['CPU','Memory','Storage','Peripherals'], 'Software': ['OS','Applications','File management'] },
      F2: { 'Programming': ['Algorithms','Flowcharts','Basic Python/Scratch'], 'Networking': ['Internet','Email','Cloud computing'] }
    },
    'Creative and Technology Studies': {
      F1: { 'Design Technology': ['Design brief','Sketching and modelling'] },
      F2: { 'Technology': ['Electronics basics','Robotics introduction'] }
    },
    'Physical Education and Sport': {
      F1: { 'Athletics': ['Sprints','Throws','Jumps'] },
      F2: { 'Team Sports': ['Rules and tactics','Tournament play'] }
    }
  },

  // ---- SENIOR SECONDARY (Forms 3-4) ----
  ss: {
    Mathematics: {
      F3: {
        'Matrices': ['Order of a matrix','Matrix operations','Determinant of 2×2 matrix','Inverse of 2×2 matrix','Solving simultaneous equations using matrices'],
        'Functions': ['Domain and range','Types of functions','Composite functions','Inverse functions','Graphs of functions'],
        'Quadratic Equations': ['Solving by factorisation','Completing the square','Quadratic formula','Discriminant','Quadratic inequalities'],
        'Polynomials': ['Polynomial operations','Remainder theorem','Factor theorem','Roots of polynomials'],
        'Vectors': ['Vector notation','Magnitude','Addition and subtraction','Scalar multiplication','Dot product'],
        'Trigonometry': ['Trigonometric ratios','SOHCAHTOA','Angles of elevation and depression','Sine and cosine rules','Bearings'],
        'Statistics': ['Cumulative frequency curves','Box-and-whisker plots','Standard deviation','Variance'],
        'Probability': ['Combined events','Mutually exclusive events','Independent events','Tree diagrams','Conditional probability']
      },
      F4: {
        'Calculus — Differentiation': ['First principles','Rules of differentiation','Chain rule','Product and quotient rules','Applications (gradient, turning points, rates of change)'],
        'Calculus — Integration': ['Indefinite integration','Definite integration','Area under a curve','Trapezoidal rule'],
        'Sequences and Series': ['Arithmetic progressions','Geometric progressions','Sum to infinity','Binomial expansion'],
        'Logarithms': ['Laws of logarithms','Natural logarithm','Exponential equations','Logarithmic equations'],
        'Coordinate Geometry': ['Mid-point','Distance formula','Gradient','Equation of a straight line','Circle equations'],
        'Complex Numbers': ['Definition','Argand diagram','Operations on complex numbers','Modulus and argument'],
        'Linear Programming': ['Forming constraints','Feasible region','Objective function','Optimal solution']
      }
    },
    Biology: {
      F3: {
        'Genetics': ['Mendel\'s laws','Monohybrid and dihybrid crosses','Co-dominance','Sex linkage','Mutations'],
        'Evolution': ['Theory of natural selection','Evidence for evolution','Speciation','Hardy-Weinberg principle'],
        'Ecology': ['Ecosystem structure','Nutrient cycles','Ecological succession','Biodiversity and conservation'],
        'Coordination': ['Nervous system','Reflex arc','Brain structure','Hormonal system (endocrine glands)'],
        'Reproduction': ['Sexual and asexual reproduction','Fertilisation','Embryonic development','Growth']
      },
      F4: {
        'Cell Biology (Advanced)': ['Cell division (mitosis, meiosis)','DNA replication','Protein synthesis (transcription, translation)'],
        'Photosynthesis': ['Light-dependent reactions','Calvin cycle','Limiting factors','Chloroplast structure'],
        'Respiration': ['Glycolysis','Krebs cycle','Electron transport chain','ATP synthesis'],
        'Transport in Plants': ['Osmosis and diffusion','Xylem and phloem','Transpiration and translocation'],
        'Transport in Animals': ['Blood composition','Heart structure and cardiac cycle','Blood vessels','Lymphatic system'],
        'Homeostasis': ['Osmoregulation','Thermoregulation','Blood glucose regulation']
      }
    },
    Chemistry: {
      F3: {
        'Chemical Equilibrium': ['Dynamic equilibrium','Le Chatelier\'s principle','Equilibrium constant (Kc)','Haber process','Contact process'],
        'Electrochemistry': ['Electrolysis','Faraday\'s laws','Electrode reactions','Electrolytic cells vs. galvanic cells'],
        'Organic Chemistry I': ['Alkanes and alkenes','Reactions of alkenes','Alcohols','Carboxylic acids','Esters'],
        'Periodicity': ['Trends across period 3','Group properties (alkali metals, halogens, noble gases)','Transition metals'],
        'Energetics': ['Enthalpy changes','Hess\'s law','Bond energies','Activation energy']
      },
      F4: {
        'Organic Chemistry II': ['Amines','Amides','Halogenoalkanes','Polymers','Benzene and aromatic compounds'],
        'Reaction Mechanisms': ['Free radical substitution','Electrophilic addition','Nucleophilic substitution','Elimination'],
        'Analytical Chemistry': ['Qualitative analysis (cations and anions)','Chromatography','Spectroscopy basics'],
        'Industrial Chemistry': ['Sulfuric acid manufacture','Fertiliser production','Petroleum refining'],
        'Nuclear Chemistry': ['Radioactive decay','Half-life','Nuclear equations','Applications of radioactivity']
      }
    },
    Physics: {
      F3: {
        'Mechanics': ['Newton\'s laws (advanced)','Momentum and impulse','Conservation of momentum','Work, energy, power','Conservation of energy'],
        'Circular Motion': ['Angular velocity','Centripetal force','Applications (satellites, centrifuges)'],
        'Gravitational Fields': ['Newton\'s law of gravitation','Gravitational field strength','Satellites and orbital motion'],
        'Thermal Physics': ['Kinetic theory of gases','Gas laws (Boyle\'s, Charles\'s, Pressure law)','Internal energy','Specific heat capacity'],
        'Waves': ['Wave equation','Superposition and interference','Diffraction','Polarisation','Electromagnetic spectrum']
      },
      F4: {
        'Electricity (Advanced)': ['Capacitors and capacitance','RC circuits','Magnetic force on current-carrying conductors','Electromagnetic induction','Faraday\'s and Lenz\'s laws','Transformers and alternating current'],
        'Atomic and Nuclear Physics': ['Photoelectric effect','Wave-particle duality','Atomic spectra','Nuclear structure','Radioactive decay','Fission and fusion'],
        'Electronics': ['Semiconductor diodes','Transistors','Logic gates','Operational amplifiers','Digital electronics'],
        'Astrophysics': ['Stars and stellar evolution','Hubble\'s law','Big bang theory','Cosmology basics']
      }
    },
    Geography: {
      F3: {
        'Geographical Skills': ['Topographic maps','Map reading and interpretation','Grid references and bearings','Cross-sections and profiles','Aerial photographs'],
        'Weathering and Mass Movement': ['Types of weathering','Factors affecting weathering','Mass movement types','Landslides and management'],
        'Rivers': ['River processes (erosion, transportation, deposition)','River landforms (V-valleys, meanders, oxbow lakes, deltas)','Flooding and flood management'],
        'Coasts': ['Coastal processes','Coastal landforms (cliffs, stacks, spits, beaches)','Coastal management']
      },
      F4: {
        'Plate Tectonics': ['Structure of the Earth','Plate boundaries','Earthquakes and volcanoes','Tsunamis and management'],
        'Climate': ['World climate zones','Factors affecting climate','Climate change — causes and effects','Global warming'],
        'Soils': ['Soil formation','Soil profiles and horizons','Soil types in Zambia','Soil degradation and conservation'],
        'Agriculture': ['Types of farming in Zambia','Green Revolution','Irrigation','Food security'],
        'Population': ['Population growth','Population distribution in Zambia','Migration','Urbanisation']
      }
    },
    History: {
      F3: {
        'Pre-Colonial Zambia': ['Iron Age societies','Luba-Lunda states','Maravi kingdom','Bemba kingdom','Lozi kingdom'],
        'The Slave Trade': ['Trans-Atlantic slave trade','East African slave trade','Effects on Zambia'],
        'European Exploration and Colonisation': ['Missionaries (Livingstone)','BSAC and Cecil Rhodes','Establishment of Northern Rhodesia']
      },
      F4: {
        'Colonial Rule': ['Indirect rule','Land alienation','Labour migration','The Copperbelt'],
        'African Nationalism': ['Rise of nationalism','African National Congress (ANC — Zambia)','UNIP and Kenneth Kaunda'],
        'Independence': ['Lancaster House Conference','Independence 1964','First Republic'],
        'Post-Independence History': ['Economic policies (humanisation)','Second Republic','Third Republic and multi-party democracy']
      }
    },
    'Civic Education': {
      F3: { 'Human Rights': ['Bill of Rights','Human rights instruments','Gender equality'] },
      F4: { 'Governance': ['Constitution of Zambia','Electoral system','Anti-corruption'] }
    },
    'Religious Education': {
      F3: { 'World Religions (Advanced)': ['Comparative religion','Religion and ethics','Religion and politics'] },
      F4: { 'Applied Ethics': ['Bioethics','Environmental ethics','Social justice'] }
    },
    'Computer Studies': {
      F3: { 'Programming': ['Python fundamentals','Data structures','Algorithms and problem-solving'] },
      F4: { 'Advanced Computing': ['Database design (SQL)','Networking protocols','Cybersecurity','Artificial intelligence basics'] }
    },
    'Design and Technology': {
      F3: { 'Design Process': ['Research and analysis','Concept development','Prototype building'] },
      F4: { 'Production': ['Computer-aided design','Manufacturing processes','Product evaluation'] }
    },
    'Home Management': {
      F3: { 'Home Skills': ['Household budgeting','Home maintenance','Consumer skills'] },
      F4: { 'Family Life': ['Child development','Family relationships','Elderly care'] }
    },
    'Food and Nutrition': {
      F3: { 'Nutrition Science': ['Macronutrients','Micronutrients','Nutritional disorders'] },
      F4: { 'Food Science': ['Food preservation','Food microbiology','Menu planning for special needs'] }
    },
    'Fashion and Fabrics': {
      F3: { 'Textiles': ['Fabric types and properties','Dyeing and printing','Pattern making'] },
      F4: { 'Garment Construction': ['Tailoring techniques','Clothing alterations','Fashion design'] }
    },
    'Agricultural Science': {
      F3: {
        'Crop Production': ['Soil preparation and tillage','Seed selection','Crop husbandry','Pest and disease management','Harvesting and storage'],
        'Animal Husbandry': ['Livestock breeds in Zambia','Nutrition of farm animals','Animal health and diseases','Reproduction in livestock']
      },
      F4: {
        'Farm Management': ['Farm planning','Agricultural inputs','Marketing of farm produce','Farm records'],
        'Agro-forestry': ['Principles of agro-forestry','Soil conservation','Watershed management']
      }
    },
    'Art and Design': {
      F3: { 'Drawing and Painting': ['Perspective drawing','Watercolour technique','Composition'], 'Printmaking': ['Relief printing','Screen printing'] },
      F4: { 'Design': ['Graphic design','Product design','Portfolio development'] }
    },
    Music: {
      F3: { 'Music Theory': ['Notation','Scales and chords','Rhythm and time signatures'] },
      F4: { 'Performance': ['Vocal performance','Instrumental performance','Music composition'] }
    },
    'Physical Education': {
      F3: { 'Athletics': ['Advanced sprinting','Middle distance','Field events technique'] },
      F4: { 'Sports Science': ['Exercise physiology','Nutrition for sport','Injury prevention'] }
    },
    Commerce: {
      F3: { 'Trade': ['Types of trade','Channels of distribution','Documents in trade'] },
      F4: { 'Finance': ['Banking','Insurance','International trade'] }
    },
    'Principles of Accounts': {
      F3: { 'Bookkeeping': ['Double entry','Trial balance','Financial statements'] },
      F4: { 'Accounting': ['Company accounts','Ratio analysis','Cash flow statements'] }
    },
    'Literature in English': {
      F3: { 'Poetry': ['Poetic devices','Analysing poems','Zambian poetry'], 'Prose': ['Novel analysis','Short stories'] },
      F4: { 'Drama': ['Play analysis','Themes and characters','Staging'], 'Comparative Study': ['Comparing texts across genres'] }
    }
  },

  // ---- ADVANCED LEVEL (Form 5) ----
  al: {
    'Advanced Mathematics': {
      F5: {
        'Pure Mathematics': ['Proof by induction','Further calculus (integration techniques)','Differential equations','Complex numbers (polar form, De Moivre\'s)','Vectors in 3D','Further sequences and series'],
        'Mechanics': ['Projectile motion','Circular motion (advanced)','Simple harmonic motion','Moments and couples'],
        'Statistics': ['Probability distributions (binomial, Poisson, normal)','Hypothesis testing','Regression and correlation','Chi-squared test']
      }
    },
    'Further Mathematics': {
      F5: {
        'Algebra': ['Matrices and linear transformations','Groups and group theory','Further polynomial equations'],
        'Analysis': ['Real analysis basics','Continuity and differentiability','Series convergence tests'],
        'Numerical Methods': ['Newton-Raphson method','Simpson\'s rule','Fixed-point iteration']
      }
    },
    Biology: {
      F5: {
        'Molecular Biology': ['Gene expression regulation','Recombinant DNA technology','PCR and gel electrophoresis','Genetic engineering applications'],
        'Immunology': ['Innate and adaptive immunity','Antibodies and antigens','Vaccines','Autoimmune diseases'],
        'Ecology (Advanced)': ['Population dynamics models','Interspecific interactions','Conservation biology'],
        'Plant Physiology': ['Photosynthesis (detailed)','Mineral nutrition','Plant hormones and responses']
      }
    },
    Chemistry: {
      F5: {
        'Advanced Organic Chemistry': ['Stereochemistry (enantiomers, diastereomers)','Carbonyl chemistry','Multi-step synthesis','Spectroscopy (IR, MS, NMR)'],
        'Advanced Physical Chemistry': ['Thermodynamics (entropy, Gibbs free energy)','Electrochemical cells (Nernst equation)','Chemical kinetics (rate laws, mechanisms)'],
        'Advanced Inorganic Chemistry': ['Coordination chemistry','Crystal field theory','Transition metal complexes','Industrial processes']
      }
    },
    Physics: {
      F5: {
        'Quantum Physics': ['Photoelectric effect (advanced)','de Broglie wavelength','Heisenberg uncertainty principle','Quantum tunnelling','Atomic models'],
        'Particle Physics': ['Standard model','Fundamental forces','Quarks and leptons','Particle accelerators','Antimatter'],
        'Relativity': ['Special relativity (time dilation, length contraction, mass-energy equivalence)'],
        'Medical Physics': ['X-rays','Ultrasound','MRI','Radiation therapy']
      }
    },
    Geography: {
      F5: {
        'Advanced Geographical Concepts': ['Systems thinking in geography','Spatial analysis','GIS basics'],
        'Global Issues': ['Globalisation','Development and underdevelopment','Climate change (advanced)','Sustainable development goals'],
        'Zambia in Context': ['Zambia\'s development challenges','SADC and regional integration','Urbanisation and migration (advanced)']
      }
    },
    History: {
      F5: {
        'Modern African History': ['Decolonisation across Africa','Cold War in Africa','Post-independence challenges'],
        'Zambian History (Advanced)': ['MMD government and privatisation','Constitutional reforms','Contemporary political developments'],
        'Historical Methods': ['Primary and secondary sources','Historiography','Historical debate and interpretation']
      }
    },
    'Literature in English': {
      F5: {
        'Advanced Literary Analysis': ['Critical theory (feminist, post-colonial, Marxist)','Extended essay','Unseen texts'],
        'African Literature': ['Major African writers','Post-colonial themes','Oral literature traditions'],
        'World Literature': ['Comparative texts','Translation and cultural context']
      }
    },
    Economics: {
      F5: {
        'Microeconomics': ['Demand and supply (advanced)','Elasticity','Market structures','Market failure and government intervention'],
        'Macroeconomics': ['GDP and national income','Inflation and unemployment','Fiscal and monetary policy','Balance of payments','Economic growth and development'],
        'Development Economics': ['Zambia\'s economy','Agricultural economics','Foreign aid and investment']
      }
    },
    'Computer Science': {
      F5: {
        'Advanced Programming': ['Object-oriented programming','Data structures (trees, graphs, heaps)','Algorithm complexity (Big-O)','Sorting and searching algorithms'],
        'Systems Software': ['Operating systems design','Compiler design','Memory management'],
        'Artificial Intelligence': ['Machine learning concepts','Neural networks','Natural language processing','AI ethics']
      }
    }
  }
};
