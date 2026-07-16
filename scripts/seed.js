const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function seedAbsoluteCompleteDatabase() {
  console.log('🚀 Initiating Absolute Production Database Seeding (Cost-Optimized)...');

  // ---------------------------------------------------------
  // 1. UNIVERSAL SETTINGS (1 Write)
  // ---------------------------------------------------------
  const universalData = {
    interviewTypes: ['Technical', 'HR', 'Behavioral', 'Situational', 'Case Study', 'Managerial', 'Communication', 'Mixed'],
    interviewModes: ['Voice', 'Video', 'Text'],
    difficultyLevels: ['Easy', 'Medium', 'Hard', 'Expert'],
    experienceLevels: ['Student', 'Fresher', '0–2', '2–5', '5–10', '10+ Years'],
    educationLevels: ['High School', 'Diploma', 'ITI', 'Bachelor\'s', 'Master\'s', 'MBA', 'PhD', 'Other'],
    aiPersonalities: ['Friendly', 'Professional', 'Strict', 'Technical Expert', 'HR', 'Hiring Manager'],
    languages: ['English', 'Hindi', 'Marathi', 'Tamil', 'Telugu', 'Gujarati', 'Kannada', 'Bengali'],
    questionCounts: [5, 10, 15, 20, 30],
    interviewDurations: [10, 20, 30, 45, 60]
  };
  
  // await db.collection('interview_settings').doc('interview_settings').set(universalData);
  console.log('✅ Universal settings seeded successfully.');

  // ---------------------------------------------------------
  // 2. THE MASTER DOMAIN OBJECT (33 Domains)
  // ---------------------------------------------------------
  const interviewDomains = [
    // ---------------------------------------------------------
    // 1. TECHNOLOGY & ENGINEERING
    // ---------------------------------------------------------
    {
      id: 'it',
      domainName: 'Information Technology',
      interviewTypes: ['Technical', 'Coding', 'System Design', 'Debugging', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Software Development', 
          specializations: [
            { name: 'Frontend', roles: ['Angular Developer', 'React Developer', 'Vue Developer'] },
            { name: 'Backend', roles: ['Node.js Developer', 'Java Developer', 'Python Developer', '.NET Developer', 'PHP Developer'] },
            { name: 'Full Stack', roles: ['Full Stack Developer', 'Technical Architect', 'Software Architect'] },
            { name: 'Mobile Development', roles: ['Flutter Developer', 'Android Developer', 'iOS Developer'] },
            { name: 'Desktop Development', roles: ['C++ Developer', 'Desktop Application Engineer'] }
          ] 
        },
        { 
          name: 'Cloud & DevOps', 
          specializations: [
            { name: 'AWS', roles: ['AWS Cloud Engineer', 'AWS Solutions Architect'] },
            { name: 'Azure', roles: ['Azure Cloud Engineer', 'Azure Developer'] },
            { name: 'GCP', roles: ['Google Cloud Engineer'] },
            { name: 'DevOps', roles: ['DevOps Engineer'] },
            { name: 'Site Reliability', roles: ['Site Reliability Engineer (SRE)'] }
          ] 
        },
        { 
          name: 'Data', 
          specializations: [
            { name: 'Data Engineering', roles: ['Data Engineer'] },
            { name: 'Data Science', roles: ['Data Scientist'] },
            { name: 'Machine Learning', roles: ['ML Engineer'] },
            { name: 'AI', roles: ['AI Engineer'] },
            { name: 'Analytics', roles: ['Data Analyst'] }
          ] 
        },
        { 
          name: 'Security', 
          specializations: [
            { name: 'Cyber Security', roles: ['Cyber Security Engineer'] },
            { name: 'Ethical Hacking', roles: ['Ethical Hacker', 'Penetration Tester'] },
            { name: 'Network Security', roles: ['Network Security Engineer'] }
          ] 
        },
        { 
          name: 'Testing', 
          specializations: [
            { name: 'Manual QA', roles: ['Manual QA Tester'] },
            { name: 'Automation QA', roles: ['Automation QA Engineer', 'QA Engineer'] },
            { name: 'Performance Testing', roles: ['Performance Testing Engineer'] }
          ] 
        },
        { 
          name: 'UI/UX', 
          specializations: [
            { name: 'UI Design', roles: ['UI Designer'] },
            { name: 'UX Research', roles: ['UX Researcher', 'UX Designer'] },
            { name: 'Product Design', roles: ['Product Designer'] }
          ] 
        },
        { 
          name: 'Infrastructure & Systems', 
          specializations: [
            { name: 'Linux Administration', roles: ['Linux Administrator', 'System Administrator'] },
            { name: 'Windows Administration', roles: ['Windows Server Admin', 'Active Directory Engineer'] },
            { name: 'Network Engineering', roles: ['Network Engineer', 'NOC Technician'] },
            { name: 'IT Support', roles: ['IT Support Specialist', 'Helpdesk Technician'] }
          ] 
        },
        { 
          name: 'Enterprise & Database', 
          specializations: [
            { name: 'Database Administration', roles: ['Oracle DBA', 'SQL Server DBA', 'MySQL/PostgreSQL DBA'] },
            { name: 'ERP Systems', roles: ['SAP Consultant', 'Oracle ERP Specialist'] },
            { name: 'CRM Systems', roles: ['Salesforce Developer', 'Dynamics 365 Consultant'] }
          ] 
        },
        { 
          name: 'Game Development', 
          specializations: [
            { name: 'Engine Programming', roles: ['Unity Developer', 'Unreal Engine Developer'] },
            { name: 'Game Design', roles: ['Game Designer', 'Level Designer'] },
            { name: 'Technical Art', roles: ['Technical Artist', 'Graphics Programmer'] }
          ] 
        }
      ]
    },
    {
      id: 'mech',
      domainName: 'Mechanical Engineering',
      interviewTypes: ['Technical', 'CAD Modeling', 'Machine Design', 'Industrial Safety', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Design', 
          specializations: [
            { name: 'Automotive Design', roles: ['Automotive Design Engineer'] },
            { name: 'Product Styling', roles: ['Product Styling Engineer'] },
            { name: 'CAD Modeling', roles: ['Design Engineer', 'CAD Draftsman'] }
          ] 
        },
        { 
          name: 'Production & Manufacturing', 
          specializations: [
            { name: 'Lean Manufacturing', roles: ['Production Engineer'] },
            { name: 'CNC Programming', roles: ['CNC Programmer'] },
            { name: 'Quality Control', roles: ['Quality Engineer'] }
          ] 
        },
        { 
          name: 'HVAC & Thermal', 
          specializations: [
            { name: 'Air Conditioning', roles: ['HVAC Engineer'] },
            { name: 'Refrigeration', roles: ['Maintenance Engineer'] },
            { name: 'Heat Exchangers', roles: ['Plant Engineer'] }
          ] 
        }
      ]
    },
    {
      id: 'civil',
      domainName: 'Civil Engineering',
      interviewTypes: ['Technical', 'Structural Analysis', 'Estimation & Costing', 'Site Planning', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Structural Engineering', 
          specializations: [
            { name: 'High-Rise Buildings', roles: ['Structural Engineer'] },
            { name: 'Bridges', roles: ['Bridge Design Specialist'] },
            { name: 'Foundation Design', roles: ['Geotechnical Engineer'] }
          ] 
        },
        { 
          name: 'Infrastructure & Transport', 
          specializations: [
            { name: 'Highway Design', roles: ['Civil Engineer'] },
            { name: 'Urban Planning', roles: ['Urban Planner'] },
            { name: 'Railway Systems', roles: ['Railway Infrastructure Engineer'] }
          ] 
        },
        { 
          name: 'Construction Management', 
          specializations: [
            { name: 'Project Scheduling', roles: ['Planning Engineer'] },
            { name: 'Cost Estimation', roles: ['Quantity Surveyor'] },
            { name: 'Site Operations', roles: ['Site Engineer'] }
          ] 
        }
      ]
    },
    {
      id: 'elec',
      domainName: 'Electrical Engineering',
      interviewTypes: ['Technical', 'Circuit Design', 'Automation', 'Power Systems', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Power Systems', 
          specializations: [
            { name: 'Grid Distribution', roles: ['Power Engineer'] },
            { name: 'Substation Automation', roles: ['Substation Engineer'] },
            { name: 'High Voltage Engineering', roles: ['Electrical Maintenance Engineer'] }
          ] 
        },
        { 
          name: 'Renewable Energy', 
          specializations: [
            { name: 'Solar PV Systems', roles: ['Solar Energy Engineer'] },
            { name: 'Wind Energy', roles: ['Electrical Engineer'] },
            { name: 'Battery Storage Systems', roles: ['Energy Storage Engineer'] }
          ] 
        },
        { 
          name: 'Control Systems', 
          specializations: [
            { name: 'Industrial Automation', roles: ['Control Engineer'] },
            { name: 'Robotics Systems', roles: ['Robotics Automation Engineer'] },
            { name: 'SCADA Integration', roles: ['SCADA Engineer'] }
          ] 
        }
      ]
    },
    {
      id: 'ece',
      domainName: 'Electronics Engineering',
      interviewTypes: ['Technical', 'Embedded Coding', 'VLSI Layout', 'Circuit Design', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Embedded Systems', 
          specializations: [
            { name: 'Firmware Development', roles: ['Firmware Engineer'] },
            { name: 'RTOS', roles: ['Embedded Engineer'] },
            { name: 'Microcontrollers', roles: ['Microcontroller Specialist'] }
          ] 
        },
        { 
          name: 'VLSI & Semiconductors', 
          specializations: [
            { name: 'ASIC Design', roles: ['VLSI Engineer'] },
            { name: 'FPGA Programming', roles: ['FPGA Engineer'] },
            { name: 'CMOS Layout', roles: ['PCB Designer'] }
          ] 
        },
        { 
          name: 'IoT & Robotics', 
          specializations: [
            { name: 'Sensor Networks', roles: ['IoT Engineer'] },
            { name: 'Wireless Protocols', roles: ['Network Protocol Engineer'] },
            { name: 'Actuator Systems', roles: ['Robotics Hardware Engineer'] }
          ] 
        }
      ]
    },
  
    // ---------------------------------------------------------
    // 2. BUSINESS, FINANCE, & MANAGEMENT
    // ---------------------------------------------------------
    {
      id: 'finance',
      domainName: 'Commerce & Finance',
      interviewTypes: ['Technical', 'Financial Modeling', 'Case Study', 'Auditing Standards', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Corporate Finance', 
          specializations: [
            { name: 'Financial Modeling', roles: ['Financial Analyst'] },
            { name: 'Mergers & Acquisitions', roles: ['Investment Banker'] },
            { name: 'Treasury Management', roles: ['Treasury Specialist'] }
          ] 
        },
        { 
          name: 'Accounting & Auditing', 
          specializations: [
            { name: 'Statutory Audit', roles: ['CA', 'Auditor'] },
            { name: 'Internal Audit', roles: ['Accountant'] },
            { name: 'Forensic Accounting', roles: ['Forensic Auditor'] }
          ] 
        },
        { 
          name: 'Taxation', 
          specializations: [
            { name: 'Direct Tax', roles: ['Tax Consultant'] },
            { name: 'Indirect Tax / GST', roles: ['GST Practitioner'] },
            { name: 'International Taxation', roles: ['CS', 'Corporate Tax Specialist'] }
          ] 
        }
      ]
    },
    {
      id: 'banking',
      domainName: 'Banking',
      interviewTypes: ['Technical', 'Credit Appraisal', 'Compliance & AML', 'Customer Relations', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Retail Banking', 
          specializations: [
            { name: 'Branch Operations', roles: ['Bank PO'] },
            { name: 'Wealth Management', roles: ['Relationship Manager'] },
            { name: 'Customer Services', roles: ['Branch Manager'] }
          ] 
        },
        { 
          name: 'Corporate Banking', 
          specializations: [
            { name: 'Trade Finance', roles: ['Loan Officer'] },
            { name: 'Syndicated Loans', roles: ['Corporate Loan Specialist'] },
            { name: 'Commercial Credit', roles: ['Credit Analyst'] }
          ] 
        },
        { 
          name: 'Risk & Compliance', 
          specializations: [
            { name: 'Anti-Money Laundering', roles: ['AML Compliance Officer'] },
            { name: 'Credit Risk Analysis', roles: ['Risk Analyst'] },
            { name: 'Operational Risk', roles: ['Compliance Executive'] }
          ] 
        }
      ]
    },
    {
      id: 'insurance',
      domainName: 'Insurance',
      interviewTypes: ['Technical', 'Risk Estimation', 'Underwriting Case', 'Claims Management', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Actuarial & Underwriting', 
          specializations: [
            { name: 'Risk Assessment', roles: ['Actuary'] },
            { name: 'Policy Underwriting', roles: ['Underwriter'] }
          ] 
        },
        { 
          name: 'Claims & Operations', 
          specializations: [
            { name: 'Claims Processing', roles: ['Claims Adjuster'] },
            { name: 'Loss Assessment', roles: ['Loss Assessor'] }
          ] 
        },
        { 
          name: 'Sales & Brokering', 
          specializations: [
            { name: 'Corporate Sales', roles: ['Insurance Broker'] },
            { name: 'Retail Sales', roles: ['Insurance Agent'] }
          ] 
        }
      ]
    },
    {
      id: 'management',
      domainName: 'Product & Project Management',
      interviewTypes: ['Product Sense', 'Execution & Metrics', 'Guesstimate', 'Agile/Scrum Case', 'Leadership', 'Behavioral'],
      categories: [
        { 
          name: 'Product Management', 
          specializations: [
            { name: 'Software Product Management', roles: ['Product Manager', 'Product Owner'] },
            { name: 'Growth & Strategy', roles: ['Growth Product Manager'] }
          ] 
        },
        { 
          name: 'Agile & Delivery', 
          specializations: [
            { name: 'Scrum & Agile', roles: ['Scrum Master', 'Agile Coach'] },
            { name: 'Project Management', roles: ['Project Manager', 'Delivery Manager'] }
          ] 
        }
      ]
    },
    {
      id: 'consulting',
      domainName: 'Consulting & Strategy',
      interviewTypes: ['Case Interview', 'Guesstimate', 'Market Sizing', 'Business Strategy', 'Fit Interview', 'Presentation'],
      categories: [
        { 
          name: 'Management Consulting', 
          specializations: [
            { name: 'Corporate Strategy', roles: ['Management Consultant', 'Strategy Analyst'] },
            { name: 'Operations Consulting', roles: ['Process Consultant'] }
          ] 
        },
        { 
          name: 'Technology Consulting', 
          specializations: [
            { name: 'Digital Transformation', roles: ['IT Consultant', 'Digital Transformation Consultant'] },
            { name: 'Cybersecurity Consulting', roles: ['Security Consultant'] }
          ] 
        }
      ]
    },
    {
      id: 'hr',
      domainName: 'Human Resources',
      interviewTypes: ['Behavioral', 'Situational', 'Labor Law Compliance', 'Conflict Resolution', 'HR Strategy'],
      categories: [
        { 
          name: 'Talent Acquisition', 
          specializations: [
            { name: 'Technical Recruiting', roles: ['Recruiter', 'Talent Acquisition Specialist'] },
            { name: 'Executive Search', roles: ['Executive Headhunter'] },
            { name: 'Campus Hiring', roles: ['HR Executive'] }
          ] 
        },
        { 
          name: 'HR Operations', 
          specializations: [
            { name: 'Payroll Management', roles: ['Payroll Executive'] },
            { name: 'HR Compliance', roles: ['HR Manager'] },
            { name: 'Employee Benefits', roles: ['Comp & Benefits Specialist'] }
          ] 
        },
        { 
          name: 'Talent Management', 
          specializations: [
            { name: 'Performance Appraisals', roles: ['HR Business Partner (HRBP)'] },
            { name: 'L&D (Learning & Development)', roles: ['L&D Specialist'] },
            { name: 'Employee Engagement', roles: ['Employee Engagement Executive'] }
          ] 
        }
      ]
    },
    {
      id: 'sales',
      domainName: 'Sales & Marketing',
      interviewTypes: ['Sales Pitch', 'Case Study', 'Marketing Strategy', 'Negotiation', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Sales & Business Development', 
          specializations: [
            { name: 'B2B Sales', roles: ['Account Manager'] },
            { name: 'Corporate Sales', roles: ['Business Development Executive'] },
            { name: 'Direct-to-Consumer Sales', roles: ['Sales Executive'] }
          ] 
        },
        { 
          name: 'Digital Marketing', 
          specializations: [
            { name: 'SEO & Content Marketing', roles: ['SEO Specialist'] },
            { name: 'Performance Marketing / Paid Ads', roles: ['Digital Marketing Manager'] },
            { name: 'Social Media Marketing', roles: ['Marketing Executive'] }
          ] 
        },
        { 
          name: 'Brand & Product Management', 
          specializations: [
            { name: 'Market Research', roles: ['Market Research Analyst'] },
            { name: 'Public Relations', roles: ['PR Executive'] },
            { name: 'Brand Strategy', roles: ['Brand Manager'] }
          ] 
        }
      ]
    },
    {
      id: 'bpo',
      domainName: 'Customer Success & BPO',
      interviewTypes: ['Voice & Accent', 'Customer Handling', 'Technical Support', 'Chat/Email Simulation', 'Behavioral'],
      categories: [
        { 
          name: 'Customer Support', 
          specializations: [
            { name: 'Voice Process', roles: ['Customer Service Representative', 'Telecaller'] },
            { name: 'Non-Voice & Chat', roles: ['Chat Support Executive', 'Email Support Specialist'] }
          ] 
        },
        { 
          name: 'Customer Success', 
          specializations: [
            { name: 'Client Onboarding', roles: ['Customer Success Manager', 'Onboarding Specialist'] },
            { name: 'Technical Support', roles: ['Technical Support Engineer', 'L1/L2 Support'] }
          ] 
        }
      ]
    },
  
    // ---------------------------------------------------------
    // 3. HEALTHCARE, SCIENCES, & PHARMA
    // ---------------------------------------------------------
    {
      id: 'healthcare',
      domainName: 'Healthcare',
      interviewTypes: ['Clinical Skills', 'Medical Ethics', 'Diagnostic Case', 'Emergency Response', 'Viva Voce', 'Behavioral'],
      categories: [
        { 
          name: 'Clinical Medicine', 
          specializations: [
            { name: 'General Medicine', roles: ['Doctor'] },
            { name: 'Pediatrics', roles: ['Pediatrician'] },
            { name: 'Cardiology', roles: ['Cardiologist'] },
            { name: 'Surgery', roles: ['Surgeon'] }
          ] 
        },
        { 
          name: 'Nursing & Patient Care', 
          specializations: [
            { name: 'Critical Care', roles: ['Nurse', 'Critical Care Nurse'] },
            { name: 'OT Nursing', roles: ['OT Nurse'] },
            { name: 'Geriatric Care', roles: ['Physiotherapist'] }
          ] 
        },
        { 
          name: 'Diagnostics & Pathology', 
          specializations: [
            { name: 'Radiology', roles: ['Radiologist'] },
            { name: 'Hematology', roles: ['Lab Technician'] },
            { name: 'Microbiology', roles: ['Pharmacist'] }
          ] 
        }
      ]
    },
    {
      id: 'pharma',
      domainName: 'Biotech & Pharmaceuticals',
      interviewTypes: ['Technical', 'Lab Protocol', 'Regulatory Compliance', 'Quality Assurance', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Research & Development', 
          specializations: [
            { name: 'Drug Discovery', roles: ['Research Scientist', 'Pharmacologist'] },
            { name: 'Clinical Trials', roles: ['Clinical Research Associate (CRA)', 'Clinical Data Manager'] },
            { name: 'Biotechnology', roles: ['Biotechnologist', 'Microbiologist'] }
          ] 
        },
        { 
          name: 'Production & Quality', 
          specializations: [
            { name: 'Formulation', roles: ['Formulation Scientist'] },
            { name: 'Quality Assurance', roles: ['Pharma QA/QC Inspector'] },
            { name: 'Regulatory Affairs', roles: ['Regulatory Affairs Specialist'] }
          ] 
        }
      ]
    },
    {
      id: 'science',
      domainName: 'Core Sciences & Research',
      interviewTypes: ['Technical', 'Research Defense', 'Analytical Methods', 'Lab Safety', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Environmental Science', 
          specializations: [
            { name: 'Ecology & Conservation', roles: ['Environmental Scientist', 'Ecologist'] },
            { name: 'Climate & Atmospheric', roles: ['Meteorologist', 'Climate Analyst'] }
          ] 
        },
        { 
          name: 'Physical & Chemical Sciences', 
          specializations: [
            { name: 'Chemical Research', roles: ['Research Chemist', 'Analytical Chemist'] },
            { name: 'Material Sciences', roles: ['Materials Scientist', 'Metallurgist'] }
          ] 
        }
      ]
    },
  
    // ---------------------------------------------------------
    // 4. INDUSTRY, OPERATIONS, & INFRASTRUCTURE
    // ---------------------------------------------------------
    {
      id: 'logistics',
      domainName: 'Logistics & Supply Chain',
      interviewTypes: ['Supply Chain Case', 'Inventory Management', 'Logistics Optimization', 'Strategic Procurement', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Supply Chain Planning', 
          specializations: [
            { name: 'Demand Forecasting', roles: ['Supply Chain Manager'] },
            { name: 'S&OP Operations', roles: ['S&OP Analyst'] },
            { name: 'Strategic Procurement', roles: ['Procurement Officer'] }
          ] 
        },
        { 
          name: 'Warehouse & Inventory Control', 
          specializations: [
            { name: 'Automated Inventory Systems', roles: ['Inventory Controller'] },
            { name: 'Order Fulfillment Workflows', roles: ['Warehouse Manager'] },
            { name: 'Distribution Design', roles: ['Distribution Manager'] }
          ] 
        },
        { 
          name: 'Transportation & Freight', 
          specializations: [
            { name: 'Fleet Management', roles: ['Logistics Executive'] },
            { name: 'Multimodal Freight Logistics', roles: ['Freight Forwarder'] },
            { name: 'Cold Chain Infrastructure', roles: ['Cold Chain Logistics Specialist'] }
          ] 
        }
      ]
    },
    {
      id: 'retail',
      domainName: 'Retail & E-Commerce',
      interviewTypes: ['Store Operations', 'Category Management', 'Visual Merchandising', 'Customer Relations', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Store Operations', 
          specializations: [
            { name: 'Retail Management', roles: ['Store Manager', 'Area Manager'] },
            { name: 'Visual Merchandising', roles: ['Visual Merchandiser'] }
          ] 
        },
        { 
          name: 'E-Commerce Operations', 
          specializations: [
            { name: 'Category Management', roles: ['Category Manager', 'E-commerce Specialist'] },
            { name: 'Marketplace Operations', roles: ['Marketplace Manager', 'Catalog Executive'] }
          ] 
        }
      ]
    },
    {
      id: 'energy',
      domainName: 'Energy, Oil & Gas',
      interviewTypes: ['Technical', 'Processing & Refining', 'HSE Compliance', 'Drilling Operations', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Exploration & Extraction', 
          specializations: [
            { name: 'Petroleum Engineering', roles: ['Petroleum Engineer', 'Drilling Engineer'] },
            { name: 'Geosciences', roles: ['Geologist', 'Geophysicist'] }
          ] 
        },
        { 
          name: 'Processing & Refining', 
          specializations: [
            { name: 'Chemical Engineering', roles: ['Chemical Engineer', 'Process Engineer'] },
            { name: 'Pipeline Operations', roles: ['Pipeline Engineer', 'Plant Operator'] }
          ] 
        }
      ]
    },
    {
      id: 'telecom',
      domainName: 'Telecommunications',
      interviewTypes: ['Technical', 'Network Architecture', 'RF Engineering', 'Troubleshooting', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Network Engineering', 
          specializations: [
            { name: 'RF Engineering', roles: ['RF Engineer', 'Drive Test Engineer'] },
            { name: 'Core Network', roles: ['Core Network Engineer', 'Telecom Switch Engineer'] }
          ] 
        },
        { 
          name: 'Telecom Operations', 
          specializations: [
            { name: 'Fiber Optics', roles: ['Fiber Optic Engineer', 'OSP Engineer'] },
            { name: 'NOC Operations', roles: ['Telecom NOC Analyst'] }
          ] 
        }
      ]
    },
    {
      id: 'agriculture',
      domainName: 'Agriculture',
      interviewTypes: ['Technical', 'Agronomy Case', 'Farm Management', 'Supply Chain Logistics', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Crop & Soil Sciences', 
          specializations: [
            { name: 'Agronomy Practice', roles: ['Agronomist'] },
            { name: 'Horticulture Cultivation', roles: ['Horticulture Officer'] },
            { name: 'Soil Quality Analysis', roles: ['Soil Scientist'] }
          ] 
        },
        { 
          name: 'Agri-Business Management', 
          specializations: [
            { name: 'Farm Supply Chains', roles: ['Farm Manager'] },
            { name: 'Agricultural Product Marketing', roles: ['Agriculture Officer'] },
            { name: 'Cold Storage Logistics', roles: ['Agri-Supply Chain Manager'] }
          ] 
        },
        { 
          name: 'Agricultural Engineering', 
          specializations: [
            { name: 'Smart Irrigation Frameworks', roles: ['Irrigation Engineer'] },
            { name: 'Farm Machinery Systems', roles: ['Agricultural Engineer'] },
            { name: 'Hydroponics Design', roles: ['Hydroponics Consultant'] }
          ] 
        }
      ]
    },
    {
      id: 'maritime',
      domainName: 'Maritime & Shipping',
      interviewTypes: ['Technical', 'Safety & Survival (STCW)', 'Navigation Simulation', 'Marine Engineering', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Deck Operations', 
          specializations: [
            { name: 'Ship Navigation', roles: ['Deck Officer', 'Ship Captain'] },
            { name: 'Vessel Management', roles: ['Chief Mate', 'Bosun'] }
          ] 
        },
        { 
          name: 'Marine Engineering', 
          specializations: [
            { name: 'Engine Room Operations', roles: ['Marine Engineer', 'Chief Engineer'] },
            { name: 'Electrical Systems', roles: ['Electro-Technical Officer (ETO)'] }
          ] 
        },
        { 
          name: 'Port & Terminal Operations', 
          specializations: [
            { name: 'Cargo Logistics', roles: ['Cargo Superintendent', 'Port Manager'] },
            { name: 'Harbor Control', roles: ['Harbor Master', 'Marine Pilot'] }
          ] 
        }
      ]
    },
  
    // ---------------------------------------------------------
    // 5. PUBLIC SECTOR, LAW, & EDUCATION
    // ---------------------------------------------------------
    {
      id: 'education',
      domainName: 'Education',
      interviewTypes: ['Demo Teaching', 'Pedagogy', 'Student Psychology', 'Curriculum Design', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'K-12 Education', 
          specializations: [
            { name: 'Primary Education', roles: ['Tutor'] },
            { name: 'Secondary Education', roles: ['Teacher'] },
            { name: 'STEM Teaching', roles: ['Principal'] }
          ] 
        },
        { 
          name: 'Higher Education', 
          specializations: [
            { name: 'Postgraduate Lecturing', roles: ['Lecturer'] },
            { name: 'Academic Research', roles: ['Professor'] },
            { name: 'Doctoral Supervision', roles: ['Research Supervisor'] }
          ] 
        },
        { 
          name: 'E-Learning', 
          specializations: [
            { name: 'Instructional Design', roles: ['Instructional Designer'] },
            { name: 'Online Content Creation', roles: ['E-Learning Content Developer'] },
            { name: 'Virtual Classroom Management', roles: ['Online Instructor'] }
          ] 
        }
      ]
    },
    {
      id: 'law',
      domainName: 'Law',
      interviewTypes: ['Moot Court', 'Legal Drafting', 'Case Law Analysis', 'Legal Ethics', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Corporate & Commercial Law', 
          specializations: [
            { name: 'M&A Law', roles: ['Corporate Lawyer'] },
            { name: 'Intellectual Property (IP)', roles: ['Legal Executive'] },
            { name: 'Contract Management', roles: ['Paralegal'] }
          ] 
        },
        { 
          name: 'Litigation & Dispute Resolution', 
          specializations: [
            { name: 'Criminal Defense', roles: ['Lawyer'] },
            { name: 'Civil Litigation', roles: ['Legal Advisor'] },
            { name: 'Arbitration', roles: ['Judge'] }
          ] 
        },
        { 
          name: 'Compliance & Public Law', 
          specializations: [
            { name: 'Cyber Law', roles: ['Cyber Law Specialist'] },
            { name: 'Environmental Law', roles: ['Compliance Lawyer'] },
            { name: 'Taxation Law', roles: ['Tax Attorney'] }
          ] 
        }
      ]
    },
    {
      id: 'govt',
      domainName: 'Government Jobs',
      interviewTypes: ['General Aptitude', 'Essay Writing', 'Public Administration Case', 'Ethics & Integrity', 'Panel Interview'],
      categories: [
        { 
          name: 'Civil Services & Administration', 
          specializations: [
            { name: 'Public Policy Execution', roles: ['IAS Officer'] },
            { name: 'District Management', roles: ['State PSC Officer'] },
            { name: 'Revenue Collection', roles: ['IRS Officer'] }
          ] 
        },
        { 
          name: 'Public Law & Order', 
          specializations: [
            { name: 'Police Administration', roles: ['IPS Officer'] },
            { name: 'Vigilance Operations', roles: ['Vigilance Officer'] },
            { name: 'Border Security Control', roles: ['Border Security Commander'] }
          ] 
        },
        { 
          name: 'Public Infrastructure Systems', 
          specializations: [
            { name: 'Railway Administration', roles: ['Railway Officer'] },
            { name: 'State Transport Systems', roles: ['SSC Officer'] },
            { name: 'Public Works (PWD)', roles: ['PWD Executive Engineer'] }
          ] 
        }
      ]
    },
    {
      id: 'defence',
      domainName: 'Defence',
      interviewTypes: ['Intelligence & Reasoning', 'Officer Intelligence Rating', 'Group Task', 'Psychology Test', 'Personal Interview'],
      categories: [
        { 
          name: 'Combat & Field Operations', 
          specializations: [
            { name: 'Infantry Operations', roles: ['Army Officer'] },
            { name: 'Naval Warfare', roles: ['Navy Officer'] },
            { name: 'Tactical Aviation', roles: ['Air Force Officer'] }
          ] 
        },
        { 
          name: 'Intelligence & Security', 
          specializations: [
            { name: 'Counter-Insurgency', roles: ['Police Officer'] },
            { name: 'Cyber Warfare', roles: ['Intelligence Officer'] },
            { name: 'Military Intelligence Monitoring', roles: ['CRPF Officer'] }
          ] 
        },
        { 
          name: 'Logistics & Support', 
          specializations: [
            { name: 'Strategic Supply Chain', roles: ['Defense Logistics Manager'] },
            { name: 'Defense Procurement', roles: ['Procurement Officer'] },
            { name: 'Military Telecommunications', roles: ['Signal Corps Officer'] }
          ] 
        }
      ]
    },
    {
      id: 'ngo',
      domainName: 'NGO & Social Services',
      interviewTypes: ['Situational', 'Empathy & Ethics', 'Grant Writing Case', 'Field Experience Assessment', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Social Work', 
          specializations: [
            { name: 'Clinical Social Work', roles: ['Clinical Social Worker', 'Counselor'] },
            { name: 'Child & Family Services', roles: ['Child Welfare Specialist', 'Case Manager'] }
          ] 
        },
        { 
          name: 'NGO Operations', 
          specializations: [
            { name: 'Program Management', roles: ['Program Manager', 'Field Coordinator'] },
            { name: 'Fundraising & Grants', roles: ['Grant Writer', 'Fundraising Specialist'] }
          ] 
        },
        { 
          name: 'Public Health', 
          specializations: [
            { name: 'Community Outreach', roles: ['Community Mobilizer', 'Health Educator'] },
            { name: 'Policy & Advocacy', roles: ['Policy Advocate', 'Human Rights Campaigner'] }
          ] 
        }
      ]
    },
  
    // ---------------------------------------------------------
    // 6. CREATIVE, MEDIA, & LIFESTYLE
    // ---------------------------------------------------------
    {
      id: 'arts',
      domainName: 'Arts & Design',
      interviewTypes: ['Portfolio Review', 'Design Challenge', 'Creative Ideation', 'Tool Proficiency', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Visual & Graphic Arts', 
          specializations: [
            { name: 'UI/UX Visual Design', roles: ['UI Designer'] },
            { name: 'Brand Identity Systems', roles: ['Graphic Designer', 'Art Director'] },
            { name: 'Digital Illustration', roles: ['Illustrator'] }
          ] 
        },
        { 
          name: 'Fashion & Textile Design', 
          specializations: [
            { name: 'Apparel Styling', roles: ['Fashion Designer'] },
            { name: 'Textile Printing Patterns', roles: ['Textile Designer'] },
            { name: 'Fashion Merchandising', roles: ['Fashion Merchandiser'] }
          ] 
        },
        { 
          name: 'Animation & Media Arts', 
          specializations: [
            { name: '3D Character Modeling', roles: ['Animator'] },
            { name: 'VFX Rendering Processes', roles: ['VFX Artist'] },
            { name: 'Motion Graphics Creation', roles: ['Motion Graphics Designer'] }
          ] 
        }
      ]
    },
    {
      id: 'media',
      domainName: 'Media & Journalism',
      interviewTypes: ['Screen Test', 'Writing & Copy Editing', 'Reporting Case', 'Video Editing Practical', 'Media Ethics'],
      categories: [
        { 
          name: 'Broadcast Journalism', 
          specializations: [
            { name: 'TV News Anchor Operations', roles: ['News Anchor'] },
            { name: 'Radio Hosting Programs', roles: ['Radio Jockey'] },
            { name: 'Live Field Reporting', roles: ['News Reporter'] }
          ] 
        },
        { 
          name: 'Print & Digital Publishing', 
          specializations: [
            { name: 'Investigative Reporting', roles: ['Journalist'] },
            { name: 'Content Copywriting', roles: ['Content Writer'] },
            { name: 'Editorial Management', roles: ['Editor'] }
          ] 
        },
        { 
          name: 'Multimedia Production', 
          specializations: [
            { name: 'Video Editing Workflows', roles: ['Video Editor'] },
            { name: 'Photojournalism Capture', roles: ['Photojournalist'] },
            { name: 'Podcast Production', roles: ['Audio Producer'] }
          ] 
        }
      ]
    },
    {
      id: 'hospitality',
      domainName: 'Hospitality',
      interviewTypes: ['Trade Test', 'Front Office Simulation', 'Guest Handling', 'Revenue Management', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Hotel & Lodging Operations', 
          specializations: [
            { name: 'Front Office Management', roles: ['Receptionist'] },
            { name: 'Housekeeping Systems', roles: ['Hotel Manager'] },
            { name: 'Revenue Operations', roles: ['Front Office Manager'] }
          ] 
        },
        { 
          name: 'Food & Beverage (F&B)', 
          specializations: [
            { name: 'Culinary Arts', roles: ['Chef'] },
            { name: 'Restaurant Management', roles: ['F&B Manager'] },
            { name: 'Banqueting & Catering', roles: ['Catering Coordinator'] }
          ] 
        },
        { 
          name: 'Travel & Event Management', 
          specializations: [
            { name: 'Corporate Events', roles: ['Event Manager'] },
            { name: 'Tour Operations', roles: ['Travel Consultant'] },
            { name: 'Concierge Operations', roles: ['Concierge Specialist'] }
          ] 
        }
      ]
    },
    {
      id: 'realestate',
      domainName: 'Architecture & Real Estate',
      interviewTypes: ['Portfolio Review', 'Spatial Design Challenge', 'Property Valuation', 'Sales Simulation', 'HR', 'Behavioral'],
      categories: [
        { 
          name: 'Architecture & Interiors', 
          specializations: [
            { name: 'Architectural Design', roles: ['Chief Architect', 'Landscape Architect'] },
            { name: 'Interior Design', roles: ['Interior Designer', 'Space Planner'] }
          ] 
        },
        { 
          name: 'Real Estate Sales & Management', 
          specializations: [
            { name: 'Property Management', roles: ['Property Manager', 'Facility Manager'] },
            { name: 'Real Estate Brokering', roles: ['Real Estate Agent', 'Leasing Consultant'] }
          ] 
        }
      ]
    },
    {
      id: 'sports',
      domainName: 'Sports & Fitness',
      interviewTypes: ['Technical Assessment', 'Coaching Philosophy', 'Physical Fitness Test', 'Sports Management Case', 'Behavioral'],
      categories: [
        { 
          name: 'Coaching & Training', 
          specializations: [
            { name: 'Athletic Coaching', roles: ['Head Coach', 'Assistant Coach'] },
            { name: 'Fitness & Conditioning', roles: ['Fitness Trainer', 'Strength & Conditioning Coach'] }
          ] 
        },
        { 
          name: 'Sports Management', 
          specializations: [
            { name: 'Athletic Administration', roles: ['Athletic Director', 'Sports Facility Manager'] },
            { name: 'Sports Representation', roles: ['Sports Agent', 'Scout'] }
          ] 
        },
        { 
          name: 'Sports Science', 
          specializations: [
            { name: 'Sports Psychology', roles: ['Sports Psychologist', 'Performance Analyst'] },
            { name: 'Kinesiology & Biomechanics', roles: ['Biomechanist', 'Exercise Physiologist'] }
          ] 
        }
      ]
    }
  ];

  // ---------------------------------------------------------
  // 3. SEEDING THE MASTER DOMAIN OBJECT (1 Write)
  // ---------------------------------------------------------
  const domainPayload = {
    domains: interviewDomains, // Stores all 33 domains under a single 'domains' field map
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('interview_domain').doc('interview_domain').set(domainPayload);
  
  console.log('✅ Master Domain Document (33 Domains) seeded successfully into a single document.');
  console.log('🎉 Database seeding complete! (Writes minimized successfully)');
}

seedAbsoluteCompleteDatabase().catch(console.error);