// =========== OLD SYLLABUS DATA (2013 CDC) ===========
const oldSubjectsByLevel = {
  // Upper Primary G5-7 — exactly the 7 subjects in the CDC 2013 archive (CTS is G1-4 only per its cover page)
  'oup': ['English Language','Zambian Languages','Mathematics','Integrated Science','Social Studies','Home Economics','Technology Studies'],
  // Senior Secondary G10-12 — exactly the 14 subjects in the CDC 2013 archive
  'oss': ['Mathematics','Additional Mathematics','Biology','Chemistry','Physics','Science 5124','Geography','History','Literature in English','Home Management','Food and Nutrition','Fashion and Fabrics','Design and Technology','Agricultural Science']
};

// Old syllabus topics — based on official 2013 CDC syllabus PDFs (extracted from uploaded archive)
const oldSyllabus = {
  'oup': {
    // === Upper Primary G5-7 (extracted from official 2013 syllabi PDFs) ===
    'English Language': {
      'G5': { 'Listening and Speaking': ['Active listening','Discussions','Reciting poems'], 'Reading': ['Reading aloud','Silent reading','Comprehension'], 'Writing': ['Compositions','Personal letters','Reports'], 'Grammar': ['Tenses','Punctuation','Subject-verb agreement'], 'Vocabulary': ['Synonyms','Antonyms','Spelling'] },
      'G6': { 'Listening and Speaking': ['Debates','Presentations','Interviews'], 'Reading': ['Skimming and scanning','Inference','Vocabulary in context'], 'Writing': ['Narrative essays','Descriptive essays','Formal letters'], 'Grammar': ['Active and passive voice','Direct and indirect speech','Phrases'], 'Literature': ['Short stories','Poems','Folktales'] },
      'G7': { 'Listening and Speaking': ['Public speaking','Critical listening'], 'Reading': ['Comprehension passages','Summary writing'], 'Writing': ['Argumentative essays','Reports','Notices'], 'Grammar': ['Complex sentences','All tenses','Idioms'], 'Literature': ['Drama excerpts','Poetry analysis'] }
    },
    'Mathematics': {
      // Direct from 2013 Old Mathematics Syllabus (extracted via PDF text)
      'G5': {
        'Numbers and Notation': ['Roman numeration system','Converting Arabic to Roman numerals and vice versa','Ordering Roman numerals'],
        'Addition': ['Addition on the number line','Addition in real life situations'],
        'Subtraction': ['Subtraction on the number line','Subtraction in real life situations'],
        'Combined Operations': ['Order of operations BODMAS','Commutative law','Associative law','Distributive law'],
        'Sets': ['Proper and improper subsets','Sets of numbers (natural, whole, even, odd, prime, composite)','Subsets in Venn diagrams'],
        'Factors and Multiples': ['Factors of given numbers','Highest Common Factor (HCF)','Multiples','Lowest Common Multiple (LCM)'],
        'Fractions': ['Equivalent fractions','Adding and subtracting fractions with different denominators','Mixed numbers'],
        'Decimals': ['Place value of decimals','Adding and subtracting decimals'],
        'Social and Commercial Arithmetic': ['Simple household bills','Ready-reckoners','Reading water and electricity meters'],
        'Plane Shapes': ['Symmetry of plane shapes','Construction of plane shapes'],
        'Solid Shapes': ['Properties of solid shapes','Nets of solid shapes'],
        'Measures': ['Length: km','Mass: tonnes','Capacity'],
        'Statistics': ['Stem-and-leaf plot','Bar graphs','Collecting and presenting data'],
        'Relations': ['One-to-many relations','Many-to-one relations']
      },
      'G6': {
        'Index Notation': ['Bases and powers','Index notation','Squares and square roots'],
        'Sets': ['Universal set','Complement of a set','Venn diagrams with universal set'],
        'Prime Factors': ['Prime factorisation','HCF using prime factors','LCM using prime factors'],
        'Fractions': ['Multiplication of fractions','Division of fractions','Mixed operations on fractions'],
        'Decimals': ['Multiplying decimals','Dividing decimals','Converting fractions to decimals'],
        'Approximation': ['Rounding off','Significant figures','Decimal places'],
        'Ratio and Proportion': ['Concept of ratio','Equivalent ratios','Direct proportion'],
        'Social and Commercial Arithmetic': ['Profit and loss','Discount','Simple interest'],
        'Statistics': ['Pie charts','Mean','Mode','Median'],
        'Linear Equations': ['Open sentences','Solving linear equations in one variable'],
        'Plane Shapes': ['Angles in polygons','Construction with set squares'],
        'Measurement': ['Perimeter and area of compound shapes','Volume of cubes and cuboids']
      },
      'G7': {
        'Fractions': ['Four operations on fractions','Word problems involving fractions'],
        'Decimals': ['Operations on decimals','Standard form (intro)'],
        'Percentages': ['Concept of percentages','Converting fractions/decimals to percentages','Percentage of a quantity'],
        'Ratio and Proportion': ['Indirect proportion','Unitary method','Scale and map reading'],
        'Social and Commercial Arithmetic': ['Compound interest','Hire purchase','Foreign exchange','Income tax'],
        'Integers': ['Operations on integers','Number line and integers'],
        'Number Bases': ['Base 2 (binary)','Base 5','Conversion between bases'],
        'Number Sequences': ['Arithmetic sequences','Patterns','Nth term'],
        'Inequations': ['Linear inequations','Graphical representation'],
        'Plane Shapes': ['Constructions','Loci (intro)','Symmetry'],
        'Measurement': ['Surface area of cubes and cuboids','Volume of prisms'],
        'Solid Shapes': ['Cylinder','Cone','Sphere — properties'],
        'Statistics': ['Frequency tables','Histograms','Probability (intro)']
      }
    },
    'Integrated Science': {
      'G5': { 'Living Things': ['Classification of plants','Classification of animals'], 'Human Body': ['Digestive system','Respiratory system'], 'Matter': ['Properties of matter','States of matter'], 'Energy': ['Sources of energy','Heat'], 'Earth': ['Weather','Soil types'], 'Health': ['Communicable diseases','Personal hygiene'] },
      'G6': { 'Living Things': ['Plant reproduction','Animal reproduction'], 'Human Body': ['Circulatory system','Excretory system'], 'Matter': ['Mixtures and solutions','Acids and bases (intro)'], 'Energy': ['Light','Sound','Electricity (basic)'], 'Environment': ['Pollution','Conservation'], 'Health': ['HIV and AIDS','Drug abuse'] },
      'G7': { 'Living Things': ['Photosynthesis','Food chains'], 'Human Body': ['Reproductive system','Nervous system'], 'Matter': ['Atoms and molecules (intro)','Chemical reactions (intro)'], 'Energy': ['Forces','Simple machines','Magnetism'], 'Environment': ['Climate change','Sustainability'], 'Health': ['Non-communicable diseases','Mental health'] }
    },
    'Social Studies': {
      'G5': { 'Our Country Zambia': ['Provinces','Physical features','Climate'], 'History': ['Pre-colonial Zambia','Bantu migration'], 'Civics': ['National symbols','Government structure'], 'Economic Activities': ['Agriculture','Trade'] },
      'G6': { 'Africa': ['Physical features','Climate regions','African countries'], 'History': ['Colonial period','Independence movements'], 'Civics': ['Constitution','Rights and responsibilities'], 'Economic Activities': ['Mining','Industry','Tourism'] },
      'G7': { 'World Geography': ['Continents','Oceans','World climates'], 'History': ['Post-independence Zambia','African Union'], 'Civics': ['Democracy','Elections','Rule of law'], 'Economic Activities': ['International trade','SADC'] }
    },
    'Home Economics': {
      'G5': { 'Foods and Nutrition': ['Food groups','Healthy eating'], 'Clothing and Textiles': ['Fibres','Care of clothes'], 'Home Management': ['Cleaning','Family resources'] },
      'G6': { 'Foods and Nutrition': ['Meal planning','Food preparation','Food hygiene'], 'Clothing and Textiles': ['Stitches','Simple sewing'], 'Home Management': ['Budgeting','Consumer awareness'] },
      'G7': { 'Foods and Nutrition': ['Nutrients in detail','Cookery methods','Food preservation'], 'Clothing and Textiles': ['Pattern making','Garment construction'], 'Home Management': ['Childcare','Family health'] }
    },
    'Technology Studies': {
      'G5': { 'Materials': ['Wood','Metal','Plastic','Fabric'], 'Tools': ['Hand tools','Tool safety'], 'Design Process': ['Identifying needs','Sketching','Making'] },
      'G6': { 'Materials Working': ['Cutting','Joining','Finishing'], 'Mechanisms': ['Levers','Wheels','Pulleys'], 'Drawing': ['Technical drawing basics','Orthographic views'] },
      'G7': { 'Materials Technology': ['Properties of materials','Selection of materials'], 'Mechanisms and Structures': ['Forces','Simple structures'], 'Electronics (Intro)': ['Circuits','Components'], 'CAD (Intro)': ['Computer-aided drawing basics'] }
    },
    'Zambian Languages': {
      'G5': { 'Reading': ['Comprehension','Cultural texts'], 'Writing': ['Compositions','Letters'], 'Grammar': ['Word classes','Tenses'], 'Oral Skills': ['Speeches','Storytelling'] },
      'G6': { 'Reading': ['Literary texts','Critical reading'], 'Writing': ['Reports','Creative writing'], 'Grammar': ['Sentence structure','Idioms and proverbs'], 'Literature': ['Folktales','Poetry'] },
      'G7': { 'Reading': ['Comprehension','Inference'], 'Writing': ['Argumentative writing','Translation'], 'Grammar': ['Advanced grammar','Vocabulary'], 'Literature': ['Drama','Modern literature'] }
    }
  },
  'oss': {
    // === Senior Secondary G10-12 (old O-Level, extracted from 2013 syllabi) ===
    'Mathematics': {
      'G10': {
        'Sets': ['Sets and set notation','Operations on sets','Venn diagrams (3 sets)'],
        'Index Notation': ['Laws of indices','Negative and fractional indices'],
        'Algebra': ['Basic algebraic expressions','Linear equations','Simultaneous equations','Inequalities'],
        'Matrices': ['Transpose of a matrix','Matrix addition and multiplication','Identity matrix'],
        'Similarity': ['Similar triangles','Similar shapes','Scale factor'],
        'Travel Graphs': ['Distance-time graphs','Speed-time graphs'],
        'Bearings': ['Bearings and direction','Three-figure bearings','Solving bearing problems'],
        'Symmetry': ['Line symmetry','Rotational symmetry','Symmetry of plane shapes'],
        'Computer Numbers': ['Binary numbers','Number bases','Conversion between bases']
      },
      'G11': {
        'Approximation': ['Significant figures','Decimal places','Estimation'],
        'Sequences': ['Arithmetic progression','Geometric progression','Nth term'],
        'Coordinate Geometry': ['Distance and midpoint','Gradient','Equation of a line'],
        'Relations and Functions': ['Domain and range','Mapping','Inverse functions'],
        'Quadratic Equations': ['Factorisation','Completing the square','Quadratic formula'],
        'Quadratic Functions': ['Graphs of quadratic functions','Maximum and minimum values'],
        'Variation': ['Direct variation','Inverse variation','Joint variation'],
        'Circle Geometry': ['Angle properties of circles','Tangent properties','Cyclic quadrilaterals'],
        'Construction': ['Constructing triangles','Loci','Geometric constructions'],
        'Trigonometry': ['Trigonometric ratios','Sine and cosine rules','Area of triangle'],
        'Mensuration': ['Surface area and volume of solids','Compound shapes'],
        'Probability': ['Basic probability','Combined events','Tree diagrams'],
        'Statistics': ['Cumulative frequency','Mean, median, mode of grouped data','Standard deviation']
      },
      'G12': {
        'Graphs of Functions': ['Linear graphs','Quadratic graphs','Cubic graphs'],
        'Linear Programming': ['Linear inequalities','Graphical solutions','Optimisation'],
        'Travel Graphs': ['Distance-time and speed-time graphs','Acceleration'],
        'Vectors': ['Vectors in 2D','Position vectors','Vector geometry'],
        'Geometrical Transformations': ['Translation','Reflection','Rotation','Enlargement'],
        'Earth Geometry': ['Latitude and longitude','Distance on the Earth\'s surface','Time zones'],
        'Introductory Calculus': ['Differentiation: power rule','Tangent and normal','Stationary points','Integration: basics']
      }
    },
    'Additional Mathematics': {
      'G10': { 'Algebra': ['Polynomial functions','Remainder and factor theorem','Partial fractions'], 'Functions': ['Composite functions','Inverse functions','Modulus functions'], 'Trigonometry': ['Trigonometric identities','Trigonometric equations'] },
      'G11': { 'Calculus': ['Differentiation: rules and applications','Integration: techniques and applications'], 'Coordinate Geometry': ['Circles','Parametric equations'], 'Vectors': ['Vector geometry','Scalar product'] },
      'G12': { 'Calculus': ['Differential equations','Maclaurin series'], 'Complex Numbers': ['Argand diagram','De Moivre theorem'], 'Probability and Statistics': ['Discrete distributions','Continuous distributions'] }
    },
    'Biology': {
      'G10': { 'Cell Biology': ['Cell structure','Cell division','Movement in/out of cells'], 'Plant Biology': ['Plant structure','Photosynthesis','Transport in plants'], 'Human Nutrition': ['Nutrients','Digestion','Absorption'] },
      'G11': { 'Transport in Humans': ['Heart and blood','Blood vessels','Lymphatic system'], 'Respiration': ['Breathing','Cellular respiration','Gas exchange'], 'Reproduction': ['Asexual and sexual','Human reproduction','Pregnancy and birth'] },
      'G12': { 'Coordination': ['Nervous system','Hormones','Senses'], 'Genetics': ['Chromosomes and genes','Inheritance','Variation'], 'Ecology': ['Ecosystems','Food webs','Conservation'], 'Health': ['Diseases','Immunity','HIV and AIDS'] }
    },
    'Chemistry': {
      'G10': { 'Atomic Structure': ['Atoms, ions, isotopes','Electronic configuration','Periodic table'], 'Bonding': ['Ionic','Covalent','Metallic'], 'Stoichiometry': ['Mole concept','Empirical formulae','Calculations'] },
      'G11': { 'Acids, Bases and Salts': ['pH','Neutralisation','Salt preparation','Titrations'], 'Energetics': ['Exothermic/endothermic','Enthalpy','Bond energies'], 'Rates of Reaction': ['Factors affecting rate','Catalysis'], 'Equilibrium': ['Reversible reactions','Le Chatelier'] },
      'G12': { 'Redox': ['Oxidation states','Electrolysis','Cells'], 'Organic Chemistry': ['Hydrocarbons','Alcohols','Carboxylic acids','Polymers'], 'Industrial Chemistry': ['Haber process','Contact process','Extraction of metals'] }
    },
    'Physics': {
      'G10': { 'Mechanics': ['Measurements','Motion','Forces','Work and energy'], 'Heat': ['Temperature','Heat transfer','Gas laws'], 'Optics': ['Reflection','Refraction','Lenses'] },
      'G11': { 'Waves': ['Transverse and longitudinal','Sound','Electromagnetic spectrum'], 'Electricity': ['Static electricity','Current electricity','Ohm\'s law','Circuits'], 'Magnetism': ['Magnets','Electromagnetism','Motors and generators'] },
      'G12': { 'Modern Physics': ['Atomic structure','Radioactivity','Nuclear reactions'], 'Electronics (Intro)': ['Diodes','Transistors','Logic gates'], 'Energy': ['Renewable energy','Energy resources'] }
    },
    'Science 5124': {
      // Combined Science (old single-paper for those not taking pure sciences)
      'G10': { 'Biology': ['Cells','Nutrition','Transport in living things'], 'Chemistry': ['Matter','Acids and bases','Reactions'], 'Physics': ['Motion','Energy','Heat'] },
      'G11': { 'Biology': ['Reproduction','Genetics basics','Health'], 'Chemistry': ['Periodic table','Bonding','Salts'], 'Physics': ['Waves','Electricity','Magnetism'] },
      'G12': { 'Biology': ['Ecology','Biotechnology'], 'Chemistry': ['Organic intro','Industrial processes'], 'Physics': ['Modern physics intro','Electronics intro'] }
    },
    'Geography': {
      'G10': { 'Physical Geography': ['Earth structure','Plate tectonics','Weathering and erosion','Rivers'], 'Map Skills': ['Map reading','Map analysis','Photographs'], 'Climatology': ['Weather and climate','Climate of Zambia'] },
      'G11': { 'Human Geography': ['Population','Settlement','Migration','Urbanisation'], 'Economic Geography': ['Agriculture','Industry','Mining','Trade'], 'Zambia in Detail': ['Mining regions','Agricultural regions'] },
      'G12': { 'Africa and the World': ['African geography','SADC','Globalisation'], 'Environment': ['Climate change','Conservation','Sustainable development'], 'Field Studies': ['Methodology','Data collection','Analysis'] }
    },
    'History': {
      'G10': { 'Pre-colonial Africa': ['Early African societies','Trans-Saharan and East African trade','Great Zimbabwe','Pre-colonial Zambian states'] },
      'G11': { 'Colonialism': ['Scramble for Africa','Berlin Conference','Resistance and rebellion','Colonial administration'], 'Slavery': ['Trans-Atlantic and East African slave trades','Abolition'] },
      'G12': { 'Independence Era': ['Liberation movements','Zambian independence (1964)','Post-independence Zambia','Multi-party democracy'], 'World History': ['World Wars','Cold War','Decolonisation'], 'Themes': ['Apartheid','Pan-Africanism'] }
    },
    'Home Management': {
      'G10': { 'Family Studies': ['Family roles','Marriage','Childcare'], 'Home and Living': ['Housing','Home decoration'], 'Consumer Studies': ['Consumer rights','Wise spending'] },
      'G11': { 'Family Health': ['Nutrition','Hygiene','First aid'], 'Resource Management': ['Budgeting','Saving','Investment'], 'Hospitality': ['Receiving guests','Etiquette'] },
      'G12': { 'Childcare in Detail': ['Stages of development','Special needs'], 'Home Industries': ['Income-generating activities','Small business'] }
    },
    'Food and Nutrition': {
      'G10': { 'Food Science': ['Composition of foods','Nutrients'], 'Food Preparation': ['Cookery methods','Kitchen tools'], 'Hygiene': ['Personal and food hygiene'] },
      'G11': { 'Meal Planning': ['Menu planning','Special diets','Catering'], 'Food Preservation': ['Drying, canning, freezing'], 'Sensory Evaluation': ['Tasting','Plating'] },
      'G12': { 'Bakery and Confectionery': ['Bread','Cakes','Pastries'], 'Mass Catering': ['Large-scale meal planning','Costing'], 'Food Industry': ['Food packaging','Marketing'] }
    },
    'Fashion and Fabrics': {
      'G10': { 'Fibres and Fabrics': ['Natural and synthetic fibres','Fabric construction'], 'Pattern Making': ['Body measurements','Simple patterns'], 'Stitches': ['Hand stitches','Machine stitches'] },
      'G11': { 'Garment Construction': ['Layout and cutting','Assembly','Finishing'], 'Fashion Design': ['Design elements','Illustration'], 'Care of Clothing': ['Laundry','Stain removal','Storage'] },
      'G12': { 'Pattern Drafting': ['Advanced pattern drafting','Adaptations'], 'Fashion History': ['Fashion eras','Zambian and African fashion'], 'Production': ['Small-scale production','Costing'] }
    },
    'Design and Technology': {
      'G10': { 'Materials': ['Wood','Metals','Plastics','Composites'], 'Tools': ['Hand tools','Machine tools','Workshop safety'], 'Drawing': ['Technical drawing','Orthographic projection','Pictorial views'] },
      'G11': { 'Design Process': ['Identifying needs','Specifications','Solutions','Evaluation'], 'Mechanisms': ['Levers, gears, pulleys, cams'], 'Structures': ['Forces','Stability'], 'Electronics': ['Components','Simple circuits'] },
      'G12': { 'Manufacturing': ['Workshop processes','Mass production','Quality control'], 'CAD/CAM': ['Computer-aided design','3D modelling'], 'Design Project': ['Major project','Documentation'] }
    },
    'Agricultural Science': {
      'G10': { 'Soil Science': ['Soil formation','Soil fertility','Conservation'], 'Crop Production': ['Maize, cassava, vegetables','Land preparation','Planting'], 'Farm Tools': ['Hand tools','Farm machinery'] },
      'G11': { 'Crop Production (Advanced)': ['Pest and disease control','Harvesting','Storage'], 'Animal Husbandry': ['Cattle, goats, pigs, poultry','Feeding','Health'], 'Farm Records': ['Record-keeping','Farm planning'] },
      'G12': { 'Farm Economics': ['Costs and revenue','Marketing','Agribusiness'], 'Animal Production': ['Breeding','Animal products','Veterinary basics'], 'Agricultural Engineering': ['Irrigation','Farm structures'] }
    },
    'Literature in English': {
      'G10': { 'Poetry': ['Forms of poetry','Figurative language','Studied poems'], 'Prose': ['Short stories','Novel study'], 'Drama': ['Studied play','Dramatic techniques'] },
      'G11': { 'Poetry': ['Critical analysis','Comparative poetry'], 'Prose': ['Themes and characterisation','Narrative techniques'], 'Drama': ['Performance and analysis'] },
      'G12': { 'Set Texts': ['Detailed study of all set texts','Examination preparation'], 'Critical Essays': ['Practical criticism','Comparative essays'] }
    },
  }
};
