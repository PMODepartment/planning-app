// ============================================================================
// EPCRCM — the shared EPC Risk and Control Matrix reference data
// ----------------------------------------------------------------------------
// ONE copy of the vocabulary and the scoring rules that the Risk Register and
// the Stakeholder Register both run on. The two workbooks these come from are
// literally the same template with one band swapped:
//
//   SLN101. OPS. Risk Register. 2025 07 01.xlsx
//   CSF101. OPS. Stakeholder Register. 2026 02 13.xlsx
//
// Every sheet below appears, byte-identical, in BOTH files: the 5-PMLC activity
// list, the EPC Risk Universe (category > sub-category), the Control Masterlist,
// "Criteria for Risk Assessment" and the priority heat map. Transcribing them
// into each module would guarantee the two drift — a sub-category added to the
// risk register's picker and not the stakeholder one, and then two registers
// that cannot be joined on category any more. So they live here, once.
//
// ⚠️ NOTHING IN HERE IS A SCORE. This file holds the scales, the grids and the
// lookups; the actual ratings live on the rows. Every derived value (importance,
// priority level, residual band, engagement approach) is a pure function
// exported below and is NEVER persisted — same rule the modules already follow
// for `rating`, and for the same reason: a stored derivation drifts out of step
// with the numbers it was made from the first time someone edits one of them.
//
// Loaded by: modules/risk-register, modules/stakeholder-map.
// ============================================================================

window.EPCRCM = (function () {

  // =========================================================================
  // 1) THE 5-PMLC ACTIVITIES — the register's spine (cols A–E of both sheets)
  // -------------------------------------------------------------------------
  // A risk or a stakeholder is registered AGAINST a business process, not
  // free-floating; the sheet is read activity by activity and the process owner
  // answers for their own block. `subs` are the sub-processes actually used
  // under each activity in the source registers.
  // =========================================================================
  var ACTIVITIES = [
    { no: 1, name: 'OPPORTUNITY MANAGEMENT',
      objective: 'Ensure effective and efficient coordination between Bids and Contracts department with the Management',
      description: 'It refers to the coordination of Bids and Contracts department with the Management (CEO and EVP) for the decision to bid on a prospective project',
      subs: ['Opportunity Management'] },
    { no: 2, name: 'BID PREPARATION',
      objective: 'Ensure complete, timely preparation and submission of reliable, and competitive bid documentations (Technical / Financial)',
      description: 'This process shall start once Management agrees to participate in the Bid invited by the Client.',
      subs: ['Bids Preparation'] },
    { no: 3, name: 'NEGOTIATION AND CLOSING',
      objective: 'The technical and commercial terms shall be discussed and negotiated thoroughly, so that both parties can conclude the awarding of the project.',
      description: 'This process will start if the Client has shortlisted Megawide as the top 3 or only contractor to take the project. Once both parties agreed, a simple Term Sheet or Notice to Proceed (NTP) can be signed or issued by Client to capture all the agreements from Technical to Commercial.',
      subs: ['Negotiation and Closing'] },
    { no: 4, name: 'POST AWARD HANDOVER',
      objective: 'Ensure complete, accurate, timely, and approved handover of documents to QA team according to the standard handover checklist',
      description: 'This process will start once the Term Sheet or NTP is issued and accepted by Megawide. The final design drawing shall start the commencement.',
      subs: ['Post Award Handover'] },
    { no: 5, name: 'CONTRACT MANAGEMENT',
      objective: 'Ensure timely approval of contract by the CEO upon agreement w/ client of contract conditions, scope of work, and other relevant documents',
      description: 'It refers to the finalizing of the contract with the Client and the application of required bond / insurances and operating and construction permits.',
      subs: ['Contract Management'] },
    { no: 6, name: 'DESIGN DEVELOPMENT',
      objective: 'Finalisation of Design for D&B projects to ensure time and budget are achieved — Design Criteria, Conceptual Design, Value Engineering, Preliminary Cost Estimate, SD1, SD2, FCD, DED, CSD, ISD, Detailed Drawings and Materials Specification List properly defined, reviewed and approved to ensure the most cost-efficient construction methodology.',
      description: 'Design development starts from the Concept Design and Schematic Design 1 when in bidding stage (INITIATION). After the awarding of project, it will further develop to Schematic Design 2 to For Construction Drawings (FCD).',
      subs: ['Design Development'] },
    { no: 7, name: 'PREPARATION OF PROJECT EXECUTION PLAN (PEP)',
      objective: 'The PEP is the governing document that establishes the means to execute, monitor and control projects. The plan serves as the main communication vehicle to ensure that everyone is aware and knowledgeable of project objectives and how they will be accomplished.',
      description: 'A compilation of different processes for the completion of the Project Execution Plan (Manual): the Technical Plan (Design & Material Specification), the Commercial Plan (IBB, BCB, Work Package & Cashflow) and the Operational Plan (Schedule / Work Program).',
      subs: ['Preparation of Project Execution Plan (PEP)'] },
    { no: 8, name: 'PROCUREMENT',
      objective: 'Procurement Process shall ensure that goods, works, and services acquired by Megawide are obtained in a timely manner, at the most competitive price and are of the required quality and quantity',
      description: 'This refers to various sub processes of Procurement that focus on the strategic way of acquiring the goods, services and work that is vital to the company.',
      subs: ['Procurement'] },
    { no: 9, name: 'MOBILIZATION / OPERATIONS',
      objective: 'Mobilization aims to define the preparatory work and operations necessary for the movement of personnel, supplies and incidentals to the project site, for the establishment of all facilities necessary for work on the project, and for all other work and operations which must be performed, or costs incurred, prior to beginning work on the various items on the project site.',
      description: 'Mobilization includes obtaining any permits needed and project-specific bonds, and the construction of temporary ramps and access ways, temporary roads, grading, temporary fencing, and the necessary preparatory work required to allow for the safe and stable movement of all vehicles required to construct the improvements outlined in the Construction Documents.',
      subs: ['Mobilization', 'Operation'] },
    { no: 10, name: 'WAREHOUSE MANAGEMENT',
      objective: 'Ensure satisfactory receipt of goods; rapid delivery of goods requested; accurate account of inventory movement and balance; complete and accurate records of the inventory situation; adequate storage conditions; safety and security of the goods; inventory maintained per the Layout & Storage Plan.',
      description: 'This refers to the various processes related to maintaining and controlling the Central and Site Warehouses.',
      subs: ['Warehouse Management'] },
    { no: 11, name: 'QESHS REVIEW / AUDIT',
      objective: 'The primary objective of the QESHS Audit is to discover and evaluate the need for improvement, verify compliance and effectiveness of the implemented Quality, Safety and Environmental Management Systems.',
      description: 'It refers to the monitoring and inspection of work and materials to be used, the execution of work especially on the safety and welfare of the employees, and the security of the workplace to ensure quality output is being delivered.',
      subs: ['QESHS Review/Audit'] },
    { no: 12, name: 'BILLINGS AND COLLECTION',
      objective: "This process aims to ensure that progress billing and collection is accurately, timely, and efficiently performed corresponding to the project's progress or as stipulated in the Contractual Agreement, to ensure that Megawide is adequately funded throughout the duration of the project.",
      description: 'It refers to the processes of monitoring, evaluating and delivering invoices to our Clients and claiming payment for the services rendered by Megawide. This shall also include goods supplied and/or services rendered and received from the vendors.',
      subs: ['Billings and Collection'] },
    { no: 13, name: 'VARIATION ORDER',
      objective: 'This process aims to establish that all Change Orders by the Client and Megawide have been identified, documented, reviewed and approved prior to acceptance by either party, and to prevent informal project variation orders that can significantly impact project quality, cost, and timeline.',
      description: 'It refers to the processes involved with the alteration to the scope of works in the agreed construction contract in the form of addition, substitution or omission.',
      subs: ['Variation Order'] },
    { no: 14, name: 'PROJECT PERFORMANCE REVIEW',
      objective: "This process is used to gauge, compare, and analyze the performance of work in progress against the baseline of the project. This helps identify how each project performs, to give early warning signs of problems that might get in the way of achieving the project's success.",
      description: 'Program / Project Management Review — a monthly discussion among heads of EPC together with Operations Head on pressing issues and concerns in project sites.',
      subs: ['Project Performance Review'] },
    { no: 15, name: 'PROGRAM PERFORMANCE REVIEW',
      objective: 'Program management is the process of planning, monitoring, controlling and evaluating several projects. All of the projects are combined into a portfolio in a program management office, which monitors how each project may be linked or related, the costs of each project and the risks involved with each project.',
      description: 'Operations — a monthly review by Operations Head on project health to management level. Head Office — a monthly review by Department Head on department issues to management.',
      subs: ['Program/Project Management Review'] },
    { no: 16, name: 'EPC FUNCTIONAL MEETINGS',
      objective: 'This process aims to discuss, monitor, and address risks, issues, dependencies, and improvement opportunities among EPC Functions related to or impacting Operations and EPC Projects.',
      description: 'Regular functional meetings whose minutes are submitted to PMO, with a pre-defined agenda and allotted time per presentation by the concerned Department Heads.',
      subs: ['EPC Functional Meetings'] },
    { no: 17, name: 'PUNCHLIST CLOSE OUT',
      objective: 'This process ensures that all tasks and items needing to be fixed or completed in a construction project have been finalized and concluded, making sure no unfinished work or existing defects remain open prior to hand over to Client.',
      description: 'It refers to the process of documenting and inspecting the works that have not conformed with the contract specifications prior to project completion.',
      subs: ['Punchlist Close Out'] },
    { no: 18, name: 'TESTING AND COMMISSIONING',
      objective: 'This is the process of assuring that all systems and components of a building are designed, installed, tested, operated and maintained according to the operational requirements of the Client, guaranteeing operability in terms of performance, reliability, safety and information traceability.',
      description: 'It refers to the processes of planning, documenting, scheduling, testing, and training.',
      subs: ['Testing and Commissioning'] },
    { no: 19, name: 'PROJECT CLOSE-OUT',
      objective: 'The Project Closeout Report is documented to identify the variances from the baseline plans in terms of project performance, schedule, and cost — stating the planned and actual figures, the variances and, most importantly, an explanation of why such variances exist.',
      description: 'The final reconciliation and reporting of final expenses and activities related to Vendor, Client, Inventory and Asset.',
      subs: ['Project Close-Out Report (Technical/Financial)'] },
    { no: 20, name: 'RELEASE OF EMPLOYEES',
      objective: 'This process aims to ensure that all applicable policies, regulations, and procedures have been adhered to when releasing employees after the project close out, preventing untoward employee termination risks.',
      description: 'It involves the process of transferring personnel to other projects and terminating personnel based on performance.',
      subs: ['Release of Employees'] }
  ];

  function activityByNo(no) {
    no = parseInt(no, 10);
    for (var i = 0; i < ACTIVITIES.length; i++) if (ACTIVITIES[i].no === no) return ACTIVITIES[i];
    return null;
  }
  function activityByName(nm) {
    if (!nm) return null;
    var k = String(nm).trim().toUpperCase();
    for (var i = 0; i < ACTIVITIES.length; i++) if (ACTIVITIES[i].name.toUpperCase() === k) return ACTIVITIES[i];
    return null;
  }

  // =========================================================================
  // 2) THE EPC RISK UNIVERSE — Risk / Stakeholder Category > Sub-Category
  // -------------------------------------------------------------------------
  // Sheet "EPC Project Risk Categorization" (risk file) / "Glossary of Terms"
  // (stakeholder file). L1 = the 10 categories, L2 = sub-categories.
  // Descriptions are the sheet's own, verbatim where it gave one.
  // =========================================================================
  var CATEGORIES = [
    { name: 'Commercial', subs: [
      { name: 'Bid Price', desc: 'The bid price submitted to the client before negotiations' },
      { name: 'IBB',       desc: 'The agreed contract amount with the client' },
      { name: 'BCB',       desc: 'This is the approved Budget for the project' },
      { name: 'Others',    desc: '' } ] },
    { name: 'Contracts', subs: [
      { name: 'Client Contract',       desc: 'Client contract signed by both parties' },
      { name: 'Joint Venture Contract',desc: 'For projects that we have joint ventures, indicate risks with our partners' },
      { name: 'Others',                desc: '' } ] },
    { name: 'Technical', subs: [
      { name: 'Design Drawings',     desc: 'CD, SD1, SD2, FCD, etc.' },
      { name: 'Specifications',      desc: '' },
      { name: 'Technical Submittals', desc: '' },
      { name: 'Others',              desc: '' } ] },
    { name: 'Stakeholders', subs: [
      { name: 'LGUs',                    desc: 'Issues regarding local barangay, municipality etc.' },
      { name: 'Customer',                desc: 'Client concerns' },
      { name: 'Construction Management', desc: 'If there is a construction management group' },
      { name: 'Others',                  desc: '' } ] },
    { name: 'Organizational', subs: [
      { name: 'Leadership',                desc: 'Site leadership' },
      { name: 'Project Team Compatibility', desc: 'Project team dynamics' },
      { name: 'Training',                  desc: 'Risks associated with gaps in training' },
      { name: 'Others',                    desc: '' } ] },
    { name: 'Procurement', subs: [
      { name: 'Vendors',      desc: 'Suppliers / Subcontractors' },
      { name: 'Work Package', desc: '' },
      { name: 'PO / JO',      desc: 'Awarding and Issuance of PO / JO' },
      { name: 'Others',       desc: '' } ] },
    { name: 'Operational', subs: [
      { name: 'Quality',                desc: 'Quality Control and Quality Assurance concerns' },
      { name: 'Safety',                 desc: 'Safety related concerns and risks' },
      { name: 'Environmental / Health', desc: 'Environmental and health related risks' },
      { name: 'Schedule',               desc: 'Risks associated with changes / delays in schedule' },
      { name: 'Manpower',               desc: 'Manpower related risks (staff, workers etc.)' },
      { name: 'Others',                 desc: '' } ] },
    { name: 'Project Management', subs: [
      { name: 'Planning',      desc: '' },
      { name: 'Communication', desc: 'Issues in internal and external communications' },
      { name: 'Project Mgt Systems (Protocol / Procedure)', desc: 'Issues in the procedures and protocols' },
      { name: 'Compliance',    desc: 'Non compliance of the project team' },
      { name: 'Others',        desc: '' } ] },
    { name: 'Regulatory', subs: [
      { name: 'Permits',   desc: '' },
      { name: 'Licensing', desc: '' },
      { name: 'Others',    desc: '' } ] },
    { name: 'Others', subs: [
      { name: 'Others', desc: '' } ] }
  ];

  var CATEGORY_NAMES = CATEGORIES.map(function (c) { return c.name; });

  // ⚠️ Tolerant lookup. The source register writes "ProjectManagement" (no space)
  // in some rows and "Technical " (trailing space) in others; older rows in this
  // app's own table carry the pre-RCM vocabulary ("Schedule", "Financial"). A
  // strict match would silently return an empty sub-category picker on those
  // rows, which reads as "this category has no sub-categories" rather than
  // "your value does not match the taxonomy".
  function subsOf(cat) {
    if (!cat) return [];
    var k = String(cat).replace(/\s+/g, '').toLowerCase();
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].name.replace(/\s+/g, '').toLowerCase() === k) return CATEGORIES[i].subs;
    }
    return [];
  }
  function subNamesOf(cat) { return subsOf(cat).map(function (s) { return s.name; }); }

  // =========================================================================
  // 3) RATING CRITERIA — sheet "Criteria for Risk Assessment"
  // =========================================================================

  // Table 1A — PROBABILITY RATING.
  // ⚠️ `rate` IS TRANSCRIBED VERBATIM AND IT IS BACKWARDS IN THE SOURCE: the
  // workbook prints "> 70%" against Very Low and "0% – 10%" against Very High.
  // Every other column of the row (the qualitative label, the rating number, the
  // two descriptor bullets) reads the right way round, and the register's actual
  // scores follow the LABEL, not the percentage — so the percentages are a
  // column that was filled bottom-up by mistake. Kept as-is because this is a
  // transcription of a controlled document, and flagged in the Criteria tab
  // rather than silently "fixed" here, where nobody would ever see the change.
  var PROBABILITY = [
    { rating: 1, label: 'Very Low',  rate: '> 70%',     bullets: ['The risk event could possibly occur within the life of the project.', 'The risk event has not occurred in similar projects.'] },
    { rating: 2, label: 'Low',       rate: '51% – 70%', bullets: ['The risk event could possibly occur in one of the phases of the project.', 'The risk event has occurred once in similar projects.'] },
    { rating: 3, label: 'Medium',    rate: '31% – 50%', bullets: ['The risk event could possibly occur in 2 – 3 phases of the project.', 'The risk event has occurred 2 – 3 times in a similar project.'] },
    { rating: 4, label: 'High',      rate: '11% – 30%', bullets: ['The risk event could possibly occur within a 1-year period.', 'The risk event has occurred several times in a similar project.'] },
    { rating: 5, label: 'Very High', rate: '0% – 10%',  bullets: ['The risk event could possibly occur within a 6-month period.', 'The risk event has occurred several times in a similar project in less than a year.'] }
  ];

  // Table 1B — IMPACT RATING. Three yardsticks, any one of which sets the score.
  var IMPACT = [
    { rating: 1, label: 'Very Low',  cost: '0.0100% – 0.0600%', time: '< 0.2%', quality: '< 1 day' },
    { rating: 2, label: 'Low',       cost: '0.0700% – 0.1200%', time: '< 0.4%', quality: '< 2 days' },
    { rating: 3, label: 'Medium',    cost: '0.1300% – 0.1800%', time: '< 0.6%', quality: '< 3 days' },
    { rating: 4, label: 'High',      cost: '0.1900% – 0.2400%', time: '< 0.8%', quality: '< 4 days' },
    { rating: 5, label: 'Very High', cost: '0.2500% – 0.3000%', time: '> 2%',   quality: '> 5 days' }
  ];

  // Table 1C — DEGREE OF CONTROL, used by the RESIDUAL band on both registers.
  var CONTROL = [
    { rating: 1, label: 'Avoidable', desc: 'Fully controllable and can be fully avoided by the company',
      bullets: ['existing control / mitigating measures are proven effective',
                'risk source can be eliminated by the company, i.e. process can be modified / transferred / relocated; material can be substituted'] },
    { rating: 2, label: 'Highly controllable', desc: 'Highly controllable by the company and partly avoidable through selected risk mitigation actions taken',
      bullets: ['existing control / mitigating measures are optimum as practicable',
                "risk source is within the company's control, i.e. process is performed on-site; material is supplied / decided by the company"] },
    { rating: 3, label: 'Moderately controllable', desc: 'Slightly controllable by the company but can be influenced by the company to a large degree',
      bullets: ['existing control / mitigating measures are adequate but can still be improved',
                'risk source is originating externally, i.e. process is performed by external provider off-site; material is supplied / decided by the customer'] },
    { rating: 4, label: 'Uncontrollable', desc: 'Uncontrollable by the company but can be influenced by the company to a small degree',
      bullets: ['existing control / mitigating measures are barely adequate',
                'company has no authority over risk source but risk source is a relevant interested party'] },
    { rating: 5, label: 'Highly uncontrollable', desc: 'Uncontrollable by the company and cannot be influenced by the company',
      bullets: ['no existing control / mitigating measures',
                'company has no authority over risk source and risk source is not a relevant interested party'] }
  ];

  // Table 1D — RISK TREATMENT PLANS (the doctrine behind the four response terms)
  var TREATMENTS = [
    { term: 'Assume / Accept', desc: 'Acknowledge the existence of a particular risk and make a deliberate decision to accept it without engaging in special efforts to control it.' },
    { term: 'Avoid',           desc: 'Adjust programme requirements or constraints to eliminate or reduce the risk. This adjustment could be accommodated by a change in funding, schedule or technical requirements.' },
    { term: 'Control / Mitigate', desc: 'Implement actions to minimize the impact / consequence or likelihood of the risk. Help control risks by performing analyses of various mitigation options.' },
    { term: 'Transfer / Share',   desc: 'Reassign organizational accountability, responsibility and authority to another stakeholder willing to accept the risk.' },
    { term: 'Watch / Monitor',    desc: 'Monitor the environment for changes that affect the nature and/or the impact of the risk.' }
  ];

  // The four terms the register's own Response column actually offers
  // (sheet "Dropdown List", B48:B52).
  var RESPONSES = ['Tolerate / Accept', 'Transfer / Share', 'Terminate / Avoid', 'Treat / Mitigate'];

  // =========================================================================
  // 4) CONTROL MASTERLIST — sheet "Control Masterlist"
  // -------------------------------------------------------------------------
  // ⚠️ NOT the same field as the response term above, even though the sheet
  // labels both "Control Category". This is the KIND of control (a policy? a
  // review? an audit?); the response term is what you decided to do about the
  // risk. `controls` are the sheet's own key controls, offered as suggestions
  // when a planner writes a control description.
  // =========================================================================
  var CONTROL_TYPES = [
    { name: 'Framework, Policy, Procedure Manual',
      desc: 'Set of statements and documents that provide direction and guidance (within the organization) towards attainment of objectives',
      controls: ['Go-or-No-Go decision matrix',
        'Defined list of Bid Documents (both "Design Only" and "Design and Build")',
        'Clarificatory and coordination meeting/s with client (with proper documentation)',
        'Established standard leadtime',
        'Finalization of contract is a pre-requisite process of mobilization based on the 5 PMLC Framework',
        'Established standard leadtime for review process by Legal Department',
        'Defined design development process from preparation to approval including its responsibility matrix (5PMLC)',
        'Defined design criteria for Qualification & Exclusion / Architectural / Structural / Landscape & public work / MEPF',
        'Defined process of review and approval of client',
        'Defined attendees in the review of PEP per PM-PLN004',
        'Presence of Milestone-based PEP Completion List / Plan',
        'Defined timeline for presentation, review and approval of PEP (approved within 5% of POC) per PM-PLN004 (5.1)',
        'Defined list of PEP requirements and milestone of submission and timeline',
        'Established evaluation & selection process',
        'Established vendor accreditation process',
        'Scheduled presentation and communication with client requirements',
        'Defined mobilization phases (Initial / Full)',
        'Defined Goods / Inventory Transfer process flow',
        'Defined leadtime for review and approval of inventory transfer',
        'Documented and disseminated House Rules for MCC Subcons',
        '5PMLC cascading by TQM',
        'Defined billing and collection process flow',
        'Define responsibilities from preparation, review, and approval of Variation Orders',
        'Defined minimum contents for Financial and Technical Close-out Report including responsibility',
        'Defined presentation and approval procedures',
        'Defined recommendation and approval process flow for employee transfer to other project'] },
    { name: 'Document Preparation, Review and Approval',
      desc: 'A process in which a document or set of documents will be subjected to (1) checking of completeness and accuracy by a superior (reviewer); and (2) approval by department head for release or issuance',
      controls: ['Review process on potential projects and information collection of client',
        'Go-or-No-Go Review and Approval by CEO / COO',
        'Review of Bid Documents by Operations Head and EVP',
        'Defined management review and approval process',
        'Defined review process on contract documents by Legal, Operations, Bids and Contracts Teams',
        'Review process by VP-Engineering of designs and approval process by the Client per PM-TMD001 and PM-TMD002',
        'PEP shall be approved within 5% POC, otherwise all materials and job requests shall be put on hold',
        'Accomplishment of Goods Receipt Purchase Order (GRPO)',
        'Accomplished Inventory Transfer Form',
        'Timely accomplishment of Change Order Monitoring Log',
        'Timely accomplishment of Extension of Time Monitoring Log',
        'Defined lead time of preparation, rectification, and closeout of punchlist items (internal and external)',
        'Project Completion Report (PCR) presented up to CEO and Head of Construction for approval',
        'Close out inventory summary as part of the Financial Close-out Report',
        'Accounts Payable Retention and Certificate of Completion (COC) Endorsement',
        'Accounts Payable Summary with Aging Close Out',
        'Accomplishment of employee recommendation form'] },
    { name: 'Management Review (Meetings)',
      desc: 'A formal, structured meeting which involves top and mid-level management to discuss certain agenda and takes place at regular intervals throughout the year',
      controls: ['Scheduled Monthly Committee-based Management Review Meeting',
        'Management review and monitoring',
        'Management review, monitoring, and approval process of preparation of work package',
        'Management review and approval process',
        'Define regular monthly schedule meeting for Project Performance Review',
        'Defined minimum attendees for monthly project performance review',
        'Minutes of regular meetings of various EPC functions / departments submitted to PMO every Monday',
        'Pre-defined meeting agenda with allotted time per presentation by concerned Department Heads',
        'Timely accomplishment of Site Team Weekly Minutes of the Meeting template'] },
    { name: 'Independent Review or Audit',
      desc: 'A formal process performed by a party independent from the management and process owner, which aims to provide reasonable assurance as to efficiency and effectiveness of processes',
      controls: ['Periodic HSE Audit', 'Periodic compliance review'] },
    { name: 'Physical Inspection / Validation',
      desc: 'Actual observation being done to check and validate existence of a particular event or document',
      controls: [] },
    { name: 'Quality Control',
      desc: 'Procedure or set of procedures intended to ensure that processes, products, services, documents and outputs adhere to a defined set of quality criteria or meet the requirements of the client',
      controls: ['Regular compliance testing and review',
        'Define receiving process flow including material inspection',
        'Issuance of Corrective Action Report / Nonconformity Report and implementation and monitoring of corrective actions',
        'Defined Project Quality Plan Audit Template',
        'Defined test procedures and various forms'] },
    { name: 'Control Self-Assessment (Checklist, defined Job Roles)',
      desc: "A technique that allows managers and work teams directly involved in business units, functions or processes to participate in assessing the organization's risk management and control processes",
      controls: ['5PMLC Tracker Schedule', 'Bid Documents Handover Checklist', 'Monitoring procedure/s'] }
  ];
  var CONTROL_TYPE_NAMES = CONTROL_TYPES.map(function (c) { return c.name; });
  function controlsOf(type) {
    for (var i = 0; i < CONTROL_TYPES.length; i++) if (CONTROL_TYPES[i].name === type) return CONTROL_TYPES[i].controls;
    return [];
  }

  // =========================================================================
  // 5) THE GRIDS — every derived priority in both registers
  // =========================================================================

  var PRIORITIES = ['1st Priority', '2nd Priority', '3rd Priority', '4th Priority'];

  // ---- Risk: "Table 2 – RISK ASSESSMENT HEAT MAP" (5 × 5) -----------------
  // RISK_GRID[probability][impact]. Read straight off the sheet, rows
  // probability 5 → 1 and columns impact 1 → 5.
  //
  // ⚠️ NOT a band on impact × probability, so a threshold on the product would be
  // wrong. The demonstration is a product of 4, which the sheet answers three
  // different ways: impact 2 × probability 2 is 4th Priority, while impact 1 ×
  // probability 4 and impact 4 × probability 1 are both 3rd. The grid is a
  // lookup and must stay one.
  //
  // (An earlier version of this comment cited (5,1) vs (1,5) as the example and
  // claimed they land on 3rd and 4th. They do not — the sheet gives 3rd for
  // both, checked against the workbook. The table below was always right; only
  // the example was wrong. Asserted in modules/risk-register/test-rcm.js so the
  // claim and the data cannot drift apart again.)
  var RISK_GRID = {
    5: { 1: '3rd Priority', 2: '2nd Priority', 3: '2nd Priority', 4: '1st Priority', 5: '1st Priority' },
    4: { 1: '3rd Priority', 2: '3rd Priority', 3: '2nd Priority', 4: '2nd Priority', 5: '1st Priority' },
    3: { 1: '4th Priority', 2: '3rd Priority', 3: '3rd Priority', 4: '2nd Priority', 5: '2nd Priority' },
    2: { 1: '4th Priority', 2: '4th Priority', 3: '3rd Priority', 4: '3rd Priority', 5: '2nd Priority' },
    1: { 1: '4th Priority', 2: '4th Priority', 3: '4th Priority', 4: '3rd Priority', 5: '3rd Priority' }
  };
  function r5(v) { var x = parseInt(v, 10); return (x >= 1 && x <= 5) ? x : null; }
  function r4(v) { var x = parseInt(v, 10); return (x >= 1 && x <= 4) ? x : null; }

  function riskPriority(impact, probability) {
    var i = r5(impact), p = r5(probability);
    if (!i || !p) return '';
    return RISK_GRID[p][i];
  }

  // ---- Stakeholder: the 4 × 4 priority grid the register's own formula uses --
  // ('Risk Assessment Criteria - old'!D328:H332 — the range the live
  // Priority Level cell INDEX/MATCHes into.) STK_GRID[influence][impact].
  var STK_GRID = {
    4: { 1: '3rd Priority', 2: '2nd Priority', 3: '1st Priority', 4: '1st Priority' },
    3: { 1: '3rd Priority', 2: '2nd Priority', 3: '2nd Priority', 4: '1st Priority' },
    2: { 1: '3rd Priority', 2: '3rd Priority', 3: '2nd Priority', 4: '2nd Priority' },
    1: { 1: '4th Priority', 2: '3rd Priority', 3: '3rd Priority', 4: '3rd Priority' }
  };
  function stkPriority(impact, influence) {
    var i = r4(impact), f = r4(influence);
    if (!i || !f) return '';
    return STK_GRID[f][i];
  }

  // Response Category (stakeholder col Q) = LOOKUP of the priority level.
  // ⚠️ This mapping is NOT the risk register's and NOT the Mendelow grid's: the
  // stakeholder workbook pairs 2nd with Keep Informed and 3rd with Keep
  // Satisfied (Criteria for Assessment!E265:F268). The BD map this module was
  // originally built from had those two the other way round; the OPS register
  // governs now.
  var STK_RESPONSE = { '1st Priority': 'Manage Closely', '2nd Priority': 'Keep Informed',
                       '3rd Priority': 'Keep Satisfied', '4th Priority': 'Monitor (Minimum Effort)' };
  function stkResponseCategory(priority) { return STK_RESPONSE[priority] || ''; }

  // Stakeholder Management Approach (col AF) = "Table 2 – IMPACT / INFLUENCE
  // MAP", i.e. the classic Mendelow power/interest grid: high impact splits on
  // influence into Keep Satisfied vs Manage Closely, low impact into Monitor vs
  // Keep Informed. MENDELOW[impact][influence].
  //
  // ⚠️ THIS DELIBERATELY DISAGREES WITH stkResponseCategory() ON SOME CELLS,
  // because the workbook does. Impact 3 × influence 3 is 2nd Priority, which the
  // lookup turns into "Keep Informed", while Table 2 puts that same cell in
  // "Manage Closely". They are two different columns of the sheet, computed two
  // different ways, and both are shown — collapsing them into one answer would
  // be inventing a number the source does not give.
  //
  // ⚠️ And the register's own hand-typed Approach column follows NEITHER
  // consistently: at (3,3) it reads "Keep Informed" on 23 rows and "Manage
  // Closely" on 2. That is why a stored `mgmt_approach` overrides the derived
  // value rather than being corrected to it — the planner's judgement on a named
  // person is worth more than a grid, and the grid is the default, not the truth.
  //
  // (An earlier version of this comment said the map gives "Keep Satisfied" at
  // (3,3). It gives "Manage Closely" — checked against Table 2 in the workbook.
  // The map below was always right; only the example was wrong.)
  var MENDELOW = {
    4: { 1: 'Keep Satisfied', 2: 'Keep Satisfied', 3: 'Manage Closely', 4: 'Manage Closely' },
    3: { 1: 'Keep Satisfied', 2: 'Keep Satisfied', 3: 'Manage Closely', 4: 'Manage Closely' },
    2: { 1: 'Monitor (Minimum Effort)', 2: 'Monitor (Minimum Effort)', 3: 'Keep Informed', 4: 'Keep Informed' },
    1: { 1: 'Monitor (Minimum Effort)', 2: 'Monitor (Minimum Effort)', 3: 'Keep Informed', 4: 'Keep Informed' }
  };
  function stkApproach(impact, influence) {
    var i = r4(impact), f = r4(influence);
    if (!i || !f) return '';
    return MENDELOW[i][f];
  }
  var APPROACHES = ['Manage Closely', 'Keep Satisfied', 'Keep Informed', 'Monitor (Minimum Effort)'];

  // ---- Residual: "Table 3A – RISK RATING" ---------------------------------
  // Score = severity × occurrence × degree-of-control (1..125).
  function residualScore(impact, possibility, detectability) {
    var a = r5(impact), b = r5(possibility), c = r5(detectability);
    if (!a || !b || !c) return null;
    return a * b * c;
  }
  function residualBand(score) {
    if (score == null) return { label: '', cls: '', action: '' };
    if (score >= 65) return { label: 'High', cls: 'rcm-res-high', action: 'Risk is not acceptable; needs a risk treatment plan aimed at avoiding the risk / eliminating the risk source. Stop or suspend work until the plan is implemented.' };
    if (score >= 28) return { label: 'Moderate', cls: 'rcm-res-mod', action: 'Risk can be tolerated but needs a risk treatment action plan aimed at reducing the likelihood and/or mitigating the adverse impact. Transfer / share the risk.' };
    return { label: 'Low', cls: 'rcm-res-low', action: 'Risk is acceptable, no further action needed. Take the risk in order to pursue an opportunity.' };
  }

  // ---- Priority presentation ---------------------------------------------
  // Semantic, fixed in both themes (a priority colour is data, not chrome).
  function priorityClass(p) {
    return { '1st Priority': 'rcm-p1', '2nd Priority': 'rcm-p2',
             '3rd Priority': 'rcm-p3', '4th Priority': 'rcm-p4' }[p] || '';
  }
  function priorityShort(p) { return p ? p.replace(' Priority', '') : ''; }
  function priorityRank(p) { var i = PRIORITIES.indexOf(p); return i < 0 ? 99 : i + 1; }

  // =========================================================================
  // 6) Small render helpers — the Criteria tab is the same table markup in both
  //    modules, so it is built here rather than twice.
  // =========================================================================
  function esc(s) { return window.Fmt ? Fmt.esc(s) : String(s == null ? '' : s); }

  function tbl(caption, headers, rows, note) {
    var h = '<div class="rcm-tblwrap"><div class="rcm-tbl-cap">' + esc(caption) + '</div>' +
      '<table class="rcm-tbl"><thead><tr>' +
      headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) {
          // Column 0 carries the row's own label on a phone, where the table
          // scrolls horizontally inside its wrapper rather than reflowing.
          return '<td' + (i === 0 ? ' class="rcm-tbl-k"' : '') + '>' + c + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>' + (note ? '<div class="rcm-tbl-note">' + note + '</div>' : '') + '</div>';
    return h;
  }

  // The four criteria tables shared by both registers.
  function probabilityTableHTML() {
    return tbl('Table 1A — Probability rating', ['Rating', 'Qualitative', 'Probability rate', 'Description'],
      PROBABILITY.map(function (p) {
        return ['<strong>' + p.rating + '</strong>', esc(p.label), esc(p.rate),
          '<ul class="rcm-bul">' + p.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>'];
      }),
      '⚠️ The <em>Probability rate</em> column is transcribed verbatim from the controlled document, where it runs backwards ' +
      '(&gt;70% against Very Low, 0–10% against Very High). Score from the qualitative descriptors, which the register itself follows.');
  }
  function impactTableHTML() {
    return tbl('Table 1B — Impact rating', ['Rating', 'Qualitative', 'Cost (% of total project cost)', 'Time (% of project schedule)', 'Quality (lost time)'],
      IMPACT.map(function (p) {
        return ['<strong>' + p.rating + '</strong>', esc(p.label), esc(p.cost), esc(p.time), esc(p.quality)];
      }), 'Any one of the three yardsticks may set the score — take the highest it justifies.');
  }
  function controlTableHTML() {
    return tbl('Table 1C — Degree of control (residual assessment)', ['Rating', 'Qualitative', 'Description'],
      CONTROL.map(function (p) {
        return ['<strong>' + p.rating + '</strong>', esc(p.label),
          esc(p.desc) + '<ul class="rcm-bul">' + p.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>'];
      }));
  }
  function treatmentTableHTML() {
    return tbl('Table 1D — Risk treatment plans', ['Term', 'Description'],
      TREATMENTS.map(function (t) { return ['<strong>' + esc(t.term) + '</strong>', esc(t.desc)]; }));
  }
  function residualBandTableHTML() {
    return tbl('Table 3A — Residual risk rating (severity × occurrence × degree of control)', ['Band', 'Score', 'Action'],
      [['<span class="rcm-pill rcm-res-low">Low</span>', '1 – 27', esc(residualBand(1).action)],
       ['<span class="rcm-pill rcm-res-mod">Moderate</span>', '28 – 64', esc(residualBand(30).action)],
       ['<span class="rcm-pill rcm-res-high">High</span>', '65 – 125', esc(residualBand(70).action)]]);
  }

  // The universe (category > sub-category), as a reference table.
  function universeTableHTML() {
    var rows = [];
    CATEGORIES.forEach(function (c, ci) {
      c.subs.forEach(function (s, si) {
        rows.push([si === 0 ? '<strong>' + (ci + 1) + '. ' + esc(c.name) + '</strong>' : '',
                   esc(s.name), esc(s.desc)]);
      });
    });
    return tbl('EPC Risk Universe — category › sub-category', ['Category', 'Sub-category', 'Description'], rows);
  }
  function controlMasterlistHTML() {
    var rows = [];
    CONTROL_TYPES.forEach(function (t) {
      rows.push(['<strong>' + esc(t.name) + '</strong>', '<em>' + esc(t.desc) + '</em>']);
      if (!t.controls.length) rows.push(['', '<span class="rcm-muted">— no key controls listed —</span>']);
      t.controls.forEach(function (k) { rows.push(['', esc(k)]); });
    });
    return tbl('EPC Control Masterlist — key controls per category', ['Control category', 'Key control'], rows,
      'Sample control measures for the risks identified. Pick a control category on a risk and these become suggestions for its control description.');
  }

  // A grid renderer both registers use for their heat map view. `cells(x, y)`
  // returns the inner HTML for one cell; `cls(x, y)` its extra classes.
  function gridHTML(o) {
    var xMax = o.xMax, yMax = o.yMax;
    var h = '<table class="rcm-grid"><tbody>';
    for (var y = yMax; y >= 1; y--) {
      h += '<tr>';
      if (y === yMax) h += '<th class="rcm-ax rcm-ax-y" rowspan="' + yMax + '"><span>' + esc(o.yLabel) + '</span></th>';
      h += '<th class="rcm-ax">' + y + '</th>';
      for (var x = 1; x <= xMax; x++) {
        h += '<td class="rcm-gcell ' + (o.cls ? o.cls(x, y) : '') + '" data-x="' + x + '" data-y="' + y + '"' +
             (o.title ? ' title="' + esc(o.title(x, y)) + '"' : '') + '>' + o.cell(x, y) + '</td>';
      }
      h += '</tr>';
    }
    h += '<tr><th></th><th></th>';
    for (var k = 1; k <= xMax; k++) h += '<th class="rcm-ax">' + k + '</th>';
    h += '</tr><tr><th></th><th></th><th class="rcm-ax" colspan="' + xMax + '">' + esc(o.xLabel) + '</th></tr>';
    return h + '</tbody></table>';
  }

  // Legend for the four priority levels, with each level's own count.
  function priorityLegendHTML(counts) {
    return '<div class="rcm-legend">' + PRIORITIES.map(function (p) {
      return '<span class="rcm-leg"><span class="rcm-leg-sw ' + priorityClass(p) + '"></span>' + esc(p) +
        (counts && counts[p] != null ? ' <b>' + counts[p] + '</b>' : '') + '</span>';
    }).join('') + '</div>';
  }

  return {
    ACTIVITIES: ACTIVITIES, activityByNo: activityByNo, activityByName: activityByName,
    CATEGORIES: CATEGORIES, CATEGORY_NAMES: CATEGORY_NAMES, subsOf: subsOf, subNamesOf: subNamesOf,
    PROBABILITY: PROBABILITY, IMPACT: IMPACT, CONTROL: CONTROL, TREATMENTS: TREATMENTS,
    RESPONSES: RESPONSES, CONTROL_TYPES: CONTROL_TYPES, CONTROL_TYPE_NAMES: CONTROL_TYPE_NAMES,
    controlsOf: controlsOf,
    PRIORITIES: PRIORITIES, RISK_GRID: RISK_GRID, STK_GRID: STK_GRID, MENDELOW: MENDELOW,
    APPROACHES: APPROACHES,
    riskPriority: riskPriority, stkPriority: stkPriority,
    stkResponseCategory: stkResponseCategory, stkApproach: stkApproach,
    residualScore: residualScore, residualBand: residualBand,
    priorityClass: priorityClass, priorityShort: priorityShort, priorityRank: priorityRank,
    tbl: tbl, gridHTML: gridHTML, priorityLegendHTML: priorityLegendHTML,
    probabilityTableHTML: probabilityTableHTML, impactTableHTML: impactTableHTML,
    controlTableHTML: controlTableHTML, treatmentTableHTML: treatmentTableHTML,
    residualBandTableHTML: residualBandTableHTML,
    universeTableHTML: universeTableHTML, controlMasterlistHTML: controlMasterlistHTML
  };
})();
